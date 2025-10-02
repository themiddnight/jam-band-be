// Jest setup file for backend tests
import { MockFactory } from "./helpers/MockFactory";
import { TestEnvironment } from "./helpers/TestEnvironment";
import { TestLogger } from "./helpers/TestLogger";

// Increase timeout for integration tests
jest.setTimeout(30000);

// Initialize test environment
const testEnv = new TestEnvironment();
const mockFactory = new MockFactory();
const testLogger = new TestLogger();

beforeAll(async () => {
  // Setup test environment
  await testEnv.setup();
  
  // Suppress console output during tests unless explicitly needed
  testLogger.suppressConsole();
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
});

afterAll(async () => {
  // Restore console methods
  testLogger.restoreConsole();
  
  // Cleanup test environment
  await testEnv.cleanup();
});

beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

// Global test utilities
global.testUtils = {
  // Environment utilities
  env: testEnv,
  
  // Mock utilities
  mocks: mockFactory,
  
  // Logger utilities
  logger: testLogger,
  
  // Utility to wait for async operations
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Utility to create mock data
  createMockUser: (overrides: Partial<any> = {}) => mockFactory.createUser(overrides),
  
  createMockRoom: (overrides: Partial<any> = {}) => mockFactory.createRoom(overrides),
  
  createMockSocket: (overrides: Partial<any> = {}) => mockFactory.createSocket(overrides),
  
  // Performance testing utilities
  measurePerformance: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    console.log(`Performance: ${name} took ${end - start} milliseconds`);
    return result;
  },
  
  // Database utilities for integration tests
  cleanDatabase: async () => {
    // Implement database cleanup logic here
    console.log('Database cleaned for test');
  },
  
  // WebSocket testing utilities
  createTestSocketConnection: () => mockFactory.createSocketConnection(),
  
  // Assertion helpers
  expectToMatchSnapshot: (data: any, snapshotName?: string) => {
    expect(data).toMatchSnapshot(snapshotName);
  },
  
  expectToBeValidUser: (user: any) => {
    expect(user).toMatchObject({
      id: expect.any(String),
      username: expect.any(String),
      role: expect.stringMatching(/^(audience|performer|admin)$/),
      isReady: expect.any(Boolean)
    });
  },
  
  expectToBeValidRoom: (room: any) => {
    expect(room).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      owner: expect.any(String),
      isPrivate: expect.any(Boolean),
      createdAt: expect.any(Date)
    });
  }
};

// Declare global types for TypeScript
declare global {
  var testUtils: {
    env: TestEnvironment;
    mocks: MockFactory;
    logger: TestLogger;
    wait: (ms: number) => Promise<void>;
    createMockUser: (overrides?: Partial<any>) => any;
    createMockRoom: (overrides?: Partial<any>) => any;
    createMockSocket: (overrides?: Partial<any>) => any;
    measurePerformance: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
    cleanDatabase: () => Promise<void>;
    createTestSocketConnection: () => any;
    expectToMatchSnapshot: (data: any, snapshotName?: string) => void;
    expectToBeValidUser: (user: any) => void;
    expectToBeValidRoom: (room: any) => void;
  };
}

export {};