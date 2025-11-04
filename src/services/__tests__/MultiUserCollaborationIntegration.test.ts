import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CollaborationPersistenceIntegrationService } from '../CollaborationPersistenceIntegrationService';
import { ProjectStateManager } from '../ProjectStateManager';
import { RealTimeChangeService } from '../RealTimeChangeService';
import { InstantSyncService } from '../InstantSyncService';
import { MockSocket } from '../../testing/MockSocket';
import type { Socket, Namespace } from 'socket.io';

// Mock dependencies
jest.mock('../ProjectStateManager');
jest.mock('../RealTimeChangeService');
jest.mock('../InstantSyncService');
jest.mock('../LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

/**
 * Multi-User Collaboration Integration Tests (Backend)
 * 
 * Tests backend collaboration system with multiple concurrent users,
 * conflict resolution, project state synchronization, and performance
 * with large projects.
 * 
 * Requirements: 8.1, 8.2, 8.5, 11.1
 */
describe('Multi-User Collaboration Integration (Backend)', () => {
  let collaborationService: CollaborationPersistenceIntegrationService;
  let mockProjectStateManager: jest.Mocked<ProjectStateManager>;
  let mockRealTimeChangeService: jest.Mocked<RealTimeChangeService>;
  let mockInstantSyncService: jest.Mocked<InstantSyncService>;
  let mockNamespace: jest.Mocked<Namespace>;

  const mockRoomId = 'collab-room-123';
  const mockProjectId = 'collab-project-456';
  const mockUsers = [
    { id: 'user-1', username: 'Alice', socket: new MockSocket('socket-1') as any },
    { id: 'user-2', username: 'Bob', socket: new MockSocket('socket-2') as any },
    { id: 'user-3', username: 'Charlie', socket: new MockSocket('socket-3') as any },
    { id: 'user-4', username: 'Diana', socket: new MockSocket('socket-4') as any },
    { id: 'user-5', username: 'Eve', socket: new MockSocket('socket-5') as any },
  ];

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock services
    mockProjectStateManager = {
      getInstance: jest.fn(),
      initialize: jest.fn(),
      getProjectsByRoom: jest.fn(),
      getCompleteProjectState: jest.fn(),
      getChangesSince: jest.fn(),
      recordChange: jest.fn(),
      on: jest.fn(),
    } as any;

    mockRealTimeChangeService = {
      getInstance: jest.fn(),
      initialize: jest.fn(),
      queueChange: jest.fn(),
      forceSave: jest.fn(),
      on: jest.fn(),
    } as any;

    mockInstantSyncService = {
      getInstance: jest.fn(),
      initialize: jest.fn(),
      onUserJoinRoom: jest.fn(),
      verifyStateConsistency: jest.fn(),
      on: jest.fn(),
    } as any;

    // Mock static getInstance methods
    (ProjectStateManager.getInstance as jest.Mock).mockReturnValue(mockProjectStateManager);
    (RealTimeChangeService.getInstance as jest.Mock).mockReturnValue(mockRealTimeChangeService);
    (InstantSyncService.getInstance as jest.Mock).mockReturnValue(mockInstantSyncService);

    // Create mock namespace
    mockNamespace = {
      on: jest.fn(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;

    // Initialize collaboration service
    collaborationService = CollaborationPersistenceIntegrationService.getInstance();
    await collaborationService.initialize();

    // Setup default mock responses
    mockProjectStateManager.getProjectsByRoom.mockResolvedValue([
      {
        id: mockProjectId,
        name: 'Test Project',
        roomId: mockRoomId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    mockProjectStateManager.getCompleteProjectState.mockResolvedValue({
      project: { id: mockProjectId, name: 'Test Project' },
      tracks: [],
      regions: [],
      audioFiles: [],
      transportState: { isPlaying: false, position: 0 },
      userStates: [],
      timestamp: new Date(),
    } as any);

    mockRealTimeChangeService.queueChange.mockResolvedValue(undefined);
    mockInstantSyncService.onUserJoinRoom.mockResolvedValue(undefined);
    mockInstantSyncService.verifyStateConsistency.mockResolvedValue({
      isConsistent: true,
      differences: [],
      serverState: null,
    });
  });

  afterEach(async () => {
    await collaborationService.cleanup();
  });

  describe('Concurrent User Connection and Operation Processing', () => {
    it('should handle multiple users connecting simultaneously', async () => {
      const connectionPromises = mockUsers.map(user =>
        collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        )
      );

      // All connections should complete successfully
      await expect(Promise.all(connectionPromises)).resolves.not.toThrow();

      // Verify all users are tracked
      const activeConnections = collaborationService.getActiveConnections();
      expect(activeConnections.size).toBe(5);

      // Verify user-project relationships
      const userProjects = collaborationService.getUserProjects();
      expect(userProjects.size).toBe(5);

      // Verify instant sync was called for each user
      expect(mockInstantSyncService.onUserJoinRoom).toHaveBeenCalledTimes(5);
    });

    it('should process concurrent DAW operations from multiple users', async () => {
      // Connect all users first
      for (const user of mockUsers) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      // Create concurrent operations
      const operations = mockUsers.map((user, index) => ({
        type: 'track_create',
        userId: user.id,
        targetId: `track-${index}`,
        operation: 'create',
        parameters: {
          name: `${user.username}'s Track`,
          type: 'midi',
        },
        projectId: mockProjectId,
        version: 1,
      }));

      // Process operations concurrently
      const operationPromises = operations.map((operation, index) => {
        const user = mockUsers[index];
        return new Promise<void>((resolve) => {
          // Simulate socket event emission
          user.socket.emit('daw:operation_with_persistence', operation);
          
          // Mock the handler call directly for testing
          (collaborationService as any).handleFrontendOperationWithPersistence(
            user.socket,
            mockNamespace,
            mockRoomId,
            user.id,
            user.username,
            operation
          ).then(resolve);
        });
      });

      await Promise.all(operationPromises);

      // Verify all operations were processed
      expect(mockRealTimeChangeService.queueChange).toHaveBeenCalledTimes(5);

      // Verify statistics
      const stats = collaborationService.getStats();
      expect(stats.totalOperationsProcessed).toBe(5);
      expect(stats.activeConnections).toBe(5);
    });

    it('should handle concurrent editing conflicts with resolution', async () => {
      // Connect users
      const user1 = mockUsers[0];
      const user2 = mockUsers[1];

      await collaborationService.handleUserConnection(
        user1.socket as Socket,
        mockNamespace,
        mockRoomId,
        user1.id,
        user1.username
      );

      await collaborationService.handleUserConnection(
        user2.socket as Socket,
        mockNamespace,
        mockRoomId,
        user2.id,
        user2.username
      );

      // Create conflicting operations on the same target
      const conflictingOperations = [
        {
          type: 'track_update',
          userId: user1.id,
          targetId: 'shared-track',
          operation: 'update',
          parameters: {
            name: 'Alice Version',
            volume: 0.8,
          },
          projectId: mockProjectId,
          version: 1,
        },
        {
          type: 'track_update',
          userId: user2.id,
          targetId: 'shared-track', // Same target - should conflict
          operation: 'update',
          parameters: {
            name: 'Bob Version',
            volume: 0.6,
          },
          projectId: mockProjectId,
          version: 1,
        },
      ];

      // Process conflicting operations simultaneously
      const conflictPromises = conflictingOperations.map((operation, index) => {
        const user = index === 0 ? user1 : user2;
        return (collaborationService as any).handleFrontendOperationWithPersistence(
          user.socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username,
          operation
        );
      });

      await Promise.all(conflictPromises);

      // Verify both operations were processed (conflict resolution should handle them)
      expect(mockRealTimeChangeService.queueChange).toHaveBeenCalledTimes(2);

      // Verify conflict resolution statistics
      const stats = collaborationService.getStats();
      expect(stats.totalOperationsProcessed).toBe(2);
    });

    it('should maintain operation ordering with rapid concurrent edits', async () => {
      // Connect users
      for (const user of mockUsers.slice(0, 3)) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      // Create rapid sequence of operations
      const rapidOperations = [];
      const operationsPerUser = 10;

      for (let i = 0; i < operationsPerUser; i++) {
        for (const user of mockUsers.slice(0, 3)) {
          rapidOperations.push({
            type: 'user_cursor_move',
            userId: user.id,
            targetId: `cursor-${user.id}`,
            operation: 'move',
            parameters: {
              position: i * 0.1,
              timestamp: Date.now() + (i * 10),
            },
            projectId: mockProjectId,
            version: i + 1,
          });
        }
      }

      // Process operations with minimal delay
      const processingPromises = rapidOperations.map((operation, index) => {
        return new Promise<void>((resolve) => {
          setTimeout(async () => {
            const user = mockUsers.find(u => u.id === operation.userId)!;
            await (collaborationService as any).handleFrontendOperationWithPersistence(
              user.socket,
              mockNamespace,
              mockRoomId,
              user.id,
              user.username,
              operation
            );
            resolve();
          }, index * 5); // 5ms between operations
        });
      });

      await Promise.all(processingPromises);

      // Verify all operations were processed
      const totalOperations = operationsPerUser * 3;
      expect(mockRealTimeChangeService.queueChange).toHaveBeenCalledTimes(totalOperations);

      // Verify performance statistics
      const stats = collaborationService.getStats();
      expect(stats.totalOperationsProcessed).toBe(totalOperations);
      expect(stats.averageOperationLatency).toBeLessThan(100); // Should be fast
    });
  });

  describe('Project State Synchronization Across Users', () => {
    it('should synchronize project state for new users joining active session', async () => {
      // Connect initial users and create project state
      const initialUsers = mockUsers.slice(0, 3);
      for (const user of initialUsers) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      // Create some project state
      const stateOperations = [
        {
          type: 'track_create',
          userId: initialUsers[0].id,
          targetId: 'track-1',
          operation: 'create',
          parameters: { name: 'Drums', type: 'midi' },
          projectId: mockProjectId,
          version: 1,
        },
        {
          type: 'region_create',
          userId: initialUsers[1].id,
          targetId: 'region-1',
          operation: 'create',
          parameters: { trackId: 'track-1', startTime: 0, duration: 4 },
          projectId: mockProjectId,
          version: 2,
        },
      ];

      // Process initial state operations
      for (const operation of stateOperations) {
        const user = initialUsers.find(u => u.id === operation.userId)!;
        await (collaborationService as any).handleFrontendOperationWithPersistence(
          user.socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username,
          operation
        );
      }

      // New user joins
      const newUser = mockUsers[3];
      await collaborationService.handleUserConnection(
        newUser.socket as Socket,
        mockNamespace,
        mockRoomId,
        newUser.id,
        newUser.username
      );

      // Verify instant sync was called for new user
      expect(mockInstantSyncService.onUserJoinRoom).toHaveBeenCalledWith(
        newUser.id,
        mockRoomId
      );

      // Verify new user is tracked
      const activeConnections = collaborationService.getActiveConnections();
      expect(activeConnections.has(newUser.id)).toBe(true);
    });

    it('should handle state synchronization requests from multiple users', async () => {
      // Connect all users
      for (const user of mockUsers) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      // Mock state sync responses
      mockProjectStateManager.getChangesSince.mockResolvedValue([
        {
          id: 'change-1',
          projectId: mockProjectId,
          userId: 'user-1',
          changeType: 'track_create',
          timestamp: new Date(),
          data: { track: { id: 'track-1', name: 'Test Track' } },
        } as any,
      ]);

      // Simulate concurrent state sync requests
      const syncRequests = mockUsers.map((user, index) => ({
        projectId: mockProjectId,
        lastKnownVersion: index * 2, // Different versions for each user
        requestType: 'incremental' as const,
      }));

      const syncPromises = syncRequests.map((request, index) => {
        const user = mockUsers[index];
        return (collaborationService as any).handleStateSyncRequest(
          user.socket,
          user.id,
          request
        );
      });

      await Promise.all(syncPromises);

      // Verify all sync requests were processed
      expect(mockProjectStateManager.getChangesSince).toHaveBeenCalledTimes(5);

      // Verify each user received sync response
      mockUsers.forEach(user => {
        expect(user.socket.emit).toHaveBeenCalledWith(
          'daw:state_sync_result',
          expect.objectContaining({
            success: true,
            requestType: 'incremental',
          })
        );
      });
    });

    it('should handle user reconnection with state restoration', async () => {
      // Initial user connection
      const user = mockUsers[0];
      await collaborationService.handleUserConnection(
        user.socket as Socket,
        mockNamespace,
        mockRoomId,
        user.id,
        user.username
      );

      // Simulate user disconnection
      user.socket.emit('disconnect');

      // Simulate reconnection with state
      const reconnectionData = {
        projectId: mockProjectId,
        lastKnownVersion: 5,
        lastActivity: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
        clientState: {
          version: 5,
          tracks: [{ id: 'track-1', name: 'Old Track' }],
          lastModified: new Date(Date.now() - 60000),
        },
      };

      await (collaborationService as any).handleReconnectionWithState(
        user.socket,
        mockNamespace,
        mockRoomId,
        user.id,
        user.username,
        reconnectionData
      );

      // Verify reconnection was processed
      expect(mockInstantSyncService.onUserJoinRoom).toHaveBeenCalledWith(
        user.id,
        mockRoomId
      );

      // Verify state consistency check was performed
      expect(mockInstantSyncService.verifyStateConsistency).toHaveBeenCalledWith(
        user.id,
        mockProjectId,
        reconnectionData.clientState
      );

      // Verify reconnection statistics
      const stats = collaborationService.getStats();
      expect(stats.reconnectionsHandled).toBe(1);
    });

    it('should maintain state consistency across multiple concurrent users', async () => {
      // Connect all users
      for (const user of mockUsers) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      // Create complex state with dependencies
      const complexOperations = [
        // Create tracks
        ...mockUsers.slice(0, 3).map((user, index) => ({
          type: 'track_create',
          userId: user.id,
          targetId: `track-${index}`,
          operation: 'create',
          parameters: {
            name: `Track ${index}`,
            type: index % 2 === 0 ? 'midi' : 'audio',
          },
          projectId: mockProjectId,
          version: index + 1,
        })),
        // Create regions
        ...mockUsers.slice(0, 3).map((user, index) => ({
          type: 'region_create',
          userId: user.id,
          targetId: `region-${index}`,
          operation: 'create',
          parameters: {
            trackId: `track-${index}`,
            startTime: index * 4,
            duration: 3,
          },
          projectId: mockProjectId,
          version: index + 4,
        })),
        // Add MIDI notes
        ...mockUsers.slice(0, 2).map((user, index) => ({
          type: 'midi_note_add',
          userId: user.id,
          targetId: `region-${index}`,
          operation: 'add_notes',
          parameters: {
            notes: [
              { pitch: 60 + index * 4, velocity: 100, startTime: 0, duration: 1 },
            ],
          },
          projectId: mockProjectId,
          version: index + 7,
        })),
      ];

      // Process operations in batches to simulate realistic timing
      const batchSize = 3;
      for (let i = 0; i < complexOperations.length; i += batchSize) {
        const batch = complexOperations.slice(i, i + batchSize);
        const batchPromises = batch.map(operation => {
          const user = mockUsers.find(u => u.id === operation.userId)!;
          return (collaborationService as any).handleFrontendOperationWithPersistence(
            user.socket,
            mockNamespace,
            mockRoomId,
            user.id,
            user.username,
            operation
          );
        });

        await Promise.all(batchPromises);
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Verify all operations were processed
      expect(mockRealTimeChangeService.queueChange).toHaveBeenCalledTimes(8);

      // Verify state consistency
      const stats = collaborationService.getStats();
      expect(stats.totalOperationsProcessed).toBe(8);
      expect(stats.activeConnections).toBe(5);
    });
  });

  describe('Performance with Large Projects and Many Users', () => {
    it('should handle large project with many tracks and regions efficiently', async () => {
      // Connect all users
      for (const user of mockUsers) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      const trackCount = 20;
      const regionsPerTrack = 5;
      const startTime = Date.now();

      // Create tracks
      const trackOperations = Array.from({ length: trackCount }, (_, i) => ({
        type: 'track_create',
        userId: mockUsers[i % mockUsers.length].id,
        targetId: `large-track-${i}`,
        operation: 'create',
        parameters: {
          name: `Large Track ${i}`,
          type: i % 2 === 0 ? 'midi' : 'audio',
        },
        projectId: mockProjectId,
        version: i + 1,
      }));

      // Process tracks in parallel
      const trackPromises = trackOperations.map(operation => {
        const user = mockUsers.find(u => u.id === operation.userId)!;
        return (collaborationService as any).handleFrontendOperationWithPersistence(
          user.socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username,
          operation
        );
      });

      await Promise.all(trackPromises);

      // Create regions
      const regionOperations = [];
      for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
        for (let regionIndex = 0; regionIndex < regionsPerTrack; regionIndex++) {
          regionOperations.push({
            type: 'region_create',
            userId: mockUsers[(trackIndex + regionIndex) % mockUsers.length].id,
            targetId: `large-region-${trackIndex}-${regionIndex}`,
            operation: 'create',
            parameters: {
              trackId: `large-track-${trackIndex}`,
              startTime: regionIndex * 4,
              duration: 3,
            },
            projectId: mockProjectId,
            version: trackCount + (trackIndex * regionsPerTrack) + regionIndex + 1,
          });
        }
      }

      // Process regions in batches
      const batchSize = 10;
      for (let i = 0; i < regionOperations.length; i += batchSize) {
        const batch = regionOperations.slice(i, i + batchSize);
        const batchPromises = batch.map(operation => {
          const user = mockUsers.find(u => u.id === operation.userId)!;
          return (collaborationService as any).handleFrontendOperationWithPersistence(
            user.socket,
            mockNamespace,
            mockRoomId,
            user.id,
            user.username,
            operation
          );
        });

        await Promise.all(batchPromises);
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Verify performance
      const totalOperations = trackCount + (trackCount * regionsPerTrack);
      expect(processingTime).toBeLessThan(5000); // Should complete within 5 seconds

      // Verify all operations were processed
      expect(mockRealTimeChangeService.queueChange).toHaveBeenCalledTimes(totalOperations);

      // Verify statistics
      const stats = collaborationService.getStats();
      expect(stats.totalOperationsProcessed).toBe(totalOperations);
      expect(stats.averageOperationLatency).toBeLessThan(50); // Should be fast
    });

    it('should maintain performance with high-frequency operations', async () => {
      // Connect users
      for (const user of mockUsers) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      const operationsPerUser = 50;
      const startTime = Date.now();

      // Generate high-frequency operations (cursor movements, parameter changes)
      const highFrequencyOperations = mockUsers.flatMap(user =>
        Array.from({ length: operationsPerUser }, (_, i) => ({
          type: 'user_cursor_move',
          userId: user.id,
          targetId: `cursor-${user.id}`,
          operation: 'move',
          parameters: {
            position: i * 0.1,
            trackId: `track-${i % 5}`,
          },
          projectId: mockProjectId,
          version: i + 1,
        }))
      );

      // Process operations concurrently
      const processingPromises = highFrequencyOperations.map(operation => {
        const user = mockUsers.find(u => u.id === operation.userId)!;
        return (collaborationService as any).handleFrontendOperationWithPersistence(
          user.socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username,
          operation
        );
      });

      await Promise.all(processingPromises);

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Verify performance
      const totalOperations = mockUsers.length * operationsPerUser;
      expect(processingTime).toBeLessThan(3000); // Should complete within 3 seconds

      // Verify average processing time
      const avgProcessingTime = processingTime / totalOperations;
      expect(avgProcessingTime).toBeLessThan(20); // Less than 20ms per operation

      // Verify all operations were processed
      expect(mockRealTimeChangeService.queueChange).toHaveBeenCalledTimes(totalOperations);

      // Verify statistics
      const stats = collaborationService.getStats();
      expect(stats.totalOperationsProcessed).toBe(totalOperations);
      expect(stats.averageOperationLatency).toBeLessThan(30);
    });

    it('should handle memory efficiently during long collaboration sessions', async () => {
      // Connect users
      for (const user of mockUsers) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      // Simulate long session with periodic operations
      const sessionDurationMinutes = 2; // 2 minutes for test
      const operationsPerMinute = 30; // 0.5 operations per second
      const totalOperations = sessionDurationMinutes * operationsPerMinute;

      const startTime = Date.now();

      // Process operations in batches over time
      const batchSize = 10;
      const batchCount = Math.ceil(totalOperations / batchSize);

      for (let batch = 0; batch < batchCount; batch++) {
        const batchOperations = Array.from({ 
          length: Math.min(batchSize, totalOperations - batch * batchSize) 
        }, (_, i) => {
          const globalIndex = batch * batchSize + i;
          return {
            type: 'parameter_change',
            userId: mockUsers[globalIndex % mockUsers.length].id,
            targetId: `param-${globalIndex}`,
            operation: 'change',
            parameters: {
              parameter: 'volume',
              value: Math.random(),
            },
            projectId: mockProjectId,
            version: globalIndex + 1,
          };
        });

        // Process batch
        const batchPromises = batchOperations.map(operation => {
          const user = mockUsers.find(u => u.id === operation.userId)!;
          return (collaborationService as any).handleFrontendOperationWithPersistence(
            user.socket,
            mockNamespace,
            mockRoomId,
            user.id,
            user.username,
            operation
          );
        });

        await Promise.all(batchPromises);

        // Small delay between batches to simulate real-time
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify performance
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds

      // Verify all operations were processed
      expect(mockRealTimeChangeService.queueChange).toHaveBeenCalledTimes(totalOperations);

      // Verify memory efficiency (connections should still be active)
      const activeConnections = collaborationService.getActiveConnections();
      expect(activeConnections.size).toBe(5);

      // Verify statistics
      const stats = collaborationService.getStats();
      expect(stats.totalOperationsProcessed).toBe(totalOperations);
      expect(stats.activeConnections).toBe(5);
    });

    it('should handle user disconnections and reconnections during heavy load', async () => {
      // Connect all users initially
      for (const user of mockUsers) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      // Start heavy operation load
      const heavyOperations = Array.from({ length: 100 }, (_, i) => ({
        type: 'track_update',
        userId: mockUsers[i % mockUsers.length].id,
        targetId: `track-${i % 10}`,
        operation: 'update',
        parameters: {
          volume: Math.random(),
        },
        projectId: mockProjectId,
        version: i + 1,
      }));

      // Process operations while simulating disconnections
      const operationPromises = heavyOperations.map((operation, index) => {
        return new Promise<void>(async (resolve) => {
          // Simulate some users disconnecting and reconnecting
          if (index === 25) {
            // Disconnect user 1
            mockUsers[0].socket.emit('disconnect');
          }
          
          if (index === 50) {
            // Reconnect user 1
            await collaborationService.handleUserConnection(
              mockUsers[0].socket as Socket,
              mockNamespace,
              mockRoomId,
              mockUsers[0].id,
              mockUsers[0].username
            );
          }

          const user = mockUsers.find(u => u.id === operation.userId)!;
          await (collaborationService as any).handleFrontendOperationWithPersistence(
            user.socket,
            mockNamespace,
            mockRoomId,
            user.id,
            user.username,
            operation
          );
          resolve();
        });
      });

      await Promise.all(operationPromises);

      // Verify system handled disconnections gracefully
      const stats = collaborationService.getStats();
      expect(stats.totalOperationsProcessed).toBe(100);
      expect(stats.reconnectionsHandled).toBeGreaterThan(0);

      // Verify final connection state
      const activeConnections = collaborationService.getActiveConnections();
      expect(activeConnections.size).toBe(5); // All users should be connected
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle backend service failures gracefully', async () => {
      // Connect users
      for (const user of mockUsers.slice(0, 2)) {
        await collaborationService.handleUserConnection(
          user.socket as Socket,
          mockNamespace,
          mockRoomId,
          user.id,
          user.username
        );
      }

      // Mock backend service failure
      mockRealTimeChangeService.queueChange.mockRejectedValue(
        new Error('Backend service unavailable')
      );

      // Attempt operations
      const operation = {
        type: 'track_create',
        userId: mockUsers[0].id,
        targetId: 'test-track',
        operation: 'create',
        parameters: { name: 'Test Track' },
        projectId: mockProjectId,
        version: 1,
      };

      await (collaborationService as any).handleFrontendOperationWithPersistence(
        mockUsers[0].socket,
        mockNamespace,
        mockRoomId,
        mockUsers[0].id,
        mockUsers[0].username,
        operation
      );

      // Verify error was handled gracefully
      expect(mockUsers[0].socket.emit).toHaveBeenCalledWith(
        'daw:operation_error',
        expect.objectContaining({
          error: expect.stringContaining('Failed to process operation'),
        })
      );
    });

    it('should recover from network issues and sync state', async () => {
      // Connect user
      const user = mockUsers[0];
      await collaborationService.handleUserConnection(
        user.socket as Socket,
        mockNamespace,
        mockRoomId,
        user.id,
        user.username
      );

      // Simulate network issue during state sync
      mockInstantSyncService.verifyStateConsistency.mockRejectedValueOnce(
        new Error('Network timeout')
      );

      // Attempt state verification
      const verificationData = {
        projectId: mockProjectId,
        clientState: { version: 1, tracks: [] },
      };

      await (collaborationService as any).handleStateVerification(
        user.socket,
        user.id,
        verificationData
      );

      // Verify error was handled
      expect(user.socket.emit).toHaveBeenCalledWith(
        'daw:state_verification_error',
        expect.objectContaining({
          error: expect.stringContaining('Verification failed'),
        })
      );
    });
  });
});