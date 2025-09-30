import { Namespace, Socket } from 'socket.io';
import { LobbyApplicationService } from '../../application/LobbyApplicationService';
import { SearchCriteria } from '../../domain/models/SearchCriteria';
import { UserId } from '../../../../shared/domain/models/ValueObjects';
import { loggingService } from '../../../../services/LoggingService';
import { checkSocketRateLimit } from '../../../../middleware/rateLimit';

/**
 * LobbyNamespaceHandlers
 * 
 * Handles WebSocket events for the lobby namespace, providing room discovery,
 * search, and browsing functionality.
 * 
 * Requirements: 9.2, 9.3, 9.4
 */
export class LobbyNamespaceHandlers {
  constructor(private lobbyApplicationService: LobbyApplicationService) {}

  /**
   * Set up event handlers for the lobby namespace
   */
  setupLobbyNamespaceHandlers(namespace: Namespace): void {
    namespace.on('connection', (socket: Socket) => {
      loggingService.logInfo('Socket connected to lobby namespace', {
        socketId: socket.id,
        namespacePath: '/lobby'
      });

      // Bind lobby event handlers
      this.bindLobbyEventHandlers(socket, namespace);

      socket.on('disconnect', (reason) => {
        loggingService.logInfo('Socket disconnected from lobby namespace', {
          socketId: socket.id,
          reason,
          namespacePath: '/lobby'
        });
      });

      socket.on('error', (error) => {
        loggingService.logError(error, {
          context: 'Lobby namespace socket error',
          socketId: socket.id,
          namespacePath: '/lobby'
        });
      });
    });
  }

  /**
   * Bind lobby-specific event handlers to the socket
   */
  private bindLobbyEventHandlers(socket: Socket, _namespace: Namespace): void {
    // Room browsing and search events
    socket.on('browse_rooms', async (data) => {
      const rateLimitCheck = checkSocketRateLimit(socket, 'browse_rooms');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', {
          message: `Rate limit exceeded for browse_rooms. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter
        });
        return;
      }

      try {
        const criteria = data?.criteria ? SearchCriteria.fromQuery(data.criteria) : SearchCriteria.default();
        const userId = data?.userId ? UserId.fromString(data.userId) : undefined;

        const result = await this.lobbyApplicationService.searchRooms(criteria, userId);

        socket.emit('rooms_browsed', {
          success: true,
          rooms: result.items.map(room => room.toSummary()),
          totalCount: result.totalCount,
          hasMore: result.hasMore,
          nextOffset: result.nextOffset
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Browse rooms error',
          socketId: socket.id,
          data
        });

        socket.emit('rooms_browsed', {
          success: false,
          error: 'Failed to browse rooms'
        });
      }
    });

    socket.on('search_rooms', async (data) => {
      const rateLimitCheck = checkSocketRateLimit(socket, 'search_rooms');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', {
          message: `Rate limit exceeded for search_rooms. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter
        });
        return;
      }

      try {
        const { searchTerm, userId, limit = 20 } = data;
        const userIdObj = userId ? UserId.fromString(userId) : undefined;

        const rooms = await this.lobbyApplicationService.searchRoomsByText(
          searchTerm,
          userIdObj,
          limit
        );

        socket.emit('rooms_searched', {
          success: true,
          rooms: rooms.map(room => room.toSummary()),
          searchTerm
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Search rooms error',
          socketId: socket.id,
          data
        });

        socket.emit('rooms_searched', {
          success: false,
          error: 'Failed to search rooms'
        });
      }
    });

    socket.on('get_popular_rooms', async (data) => {
      const rateLimitCheck = checkSocketRateLimit(socket, 'get_popular_rooms');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', {
          message: `Rate limit exceeded for get_popular_rooms. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter
        });
        return;
      }

      try {
        const { limit = 10 } = data || {};

        const popularRooms = await this.lobbyApplicationService.getPopularRooms(limit);

        socket.emit('popular_rooms', {
          success: true,
          rooms: popularRooms.map(room => room.toSummary())
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Get popular rooms error',
          socketId: socket.id,
          data
        });

        socket.emit('popular_rooms', {
          success: false,
          error: 'Failed to get popular rooms'
        });
      }
    });

    socket.on('get_recommended_rooms', async (data) => {
      const rateLimitCheck = checkSocketRateLimit(socket, 'get_recommended_rooms');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', {
          message: `Rate limit exceeded for get_recommended_rooms. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter
        });
        return;
      }

      try {
        const { userId, preferredGenres = [], limit = 10 } = data;
        
        if (!userId) {
          socket.emit('recommended_rooms', {
            success: false,
            error: 'User ID is required for recommendations'
          });
          return;
        }

        const userIdObj = UserId.fromString(userId);
        const recommendations = await this.lobbyApplicationService.getRecommendedRooms(
          userIdObj,
          preferredGenres,
          limit
        );

        socket.emit('recommended_rooms', {
          success: true,
          rooms: recommendations.map(room => room.toSummary())
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Get recommended rooms error',
          socketId: socket.id,
          data
        });

        socket.emit('recommended_rooms', {
          success: false,
          error: 'Failed to get recommended rooms'
        });
      }
    });

    socket.on('get_rooms_by_genre', async (data) => {
      const rateLimitCheck = checkSocketRateLimit(socket, 'get_rooms_by_genre');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', {
          message: `Rate limit exceeded for get_rooms_by_genre. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter
        });
        return;
      }

      try {
        const { genre, userId, limit = 20 } = data;
        
        if (!genre) {
          socket.emit('rooms_by_genre', {
            success: false,
            error: 'Genre is required'
          });
          return;
        }

        const userIdObj = userId ? UserId.fromString(userId) : undefined;
        const rooms = await this.lobbyApplicationService.getRoomsByGenre(
          genre,
          userIdObj,
          limit
        );

        socket.emit('rooms_by_genre', {
          success: true,
          rooms: rooms.map(room => room.toSummary()),
          genre
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Get rooms by genre error',
          socketId: socket.id,
          data
        });

        socket.emit('rooms_by_genre', {
          success: false,
          error: 'Failed to get rooms by genre'
        });
      }
    });

    socket.on('get_available_rooms', async (data) => {
      const rateLimitCheck = checkSocketRateLimit(socket, 'get_available_rooms');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', {
          message: `Rate limit exceeded for get_available_rooms. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter
        });
        return;
      }

      try {
        const { userId, limit = 50 } = data || {};
        const userIdObj = userId ? UserId.fromString(userId) : undefined;

        const availableRooms = await this.lobbyApplicationService.getAvailableRooms(
          userIdObj,
          limit
        );

        socket.emit('available_rooms', {
          success: true,
          rooms: availableRooms.map(room => room.toSummary())
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Get available rooms error',
          socketId: socket.id,
          data
        });

        socket.emit('available_rooms', {
          success: false,
          error: 'Failed to get available rooms'
        });
      }
    });

    socket.on('get_lobby_statistics', async (data) => {
      const rateLimitCheck = checkSocketRateLimit(socket, 'get_lobby_statistics');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', {
          message: `Rate limit exceeded for get_lobby_statistics. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter
        });
        return;
      }

      try {
        const statistics = await this.lobbyApplicationService.getLobbyStatistics();

        socket.emit('lobby_statistics', {
          success: true,
          statistics
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Get lobby statistics error',
          socketId: socket.id,
          data
        });

        socket.emit('lobby_statistics', {
          success: false,
          error: 'Failed to get lobby statistics'
        });
      }
    });

    // Room interaction events
    socket.on('view_room_details', async (data) => {
      try {
        const { userId, roomId, viewSource = 'browse' } = data;
        
        if (userId && roomId) {
          const userIdObj = UserId.fromString(userId);
          await this.lobbyApplicationService.recordRoomDetailsView(
            userIdObj,
            roomId,
            viewSource
          );
        }

        // Acknowledge the event
        socket.emit('room_details_viewed', {
          success: true,
          roomId
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'View room details error',
          socketId: socket.id,
          data
        });

        socket.emit('room_details_viewed', {
          success: false,
          error: 'Failed to record room details view'
        });
      }
    });

    socket.on('attempt_room_join', async (data) => {
      try {
        const { userId, roomId, joinMethod = 'direct' } = data;
        
        if (userId && roomId) {
          const userIdObj = UserId.fromString(userId);
          await this.lobbyApplicationService.recordRoomJoinAttempt(
            userIdObj,
            roomId,
            joinMethod
          );
        }

        // Acknowledge the event
        socket.emit('room_join_attempted', {
          success: true,
          roomId,
          joinMethod
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Attempt room join error',
          socketId: socket.id,
          data
        });

        socket.emit('room_join_attempted', {
          success: false,
          error: 'Failed to record room join attempt'
        });
      }
    });

    // Ping measurement for latency monitoring
    socket.on('ping_measurement', (data) => {
      if (data && data.pingId && data.timestamp) {
        socket.emit('ping_response', {
          pingId: data.pingId,
          timestamp: data.timestamp,
          serverTimestamp: Date.now()
        });
      }
    });

    // Real-time room updates subscription
    socket.on('subscribe_room_updates', () => {
      try {
        // Join a room for real-time updates
        socket.join('lobby_updates');
        
        socket.emit('subscribed_room_updates', {
          success: true,
          message: 'Subscribed to room updates'
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Subscribe room updates failure',
          socketId: socket.id
        });
        socket.emit('subscribed_room_updates', {
          success: false,
          error: 'Failed to subscribe to room updates'
        });
      }
    });

    socket.on('unsubscribe_room_updates', () => {
      try {
        socket.leave('lobby_updates');
        
        socket.emit('unsubscribed_room_updates', {
          success: true,
          message: 'Unsubscribed from room updates'
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'Unsubscribe room updates failure',
          socketId: socket.id
        });
        socket.emit('unsubscribed_room_updates', {
          success: false,
          error: 'Failed to unsubscribe from room updates'
        });
      }
    });
  }

  /**
   * Broadcast room list updates to all connected lobby clients
   */
  broadcastRoomListUpdate(namespace: Namespace, updateType: 'created' | 'updated' | 'deleted', roomSummary: any): void {
    namespace.to('lobby_updates').emit('room_list_updated', {
      type: updateType,
      room: roomSummary,
      timestamp: Date.now()
    });
  }

  /**
   * Broadcast lobby statistics updates
   */
  broadcastLobbyStatistics(namespace: Namespace, statistics: any): void {
    namespace.to('lobby_updates').emit('lobby_statistics_updated', {
      statistics,
      timestamp: Date.now()
    });
  }
}