import { Server } from 'socket.io';
import { createServer } from 'http';
import { MetronomeService, RoomMetronome } from '../../src/services/MetronomeService';
import { RoomService } from '../../src/services/RoomService';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { Room, MetronomeState } from '../../src/types';

describe('MetronomeService', () => {
  let io: Server;
  let metronomeService: MetronomeService;
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let mockNamespace: any;

  beforeEach(() => {
    const httpServer = createServer();
    io = new Server(httpServer);
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    metronomeService = new MetronomeService(io, roomService);

    // Mock namespace
    mockNamespace = {
      emit: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn()
    };

    // Mock room service methods
    jest.spyOn(roomService, 'getMetronomeState').mockReturnValue({
      bpm: 120,
      lastTickTimestamp: Date.now()
    });

    jest.spyOn(roomService, 'getRoom').mockReturnValue({
      id: 'test-room',
      name: 'Test Room',
      owner: 'user1',
      users: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      createdAt: new Date(),
      metronome: {
        bpm: 120,
        lastTickTimestamp: Date.now()
      }
    } as Room);
  });

  afterEach(() => {
    metronomeService.shutdown();
    jest.clearAllMocks();
  });

  describe('initializeRoomMetronome', () => {
    it('should create and start a room metronome instance', () => {
      const roomId = 'test-room';
      
      metronomeService.initializeRoomMetronome(roomId, mockNamespace);
      
      const roomMetronome = metronomeService.getRoomMetronome(roomId);
      expect(roomMetronome).toBeDefined();
      expect(roomMetronome?.getRoomId()).toBe(roomId);
    });

    it('should clean up existing metronome before creating new one', () => {
      const roomId = 'test-room';
      
      // Initialize first metronome
      metronomeService.initializeRoomMetronome(roomId, mockNamespace);
      const firstMetronome = metronomeService.getRoomMetronome(roomId);
      
      // Initialize second metronome (should replace first)
      metronomeService.initializeRoomMetronome(roomId, mockNamespace);
      const secondMetronome = metronomeService.getRoomMetronome(roomId);
      
      expect(secondMetronome).toBeDefined();
      expect(secondMetronome).not.toBe(firstMetronome);
    });
  });

  describe('startMetronome', () => {
    it('should start metronome for existing room', () => {
      const roomId = 'test-room';
      metronomeService.initializeRoomMetronome(roomId, mockNamespace);
      
      metronomeService.startMetronome(roomId);
      
      const roomMetronome = metronomeService.getRoomMetronome(roomId);
      expect(roomMetronome?.getIsRunning()).toBe(true);
    });

    it('should do nothing if room metronome does not exist', () => {
      const roomId = 'non-existent-room';
      
      // Should not throw error
      expect(() => {
        metronomeService.startMetronome(roomId);
      }).not.toThrow();
    });
  });

  describe('stopMetronome', () => {
    it('should stop metronome for existing room', () => {
      const roomId = 'test-room';
      metronomeService.initializeRoomMetronome(roomId, mockNamespace);
      
      metronomeService.stopMetronome(roomId);
      
      const roomMetronome = metronomeService.getRoomMetronome(roomId);
      expect(roomMetronome?.getIsRunning()).toBe(false);
    });
  });

  describe('updateMetronomeTempo', () => {
    it('should update tempo for existing room', () => {
      const roomId = 'test-room';
      metronomeService.initializeRoomMetronome(roomId, mockNamespace);
      
      metronomeService.updateMetronomeTempo(roomId, 140);
      
      const roomMetronome = metronomeService.getRoomMetronome(roomId);
      expect(roomMetronome?.getIsRunning()).toBe(true);
    });
  });

  describe('cleanupRoom', () => {
    it('should cleanup and remove room metronome', () => {
      const roomId = 'test-room';
      metronomeService.initializeRoomMetronome(roomId, mockNamespace);
      
      expect(metronomeService.getRoomMetronome(roomId)).toBeDefined();
      
      metronomeService.cleanupRoom(roomId);
      
      expect(metronomeService.getRoomMetronome(roomId)).toBeUndefined();
    });
  });

  describe('getActiveMetronomes', () => {
    it('should return list of active metronome room IDs', () => {
      const roomId1 = 'test-room-1';
      const roomId2 = 'test-room-2';
      
      metronomeService.initializeRoomMetronome(roomId1, mockNamespace);
      metronomeService.initializeRoomMetronome(roomId2, mockNamespace);
      
      const activeMetronomes = metronomeService.getActiveMetronomes();
      expect(activeMetronomes).toContain(roomId1);
      expect(activeMetronomes).toContain(roomId2);
      expect(activeMetronomes).toHaveLength(2);
    });

    it('should not include stopped metronomes', () => {
      const roomId = 'test-room';
      metronomeService.initializeRoomMetronome(roomId, mockNamespace);
      metronomeService.stopMetronome(roomId);
      
      const activeMetronomes = metronomeService.getActiveMetronomes();
      expect(activeMetronomes).not.toContain(roomId);
    });
  });

  describe('getTotalMetronomes', () => {
    it('should return total number of metronome instances', () => {
      expect(metronomeService.getTotalMetronomes()).toBe(0);
      
      metronomeService.initializeRoomMetronome('room1', mockNamespace);
      expect(metronomeService.getTotalMetronomes()).toBe(1);
      
      metronomeService.initializeRoomMetronome('room2', mockNamespace);
      expect(metronomeService.getTotalMetronomes()).toBe(2);
      
      metronomeService.cleanupRoom('room1');
      expect(metronomeService.getTotalMetronomes()).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('should cleanup all metronome instances', () => {
      metronomeService.initializeRoomMetronome('room1', mockNamespace);
      metronomeService.initializeRoomMetronome('room2', mockNamespace);
      
      expect(metronomeService.getTotalMetronomes()).toBe(2);
      
      metronomeService.shutdown();
      
      expect(metronomeService.getTotalMetronomes()).toBe(0);
    });
  });
});

describe('RoomMetronome', () => {
  let roomMetronome: RoomMetronome;
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let mockNamespace: any;

  beforeEach(() => {
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    
    mockNamespace = {
      emit: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn()
    };

    // Mock room service methods
    jest.spyOn(roomService, 'getMetronomeState').mockReturnValue({
      bpm: 120,
      lastTickTimestamp: Date.now()
    });

    jest.spyOn(roomService, 'getRoom').mockReturnValue({
      id: 'test-room',
      name: 'Test Room',
      owner: 'user1',
      users: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      createdAt: new Date(),
      metronome: {
        bpm: 120,
        lastTickTimestamp: Date.now()
      }
    } as Room);

    roomMetronome = new RoomMetronome('test-room', mockNamespace, roomService);
  });

  afterEach(() => {
    roomMetronome.cleanup();
    jest.clearAllMocks();
  });

  describe('start', () => {
    it('should start the metronome and set running state', () => {
      expect(roomMetronome.getIsRunning()).toBe(false);
      
      roomMetronome.start();
      
      expect(roomMetronome.getIsRunning()).toBe(true);
    });

    it('should emit metronome tick to namespace', (done) => {
      roomMetronome.start();
      
      // Wait for first tick
      setTimeout(() => {
        expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_tick', expect.objectContaining({
          timestamp: expect.any(Number),
          bpm: 120
        }));
        done();
      }, 50);
    });

    it('should stop if room metronome state is not available', () => {
      jest.spyOn(roomService, 'getMetronomeState').mockReturnValue(null);
      
      roomMetronome.start();
      
      expect(roomMetronome.getIsRunning()).toBe(false);
    });
  });

  describe('stop', () => {
    it('should stop the metronome and clear running state', () => {
      roomMetronome.start();
      expect(roomMetronome.getIsRunning()).toBe(true);
      
      roomMetronome.stop();
      
      expect(roomMetronome.getIsRunning()).toBe(false);
    });
  });

  describe('updateTempo', () => {
    it('should restart metronome with new tempo', () => {
      const stopSpy = jest.spyOn(roomMetronome, 'stop');
      const startSpy = jest.spyOn(roomMetronome, 'start');
      
      roomMetronome.updateTempo(140);
      
      expect(stopSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe('getRoomId', () => {
    it('should return the room ID', () => {
      expect(roomMetronome.getRoomId()).toBe('test-room');
    });
  });

  describe('cleanup', () => {
    it('should stop the metronome', () => {
      roomMetronome.start();
      expect(roomMetronome.getIsRunning()).toBe(true);
      
      roomMetronome.cleanup();
      
      expect(roomMetronome.getIsRunning()).toBe(false);
    });
  });
});