import { Server } from 'socket.io';
import { createServer } from 'http';
import { NamespaceManager } from '../../src/services/NamespaceManager';
import { NamespaceEventHandlers } from '../../src/handlers/NamespaceEventHandlers';
import { RoomHandlers } from '../../src/handlers/RoomHandlers';
import { RoomService } from '../../src/services/RoomService';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { MetronomeService } from '../../src/services/MetronomeService';

// Mock the LoggingService
jest.mock('../../src/services/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarning: jest.fn(),
    logSocketEvent: jest.fn(),
  },
}));

describe('Cross-Room Isolation - Core Functionality Tests', () => {
  let httpServer: any;
  let io: Server;
  let namespaceManager: NamespaceManager;
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let metronomeService: MetronomeService;

  beforeEach(async () => {
    // Create server
    httpServer = createServer();
    io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Initialize services
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    
    // Initialize namespace manager first
    namespaceManager = new NamespaceManager(io);
    
    // Initialize metronome service
    metronomeService = new MetronomeService(io, roomService);
    
    // Initialize handlers
    const roomHandlers = new RoomHandlers(roomService, io, namespaceManager, roomSessionManager);
    const namespaceEventHandlers = new NamespaceEventHandlers(roomHandlers, roomSessionManager);
    
    // Set event handlers on namespace manager
    namespaceManager.setEventHandlers(namespaceEventHandlers);

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(() => {
        resolve();
      });
    });

    // Initialize namespaces
    namespaceManager.createLobbyMonitorNamespace();
    namespaceManager.createRoomNamespace('room1');
    namespaceManager.createRoomNamespace('room2');

    // Initialize metronomes for rooms
    metronomeService.initializeRoomMetronome('room1', namespaceManager.getNamespace('/room/room1')!);
    metronomeService.initializeRoomMetronome('room2', namespaceManager.getNamespace('/room/room2')!);
  });

  afterEach(async () => {
    // Cleanup services
    if (metronomeService) {
      metronomeService.shutdown();
    }
    if (namespaceManager) {
      namespaceManager.shutdown();
    }
    if (io) {
      io.close();
    }
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  });

  describe('Namespace Isolation - Requirements 1.1, 1.2, 1.3', () => {
    it('should create separate namespaces for different rooms', () => {
      const room1Namespace = namespaceManager.getNamespace('/room/room1');
      const room2Namespace = namespaceManager.getNamespace('/room/room2');
      const lobbyNamespace = namespaceManager.getNamespace('/lobby-monitor');

      expect(room1Namespace).toBeDefined();
      expect(room2Namespace).toBeDefined();
      expect(lobbyNamespace).toBeDefined();
      
      // Verify they are different instances
      expect(room1Namespace).not.toBe(room2Namespace);
      expect(room1Namespace).not.toBe(lobbyNamespace);
      expect(room2Namespace).not.toBe(lobbyNamespace);
      
      // Verify correct namespace paths
      expect(room1Namespace!.name).toBe('/room/room1');
      expect(room2Namespace!.name).toBe('/room/room2');
      expect(lobbyNamespace!.name).toBe('/lobby-monitor');
    });

    it('should maintain separate namespace statistics', () => {
      const stats = namespaceManager.getNamespaceStats();
      
      expect(stats.totalNamespaces).toBe(3); // room1, room2, lobby
      expect(stats.totalConnections).toBe(0); // No connections yet
      expect(stats.namespaceDetails).toHaveLength(3);
      
      const namespacePaths = stats.namespaceDetails.map(detail => detail.path);
      expect(namespacePaths).toContain('/room/room1');
      expect(namespacePaths).toContain('/room/room2');
      expect(namespacePaths).toContain('/lobby-monitor');
    });

    it('should list active namespaces correctly', () => {
      const activeNamespaces = namespaceManager.getActiveNamespaces();
      
      expect(activeNamespaces).toContain('/room/room1');
      expect(activeNamespaces).toContain('/room/room2');
      expect(activeNamespaces).toContain('/lobby-monitor');
      expect(activeNamespaces).toHaveLength(3);
    });
  });

  describe('Metronome Isolation - Requirements 8.1, 8.2', () => {
    it('should create separate metronome instances for different rooms', () => {
      const room1Metronome = metronomeService.getRoomMetronome('room1');
      const room2Metronome = metronomeService.getRoomMetronome('room2');

      expect(room1Metronome).toBeDefined();
      expect(room2Metronome).toBeDefined();
      expect(room1Metronome).not.toBe(room2Metronome);

      // Verify room IDs are correct
      expect(room1Metronome!.getRoomId()).toBe('room1');
      expect(room2Metronome!.getRoomId()).toBe('room2');
    });

    it('should track metronomes independently', () => {
      const totalMetronomes = metronomeService.getTotalMetronomes();
      expect(totalMetronomes).toBe(2); // room1 and room2

      // Test that metronomes exist but are not active initially
      const initialActiveMetronomes = metronomeService.getActiveMetronomes();
      expect(initialActiveMetronomes).toHaveLength(0); // None running initially

      // Verify metronome instances exist
      const room1Metronome = metronomeService.getRoomMetronome('room1');
      const room2Metronome = metronomeService.getRoomMetronome('room2');
      expect(room1Metronome).toBeDefined();
      expect(room2Metronome).toBeDefined();
    });

    it('should allow independent metronome control', () => {
      const room1Metronome = metronomeService.getRoomMetronome('room1');
      const room2Metronome = metronomeService.getRoomMetronome('room2');

      // Initially both should be stopped
      expect(room1Metronome!.getIsRunning()).toBe(false);
      expect(room2Metronome!.getIsRunning()).toBe(false);

      // Test that metronomes are separate instances
      expect(room1Metronome).not.toBe(room2Metronome);
      expect(room1Metronome!.getRoomId()).toBe('room1');
      expect(room2Metronome!.getRoomId()).toBe('room2');

      // Test stop functionality (should not throw even if not running)
      metronomeService.stopMetronome('room1');
      metronomeService.stopMetronome('room2');
      expect(room1Metronome!.getIsRunning()).toBe(false);
      expect(room2Metronome!.getIsRunning()).toBe(false);
    });
  });

  describe('Session Management Isolation - Requirements 7.1, 7.2, 7.3', () => {
    it('should maintain separate session tracking', () => {
      const initialStats = roomSessionManager.getSessionStats();
      expect(initialStats.totalSessions).toBe(0);
      expect(initialStats.roomSessions).toBe(0);
      expect(initialStats.approvalSessions).toBe(0);
      expect(initialStats.lobbySessions).toBe(0);
    });

    it('should isolate room sessions', () => {
      // Set up sessions for different rooms
      roomSessionManager.setRoomSession('room1', 'socket1', { roomId: 'room1', userId: 'user1' });
      roomSessionManager.setRoomSession('room2', 'socket2', { roomId: 'room2', userId: 'user2' });

      const stats = roomSessionManager.getSessionStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.roomSessions).toBe(2);
      expect(stats.roomBreakdown).toHaveLength(2);

      // Verify sessions are in correct rooms
      const room1Session = roomSessionManager.getRoomSession('socket1');
      const room2Session = roomSessionManager.getRoomSession('socket2');

      expect(room1Session?.roomId).toBe('room1');
      expect(room1Session?.userId).toBe('user1');
      expect(room2Session?.roomId).toBe('room2');
      expect(room2Session?.userId).toBe('user2');
    });

    it('should find users only within their rooms', () => {
      // Set up sessions
      roomSessionManager.setRoomSession('room1', 'socket1', { roomId: 'room1', userId: 'user1' });
      roomSessionManager.setRoomSession('room2', 'socket2', { roomId: 'room2', userId: 'user1' }); // Same user ID, different room

      // Find user in room1
      const socketInRoom1 = roomSessionManager.findSocketByUserId('room1', 'user1');
      expect(socketInRoom1).toBe('socket1');

      // Find user in room2
      const socketInRoom2 = roomSessionManager.findSocketByUserId('room2', 'user1');
      expect(socketInRoom2).toBe('socket2');

      // User should not be found in wrong room
      const socketInWrongRoom = roomSessionManager.findSocketByUserId('room1', 'user2');
      expect(socketInWrongRoom).toBeUndefined();
    });
  });

  describe('Cleanup Isolation - Requirements 5.4', () => {
    it('should cleanup individual rooms without affecting others', () => {
      // Verify initial state
      expect(namespaceManager.hasNamespace('/room/room1')).toBe(true);
      expect(namespaceManager.hasNamespace('/room/room2')).toBe(true);
      expect(metronomeService.getRoomMetronome('room1')).toBeDefined();
      expect(metronomeService.getRoomMetronome('room2')).toBeDefined();

      // Cleanup room1
      const cleaned = namespaceManager.cleanupRoomNamespace('room1');
      metronomeService.cleanupRoom('room1');

      expect(cleaned).toBe(true);
      expect(namespaceManager.hasNamespace('/room/room1')).toBe(false);
      expect(metronomeService.getRoomMetronome('room1')).toBeUndefined();

      // Verify room2 is unaffected
      expect(namespaceManager.hasNamespace('/room/room2')).toBe(true);
      expect(metronomeService.getRoomMetronome('room2')).toBeDefined();
    });

    it('should cleanup room sessions independently', () => {
      // Set up sessions in both rooms
      roomSessionManager.setRoomSession('room1', 'socket1', { roomId: 'room1', userId: 'user1' });
      roomSessionManager.setRoomSession('room1', 'socket2', { roomId: 'room1', userId: 'user2' });
      roomSessionManager.setRoomSession('room2', 'socket3', { roomId: 'room2', userId: 'user3' });

      expect(roomSessionManager.getSessionStats().totalSessions).toBe(3);

      // Cleanup room1 sessions
      roomSessionManager.cleanupRoomSessions('room1');

      const stats = roomSessionManager.getSessionStats();
      expect(stats.totalSessions).toBe(1); // Only room2 session remains
      expect(stats.roomBreakdown).toHaveLength(1);
      expect(stats.roomBreakdown[0]?.roomId).toBe('room2');

      // Verify room1 sessions are gone
      expect(roomSessionManager.getRoomSession('socket1')).toBeUndefined();
      expect(roomSessionManager.getRoomSession('socket2')).toBeUndefined();

      // Verify room2 session is intact
      expect(roomSessionManager.getRoomSession('socket3')).toBeDefined();
    });
  });

  describe('Service Integration Isolation - Requirements 10.1, 10.2, 10.3', () => {
    it('should maintain service isolation across rooms', () => {
      // Test that all services are properly isolated
      const namespaceStats = namespaceManager.getNamespaceStats();
      const sessionStats = roomSessionManager.getSessionStats();
      const totalMetronomes = metronomeService.getTotalMetronomes();

      expect(namespaceStats.totalNamespaces).toBe(3);
      expect(sessionStats.totalSessions).toBe(0);
      expect(totalMetronomes).toBe(2);

      // Verify services are working independently
      expect(namespaceManager.getActiveNamespaces()).toHaveLength(3);
      
      // Verify metronome service has the correct number of instances
      expect(totalMetronomes).toBe(2);
      
      // Verify no metronomes are active initially
      expect(metronomeService.getActiveMetronomes()).toHaveLength(0);
    });
  });
});