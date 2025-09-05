import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';
import { RoomService } from '../../../../services/RoomService';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import { NamespaceManager } from '../../../../services/NamespaceManager';
import { UpdateSynthParamsData } from '../../../../types';
import { loggingService } from '../../../../services/LoggingService';

/**
 * AudioRoutingHandler - Handles audio parameter routing and synth coordination
 * 
 * This handler manages:
 * - Synth parameter updates and broadcasting
 * - Parameter requests between users
 * - Auto-requesting parameters for new users
 * - Foundation for future audio bus routing and effects
 * 
 * Requirements: 4.1, 10.2
 */
export class AudioRoutingHandler {
  constructor(
    private roomService: RoomService,
    private io: Server,
    private roomSessionManager: RoomSessionManager,
    private namespaceManager: NamespaceManager
  ) {}

  /**
   * Handle synth parameter updates from users
   * Broadcasts parameter changes to other users in the room
   */
  handleUpdateSynthParams(socket: Socket, data: UpdateSynthParamsData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Store synth parameters in user state for swapping
    this.roomService.updateUserSynthParams(session.roomId, session.userId, data.params);

    // Synth params now bypass validation for performance
    loggingService.logInfo('Audio routing - synth params updated', {
      userId: session.userId,
      username: user.username,
      instrument: user.currentInstrument,
      category: user.currentCategory
    });

    // Get the room namespace for proper isolation
    const roomNamespace = this.namespaceManager.getRoomNamespace(session.roomId);
    if (roomNamespace) {
      // Broadcast to all other users in the room (exclude sender)
      socket.to(roomNamespace.name).emit('synth_params_changed', {
        userId: session.userId,
        username: user.username,
        instrument: user.currentInstrument || '',
        category: user.currentCategory || '',
        params: data.params
      });
    }
  }

  /**
   * Handle requests for synth parameters from other users
   * Notifies synth users to send their current parameters
   */
  handleRequestSynthParams(socket: Socket): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const requestingUser = room.users.get(session.userId);
    if (!requestingUser) return;

    // Find all users with synthesizers in the room
    const synthUsers = Array.from(room.users.values()).filter(user =>
      user.currentCategory === 'synthesizer' && user.id !== session.userId
    );

    loggingService.logInfo('Audio routing - synth params requested', {
      requestingUserId: session.userId,
      requestingUsername: requestingUser.username,
      synthUsersCount: synthUsers.length
    });

    // Notify other synth users to send their parameters
    synthUsers.forEach(synthUser => {
      const synthUserSocketId = this.roomSessionManager.findSocketByUserId(session.roomId, synthUser.id);
      if (synthUserSocketId) {
        const synthUserSocket = this.io.sockets.sockets.get(synthUserSocketId);
        if (synthUserSocket) {
          synthUserSocket.emit('request_synth_params_response', {
            requestingUserId: session.userId,
            requestingUsername: requestingUser.username
          });
        }
      }
    });
  }

  /**
   * Auto-request synth parameters for new users joining the room
   * Ensures new users receive current synth states from existing users
   */
  autoRequestSynthParamsForNewUser(socket: Socket, roomId: string, newUserId: string): void {
    loggingService.logInfo('Audio routing - auto-request synth params for new user', {
      newUserId,
      roomId
    });
    
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      loggingService.logInfo('Audio routing - room not found for auto-request', { roomId });
      return;
    }

    const newUser = room.users.get(newUserId);
    if (!newUser) {
      loggingService.logInfo('Audio routing - new user not found for auto-request', { newUserId });
      return;
    }

    // Debug: Log all users in the room and their categories
    loggingService.logInfo('Audio routing - all users in room', {
      roomId,
      users: Array.from(room.users.values()).map(user => ({
        username: user.username,
        id: user.id,
        category: user.currentCategory,
        instrument: user.currentInstrument
      }))
    });

    // Find all users with synthesizers in the room (excluding the new user)
    const synthUsers = Array.from(room.users.values()).filter(user =>
      user.currentCategory === 'synthesizer' && user.id !== newUserId
    );

    loggingService.logInfo('Audio routing - auto-requesting synth params', {
      newUsername: newUser.username,
      synthUsersCount: synthUsers.length
    });

    // Notify existing synth users to send their parameters to the new user
    synthUsers.forEach(synthUser => {
      const synthUserSocketId = this.roomSessionManager.findSocketByUserId(roomId, synthUser.id);
      if (synthUserSocketId) {
        const synthUserSocket = this.io.sockets.sockets.get(synthUserSocketId);
        if (synthUserSocket) {
          loggingService.logInfo('Audio routing - requesting synth params from user', {
            synthUsername: synthUser.username,
            newUsername: newUser.username
          });
          
          synthUserSocket.emit('auto_send_synth_params_to_new_user', {
            newUserId: newUserId,
            newUsername: newUser.username
          });
        } else {
          loggingService.logInfo('Audio routing - no socket found for synth user', {
            synthUsername: synthUser.username
          });
        }
      } else {
        loggingService.logInfo('Audio routing - no socket ID found for synth user', {
          synthUsername: synthUser.username
        });
      }
    });
  }

  /**
   * Auto-request synth parameters for new users joining the room (namespace version)
   * Namespace-aware version for better isolation and performance
   */
  autoRequestSynthParamsForNewUserNamespace(namespace: Namespace, roomId: string, newUserId: string): void {
    loggingService.logInfo('Audio routing - auto-request synth params for new user (namespace)', {
      newUserId,
      roomId,
      namespaceName: namespace.name
    });
    
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      loggingService.logInfo('Audio routing - room not found for namespace auto-request', { roomId });
      return;
    }

    const newUser = room.users.get(newUserId);
    if (!newUser) {
      loggingService.logInfo('Audio routing - new user not found for namespace auto-request', { newUserId });
      return;
    }

    // Debug: Log all users in the room and their categories
    loggingService.logInfo('Audio routing - all users in room (namespace)', {
      roomId,
      users: Array.from(room.users.values()).map(user => ({
        username: user.username,
        id: user.id,
        category: user.currentCategory,
        instrument: user.currentInstrument
      }))
    });

    // Find all users with synthesizers in the room (excluding the new user)
    const synthUsers = Array.from(room.users.values()).filter(user =>
      user.currentCategory === 'synthesizer' && user.id !== newUserId
    );

    loggingService.logInfo('Audio routing - auto-requesting synth params (namespace)', {
      newUsername: newUser.username,
      synthUsersCount: synthUsers.length
    });

    if (synthUsers.length === 0) {
      loggingService.logInfo('Audio routing - no synthesizer users found to request params from');
      return;
    }

    // Notify existing synth users to send their parameters to the new user
    synthUsers.forEach(synthUser => {
      // Find the socket in the namespace for this synth user
      for (const [socketId, socket] of namespace.sockets) {
        const session = this.roomSessionManager.getRoomSession(socketId);
        if (session && session.userId === synthUser.id) {
          loggingService.logInfo('Audio routing - requesting synth params from user (namespace)', {
            synthUsername: synthUser.username,
            newUsername: newUser.username
          });
          
          // Send both events to ensure reliability
          socket.emit('auto_send_synth_params_to_new_user', {
            newUserId: newUserId,
            newUsername: newUser.username
          });
          
          // Also send a direct request for current synth params
          socket.emit('request_current_synth_params_for_new_user', {
            newUserId: newUserId,
            newUsername: newUser.username,
            synthUserId: synthUser.id,
            synthUsername: synthUser.username
          });
          break;
        }
      }
    });
  }

  /**
   * Handle synth params update through namespace - namespace-aware version
   * Provides better isolation and performance for namespace-based rooms
   */
  handleUpdateSynthParamsNamespace(socket: Socket, data: UpdateSynthParamsData, namespace: Namespace): void {
    loggingService.logInfo('Audio routing - synth params update (namespace)', {
      socketId: socket.id,
      namespaceName: namespace.name,
      hasParams: !!data.params
    });
    
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      loggingService.logInfo('Audio routing - no session found for namespace synth params update', {
        socketId: socket.id
      });
      return;
    }

    const room = this.roomService.getRoom(session.roomId);
    if (!room) {
      loggingService.logInfo('Audio routing - no room found for namespace synth params update', {
        roomId: session.roomId
      });
      return;
    }

    const user = room.users.get(session.userId);
    if (!user) {
      loggingService.logInfo('Audio routing - no user found for namespace synth params update', {
        userId: session.userId
      });
      return;
    }

    // Store synth parameters in user state for swapping
    this.roomService.updateUserSynthParams(session.roomId, session.userId, data.params);

    loggingService.logInfo('Audio routing - broadcasting synth_params_changed (namespace)', {
      namespaceName: namespace.name,
      userId: session.userId,
      username: user.username,
      instrument: user.currentInstrument,
      category: user.currentCategory
    });

    // Broadcast to other clients in the same namespace (exclude sender)
    socket.broadcast.emit('synth_params_changed', {
      userId: session.userId,
      username: user.username,
      instrument: user.currentInstrument || '',
      category: user.currentCategory || '',
      params: data.params
    });
    
    loggingService.logInfo('Audio routing - successfully broadcasted synth_params_changed (namespace)');
  }

  /**
   * Handle request synth params through namespace - namespace-aware version
   * Provides better isolation for parameter requests in namespace-based rooms
   */
  handleRequestSynthParamsNamespace(socket: Socket, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const requestingUser = room.users.get(session.userId);
    if (!requestingUser) return;

    // Find all users with synthesizers in the room
    const synthUsers = Array.from(room.users.values()).filter(user =>
      user.currentCategory === 'synthesizer' && user.id !== session.userId
    );

    loggingService.logInfo('Audio routing - synth params requested (namespace)', {
      requestingUserId: session.userId,
      requestingUsername: requestingUser.username,
      synthUsersCount: synthUsers.length,
      namespaceName: namespace.name
    });

    // Notify other synth users in the namespace to send their parameters
    synthUsers.forEach(synthUser => {
      // Find the socket in the namespace for this synth user
      for (const [socketId, synthSocket] of namespace.sockets) {
        const synthSession = this.roomSessionManager.getRoomSession(socketId);
        if (synthSession && synthSession.userId === synthUser.id) {
          synthSocket.emit('request_synth_params_response', {
            requestingUserId: session.userId,
            requestingUsername: requestingUser.username
          });
          break;
        }
      }
    });
  }

  /**
   * Get or create room namespace helper
   * Ensures the namespace exists before we try to use it
   */
  private getOrCreateRoomNamespace(roomId: string): Namespace | null {
    let roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (!roomNamespace) {
      // Create the room namespace if it doesn't exist
      loggingService.logInfo('Audio routing - creating room namespace', { roomId });
      try {
        roomNamespace = this.namespaceManager.createRoomNamespace(roomId);
      } catch (error) {
        loggingService.logError(error instanceof Error ? error : new Error('Unknown error'), {
          roomId,
          context: 'Audio routing - failed to create room namespace'
        });
        return null;
      }
    }
    return roomNamespace;
  }
}