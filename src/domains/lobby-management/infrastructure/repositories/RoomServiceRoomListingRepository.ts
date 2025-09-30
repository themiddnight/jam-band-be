import { RoomListing, RoomActivityStatus } from '../../domain/models/RoomListing';
import { SearchCriteria, SearchResult, SortBy, SortOrder } from '../../domain/models/SearchCriteria';
import { RoomListingRepository, RoomListingStatistics, GenreStatistic } from '../../domain/repositories/RoomListingRepository';
import { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';
import { RoomService } from '../../../../services/RoomService';
import { Room } from '../../../../types';

/**
 * RoomServiceRoomListingRepository
 * 
 * Adapts the existing RoomService to implement the RoomListingRepository interface.
 * Provides a bridge between the legacy room management and the new lobby domain.
 * 
 * Requirements: 1.3, 3.1, 9.2
 */
export class RoomServiceRoomListingRepository implements RoomListingRepository {
  constructor(private roomService: RoomService) {}

  async findAll(): Promise<RoomListing[]> {
    const rooms = this.roomService.getAllRooms();
    return rooms.map(room => this.mapToRoomListing(room));
  }

  async findByCriteria(criteria: SearchCriteria): Promise<SearchResult<RoomListing>> {
    const allRooms = await this.findAll();
    
    // Apply filters
    let filteredRooms = this.applyFilters(allRooms, criteria);
    
    // Apply sorting
    filteredRooms = this.applySorting(filteredRooms, criteria);
    
    // Apply pagination
    const totalCount = filteredRooms.length;
    const paginatedRooms = filteredRooms.slice(criteria.offset, criteria.offset + criteria.limit);
    
    const result: SearchResult<RoomListing> = {
      items: paginatedRooms,
      totalCount,
      hasMore: criteria.offset + criteria.limit < totalCount
    };
    
    if (criteria.offset + criteria.limit < totalCount) {
      result.nextOffset = criteria.offset + criteria.limit;
    }
    
    return result;
  }

  async findById(roomId: RoomId): Promise<RoomListing | null> {
    const room = this.roomService.getRoom(roomId.toString());
    if (!room) return null;
    
    return this.mapRoomToRoomListing(room);
  }

  async findByOwner(ownerId: UserId): Promise<RoomListing[]> {
    const allRooms = await this.findAll();
    return allRooms.filter(room => room.owner.equals(ownerId));
  }

  async findByGenre(genre: string, limit?: number): Promise<RoomListing[]> {
    const allRooms = await this.findAll();
    const genreRooms = allRooms.filter(room => room.hasGenre(genre));
    
    return limit ? genreRooms.slice(0, limit) : genreRooms;
  }

  async findByGenres(genres: string[], limit?: number): Promise<RoomListing[]> {
    const allRooms = await this.findAll();
    const genreRooms = allRooms.filter(room => room.hasAnyGenre(genres));
    
    return limit ? genreRooms.slice(0, limit) : genreRooms;
  }

  async findActive(limit?: number): Promise<RoomListing[]> {
    const allRooms = await this.findAll();
    const activeRooms = allRooms.filter(room => 
      room.getActivityStatus() === RoomActivityStatus.ACTIVE ||
      room.getActivityStatus() === RoomActivityStatus.IDLE
    );
    
    return limit ? activeRooms.slice(0, limit) : activeRooms;
  }

  async findAvailable(limit?: number): Promise<RoomListing[]> {
    const allRooms = await this.findAll();
    const availableRooms = allRooms.filter(room => 
      !room.isFull() && 
      room.isActive &&
      (room.getActivityStatus() === RoomActivityStatus.ACTIVE ||
       room.getActivityStatus() === RoomActivityStatus.IDLE)
    );
    
    return limit ? availableRooms.slice(0, limit) : availableRooms;
  }

  async findPopular(limit?: number): Promise<RoomListing[]> {
    const allRooms = await this.findAll();
    const popularRooms = allRooms
      .filter(room => room.memberCount > 0 && room.isActive)
      .sort((a, b) => {
        // Sort by member count first, then by recent activity
        if (a.memberCount !== b.memberCount) {
          return b.memberCount - a.memberCount;
        }
        return b.lastActivity.getTime() - a.lastActivity.getTime();
      });
    
    return limit ? popularRooms.slice(0, limit) : popularRooms;
  }

  async searchByText(searchTerm: string, limit?: number): Promise<RoomListing[]> {
    const allRooms = await this.findAll();
    const matchingRooms = allRooms.filter(room => room.matchesSearchTerm(searchTerm));
    
    return limit ? matchingRooms.slice(0, limit) : matchingRooms;
  }

  async getStatistics(): Promise<RoomListingStatistics> {
    const allRooms = await this.findAll();
    
    const totalRooms = allRooms.length;
    const activeRooms = allRooms.filter(room => 
      room.getActivityStatus() === RoomActivityStatus.ACTIVE
    ).length;
    const privateRooms = allRooms.filter(room => room.isPrivate).length;
    const publicRooms = totalRooms - privateRooms;
    const fullRooms = allRooms.filter(room => room.isFull()).length;
    const availableRooms = allRooms.filter(room => !room.isFull() && room.isActive).length;
    
    const totalMembers = allRooms.reduce((sum, room) => sum + room.memberCount, 0);
    const averageMemberCount = totalRooms > 0 ? totalMembers / totalRooms : 0;
    
    // Calculate genre statistics
    const genreMap = new Map<string, { roomCount: number; totalMembers: number }>();
    allRooms.forEach(room => {
      room.genres.forEach(genre => {
        const existing = genreMap.get(genre) || { roomCount: 0, totalMembers: 0 };
        genreMap.set(genre, {
          roomCount: existing.roomCount + 1,
          totalMembers: existing.totalMembers + room.memberCount
        });
      });
    });
    
    const popularGenres: GenreStatistic[] = Array.from(genreMap.entries())
      .map(([genre, stats]) => ({
        genre,
        roomCount: stats.roomCount,
        totalMembers: stats.totalMembers,
        averageMembers: stats.roomCount > 0 ? stats.totalMembers / stats.roomCount : 0
      }))
      .sort((a, b) => b.roomCount - a.roomCount);
    
    // Calculate activity distribution
    const activityDistribution = {
      active: allRooms.filter(room => room.getActivityStatus() === RoomActivityStatus.ACTIVE).length,
      idle: allRooms.filter(room => room.getActivityStatus() === RoomActivityStatus.IDLE).length,
      inactive: allRooms.filter(room => room.getActivityStatus() === RoomActivityStatus.INACTIVE).length
    };
    
    return {
      totalRooms,
      activeRooms,
      privateRooms,
      publicRooms,
      fullRooms,
      availableRooms,
      averageMemberCount,
      popularGenres,
      activityDistribution
    };
  }

  async save(_roomListing: RoomListing): Promise<void> {
    // Note: This is a read-only adapter for the existing RoomService
    // Actual room updates should go through the room management domain
    throw new Error('RoomServiceRoomListingRepository is read-only. Use room management domain for updates.');
  }

  async saveMany(_roomListings: RoomListing[]): Promise<void> {
    throw new Error('RoomServiceRoomListingRepository is read-only. Use room management domain for updates.');
  }

  async remove(_roomId: RoomId): Promise<void> {
    throw new Error('RoomServiceRoomListingRepository is read-only. Use room management domain for updates.');
  }

  async updateActivity(_roomId: RoomId, _lastActivity: Date): Promise<void> {
    // This could be implemented if needed, but for now it's read-only
    throw new Error('RoomServiceRoomListingRepository is read-only. Use room management domain for updates.');
  }

  async updateMemberCount(_roomId: RoomId, _memberCount: number): Promise<void> {
    throw new Error('RoomServiceRoomListingRepository is read-only. Use room management domain for updates.');
  }

  async refresh(): Promise<void> {
    // The RoomService maintains its own state, so no explicit refresh needed
    // In a real implementation, this might sync with a database
  }

  async clearInactive(_olderThan: Date): Promise<number> {
    // This would need to be implemented in coordination with the RoomService
    // For now, return 0 as no cleanup is performed
    return 0;
  }

  private mapToRoomListing(roomSummary: any): RoomListing {
    // Map from RoomService.getAllRooms() format to RoomListing
    return new RoomListing(
      RoomId.fromString(roomSummary.id),
      roomSummary.name,
      roomSummary.userCount,
      8, // Default max members - this should come from room settings
      roomSummary.isPrivate,
      roomSummary.isPrivate, // Assume private rooms require approval
      [], // Genres not available in current format - would need to be added
      undefined, // Description not available
      UserId.fromString(roomSummary.owner),
      'Unknown', // Owner username not available in summary
      roomSummary.createdAt,
      new Date(), // Use current time as last activity - should be tracked properly
      true // Assume active if in the list
    );
  }

  private mapRoomToRoomListing(room: Room): RoomListing {
    // Map from full Room object to RoomListing
    const ownerUser = room.users.get(room.owner);
    
    return new RoomListing(
      RoomId.fromString(room.id),
      room.name,
      room.users.size,
      8, // Default max members - should come from room settings
      room.isPrivate,
      room.isPrivate, // Assume private rooms require approval
      [], // Genres not available - would need to be added to Room type
      undefined, // Description not available
      UserId.fromString(room.owner),
      ownerUser?.username || 'Unknown',
      room.createdAt,
      new Date(), // Should track actual last activity
      true // Assume active
    );
  }

  private applyFilters(rooms: RoomListing[], criteria: SearchCriteria): RoomListing[] {
    return rooms.filter(room => {
      // Text search filter
      if (criteria.isTextSearch() && !room.matchesSearchTerm(criteria.searchTerm!)) {
        return false;
      }

      // Genre filter
      if (criteria.genres.length > 0 && !room.hasAnyGenre(criteria.genres)) {
        return false;
      }

      // Privacy filter
      if (!criteria.includePrivate && room.isPrivate) {
        return false;
      }

      // Full rooms filter
      if (!criteria.includeFullRooms && room.isFull()) {
        return false;
      }

      // Member count filters
      if (criteria.minMembers !== undefined && room.memberCount < criteria.minMembers) {
        return false;
      }

      if (criteria.maxMembers !== undefined && room.memberCount > criteria.maxMembers) {
        return false;
      }

      // Capacity status filter
      if (criteria.capacityStatus && !criteria.capacityStatus.includes(room.getCapacityStatus())) {
        return false;
      }

      // Activity status filter
      if (criteria.activityStatus && !criteria.activityStatus.includes(room.getActivityStatus())) {
        return false;
      }

      return true;
    });
  }

  private applySorting(rooms: RoomListing[], criteria: SearchCriteria): RoomListing[] {
    return [...rooms].sort((a, b) => {
      let comparison = 0;

      switch (criteria.sortBy) {
        case SortBy.NAME:
          comparison = a.name.localeCompare(b.name);
          break;
        
        case SortBy.MEMBER_COUNT:
          comparison = a.memberCount - b.memberCount;
          break;
        
        case SortBy.CREATED_AT:
          comparison = a.createdAt.getTime() - b.createdAt.getTime();
          break;
        
        case SortBy.LAST_ACTIVITY:
          comparison = a.lastActivity.getTime() - b.lastActivity.getTime();
          break;
        
        case SortBy.RELEVANCE:
          // For relevance, we'd need to calculate scores
          // For now, fall back to activity
          comparison = a.lastActivity.getTime() - b.lastActivity.getTime();
          break;
        
        default:
          comparison = a.lastActivity.getTime() - b.lastActivity.getTime();
      }

      return criteria.sortOrder === SortOrder.DESC ? -comparison : comparison;
    });
  }
}