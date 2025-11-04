/**
 * EventWebSocketBridge - Connects domain events to WebSocket broadcasting
 * 
 * This service subscribes to domain events and translates them into
 * appropriate WebSocket messages for real-time client updates.
 * 
 * Requirements: 5.1, 5.4
 */

import { Server } from 'socket.io';
import { EventBus, EventHandler } from '../../domain/events/EventBus';
import { NamespaceManager } from '../../../services/NamespaceManager';
import { 
  RoomCreated, 
  MemberJoined, 
  MemberLeft, 
  OwnershipTransferred, 
  RoomSettingsUpdated, 
  RoomClosed 
} from '../../domain/events/RoomEvents';
import { UserCreated, UserProfileUpdated } from '../../domain/events/UserEvents';

export class EventWebSocketBridge {
  constructor(
    private eventBus: EventBus,
    private io: Server,
    private namespaceManager: NamespaceManager
  ) {
    this.setupEventHandlers();
  }

  /**
   * Setup all event handlers that bridge domain events to WebSocket messages
   */
  private setupEventHandlers(): void {
    // Room Management Events
    this.eventBus.subscribe('RoomCreated', this.handleRoomCreated.bind(this));
    this.eventBus.subscribe('MemberJoined', this.handleMemberJoined.bind(this));
    this.eventBus.subscribe('MemberLeft', this.handleMemberLeft.bind(this));
    this.eventBus.subscribe('OwnershipTransferred', this.handleOwnershipTransferred.bind(this));
    this.eventBus.subscribe('RoomSettingsUpdated', this.handleRoomSettingsUpdated.bind(this));
    this.eventBus.subscribe('RoomClosed', this.handleRoomClosed.bind(this));

    // User Management Events
    this.eventBus.subscribe('UserCreated', this.handleUserCreated.bind(this));
    this.eventBus.subscribe('UserProfileUpdated', this.handleUserProfileUpdated.bind(this));
  }

  /**
   * Handle RoomCreated event - broadcast to all clients
   */
  private handleRoomCreated: EventHandler<RoomCreated> = async (event) => {
    console.log('🏠 Broadcasting room created event:', event.aggregateId);
    
    this.io.emit('room_created_broadcast', {
      id: event.aggregateId,
      name: event.roomName,
      owner: event.ownerId,
      isPrivate: event.isPrivate,
      userCount: 1, // Owner is the first user
      createdAt: event.occurredOn.toISOString()
    });
  };

  /**
   * Handle MemberJoined event - notify room members
   */
  private handleMemberJoined: EventHandler<MemberJoined> = async (event) => {
    console.log('👤 Broadcasting member joined event:', event.userId, 'to room:', event.aggregateId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace) {
      roomNamespace.emit('user_joined', {
        user: {
          id: event.userId,
          username: event.username,
          role: event.role
        }
      });

      // Also emit room state update for consistency
      roomNamespace.emit('room_state_updated', {
        room: {
          id: event.aggregateId,
          lastActivity: event.occurredOn.toISOString()
        }
      });
    }
  };

  /**
   * Handle MemberLeft event - notify room members
   */
  private handleMemberLeft: EventHandler<MemberLeft> = async (event) => {
    console.log('👋 Broadcasting member left event:', event.userId, 'from room:', event.aggregateId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace) {
      roomNamespace.emit('user_left', {
        user: {
          id: event.userId,
          username: event.username
        }
      });

      // Also emit room state update for consistency
      roomNamespace.emit('room_state_updated', {
        room: {
          id: event.aggregateId,
          lastActivity: event.occurredOn.toISOString()
        }
      });
    }
  };

  /**
   * Handle OwnershipTransferred event - notify room members
   */
  private handleOwnershipTransferred: EventHandler<OwnershipTransferred> = async (event) => {
    console.log('👑 Broadcasting ownership transferred event in room:', event.aggregateId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace) {
      roomNamespace.emit('ownership_transferred', {
        newOwner: {
          id: event.newOwnerId
        },
        oldOwner: {
          id: event.previousOwnerId
        }
      });
    }
  };

  /**
   * Handle RoomSettingsUpdated event - notify room members
   */
  private handleRoomSettingsUpdated: EventHandler<RoomSettingsUpdated> = async (event) => {
    console.log('⚙️ Broadcasting room settings updated event in room:', event.aggregateId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace) {
      roomNamespace.emit('room_settings_updated', {
        roomId: event.aggregateId,
        changes: event.changes,
        updatedBy: event.updatedBy
      });
    }
  };

  /**
   * Handle RoomClosed event - notify all clients
   */
  private handleRoomClosed: EventHandler<RoomClosed> = async (event) => {
    console.log('🚪 Broadcasting room closed event:', event.aggregateId);
    
    // Notify room members first
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace) {
      roomNamespace.emit('room_closed', {
        message: event.reason || 'Room has been closed',
        closedBy: event.closedBy
      });
    }

    // Broadcast to all clients for lobby updates
    this.io.emit('room_closed_broadcast', {
      roomId: event.aggregateId,
      reason: event.reason
    });
  };

  /**
   * Handle UserCreated event - broadcast to relevant contexts
   */
  private handleUserCreated: EventHandler<UserCreated> = async (event) => {
    console.log('👤 User created:', event.aggregateId);
    
    // This could be used for user management dashboards or analytics
    // For now, we'll just log it as user creation is typically not broadcast
  };

  /**
   * Handle UserProfileUpdated event - notify relevant rooms
   */
  private handleUserProfileUpdated: EventHandler<UserProfileUpdated> = async (event) => {
    console.log('📝 User profile updated:', event.aggregateId);
    
    // This could notify rooms where the user is present about profile changes
    // Implementation would depend on specific requirements
  };

  /**
   * Cleanup method to unsubscribe from all events
   */
  cleanup(): void {
    // Note: EventBus interface doesn't currently support unsubscribing all handlers
    // This would need to be implemented if cleanup is required
    console.log('🧹 EventWebSocketBridge cleanup requested');
  }
}