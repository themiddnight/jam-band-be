import { RoomListing } from '../../domain/models/RoomListing';
import { SearchCriteria, SearchResult } from '../../domain/models/SearchCriteria';
import { RoomListingRepository, RoomListingStatistics } from '../../domain/repositories/RoomListingRepository';
import { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';
import { RoomListingCache } from '../cache/RoomListingCache';
import { loggingService } from '../../../../services/LoggingService';

/**
 * CachedRoomListingRepository
 * 
 * Decorator for RoomListingRepository that adds caching for improved performance.
 * Ensures efficient room discovery without affecting room performance.
 * 
 * Requirements: 9.6
 */
export class CachedRoomListingRepository implements RoomListingRepository {
  private cache: RoomListingCache;

  constructor(private baseRepository: RoomListingRepository) {
    this.cache = new RoomListingCache();
  }

  async findAll(): Promise<RoomListing[]> {
    // Try cache first
    const cached = this.cache.getRoomListings();
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from base repository
    const listings = await this.baseRepository.findAll();
    this.cache.setRoomListings(listings);
    
    return listings;
  }

  async findByCriteria(criteria: SearchCriteria): Promise<SearchResult<RoomListing>> {
    // Try cache first
    const cached = this.cache.getSearchResults(criteria);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from base repository
    const result = await this.baseRepository.findByCriteria(criteria);
    this.cache.setSearchResults(criteria, result);
    
    return result;
  }

  async findById(roomId: RoomId): Promise<RoomListing | null> {
    // For individual room lookups, check if we have it in the cached listings
    const allListings = await this.findAll();
    return allListings.find(room => room.id.equals(roomId)) || null;
  }

  async findByOwner(ownerId: UserId): Promise<RoomListing[]> {
    const allListings = await this.findAll();
    return allListings.filter(room => room.owner.equals(ownerId));
  }

  async findByGenre(genre: string, limit?: number): Promise<RoomListing[]> {
    const allListings = await this.findAll();
    const genreRooms = allListings.filter(room => room.hasGenre(genre));
    
    return limit ? genreRooms.slice(0, limit) : genreRooms;
  }

  async findByGenres(genres: string[], limit?: number): Promise<RoomListing[]> {
    const allListings = await this.findAll();
    const genreRooms = allListings.filter(room => room.hasAnyGenre(genres));
    
    return limit ? genreRooms.slice(0, limit) : genreRooms;
  }

  async findActive(limit?: number): Promise<RoomListing[]> {
    const allListings = await this.findAll();
    const activeRooms = allListings.filter(room => 
      room.isActive && room.isRecentlyActive()
    );
    
    return limit ? activeRooms.slice(0, limit) : activeRooms;
  }

  async findAvailable(limit?: number): Promise<RoomListing[]> {
    const allListings = await this.findAll();
    const availableRooms = allListings.filter(room => 
      !room.isFull() && room.isActive
    );
    
    return limit ? availableRooms.slice(0, limit) : availableRooms;
  }

  async findPopular(limit?: number): Promise<RoomListing[]> {
    const allListings = await this.findAll();
    const popularRooms = allListings
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
    const allListings = await this.findAll();
    const matchingRooms = allListings.filter(room => room.matchesSearchTerm(searchTerm));
    
    return limit ? matchingRooms.slice(0, limit) : matchingRooms;
  }

  async getStatistics(): Promise<RoomListingStatistics> {
    // Try cache first
    const cached = this.cache.getStatistics();
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from base repository
    const statistics = await this.baseRepository.getStatistics();
    this.cache.setStatistics(statistics);
    
    return statistics;
  }

  async save(roomListing: RoomListing): Promise<void> {
    await this.baseRepository.save(roomListing);
    
    // Update cache
    this.cache.updateRoom(roomListing);
    this.cache.invalidateStatistics();
  }

  async saveMany(roomListings: RoomListing[]): Promise<void> {
    await this.baseRepository.saveMany(roomListings);
    
    // Invalidate cache since multiple rooms changed
    this.cache.invalidateAll();
  }

  async remove(roomId: RoomId): Promise<void> {
    await this.baseRepository.remove(roomId);
    
    // Update cache
    this.cache.removeRoom(roomId.toString());
    this.cache.invalidateStatistics();
  }

  async updateActivity(roomId: RoomId, lastActivity: Date): Promise<void> {
    await this.baseRepository.updateActivity(roomId, lastActivity);
    
    // Invalidate cache since room activity changed
    this.cache.invalidateRoomListings();
    this.cache.invalidateSearchResults();
  }

  async updateMemberCount(roomId: RoomId, memberCount: number): Promise<void> {
    await this.baseRepository.updateMemberCount(roomId, memberCount);
    
    // Invalidate cache since room member count changed
    this.cache.invalidateRoomListings();
    this.cache.invalidateSearchResults();
    this.cache.invalidateStatistics();
  }

  async refresh(): Promise<void> {
    await this.baseRepository.refresh();
    
    // Invalidate all caches after refresh
    this.cache.invalidateAll();
    
    loggingService.logInfo('CachedRoomListingRepository: Cache invalidated after refresh');
  }

  async clearInactive(olderThan: Date): Promise<number> {
    const count = await this.baseRepository.clearInactive(olderThan);
    
    if (count > 0) {
      // Invalidate cache since rooms were removed
      this.cache.invalidateAll();
      
      loggingService.logInfo('CachedRoomListingRepository: Cache invalidated after cleanup', {
        removedCount: count
      });
    }
    
    return count;
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStatistics() {
    return this.cache.getCacheStats();
  }

  /**
   * Manually invalidate cache (for administrative purposes)
   */
  invalidateCache(): void {
    this.cache.invalidateAll();
    loggingService.logInfo('CachedRoomListingRepository: Cache manually invalidated');
  }

  /**
   * Shutdown the cached repository
   */
  shutdown(): void {
    this.cache.shutdown();
  }
}