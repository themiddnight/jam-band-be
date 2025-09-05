import { ParallelTestHarness } from '../ParallelTestHarness';
import { TestEnvironment } from '../TestEnvironment';
import { MockSocket } from '../MockSocket';

describe('ParallelTestHarness', () => {
  let testHarness: ParallelTestHarness;
  let testEnvironment: TestEnvironment;

  beforeEach(async () => {
    testHarness = new ParallelTestHarness();
    testEnvironment = new TestEnvironment({ enableLogging: false });
    await testEnvironment.initialize();
  });

  afterEach(async () => {
    if (testEnvironment) {
      await testEnvironment.cleanup();
    }
    if (testHarness) {
      testHarness.clearResults();
    }
  });

  describe('Basic Functionality', () => {
    it('should register old and new implementations', () => {
      const oldImpl = { testMethod: () => 'old' };
      const newImpl = { testMethod: () => 'new' };

      testHarness.registerImplementations(oldImpl, newImpl);
      
      expect(testHarness['oldImplementation']).toBe(oldImpl);
      expect(testHarness['newImplementation']).toBe(newImpl);
    });

    it('should execute methods on both implementations', async () => {
      const oldImpl = {
        testMethod: jest.fn().mockReturnValue('old result')
      };
      const newImpl = {
        testMethod: jest.fn().mockReturnValue('new result')
      };

      testHarness.registerImplementations(oldImpl, newImpl);

      const result = await testHarness.executeParallel('testMethod', ['arg1', 'arg2']);

      expect(oldImpl.testMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(newImpl.testMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result.oldResult).toBe('old result');
      expect(result.newResult).toBe('new result');
      expect(result.isEqual).toBe(false);
    });

    it('should detect equal results', async () => {
      const sameResult = { data: 'same' };
      const oldImpl = { testMethod: () => sameResult };
      const newImpl = { testMethod: () => ({ data: 'same' }) };

      testHarness.registerImplementations(oldImpl, newImpl);

      const result = await testHarness.executeParallel('testMethod', []);

      expect(result.isEqual).toBe(true);
    });

    it('should measure execution time', async () => {
      const oldImpl = {
        testMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'old';
        }
      };
      const newImpl = {
        testMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return 'new';
        }
      };

      testHarness.registerImplementations(oldImpl, newImpl);

      const result = await testHarness.executeParallel('testMethod', []);

      expect(result.executionTimeOld).toBeGreaterThan(0);
      expect(result.executionTimeNew).toBeGreaterThan(0);
      expect(result.executionTimeOld).toBeGreaterThan(result.executionTimeNew);
    });
  });

  describe('Room Handler Testing', () => {
    it('should compare room creation between implementations', async () => {
      const mockSocket = testEnvironment.createMockSocket();

      // Create old implementation (current RoomHandlers)
      const oldImpl = {
        handleCreateRoom: (socket: MockSocket, data: any) => {
          // Return a consistent result for comparison
          return {
            success: true,
            roomName: data.name,
            username: data.username,
            isPrivate: data.isPrivate
          };
        }
      };

      // Create new implementation (future refactored version)
      const newImpl = {
        handleCreateRoom: (socket: MockSocket, data: any) => {
          // Return the same consistent result
          return {
            success: true,
            roomName: data.name,
            username: data.username,
            isPrivate: data.isPrivate
          };
        }
      };

      testHarness.registerImplementations(oldImpl, newImpl);

      const roomData = {
        name: 'Test Room',
        username: 'testuser',
        userId: 'user123',
        isPrivate: false
      };

      const result = await testHarness.executeParallel(
        'handleCreateRoom',
        [mockSocket, roomData],
        'room_creation_test'
      );

      expect(result.isEqual).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should compare user join functionality', async () => {
      // Setup test room
      const { room } = await testEnvironment.createTestRoom();
      
      const oldImpl = {
        handleJoinRoom: (socket: MockSocket, data: any) => {
          const user = {
            id: data.userId,
            username: data.username,
            role: data.role || 'audience',
            isReady: true
          };
          
          testEnvironment.getRoomService().addUserToRoom(data.roomId, user);
          socket.emit('room_joined', { room, user });
          return { room, user };
        }
      };

      const newImpl = {
        handleJoinRoom: (socket: MockSocket, data: any) => {
          // Same logic for comparison
          const user = {
            id: data.userId,
            username: data.username,
            role: data.role || 'audience',
            isReady: true
          };
          
          testEnvironment.getRoomService().addUserToRoom(data.roomId, user);
          socket.emit('room_joined', { room, user });
          return { room, user };
        }
      };

      testHarness.registerImplementations(oldImpl, newImpl);

      const joinData = {
        roomId: room.id,
        username: 'newuser',
        userId: 'newuser123',
        role: 'audience'
      };

      const mockSocket = testEnvironment.createMockSocket();
      const result = await testHarness.executeParallel(
        'handleJoinRoom',
        [mockSocket, joinData],
        'user_join_test'
      );

      expect(result.isEqual).toBe(true);
    });
  });

  describe('Performance Analysis', () => {
    it('should analyze performance differences', async () => {
      const oldImpl = {
        slowMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return 'result';
        }
      };

      const newImpl = {
        slowMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'result';
        }
      };

      testHarness.registerImplementations(oldImpl, newImpl);

      const result = await testHarness.executeParallel('slowMethod', [], 'performance_test');
      const analysis = testHarness.analyzeResults('performance_test');

      expect(analysis).toBeTruthy();
      expect(analysis!.passed).toBe(true); // Results are equal
      expect(analysis!.performanceRatio).toBeLessThan(1); // New is faster
      expect(analysis!.differences.some(d => d.includes('Performance improvement'))).toBe(true);
    });

    it('should detect performance regressions', async () => {
      const oldImpl = {
        fastMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return 'result';
        }
      };

      const newImpl = {
        fastMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return 'result';
        }
      };

      testHarness.registerImplementations(oldImpl, newImpl);

      const result = await testHarness.executeParallel('fastMethod', [], 'regression_test');
      const analysis = testHarness.analyzeResults('regression_test');

      expect(analysis).toBeTruthy();
      expect(analysis!.performanceRatio).toBeGreaterThan(1); // New is slower
      expect(analysis!.differences.some(d => d.includes('Performance degradation'))).toBe(true);
    });
  });

  describe('Test Reporting', () => {
    it('should generate comprehensive test reports', async () => {
      const oldImpl = {
        method1: () => 'result1',
        method2: () => 'result2',
        method3: () => 'different'
      };

      const newImpl = {
        method1: () => 'result1',
        method2: () => 'result2',
        method3: () => 'changed'
      };

      testHarness.registerImplementations(oldImpl, newImpl);

      // Run multiple tests
      await testHarness.executeParallel('method1', [], 'test1');
      await testHarness.executeParallel('method2', [], 'test2');
      await testHarness.executeParallel('method3', [], 'test3');

      const report = testHarness.generateReport();

      expect(report.totalTests).toBe(3);
      expect(report.passedTests).toBe(2); // method1 and method2 pass
      expect(report.failedTests).toBe(1); // method3 fails
      expect(report.results).toHaveLength(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in old implementation', async () => {
      const oldImpl = {
        errorMethod: () => {
          throw new Error('Old implementation error');
        }
      };

      const newImpl = {
        errorMethod: () => 'success'
      };

      testHarness.registerImplementations(oldImpl, newImpl);

      const result = await testHarness.executeParallel('errorMethod', [], 'error_test');

      expect(result.error).toContain('Old implementation error');
      // When there's an error, results should not be equal
      expect(result.isEqual).toBe(false);
    });

    it('should handle missing methods', async () => {
      const oldImpl = {};
      const newImpl = { existingMethod: () => 'result' };

      testHarness.registerImplementations(oldImpl, newImpl);

      const result = await testHarness.executeParallel('missingMethod', [], 'missing_test');

      expect(result.error).toContain('Method missingMethod not found');
    });
  });
});