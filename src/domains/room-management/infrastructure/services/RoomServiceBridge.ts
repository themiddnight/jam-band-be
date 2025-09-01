/**
 * RoomServiceBridge - Integration layer between legacy RoomService and new repositories
 * 
 * This service provides a bridge between the existing RoomService (which uses Map-based storage)
 * and the new repository-based domain models. It ensures backward compatibility while
 * gradually migrating to the new architecture.
 * 
 * Requirements: 1.3, 1.4, 7.3
 */

import { RoomService } from '../../../../services/RoomService';
import { RoomRepository } from '../../domain/repositories/RoomRepository';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { Room } from '../../domain/models/Room';
import { User, UserProfile, Permission } from '../../domain/models/User';
import { RoomSettings } from '../../domain/models/RoomSettings';
import { MemberRole } from '../../domain/models/Member';
import { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';
import { Room as LegacyRoom, User as LegacyUser } from '../../../../types';

export class RoomServiceBridge {
  constructor(
    private roomService: RoomService,
    private roomRepository: RoomRepository,
    private userRepository: UserRepository
  ) {}

  /**
   * Sync a legacy room to the new repository
   */
  async syncLegacyRoomToRepository(legacyRoom: LegacyRoom): Promise<Room> {
    try {
      // Check if room already exists in repository
      const roomId = RoomId.fromString(legacyRoom.id);
      let room = await this.roomRepository.findById(roomId);
      
      if (room) {
        return room; // Already synced
      }

      // Ensure owner user exists in repository
      const ownerId = UserId.fromString(legacyRoom.owner);
      const ownerUser = legacyRoom.users.get(legacyRoom.owner);
      if (ownerUser) {
        await this.syncLegacyUserToRepository(ownerUser);
      }

      // Create room settings from legacy room
      const settings = RoomSettings.create({
        isPrivate: legacyRoom.isPrivate || false,
        maxMembers: 8, // Default from legacy system
        allowAudience: true, // Default from legacy system
        requireApproval: legacyRoom.isPrivate || false,
        genres: [] // Legacy rooms don't have genres
      });

      // Create new Room aggregate
      room = Room.create(legacyRoom.name, ownerId, settings);

      // Override the generated ID with the legacy ID to maintain consistency
      (room as any)._id = roomId;

      // Add existing members (sync users first)
      for (const [userId, legacyUser] of legacyRoom.users.entries()) {
        // Sync user to repository
        await this.syncLegacyUserToRepository(legacyUser);
        
        if (userId !== legacyRoom.owner) { // Owner is already added in Room.create
          const memberRole = this.mapLegacyRoleToMemberRole(legacyUser.role);
          room.addMember(UserId.fromString(userId), legacyUser.username, memberRole);
        }
      }

      // Clear domain events to avoid publishing events for legacy data
      room.clearDomainEvents();

      // Save to repository
      await this.roomRepository.save(room);

      return room;
    } catch (error) {
      console.error('Error syncing legacy room to repository:', error);
      throw error;
    }
  }

  /**
   * Sync a legacy user to the new repository
   */
  async syncLegacyUserToRepository(legacyUser: LegacyUser): Promise<User> {
    try {
      // Check if user already exists in repository
      const userId = UserId.fromString(legacyUser.id);
      let user = await this.userRepository.findById(userId);
      
      if (user) {
        return user; // Already synced
      }

      // Create user profile from legacy user
      const profile = new UserProfile(
        legacyUser.username, // Use username as display name
        undefined, // Legacy users don't have bio
        undefined, // Legacy users don't have avatar
        legacyUser.currentInstrument ? [legacyUser.currentInstrument] : []
      );

      // Create new User aggregate
      user = User.create(legacyUser.username, profile);

      // Override the generated ID with the legacy ID to maintain consistency
      (user as any)._id = userId;

      // Set permissions based on legacy role
      this.setPermissionsFromLegacyRole(user, legacyUser.role);

      // Clear domain events to avoid publishing events for legacy data
      user.clearDomainEvents();

      // Save to repository
      await this.userRepository.save(user);

      return user;
    } catch (error) {
      console.error('Error syncing legacy user to repository:', error);
      throw error;
    }
  }

  /**
   * Get room using repository with fallback to legacy service
   */
  async getRoomWithFallback(roomId: string): Promise<Room | null> {
    try {
      // Try repository first
      const roomIdObj = RoomId.fromString(roomId);
      let room = await this.roomRepository.findById(roomIdObj);
      
      if (room) {
        return room;
      }

      // Fallback to legacy service and sync
      const legacyRoom = this.roomService.getRoom(roomId);
      
      if (legacyRoom) {
        room = await this.syncLegacyRoomToRepository(legacyRoom);
        return room;
      }

      return null;
    } catch (error) {
      console.error('Error getting room with fallback:', error);
      return null;
    }
  }

  /**
   * Get user using repository with fallback to legacy service
   */
  async getUserWithFallback(userId: string): Promise<User | null> {
    try {
      // Try repository first
      const userIdObj = UserId.fromString(userId);
      let user = await this.userRepository.findById(userIdObj);
      
      if (user) {
        return user;
      }

      // For users, we need to create them from the context where we have user data
      // This method is mainly for existing users that might be in rooms
      return null;
    } catch (error) {
      console.error('Error getting user with fallback:', error);
      return null;
    }
  }

  /**
   * Sync all legacy rooms to repositories
   */
  async syncAllLegacyRooms(): Promise<void> {
    try {
      const allRooms = this.roomService.getAllRooms();
      
      for (const roomSummary of allRooms) {
        const legacyRoom = this.roomService.getRoom(roomSummary.id);
        if (legacyRoom) {
          await this.syncLegacyRoomToRepository(legacyRoom);
          
          // Sync all users in the room
          for (const [userId, legacyUser] of legacyRoom.users.entries()) {
            await this.syncLegacyUserToRepository(legacyUser);
          }
        }
      }
    } catch (error) {
      console.error('Error syncing all legacy rooms:', error);
      throw error;
    }
  }

  /**
   * Map legacy role to new MemberRole enum
   */
  private mapLegacyRoleToMemberRole(legacyRole: string): MemberRole {
    switch (legacyRole) {
      case 'room_owner':
        return MemberRole.OWNER;
      case 'band_member':
        return MemberRole.BAND_MEMBER;
      case 'audience':
        return MemberRole.AUDIENCE;
      default:
        return MemberRole.BAND_MEMBER; // Default fallback
    }
  }

  /**
   * Set permissions based on legacy role
   */
  private setPermissionsFromLegacyRole(user: User, legacyRole: string): void {
    switch (legacyRole) {
      case 'room_owner':
        user.grantPermission(Permission.CREATE_ROOMS);
        user.grantPermission(Permission.JOIN_ROOMS);
        user.grantPermission(Permission.KICK_USERS);
        user.grantPermission(Permission.MODERATE_ROOMS);
        break;
      case 'band_member':
        user.grantPermission(Permission.CREATE_ROOMS);
        user.grantPermission(Permission.JOIN_ROOMS);
        break;
      case 'audience':
        user.grantPermission(Permission.JOIN_ROOMS);
        break;
      default:
        user.grantPermission(Permission.JOIN_ROOMS);
        break;
    }
  }

  /**
   * Update legacy room from domain model
   * This ensures changes made through domain models are reflected in the legacy system
   */
  updateLegacyRoomFromDomain(room: Room): void {
    try {
      const roomId = room.id.toString();
      const legacyRoom = this.roomService.getRoom(roomId);
      
      if (!legacyRoom) {
        console.warn('Legacy room not found for domain room:', roomId);
        return;
      }

      // Update basic properties
      legacyRoom.name = room.name;
      legacyRoom.owner = room.owner.toString();
      legacyRoom.isPrivate = room.settings.isPrivate;

      // Update members
      legacyRoom.users.clear();
      for (const member of room.members) {
        const legacyUser: LegacyUser = {
          id: member.userId.toString(),
          username: member.username,
          role: this.mapMemberRoleToLegacyRole(member.role),
          isReady: true // Default for existing members
        };
        legacyRoom.users.set(member.userId.toString(), legacyUser);
      }
    } catch (error) {
      console.error('Error updating legacy room from domain:', error);
    }
  }

  /**
   * Map MemberRole to legacy role string
   */
  private mapMemberRoleToLegacyRole(memberRole: MemberRole): 'room_owner' | 'band_member' | 'audience' {
    switch (memberRole) {
      case MemberRole.OWNER:
        return 'room_owner';
      case MemberRole.BAND_MEMBER:
        return 'band_member';
      case MemberRole.AUDIENCE:
        return 'audience';
      default:
        return 'band_member';
    }
  }
}