/**
 * MockFactory - Creates mock objects for testing
 */
export class MockFactory {
  private userIdCounter = 0;
  private roomIdCounter = 0;
  private socketIdCounter = 0;

  createUser(overrides: Partial<any> = {}): any {
    const id = overrides.id || `test-user-${++this.userIdCounter}`;
    return {
      id,
      username: overrides.username || `user-${id}`,
      role: overrides.role || 'audience',
      isReady: overrides.isReady ?? true,
      joinedAt: overrides.joinedAt || new Date(),
      isConnected: overrides.isConnected ?? true,
      permissions: overrides.permissions || ['view', 'chat'],
      ...overrides
    };
  }

  createRoom(overrides: Partial<any> = {}): any {
    const id = overrides.id || `test-room-${++this.roomIdCounter}`;
    return {
      id,
      name: overrides.name || `Room ${id}`,
      owner: overrides.owner || 'test-owner',
      isPrivate: overrides.isPrivate ?? false,
      users: overrides.users || new Map(),
      settings: overrides.settings || {
        maxUsers: 10,
        allowChat: true,
        allowEffects: true
      },
      createdAt: overrides.createdAt || new Date(),
      updatedAt: overrides.updatedAt || new Date(),
      ...overrides
    };
  }

  createSocket(overrides: Partial<any> = {}): any {
    const id = overrides.id || `socket-${++this.socketIdCounter}`;
    
    const mockSocket = {
      id,
      userId: overrides.userId || `user-${id}`,
      roomId: overrides.roomId || null,
      connected: overrides.connected ?? true,
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      to: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      broadcast: {
        emit: jest.fn(),
        to: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis()
      },
      handshake: {
        auth: overrides.auth || {},
        query: overrides.query || {},
        headers: overrides.headers || {}
      },
      ...overrides
    };

    return mockSocket;
  }

  createSocketConnection(): any {
    return {
      connect: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(true),
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      connected: true
    };
  }

  createMockService<T extends object>(methods: (keyof T)[]): jest.Mocked<T> {
    const mock = {} as jest.Mocked<T>;
    methods.forEach(method => {
      (mock as any)[method] = jest.fn();
    });
    return mock;
  }

  createMockHandler<T extends object>(methods: (keyof T)[]): jest.Mocked<T> {
    const mock = {} as jest.Mocked<T>;
    methods.forEach(method => {
      (mock as any)[method] = jest.fn();
    });
    return mock;
  }

  createMockRepository<T extends object>(): jest.Mocked<T> {
    return {
      create: jest.fn(),
      findById: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      save: jest.fn(),
      exists: jest.fn()
    } as any;
  }

  createMockEventData(type: string, overrides: Partial<any> = {}): any {
    return {
      type,
      timestamp: new Date(),
      userId: `test-user-${Date.now()}`,
      roomId: `test-room-${Date.now()}`,
      data: {},
      ...overrides
    };
  }

  createMockWebRTCConnection(): any {
    return {
      createOffer: jest.fn().mockResolvedValue({}),
      createAnswer: jest.fn().mockResolvedValue({}),
      setLocalDescription: jest.fn().mockResolvedValue(undefined),
      setRemoteDescription: jest.fn().mockResolvedValue(undefined),
      addIceCandidate: jest.fn().mockResolvedValue(undefined),
      getStats: jest.fn().mockResolvedValue(new Map()),
      close: jest.fn(),
      connectionState: 'connected',
      iceConnectionState: 'connected'
    };
  }

  createMockAudioContext(): any {
    return {
      createGain: jest.fn().mockReturnValue({
        connect: jest.fn(),
        disconnect: jest.fn(),
        gain: { value: 1 }
      }),
      createOscillator: jest.fn().mockReturnValue({
        connect: jest.fn(),
        disconnect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        frequency: { value: 440 }
      }),
      createAnalyser: jest.fn().mockReturnValue({
        connect: jest.fn(),
        disconnect: jest.fn(),
        getByteFrequencyData: jest.fn(),
        fftSize: 2048
      }),
      sampleRate: 44100,
      currentTime: 0,
      state: 'running'
    };
  }
}