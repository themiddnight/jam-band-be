import { Room } from '../domain/models/Room';
import { RoomSettings, RoomSettingsOptions } from '../domain/models/RoomSettings';
import { MemberRole } from '../domain/models/Member';
import { RoomRepository } from '../domain/repositories/RoomRepository';
import { UserRepository } from '../domain/repositories/UserRepository';
import { EventBus } from '../../../shared/domain/events/EventBus';
import { RoomId, UserId } from '../../../shared/domain/models/ValueObjects';
import { Monitor } from '../../../shared/infrastructure/monitoring';

/**
 * Commands for Room operations
 */
export interface CreateRoomCommand {
  name: string;
  ownerId: string;
  ownerUsername: string;
  settings?: {
    isPrivate?: boolean;
    maxMembers?: number;
    allowAudience?: boolean;
    requireApproval?: boolean;
    genres?: string[];
    description?: string;
  };
}

export interface JoinRoomCommand {
  roomId: string;
  userId: string;
  username: string;
  role?: MemberRole;
}

export interface TransferOwnershipCommand {
  roomId: string;
  currentOwnerId: string;
  newOwnerId: string;
}

export interface UpdateRoomSettingsCommand {
  roomId: string;
  updatedBy: string;
  settings: {
    isPrivate?: boolean;
    maxMembers?: number;
    allowAudience?: boolean;
    requireApproval?: boolean;
    genres?: string[];
    description?: string;
  };
}

/**
 * RoomApplicationService - Coordinates between domain models and infrastructure
 * 
 * This service orchestrates room-related operations, ensuring business rules
 * are enforced and domain events are published.
 * 
 * Requirements: 1.5, 4.2
 */
export class RoomApplicationService {
  constructor(
    private roomRepository: RoomRepository,
    private userRepository: UserRepository,
    private eventBus: EventBus
  ) {}

  /**
   * Create a new room
   */
  @Monitor({ 
    context: 'room-management', 
    metricName: 'createRoom',
    tags: { operation: 'create' }
  })
  async createRoom(command: CreateRoomCommand): Promise<{ roomId: string; room: Room }> {
    // Validate owner exists
    const ownerId = UserId.fromString(command.ownerId);
    const owner = await this.userRepository.findById(ownerId);
    if (!owner) {
      throw new Error(`Owner with ID ${command.ownerId} not found`);
    }

    // Check if owner can create rooms
    if (!owner.canCreateRoom()) {
      throw new Error('User does not have permission to create rooms');
    }

    // Create room settings
    // Create room settings
    let settings: RoomSettings;
    if (command.settings) {
      const settingsOptions: Partial<RoomSettingsOptions> = {
        isPrivate: command.settings.isPrivate || false,
        maxMembers: command.settings.maxMembers || 8,
        allowAudience: command.settings.allowAudience !== false,
        requireApproval: command.settings.requireApproval || false,
        genres: command.settings.genres || []
      };
      
      if (command.settings.description !== undefined) {
        settingsOptions.description = command.settings.description;
      }
      
      settings = RoomSettings.create(settingsOptions);
    } else {
      settings = RoomSettings.default();
    }

    // Create room
    const room = Room.create(command.name, ownerId, settings);

    // Save room
    await this.roomRepository.save(room);

    // Publish domain events
    await this.eventBus.publishAll(room.domainEvents);
    room.clearDomainEvents();

    return {
      roomId: room.id.toString(),
      room
    };
  }

  /**
   * Join a room
   */
  @Monitor({ 
    context: 'room-management', 
    metricName: 'joinRoom',
    tags: { operation: 'join' }
  })
  async joinRoom(command: JoinRoomCommand): Promise<void> {
    // Find room
    const roomId = RoomId.fromString(command.roomId);
    const room = await this.roomRepository.findById(roomId);
    if (!room) {
      throw new Error(`Room with ID ${command.roomId} not found`);
    }

    // Find user
    const userId = UserId.fromString(command.userId);
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error(`User with ID ${command.userId} not found`);
    }

    // Check if user can join rooms
    if (!user.canJoinRoom()) {
      throw new Error('User does not have permission to join rooms');
    }

    // Check if user can join this specific room
    const role = command.role || MemberRole.BAND_MEMBER;
    if (!room.canUserJoin(userId, role)) {
      throw new Error('User cannot join this room');
    }

    // Add member to room
    room.addMember(userId, command.username, role);

    // Save room
    await this.roomRepository.save(room);

    // Publish domain events
    await this.eventBus.publishAll(room.domainEvents);
    room.clearDomainEvents();
  }

  /**
   * Leave a room
   */
  @Monitor({ 
    context: 'room-management', 
    metricName: 'leaveRoom',
    tags: { operation: 'leave' }
  })
  async leaveRoom(roomId: string, userId: string): Promise<void> {
    // Find room
    const roomIdObj = RoomId.fromString(roomId);
    const room = await this.roomRepository.findById(roomIdObj);
    if (!room) {
      throw new Error(`Room with ID ${roomId} not found`);
    }

    const userIdObj = UserId.fromString(userId);

    // Check if user is in room
    if (!room.hasMember(userIdObj)) {
      throw new Error('User is not in this room');
    }

    // If user is owner, handle ownership transfer or room closure
    if (room.isOwner(userIdObj)) {
      const otherMembers = room.members.filter(m => !m.userId.equals(userIdObj));
      
      if (otherMembers.length > 0) {
        // Transfer ownership to first available member
        const newOwner = otherMembers[0];
        if (newOwner) {
          room.transferOwnership(newOwner.userId);
        }
      } else {
        // Close room if no other members
        room.closeRoom(userIdObj, 'Owner left and no other members');
        await this.roomRepository.delete(roomIdObj);
        
        // Publish domain events
        await this.eventBus.publishAll(room.domainEvents);
        room.clearDomainEvents();
        return;
      }
    }

    // Remove member from room
    room.removeMember(userIdObj);

    // Save room
    await this.roomRepository.save(room);

    // Publish domain events
    await this.eventBus.publishAll(room.domainEvents);
    room.clearDomainEvents();
  }

  /**
   * Transfer room ownership
   */
  async transferOwnership(command: TransferOwnershipCommand): Promise<void> {
    // Find room
    const roomId = RoomId.fromString(command.roomId);
    const room = await this.roomRepository.findById(roomId);
    if (!room) {
      throw new Error(`Room with ID ${command.roomId} not found`);
    }

    const currentOwnerId = UserId.fromString(command.currentOwnerId);
    const newOwnerId = UserId.fromString(command.newOwnerId);

    // Verify current owner
    if (!room.isOwner(currentOwnerId)) {
      throw new Error('User is not the current room owner');
    }

    // Transfer ownership
    room.transferOwnership(newOwnerId);

    // Save room
    await this.roomRepository.save(room);

    // Publish domain events
    await this.eventBus.publishAll(room.domainEvents);
    room.clearDomainEvents();
  }

  /**
   * Update room settings
   */
  async updateRoomSettings(command: UpdateRoomSettingsCommand): Promise<void> {
    // Find room
    const roomId = RoomId.fromString(command.roomId);
    const room = await this.roomRepository.findById(roomId);
    if (!room) {
      throw new Error(`Room with ID ${command.roomId} not found`);
    }

    const updatedBy = UserId.fromString(command.updatedBy);

    // Create new settings
    const currentSettings = room.settings;
    const settingsOptions: Partial<RoomSettingsOptions> = {
      isPrivate: command.settings.isPrivate !== undefined ? command.settings.isPrivate : currentSettings.isPrivate,
      maxMembers: command.settings.maxMembers !== undefined ? command.settings.maxMembers : currentSettings.maxMembers,
      allowAudience: command.settings.allowAudience !== undefined ? command.settings.allowAudience : currentSettings.allowAudience,
      requireApproval: command.settings.requireApproval !== undefined ? command.settings.requireApproval : currentSettings.requireApproval,
      genres: command.settings.genres !== undefined ? command.settings.genres : currentSettings.genres
    };
    
    if (command.settings.description !== undefined) {
      settingsOptions.description = command.settings.description;
    } else if (currentSettings.description !== undefined) {
      settingsOptions.description = currentSettings.description;
    }
    
    const newSettings = RoomSettings.create(settingsOptions);

    // Update settings
    room.updateSettings(newSettings, updatedBy);

    // Save room
    await this.roomRepository.save(room);

    // Publish domain events
    await this.eventBus.publishAll(room.domainEvents);
    room.clearDomainEvents();
  }

  /**
   * Get room by ID
   */
  async getRoomById(roomId: string): Promise<Room | null> {
    const roomIdObj = RoomId.fromString(roomId);
    return await this.roomRepository.findById(roomIdObj);
  }

  /**
   * Get rooms by owner
   */
  async getRoomsByOwner(ownerId: string): Promise<Room[]> {
    const ownerIdObj = UserId.fromString(ownerId);
    return await this.roomRepository.findByOwner(ownerIdObj);
  }

  /**
   * Get public rooms
   */
  async getPublicRooms(): Promise<Room[]> {
    return await this.roomRepository.findPublicRooms();
  }

  /**
   * Search rooms by name
   */
  async searchRoomsByName(pattern: string): Promise<Room[]> {
    return await this.roomRepository.findByNamePattern(pattern);
  }

  /**
   * Get rooms with pagination
   */
  async getRoomsWithPagination(offset: number, limit: number): Promise<Room[]> {
    return await this.roomRepository.findWithPagination(offset, limit);
  }
}