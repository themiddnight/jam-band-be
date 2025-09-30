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
import {
  UserJoinedRoom,
  UserInstrumentsReady,
  UserAudioRoutingReady,
  UserVoiceConnectionReady,
  UserReadyForPlayback,
  UserOnboardingFailed,
  UserOnboardingTimeout
} from '../../domain/events/UserOnboardingEvents';
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

    // User Onboarding Events
    this.eventBus.subscribe('UserJoinedRoom', this.handleUserJoinedRoom.bind(this));
    this.eventBus.subscribe('UserInstrumentsReady', this.handleUserInstrumentsReady.bind(this));
    this.eventBus.subscribe('UserAudioRoutingReady', this.handleUserAudioRoutingReady.bind(this));
    this.eventBus.subscribe('UserVoiceConnectionReady', this.handleUserVoiceConnectionReady.bind(this));
    this.eventBus.subscribe('UserReadyForPlayback', this.handleUserReadyForPlayback.bind(this));
    this.eventBus.subscribe('UserOnboardingFailed', this.handleUserOnboardingFailed.bind(this));
    this.eventBus.subscribe('UserOnboardingTimeout', this.handleUserOnboardingTimeout.bind(this));

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
   * Handle UserJoinedRoom event - start onboarding coordination
   */
  private handleUserJoinedRoom: EventHandler<UserJoinedRoom> = async (event) => {
    console.log('🎯 User joined room, starting onboarding coordination:', event.userId, 'in room:', event.aggregateId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.aggregateId);
    if (roomNamespace) {
      roomNamespace.emit('user_onboarding_started', {
        userId: event.userId,
        username: event.username,
        role: event.role,
        onboardingId: event.eventId
      });
    }
  };

  /**
   * Handle UserInstrumentsReady event - update onboarding progress
   */
  private handleUserInstrumentsReady: EventHandler<UserInstrumentsReady> = async (event) => {
    console.log('🎸 User instruments ready:', event.userId, 'in room:', event.roomId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace) {
      roomNamespace.emit('user_onboarding_progress', {
        userId: event.userId,
        step: 'instruments_ready',
        instruments: event.instruments,
        progress: 33 // 1 of 3 steps complete
      });
    }
  };

  /**
   * Handle UserAudioRoutingReady event - update onboarding progress
   */
  private handleUserAudioRoutingReady: EventHandler<UserAudioRoutingReady> = async (event) => {
    console.log('🔊 User audio routing ready:', event.userId, 'in room:', event.roomId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace) {
      roomNamespace.emit('user_onboarding_progress', {
        userId: event.userId,
        step: 'audio_routing_ready',
        audioBusId: event.audioBusId,
        progress: 66 // 2 of 3 steps complete
      });
    }
  };

  /**
   * Handle UserVoiceConnectionReady event - update onboarding progress
   */
  private handleUserVoiceConnectionReady: EventHandler<UserVoiceConnectionReady> = async (event) => {
    console.log('🎤 User voice connection ready:', event.userId, 'in room:', event.roomId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace) {
      roomNamespace.emit('user_onboarding_progress', {
        userId: event.userId,
        step: 'voice_connection_ready',
        connectionId: event.connectionId,
        progress: 90 // Almost complete
      });
    }
  };

  /**
   * Handle UserReadyForPlayback event - complete onboarding
   */
  private handleUserReadyForPlayback: EventHandler<UserReadyForPlayback> = async (event) => {
    console.log('✅ User ready for playback:', event.userId, 'in room:', event.roomId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace) {
      roomNamespace.emit('user_onboarding_complete', {
        userId: event.userId,
        step: 'ready_for_playback',
        progress: 100
      });

      // Also emit general user ready event for other room logic
      roomNamespace.emit('user_ready', {
        userId: event.userId,
        isReady: true
      });
    }
  };

  /**
   * Handle UserOnboardingFailed event - notify of failure
   */
  private handleUserOnboardingFailed: EventHandler<UserOnboardingFailed> = async (event) => {
    console.log('❌ User onboarding failed:', event.userId, 'in room:', event.roomId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace) {
      roomNamespace.emit('user_onboarding_failed', {
        userId: event.userId,
        reason: event.reason,
        step: event.failedComponent
      });
    }
  };

  /**
   * Handle UserOnboardingTimeout event - notify of timeout
   */
  private handleUserOnboardingTimeout: EventHandler<UserOnboardingTimeout> = async (event) => {
    console.log('⏰ User onboarding timeout:', event.userId, 'in room:', event.roomId);
    
    const roomNamespace = this.namespaceManager.getRoomNamespace(event.roomId);
    if (roomNamespace) {
      roomNamespace.emit('user_onboarding_timeout', {
        userId: event.userId,
        timeoutAfter: event.timeoutAfterMs
      });
    }
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