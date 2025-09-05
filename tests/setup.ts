// Jest setup file for backend tests

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console methods to reduce noise in tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeAll(() => {
  // Suppress console output during tests unless explicitly needed
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

// Global test utilities
global.testUtils = {
  // Utility to wait for async operations
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Utility to create mock data
  createMockUser: (id: string = 'test-user') => ({
    id,
    username: `user-${id}`,
    role: 'audience',
    isReady: true
  }),
  
  createMockRoom: (id: string = 'test-room') => ({
    id,
    name: `Room ${id}`,
    owner: 'test-owner',
    isPrivate: false,
    users: new Map(),
    createdAt: new Date()
  })
};

// Declare global types for TypeScript
declare global {
  var testUtils: {
    wait: (ms: number) => Promise<void>;
    createMockUser: (id?: string) => any;
    createMockRoom: (id?: string) => any;
  };
}

export {};