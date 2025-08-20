import { Server } from 'socket.io';
import { createServer } from 'http';
import { NamespaceManager } from '../../src/services/NamespaceManager';

// Mock the LoggingService
jest.mock('../../src/services/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarning: jest.fn(),
  },
}));

describe('NamespaceManager', () => {
  let httpServer: any;
  let io: Server;
  let namespaceManager: NamespaceManager;

  beforeEach(() => {
    httpServer = createServer();
    io = new Server(httpServer);
    namespaceManager = new NamespaceManager(io);
  });

  afterEach(() => {
    namespaceManager.shutdown();
    io.close();
    httpServer.close();
  });

  describe('createRoomNamespace', () => {
    it('should create a room namespace', () => {
      const roomId = 'test-room-123';
      const namespace = namespaceManager.createRoomNamespace(roomId);
      
      expect(namespace).toBeDefined();
      expect(namespace.name).toBe(`/room/${roomId}`);
      expect(namespaceManager.hasNamespace(`/room/${roomId}`)).toBe(true);
    });

    it('should reuse existing room namespace', () => {
      const roomId = 'test-room-123';
      const namespace1 = namespaceManager.createRoomNamespace(roomId);
      const namespace2 = namespaceManager.createRoomNamespace(roomId);
      
      expect(namespace1).toBe(namespace2);
    });
  });

  describe('createApprovalNamespace', () => {
    it('should create an approval namespace', () => {
      const roomId = 'test-room-123';
      const namespace = namespaceManager.createApprovalNamespace(roomId);
      
      expect(namespace).toBeDefined();
      expect(namespace.name).toBe(`/approval/${roomId}`);
      expect(namespaceManager.hasNamespace(`/approval/${roomId}`)).toBe(true);
    });
  });

  describe('createLobbyMonitorNamespace', () => {
    it('should create a lobby monitor namespace', () => {
      const namespace = namespaceManager.createLobbyMonitorNamespace();
      
      expect(namespace).toBeDefined();
      expect(namespace.name).toBe('/lobby-monitor');
      expect(namespaceManager.hasNamespace('/lobby-monitor')).toBe(true);
    });
  });

  describe('cleanupNamespace', () => {
    it('should cleanup a room namespace', () => {
      const roomId = 'test-room-123';
      namespaceManager.createRoomNamespace(roomId);
      
      expect(namespaceManager.hasNamespace(`/room/${roomId}`)).toBe(true);
      
      const cleaned = namespaceManager.cleanupRoomNamespace(roomId);
      
      expect(cleaned).toBe(true);
      expect(namespaceManager.hasNamespace(`/room/${roomId}`)).toBe(false);
    });

    it('should cleanup an approval namespace', () => {
      const roomId = 'test-room-123';
      namespaceManager.createApprovalNamespace(roomId);
      
      expect(namespaceManager.hasNamespace(`/approval/${roomId}`)).toBe(true);
      
      const cleaned = namespaceManager.cleanupApprovalNamespace(roomId);
      
      expect(cleaned).toBe(true);
      expect(namespaceManager.hasNamespace(`/approval/${roomId}`)).toBe(false);
    });
  });

  describe('getNamespaceStats', () => {
    it('should return correct namespace statistics', () => {
      const roomId1 = 'test-room-1';
      const roomId2 = 'test-room-2';
      
      namespaceManager.createRoomNamespace(roomId1);
      namespaceManager.createApprovalNamespace(roomId2);
      namespaceManager.createLobbyMonitorNamespace();
      
      const stats = namespaceManager.getNamespaceStats();
      
      expect(stats.totalNamespaces).toBe(3);
      expect(stats.totalConnections).toBe(0);
      expect(stats.namespaceDetails).toHaveLength(3);
    });
  });

  describe('getActiveNamespaces', () => {
    it('should return list of active namespace paths', () => {
      const roomId = 'test-room-123';
      
      namespaceManager.createRoomNamespace(roomId);
      namespaceManager.createLobbyMonitorNamespace();
      
      const activeNamespaces = namespaceManager.getActiveNamespaces();
      
      expect(activeNamespaces).toContain(`/room/${roomId}`);
      expect(activeNamespaces).toContain('/lobby-monitor');
      expect(activeNamespaces).toHaveLength(2);
    });
  });
});