import { describe, it, expect, beforeEach, jest, mock } from 'bun:test';
import { Socket, Namespace } from 'socket.io';
import { MetronomeHandler } from '../MetronomeHandler';
import { RoomService } from '../../../../../services/RoomService';
import { MetronomeService } from '../../../../../services/MetronomeService';
import { RoomSessionManager } from '../../../../../services/RoomSessionManager';
import { NamespaceManager } from '../../../../../services/NamespaceManager';
import { UpdateMetronomeData, User, UserSession, Room, MetronomeState } from '../../../../../types';

/**
 * MetronomeHandler Bun Test Suite
 * Requirements: 7.2, 8.1
 * 
 * Tests metronome updates and state requests using Bun test runner
 * Verifies namespace-aware metronome works identically
 * Tests metronome synchronization across room members
 */

// Mock dependencies
const mockRoomService = {
  getRoom: jest.fn(),
  updateMetronomeBPM: jest.fn(),
  getMetronomeState: jest.fn()
} as jest.Mocked<Partial<RoomService>>;

const mockMetronomeService = {
  updateMetronomeTempo: jest.fn()
} as jest.Mocked<Partial<MetronomeService>>;

const mockRoomSessionManager = {
  getRoomSession: jest.fn()
} as jest.Mocked<Partial<RoomSessionManager>>;

const mockNamespaceManager = {
  getRoomNamespace: jest.fn(),
  createRoomNamespace: jest.fn()
} as jest.Mocked<Partial<NamespaceManager>>;

// Mock socket and namespace
const mockSocket = {
  id: 'socket-metronome-test-123',
  emit: jest.fn()
} as jest.Mocked<Partial<Socket>>;

const mockNamespace = {
  name: '/room-metronome-test-room',
  emit: jest.fn()
} as jest.Mocked<Partial<Namespace>>;

describe('MetronomeHandler - Bun Test Suite', () => {
  let metronomeHandler: MetronomeHandler;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create handler instance
    metronomeHandler = new MetronomeHandler(
      mockRoomService as RoomService,
      mockMetronomeService as MetronomeService,
      mockRoomSessionManager as RoomSessionManager,
      mockNamespaceManager as NamespaceManager
    );

    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('Metronome Updates and State Requests', () => {
    const validMetronomeData: UpdateMetronomeData = {
      bpm: 120
    };

    const mockSession: UserSession = {
      roomId: 'metronome-test-room',
      userId: 'metronome-user-123'
    };

    const mockRoomOwner: User = {
      id: 'metronome-user-123',
      username: 'MetronomeOwner',
      role: 'room_owner',
      isReady: true
    };

    const mockBandMember: User = {
      id: 'band-member-456',
      username: 'BandMember',
      role: 'band_member',
      isReady: true
    };

    const mockAudienceMember: User = {
      id: 'audience-789',
      username: 'AudienceMember',
      role: 'audience',
      isReady: true
    };

    const mockRoom: Room = {
      id: 'metronome-test-room',
      name: 'Metronome Test Room',
      owner: 'metronome-user-123',
      users: new Map([
        ['metronome-user-123', mockRoomOwner],
        ['band-member-456', mockBandMember],
        ['audience-789', mockAudienceMember]
      ]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      createdAt: new Date(),
      metronome: {
        bpm: 100,
        lastTickTimestamp: Date.now()
      }
    };

    describe('handleUpdateMetronome', () => {
      it('should update metronome BPM when room owner makes request', () => {
        // Arrange
        const updatedRoom: Room = {
          ...mockRoom,
          metronome: {
            bpm: 120,
            lastTickTimestamp: Date.now()
          }
        };

        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getRoom.mockReturnValue(mockRoom);
        mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);
        mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

        // Act
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, validMetronomeData);

        // Assert
        expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-metronome-test-123');
        expect(mockRoomService.getRoom).toHaveBeenCalledWith('metronome-test-room');
        expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledWith('metronome-test-room', 120);
        expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledWith('metronome-test-room', 120);
        expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
          bpm: 120,
          lastTickTimestamp: expect.any(Number)
        });
      });

      it('should update metronome BPM when band member makes request', () => {
        // Arrange
        const bandMemberSession: UserSession = {
          roomId: 'metronome-test-room',
          userId: 'band-member-456'
        };

        const updatedRoom: Room = {
          ...mockRoom,
          metronome: {
            bpm: 140,
            lastTickTimestamp: Date.now()
          }
        };

        mockRoomSessionManager.getRoomSession.mockReturnValue(bandMemberSession);
        mockRoomService.getRoom.mockReturnValue(mockRoom);
        mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);
        mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

        // Act
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 140 });

        // Assert
        expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledWith('metronome-test-room', 140);
        expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledWith('metronome-test-room', 140);
        expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
          bpm: 140,
          lastTickTimestamp: expect.any(Number)
        });
      });

      it('should reject metronome update from audience member', () => {
        // Arrange
        const audienceSession: UserSession = {
          roomId: 'metronome-test-room',
          userId: 'audience-789'
        };

        mockRoomSessionManager.getRoomSession.mockReturnValue(audienceSession);
        mockRoomService.getRoom.mockReturnValue(mockRoom);

        // Act
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, validMetronomeData);

        // Assert
        expect(mockRoomService.updateMetronomeBPM).not.toHaveBeenCalled();
        expect(mockMetronomeService.updateMetronomeTempo).not.toHaveBeenCalled();
        expect(mockNamespace.emit).not.toHaveBeenCalled();
      });

      it('should handle namespace creation when namespace does not exist', () => {
        // Arrange
        const updatedRoom: Room = {
          ...mockRoom,
          metronome: {
            bpm: 130,
            lastTickTimestamp: Date.now()
          }
        };

        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getRoom.mockReturnValue(mockRoom);
        mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);
        mockNamespaceManager.getRoomNamespace.mockReturnValue(null);
        mockNamespaceManager.createRoomNamespace.mockReturnValue(mockNamespace as Namespace);

        // Act
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 130 });

        // Assert
        expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('metronome-test-room');
        expect(mockNamespaceManager.createRoomNamespace).toHaveBeenCalledWith('metronome-test-room');
        expect(consoleLogSpy).toHaveBeenCalledWith('🔧 Creating room namespace for roomId:', 'metronome-test-room');
        expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
          bpm: 130,
          lastTickTimestamp: expect.any(Number)
        });
      });

      it('should handle namespace creation failure gracefully', () => {
        // Arrange
        const updatedRoom: Room = {
          ...mockRoom,
          metronome: {
            bpm: 110,
            lastTickTimestamp: Date.now()
          }
        };

        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getRoom.mockReturnValue(mockRoom);
        mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);
        mockNamespaceManager.getRoomNamespace.mockReturnValue(null);
        mockNamespaceManager.createRoomNamespace.mockImplementation(() => {
          throw new Error('Failed to create namespace');
        });

        // Act
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 110 });

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '❌ Failed to create room namespace for roomId:',
          'metronome-test-room',
          expect.any(Error)
        );
        // Should still update the metronome service even if namespace creation fails
        expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledWith('metronome-test-room', 110);
      });

      it('should return early when socket has no session', () => {
        // Arrange
        mockRoomSessionManager.getRoomSession.mockReturnValue(null);

        // Act
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, validMetronomeData);

        // Assert
        expect(mockRoomService.getRoom).not.toHaveBeenCalled();
        expect(mockRoomService.updateMetronomeBPM).not.toHaveBeenCalled();
        expect(mockMetronomeService.updateMetronomeTempo).not.toHaveBeenCalled();
      });

      it('should return early when room does not exist', () => {
        // Arrange
        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getRoom.mockReturnValue(null);

        // Act
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, validMetronomeData);

        // Assert
        expect(mockRoomService.updateMetronomeBPM).not.toHaveBeenCalled();
        expect(mockMetronomeService.updateMetronomeTempo).not.toHaveBeenCalled();
      });

      it('should return early when user is not in room', () => {
        // Arrange
        const sessionWithMissingUser: UserSession = {
          roomId: 'metronome-test-room',
          userId: 'missing-user-999'
        };

        mockRoomSessionManager.getRoomSession.mockReturnValue(sessionWithMissingUser);
        mockRoomService.getRoom.mockReturnValue(mockRoom);

        // Act
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, validMetronomeData);

        // Assert
        expect(mockRoomService.updateMetronomeBPM).not.toHaveBeenCalled();
        expect(mockMetronomeService.updateMetronomeTempo).not.toHaveBeenCalled();
      });
    });

    describe('handleRequestMetronomeState', () => {
      const mockMetronomeState: MetronomeState = {
        bpm: 115,
        lastTickTimestamp: Date.now()
      };

      it('should send metronome state to requesting user', () => {
        // Arrange
        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getMetronomeState.mockReturnValue(mockMetronomeState);

        // Act
        metronomeHandler.handleRequestMetronomeState(mockSocket as Socket);

        // Assert
        expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-metronome-test-123');
        expect(mockRoomService.getMetronomeState).toHaveBeenCalledWith('metronome-test-room');
        expect(mockSocket.emit).toHaveBeenCalledWith('metronome_state', mockMetronomeState);
      });

      it('should return early when socket has no session', () => {
        // Arrange
        mockRoomSessionManager.getRoomSession.mockReturnValue(null);

        // Act
        metronomeHandler.handleRequestMetronomeState(mockSocket as Socket);

        // Assert
        expect(mockRoomService.getMetronomeState).not.toHaveBeenCalled();
        expect(mockSocket.emit).not.toHaveBeenCalled();
      });

      it('should return early when metronome state is not found', () => {
        // Arrange
        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getMetronomeState.mockReturnValue(null);

        // Act
        metronomeHandler.handleRequestMetronomeState(mockSocket as Socket);

        // Assert
        expect(mockRoomService.getMetronomeState).toHaveBeenCalledWith('metronome-test-room');
        expect(mockSocket.emit).not.toHaveBeenCalled();
      });
    });
  });

  describe('Namespace-Aware Metronome Functionality', () => {
    const validMetronomeData: UpdateMetronomeData = {
      bpm: 150
    };

    const mockSession: UserSession = {
      roomId: 'namespace-metronome-room',
      userId: 'namespace-user-123'
    };

    const mockUser: User = {
      id: 'namespace-user-123',
      username: 'NamespaceMetronomeUser',
      role: 'room_owner',
      isReady: true
    };

    const mockRoom: Room = {
      id: 'namespace-metronome-room',
      name: 'Namespace Metronome Room',
      owner: 'namespace-user-123',
      users: new Map([['namespace-user-123', mockUser]]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      createdAt: new Date(),
      metronome: {
        bpm: 100,
        lastTickTimestamp: Date.now()
      }
    };

    describe('handleUpdateMetronomeNamespace', () => {
      it('should update metronome through provided namespace identically to regular method', () => {
        // Arrange
        const updatedRoom: Room = {
          ...mockRoom,
          metronome: {
            bpm: 150,
            lastTickTimestamp: Date.now()
          }
        };

        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getRoom.mockReturnValue(mockRoom);
        mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);

        // Act
        metronomeHandler.handleUpdateMetronomeNamespace(mockSocket as Socket, validMetronomeData, mockNamespace as Namespace);

        // Assert - Verify service calls (same as regular method)
        expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-metronome-test-123');
        expect(mockRoomService.getRoom).toHaveBeenCalledWith('namespace-metronome-room');
        expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledWith('namespace-metronome-room', 150);
        expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledWith('namespace-metronome-room', 150);
        
        // Assert - Verify namespace broadcast
        expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
          bpm: 150,
          lastTickTimestamp: expect.any(Number)
        });
      });

      it('should produce identical behavior in both regular and namespace methods', () => {
        // Arrange
        const updatedRoom: Room = {
          ...mockRoom,
          metronome: {
            bpm: 125,
            lastTickTimestamp: Date.now()
          }
        };

        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getRoom.mockReturnValue(mockRoom);
        mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);
        mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

        const testData: UpdateMetronomeData = { bpm: 125 };

        // Act - Call both methods
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, testData);
        metronomeHandler.handleUpdateMetronomeNamespace(mockSocket as Socket, testData, mockNamespace as Namespace);

        // Assert - Both calls should have identical behavior
        expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledTimes(2);
        expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledTimes(2);
        expect(mockNamespace.emit).toHaveBeenCalledTimes(2);
        
        // Verify identical parameters
        expect(mockRoomService.updateMetronomeBPM).toHaveBeenNthCalledWith(1, 'namespace-metronome-room', 125);
        expect(mockRoomService.updateMetronomeBPM).toHaveBeenNthCalledWith(2, 'namespace-metronome-room', 125);
        expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenNthCalledWith(1, 'namespace-metronome-room', 125);
        expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenNthCalledWith(2, 'namespace-metronome-room', 125);
      });

      it('should handle namespace method error cases identically', () => {
        // Test no session case
        mockRoomSessionManager.getRoomSession.mockReturnValue(null);
        
        metronomeHandler.handleUpdateMetronomeNamespace(mockSocket as Socket, validMetronomeData, mockNamespace as Namespace);
        
        expect(mockRoomService.getRoom).not.toHaveBeenCalled();
        expect(mockNamespace.emit).not.toHaveBeenCalled();

        // Reset and test room not found case
        jest.clearAllMocks();
        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getRoom.mockReturnValue(null);
        
        metronomeHandler.handleUpdateMetronomeNamespace(mockSocket as Socket, validMetronomeData, mockNamespace as Namespace);
        
        expect(mockRoomService.updateMetronomeBPM).not.toHaveBeenCalled();
        expect(mockNamespace.emit).not.toHaveBeenCalled();

        // Reset and test user not found case
        jest.clearAllMocks();
        const sessionWithMissingUser: UserSession = {
          roomId: 'namespace-metronome-room',
          userId: 'missing-user-999'
        };
        mockRoomSessionManager.getRoomSession.mockReturnValue(sessionWithMissingUser);
        mockRoomService.getRoom.mockReturnValue(mockRoom);
        
        metronomeHandler.handleUpdateMetronomeNamespace(mockSocket as Socket, validMetronomeData, mockNamespace as Namespace);
        
        expect(mockRoomService.updateMetronomeBPM).not.toHaveBeenCalled();
        expect(mockNamespace.emit).not.toHaveBeenCalled();
      });
    });

    describe('handleRequestMetronomeStateNamespace', () => {
      const mockMetronomeState: MetronomeState = {
        bpm: 135,
        lastTickTimestamp: Date.now()
      };

      it('should send metronome state through namespace identically to regular method', () => {
        // Arrange
        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getMetronomeState.mockReturnValue(mockMetronomeState);

        // Act
        metronomeHandler.handleRequestMetronomeStateNamespace(mockSocket as Socket, mockNamespace as Namespace);

        // Assert - Verify service calls (same as regular method)
        expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-metronome-test-123');
        expect(mockRoomService.getMetronomeState).toHaveBeenCalledWith('namespace-metronome-room');
        
        // Assert - Verify socket emission (same as regular method)
        expect(mockSocket.emit).toHaveBeenCalledWith('metronome_state', mockMetronomeState);
      });

      it('should produce identical behavior in both regular and namespace methods', () => {
        // Arrange
        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getMetronomeState.mockReturnValue(mockMetronomeState);

        // Act - Call both methods
        metronomeHandler.handleRequestMetronomeState(mockSocket as Socket);
        metronomeHandler.handleRequestMetronomeStateNamespace(mockSocket as Socket, mockNamespace as Namespace);

        // Assert - Both calls should have identical behavior
        expect(mockRoomService.getMetronomeState).toHaveBeenCalledTimes(2);
        expect(mockSocket.emit).toHaveBeenCalledTimes(2);
        
        // Verify identical parameters
        expect(mockRoomService.getMetronomeState).toHaveBeenNthCalledWith(1, 'namespace-metronome-room');
        expect(mockRoomService.getMetronomeState).toHaveBeenNthCalledWith(2, 'namespace-metronome-room');
        expect(mockSocket.emit).toHaveBeenNthCalledWith(1, 'metronome_state', mockMetronomeState);
        expect(mockSocket.emit).toHaveBeenNthCalledWith(2, 'metronome_state', mockMetronomeState);
      });

      it('should handle namespace method error cases identically', () => {
        // Test no session case
        mockRoomSessionManager.getRoomSession.mockReturnValue(null);
        
        metronomeHandler.handleRequestMetronomeStateNamespace(mockSocket as Socket, mockNamespace as Namespace);
        
        expect(mockRoomService.getMetronomeState).not.toHaveBeenCalled();
        expect(mockSocket.emit).not.toHaveBeenCalled();

        // Reset and test metronome state not found case
        jest.clearAllMocks();
        mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
        mockRoomService.getMetronomeState.mockReturnValue(null);
        
        metronomeHandler.handleRequestMetronomeStateNamespace(mockSocket as Socket, mockNamespace as Namespace);
        
        expect(mockRoomService.getMetronomeState).toHaveBeenCalledWith('namespace-metronome-room');
        expect(mockSocket.emit).not.toHaveBeenCalled();
      });
    });
  });

  describe('Metronome Synchronization Across Room Members', () => {
    const mockOwnerSession: UserSession = {
      roomId: 'sync-room',
      userId: 'owner-123'
    };

    const mockBandMemberSession: UserSession = {
      roomId: 'sync-room',
      userId: 'band-member-456'
    };

    const mockOwner: User = {
      id: 'owner-123',
      username: 'RoomOwner',
      role: 'room_owner',
      isReady: true
    };

    const mockBandMember: User = {
      id: 'band-member-456',
      username: 'BandMember',
      role: 'band_member',
      isReady: true
    };

    const mockAudience: User = {
      id: 'audience-789',
      username: 'AudienceMember',
      role: 'audience',
      isReady: true
    };

    const mockSyncRoom: Room = {
      id: 'sync-room',
      name: 'Synchronization Test Room',
      owner: 'owner-123',
      users: new Map([
        ['owner-123', mockOwner],
        ['band-member-456', mockBandMember],
        ['audience-789', mockAudience]
      ]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      createdAt: new Date(),
      metronome: {
        bpm: 100,
        lastTickTimestamp: Date.now()
      }
    };

    it('should synchronize metronome updates across all room members when owner updates', () => {
      // Arrange
      const updatedRoom: Room = {
        ...mockSyncRoom,
        metronome: {
          bpm: 160,
          lastTickTimestamp: Date.now()
        }
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue(mockOwnerSession);
      mockRoomService.getRoom.mockReturnValue(mockSyncRoom);
      mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      // Act
      metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 160 });

      // Assert - Verify room-wide synchronization
      expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
        bpm: 160,
        lastTickTimestamp: expect.any(Number)
      });
      
      // Verify that the metronome service is updated for the entire room
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledWith('sync-room', 160);
      
      // Verify all users in the room would receive the update through namespace
      expect(mockNamespace.emit).toHaveBeenCalledTimes(1);
    });

    it('should synchronize metronome updates across all room members when band member updates', () => {
      // Arrange
      const updatedRoom: Room = {
        ...mockSyncRoom,
        metronome: {
          bpm: 180,
          lastTickTimestamp: Date.now()
        }
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue(mockBandMemberSession);
      mockRoomService.getRoom.mockReturnValue(mockSyncRoom);
      mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      // Act
      metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 180 });

      // Assert - Verify room-wide synchronization
      expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
        bpm: 180,
        lastTickTimestamp: expect.any(Number)
      });
      
      // Verify that the metronome service is updated for the entire room
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledWith('sync-room', 180);
    });

    it('should maintain consistent metronome state across multiple rapid updates', () => {
      // Arrange
      const bpmValues = [120, 130, 140, 150, 160];
      const updatedRooms = bpmValues.map(bpm => ({
        ...mockSyncRoom,
        metronome: {
          bpm,
          lastTickTimestamp: Date.now()
        }
      }));

      mockRoomSessionManager.getRoomSession.mockReturnValue(mockOwnerSession);
      mockRoomService.getRoom.mockReturnValue(mockSyncRoom);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      // Mock sequential updates
      bpmValues.forEach((bpm, index) => {
        mockRoomService.updateMetronomeBPM.mockReturnValueOnce(updatedRooms[index]);
      });

      // Act - Simulate rapid metronome updates
      bpmValues.forEach(bpm => {
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm });
      });

      // Assert - Verify all updates were processed and synchronized
      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledTimes(5);
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledTimes(5);
      expect(mockNamespace.emit).toHaveBeenCalledTimes(5);

      // Verify each update was broadcast with correct BPM
      bpmValues.forEach((bpm, index) => {
        expect(mockRoomService.updateMetronomeBPM).toHaveBeenNthCalledWith(index + 1, 'sync-room', bpm);
        expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenNthCalledWith(index + 1, 'sync-room', bpm);
        expect(mockNamespace.emit).toHaveBeenNthCalledWith(index + 1, 'metronome_updated', {
          bpm,
          lastTickTimestamp: expect.any(Number)
        });
      });
    });

    it('should ensure metronome state consistency when multiple users request state', () => {
      // Arrange
      const consistentMetronomeState: MetronomeState = {
        bpm: 125,
        lastTickTimestamp: Date.now()
      };

      const ownerSocket = { ...mockSocket, id: 'owner-socket' };
      const bandMemberSocket = { ...mockSocket, id: 'band-member-socket' };
      const audienceSocket = { ...mockSocket, id: 'audience-socket' };

      mockRoomService.getMetronomeState.mockReturnValue(consistentMetronomeState);

      // Act - Multiple users request metronome state
      mockRoomSessionManager.getRoomSession.mockReturnValueOnce(mockOwnerSession);
      metronomeHandler.handleRequestMetronomeState(ownerSocket as Socket);

      mockRoomSessionManager.getRoomSession.mockReturnValueOnce(mockBandMemberSession);
      metronomeHandler.handleRequestMetronomeState(bandMemberSocket as Socket);

      mockRoomSessionManager.getRoomSession.mockReturnValueOnce({
        roomId: 'sync-room',
        userId: 'audience-789'
      });
      metronomeHandler.handleRequestMetronomeState(audienceSocket as Socket);

      // Assert - All users should receive the same consistent state
      expect(mockRoomService.getMetronomeState).toHaveBeenCalledTimes(3);
      expect(ownerSocket.emit).toHaveBeenCalledWith('metronome_state', consistentMetronomeState);
      expect(bandMemberSocket.emit).toHaveBeenCalledWith('metronome_state', consistentMetronomeState);
      expect(audienceSocket.emit).toHaveBeenCalledWith('metronome_state', consistentMetronomeState);
    });

    it('should handle concurrent metronome updates from different authorized users', () => {
      // Arrange
      const ownerSocket = { ...mockSocket, id: 'owner-socket', emit: jest.fn() };
      const bandMemberSocket = { ...mockSocket, id: 'band-member-socket', emit: jest.fn() };

      const ownerUpdatedRoom: Room = {
        ...mockSyncRoom,
        metronome: { bpm: 140, lastTickTimestamp: Date.now() }
      };

      const bandMemberUpdatedRoom: Room = {
        ...mockSyncRoom,
        metronome: { bpm: 150, lastTickTimestamp: Date.now() }
      };

      mockRoomService.getRoom.mockReturnValue(mockSyncRoom);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      // Mock sequential updates
      mockRoomService.updateMetronomeBPM
        .mockReturnValueOnce(ownerUpdatedRoom)
        .mockReturnValueOnce(bandMemberUpdatedRoom);

      // Act - Concurrent updates from owner and band member
      mockRoomSessionManager.getRoomSession.mockReturnValueOnce(mockOwnerSession);
      metronomeHandler.handleUpdateMetronome(ownerSocket as Socket, { bpm: 140 });

      mockRoomSessionManager.getRoomSession.mockReturnValueOnce(mockBandMemberSession);
      metronomeHandler.handleUpdateMetronome(bandMemberSocket as Socket, { bpm: 150 });

      // Assert - Both updates should be processed and synchronized
      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledTimes(2);
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledTimes(2);
      expect(mockNamespace.emit).toHaveBeenCalledTimes(2);

      expect(mockRoomService.updateMetronomeBPM).toHaveBeenNthCalledWith(1, 'sync-room', 140);
      expect(mockRoomService.updateMetronomeBPM).toHaveBeenNthCalledWith(2, 'sync-room', 150);
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenNthCalledWith(1, 'sync-room', 140);
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenNthCalledWith(2, 'sync-room', 150);
    });
  });

  describe('Performance and Timing with Bun', () => {
    const mockSession: UserSession = {
      roomId: 'perf-room',
      userId: 'perf-user'
    };
    
    const mockUser: User = {
      id: 'perf-user',
      username: 'PerfUser',
      role: 'room_owner',
      isReady: true
    };

    const mockRoom: Room = {
      id: 'perf-room',
      name: 'Performance Test Room',
      owner: 'perf-user',
      users: new Map([['perf-user', mockUser]]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      createdAt: new Date(),
      metronome: {
        bpm: 100,
        lastTickTimestamp: Date.now()
      }
    };

    beforeEach(() => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);
    });

    it('should process metronome updates efficiently using Bun performance APIs', () => {
      // Arrange
      const updateCount = 50;
      const updatedRoom: Room = {
        ...mockRoom,
        metronome: { bpm: 120, lastTickTimestamp: Date.now() }
      };
      mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);

      const startTime = Bun.nanoseconds();

      // Act - Process multiple metronome updates
      for (let i = 0; i < updateCount; i++) {
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 120 + i });
      }

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000; // Convert to milliseconds

      // Assert
      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledTimes(updateCount);
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledTimes(updateCount);
      expect(mockNamespace.emit).toHaveBeenCalledTimes(updateCount);
      expect(durationMs).toBeLessThan(50); // Should process 50 updates in under 50ms
    });

    it('should handle rapid metronome state requests efficiently', () => {
      // Arrange
      const requestCount = 100;
      const mockMetronomeState: MetronomeState = {
        bpm: 130,
        lastTickTimestamp: Date.now()
      };
      mockRoomService.getMetronomeState.mockReturnValue(mockMetronomeState);

      const startTime = Bun.nanoseconds();

      // Act - Process multiple state requests
      for (let i = 0; i < requestCount; i++) {
        metronomeHandler.handleRequestMetronomeState(mockSocket as Socket);
      }

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000; // Convert to milliseconds

      // Assert
      expect(mockRoomService.getMetronomeState).toHaveBeenCalledTimes(requestCount);
      expect(mockSocket.emit).toHaveBeenCalledTimes(requestCount);
      expect(durationMs).toBeLessThan(25); // Should process 100 requests in under 25ms
    });

    it('should maintain accurate timestamps in metronome updates', () => {
      // Arrange
      const beforeTime = Date.now();
      const updatedRoom: Room = {
        ...mockRoom,
        metronome: {
          bpm: 140,
          lastTickTimestamp: Date.now()
        }
      };
      mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);

      // Act
      metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 140 });

      const afterTime = Date.now();

      // Assert
      expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
        bpm: 140,
        lastTickTimestamp: expect.any(Number)
      });

      const emittedData = mockNamespace.emit.mock.calls[0][1];
      expect(emittedData.lastTickTimestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(emittedData.lastTickTimestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should handle high-frequency metronome updates without performance degradation', () => {
      // Arrange
      const highFrequencyUpdates = 200;
      const bpmValues = Array.from({ length: highFrequencyUpdates }, (_, i) => 60 + (i % 180)); // BPM range 60-240
      
      const updatedRooms = bpmValues.map(bpm => ({
        ...mockRoom,
        metronome: { bpm, lastTickTimestamp: Date.now() }
      }));

      bpmValues.forEach((_, index) => {
        mockRoomService.updateMetronomeBPM.mockReturnValueOnce(updatedRooms[index]);
      });

      const startTime = Bun.nanoseconds();

      // Act - Simulate high-frequency metronome updates
      bpmValues.forEach(bpm => {
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm });
      });

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000;

      // Assert - Should handle high frequency without significant performance impact
      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledTimes(highFrequencyUpdates);
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledTimes(highFrequencyUpdates);
      expect(mockNamespace.emit).toHaveBeenCalledTimes(highFrequencyUpdates);
      expect(durationMs).toBeLessThan(100); // Should process 200 updates in under 100ms

      // Verify each update was processed correctly
      bpmValues.forEach((bpm, index) => {
        expect(mockRoomService.updateMetronomeBPM).toHaveBeenNthCalledWith(index + 1, 'perf-room', bpm);
        expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenNthCalledWith(index + 1, 'perf-room', bpm);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle invalid BPM values gracefully', () => {
      // Arrange
      const mockSession: UserSession = {
        roomId: 'edge-case-room',
        userId: 'edge-user'
      };

      const mockUser: User = {
        id: 'edge-user',
        username: 'EdgeUser',
        role: 'room_owner',
        isReady: true
      };

      const mockRoom: Room = {
        id: 'edge-case-room',
        name: 'Edge Case Room',
        owner: 'edge-user',
        users: new Map([['edge-user', mockUser]]),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        createdAt: new Date(),
        metronome: { bpm: 100, lastTickTimestamp: Date.now() }
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      const invalidBpmValues = [
        { bpm: -10 },
        { bpm: 0 },
        { bpm: 1000 },
        { bpm: null as any },
        { bpm: undefined as any },
        { bpm: 'invalid' as any }
      ];

      // Act & Assert - Each invalid BPM should be handled gracefully
      invalidBpmValues.forEach(invalidData => {
        // The handler should still attempt to process, but the service layer should handle validation
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, invalidData);
        expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledWith('edge-case-room', invalidData.bpm);
      });

      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledTimes(invalidBpmValues.length);
    });

    it('should handle service failures gracefully', () => {
      // Arrange
      const mockSession: UserSession = {
        roomId: 'service-failure-room',
        userId: 'service-user'
      };

      const mockUser: User = {
        id: 'service-user',
        username: 'ServiceUser',
        role: 'room_owner',
        isReady: true
      };

      const mockRoom: Room = {
        id: 'service-failure-room',
        name: 'Service Failure Room',
        owner: 'service-user',
        users: new Map([['service-user', mockUser]]),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        createdAt: new Date(),
        metronome: { bpm: 100, lastTickTimestamp: Date.now() }
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.updateMetronomeBPM.mockReturnValue(null); // Simulate service failure
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      // Act
      metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 120 });

      // Assert - Should handle service failure gracefully
      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledWith('service-failure-room', 120);
      expect(mockMetronomeService.updateMetronomeTempo).not.toHaveBeenCalled();
      expect(mockNamespace.emit).not.toHaveBeenCalled();
    });

    it('should propagate metronome service failures as expected', () => {
      // Arrange
      const mockSession: UserSession = {
        roomId: 'metronome-service-failure-room',
        userId: 'metronome-user'
      };

      const mockUser: User = {
        id: 'metronome-user',
        username: 'MetronomeUser',
        role: 'room_owner',
        isReady: true
      };

      const mockRoom: Room = {
        id: 'metronome-service-failure-room',
        name: 'Metronome Service Failure Room',
        owner: 'metronome-user',
        users: new Map([['metronome-user', mockUser]]),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        createdAt: new Date(),
        metronome: { bpm: 100, lastTickTimestamp: Date.now() }
      };

      const updatedRoom: Room = {
        ...mockRoom,
        metronome: { bpm: 130, lastTickTimestamp: Date.now() }
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.updateMetronomeBPM.mockReturnValue(updatedRoom);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);
      mockMetronomeService.updateMetronomeTempo.mockImplementation(() => {
        throw new Error('Metronome service failure');
      });

      // Act & Assert - Should throw error when metronome service fails
      expect(() => {
        metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 130 });
      }).toThrow('Metronome service failure');

      // Assert - Room update should have been called before the service failure
      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledWith('metronome-service-failure-room', 130);
      // Namespace broadcast should not happen due to the error
      expect(mockNamespace.emit).not.toHaveBeenCalled();
    });
  });
});