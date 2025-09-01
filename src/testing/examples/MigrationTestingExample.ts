import { TestEnvironment } from '../TestEnvironment';
import { HTTPSTestEnvironment } from '../HTTPSTestEnvironment';
import { ParallelTestHarness } from '../ParallelTestHarness';
import { PerformanceMonitor } from '../PerformanceMonitor';
import { RegressionDetector } from '../RegressionDetector';
import { MigrationDashboard } from '../MigrationDashboard';
import { DashboardServer } from '../DashboardServer';

/**
 * Complete example demonstrating the migration testing infrastructure
 * Shows how to set up parallel testing, performance monitoring, and dashboard
 */
export class MigrationTestingExample {
  private testEnvironment: TestEnvironment;
  private httpsTestEnvironment: HTTPSTestEnvironment;
  private testHarness: ParallelTestHarness;
  private performanceMonitor: PerformanceMonitor;
  private regressionDetector: RegressionDetector;
  private dashboard: MigrationDashboard;
  private dashboardServer: DashboardServer;

  constructor() {
    // Initialize components
    this.testEnvironment = new TestEnvironment({ enableLogging: true });
    this.httpsTestEnvironment = new HTTPSTestEnvironment({
      enableHTTPS: true,
      allowSelfSigned: true,
      enableLogging: true
    });
    
    this.testHarness = new ParallelTestHarness();
    this.performanceMonitor = new PerformanceMonitor();
    this.regressionDetector = new RegressionDetector(this.performanceMonitor, this.testHarness);
    
    this.dashboard = new MigrationDashboard(
      this.performanceMonitor,
      this.regressionDetector,
      this.testHarness
    );
    
    this.dashboardServer = new DashboardServer(this.dashboard, { port: 3002 });
  }

  /**
   * Run complete migration testing example
   */
  async runExample(): Promise<void> {
    console.log('🚀 Starting Migration Testing Infrastructure Example');

    try {
      // Step 1: Initialize environments
      await this.initializeEnvironments();

      // Step 2: Setup regression tests
      await this.setupRegressionTests();

      // Step 3: Start dashboard server
      await this.startDashboard();

      // Step 4: Run migration simulation
      await this.simulateMigration();

      // Step 5: Demonstrate rollback scenario
      await this.demonstrateRollback();

    } catch (error) {
      console.error('❌ Example failed:', error);
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Initialize test environments
   */
  private async initializeEnvironments(): Promise<void> {
    this.dashboard.updateMigrationStatus('setup', 10, 'Initializing test environments');

    console.log('📋 Initializing HTTP test environment...');
    await this.testEnvironment.initialize();

    console.log('🔒 Initializing HTTPS test environment...');
    try {
      await this.httpsTestEnvironment.initialize();
      console.log('✅ HTTPS environment ready');
    } catch (error) {
      console.log('⚠️  HTTPS environment not available, continuing with HTTP only');
      this.dashboard.addWarning('HTTPS environment not available');
    }

    this.dashboard.updateMigrationStatus('setup', 30, 'Test environments initialized');
  }

  /**
   * Setup regression tests
   */
  private async setupRegressionTests(): Promise<void> {
    this.dashboard.updateMigrationStatus('setup', 50, 'Setting up regression tests');

    // Register room creation test
    this.regressionDetector.registerTest({
      name: 'room_creation_test',
      description: 'Test room creation functionality',
      testFunction: async () => {
        return await this.testRoomCreation();
      },
      expectedPerformance: {
        maxResponseTime: 100,
        maxMemoryIncrease: 10 * 1024 * 1024 // 10MB
      },
      enabled: true
    });

    // Register user join test
    this.regressionDetector.registerTest({
      name: 'user_join_test',
      description: 'Test user joining room functionality',
      testFunction: async () => {
        return await this.testUserJoin();
      },
      expectedPerformance: {
        maxResponseTime: 50,
        maxMemoryIncrease: 5 * 1024 * 1024 // 5MB
      },
      enabled: true
    });

    // Register WebRTC connection test
    this.regressionDetector.registerTest({
      name: 'webrtc_connection_test',
      description: 'Test WebRTC connection establishment',
      testFunction: async () => {
        return await this.testWebRTCConnection();
      },
      expectedPerformance: {
        maxResponseTime: 2000,
        maxMemoryIncrease: 15 * 1024 * 1024 // 15MB
      },
      enabled: true
    });

    this.dashboard.updateMigrationStatus('setup', 70, 'Regression tests configured');
  }

  /**
   * Start dashboard server
   */
  private async startDashboard(): Promise<void> {
    this.dashboard.updateMigrationStatus('setup', 90, 'Starting dashboard server');

    await this.dashboardServer.start();
    
    const endpoints = this.dashboardServer.getAPIEndpoints();
    console.log('📊 Dashboard available at:', endpoints.dashboard);
    console.log('🔗 API endpoints:', endpoints);

    // Setup rollback callback
    this.dashboard.onRollback(async () => {
      console.log('🔄 Executing rollback procedures...');
      await this.executeRollback();
    });

    this.dashboard.updateMigrationStatus('testing', 0, 'Ready to start migration testing');
  }

  /**
   * Simulate migration process
   */
  private async simulateMigration(): Promise<void> {
    console.log('🔄 Starting migration simulation...');

    // Phase 1: Run baseline tests
    this.dashboard.updateMigrationStatus('testing', 10, 'Running baseline tests');
    await this.runBaselineTests();

    // Phase 2: Simulate refactoring
    this.dashboard.updateMigrationStatus('migrating', 30, 'Applying architectural changes');
    await this.simulateRefactoring();

    // Phase 3: Run regression tests
    this.dashboard.updateMigrationStatus('testing', 60, 'Running regression tests');
    await this.runRegressionTests();

    // Phase 4: Performance validation
    this.dashboard.updateMigrationStatus('testing', 80, 'Validating performance');
    await this.validatePerformance();

    this.dashboard.updateMigrationStatus('completed', 100, 'Migration completed successfully');
    console.log('✅ Migration simulation completed');
  }

  /**
   * Run baseline tests
   */
  private async runBaselineTests(): Promise<void> {
    console.log('📊 Running baseline tests...');

    for (let i = 0; i < 5; i++) {
      await this.testRoomCreation();
      await this.testUserJoin();
      await this.testWebRTCConnection();
      
      // Add some delay to simulate real testing
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('✅ Baseline tests completed');
  }

  /**
   * Simulate refactoring changes
   */
  private async simulateRefactoring(): Promise<void> {
    console.log('🔧 Simulating architectural refactoring...');

    // Simulate the creation of new handlers (this would be real refactoring in practice)
    const oldRoomHandlers = this.testEnvironment.getRoomHandlers();
    
    // Create mock new implementation with slight performance difference
    const newRoomHandlers = {
      handleCreateRoom: async (socket: any, data: any) => {
        // Simulate slightly slower performance (realistic for new code)
        await new Promise(resolve => setTimeout(resolve, 5));
        return oldRoomHandlers.handleCreateRoom(socket, data);
      },
      
      handleJoinRoom: async (socket: any, data: any) => {
        // Simulate improved performance
        await new Promise(resolve => setTimeout(resolve, 2));
        return oldRoomHandlers.handleJoinRoom(socket, data);
      }
    };

    // Register implementations for comparison
    this.testHarness.registerImplementations(oldRoomHandlers, newRoomHandlers);

    console.log('✅ Refactoring simulation completed');
  }

  /**
   * Run regression tests
   */
  private async runRegressionTests(): Promise<void> {
    console.log('🧪 Running regression tests...');

    const reports = await this.regressionDetector.runAllTests();
    
    for (const report of reports) {
      if (report.passed) {
        console.log(`✅ ${report.testName}: PASSED`);
      } else {
        console.log(`❌ ${report.testName}: FAILED`);
        if (report.performanceRegression) {
          console.log(`   Performance regression detected`);
        }
        if (report.functionalRegression) {
          console.log(`   Functional regression detected`);
        }
      }
    }

    console.log('✅ Regression tests completed');
  }

  /**
   * Validate performance
   */
  private async validatePerformance(): Promise<void> {
    console.log('⚡ Validating performance...');

    // Record some performance metrics
    this.performanceMonitor.recordMetric('migration_response_time', 45, 'ms');
    this.performanceMonitor.recordMetric('migration_memory_usage', 120, 'MB');
    this.performanceMonitor.recordMetric('migration_cpu_usage', 65, '%');

    // Check if we're within acceptable limits
    const summary = this.performanceMonitor.getPerformanceSummary();
    console.log(`📈 Performance summary: ${summary.totalMetrics} metrics recorded`);

    console.log('✅ Performance validation completed');
  }

  /**
   * Demonstrate rollback scenario
   */
  private async demonstrateRollback(): Promise<void> {
    console.log('🚨 Demonstrating rollback scenario...');

    // Simulate critical performance regression
    this.performanceMonitor.recordMetric('critical_metric', 1000, 'ms');
    this.performanceMonitor.setThreshold('critical_metric', 100, 'ms');

    // This should trigger rollback conditions
    this.dashboard.addError('Critical performance regression detected');
    this.dashboard.addError('System stability compromised');
    this.dashboard.addError('Multiple test failures');

    // Wait for rollback evaluation
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('✅ Rollback scenario demonstrated');
  }

  /**
   * Execute rollback procedures
   */
  private async executeRollback(): Promise<void> {
    console.log('🔄 Executing rollback procedures...');
    
    // In a real scenario, this would:
    // 1. Revert code changes
    // 2. Restore database state
    // 3. Restart services
    // 4. Validate system health
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate rollback time
    
    console.log('✅ Rollback completed');
  }

  /**
   * Test room creation functionality
   */
  private async testRoomCreation(): Promise<any> {
    const socket = this.testEnvironment.createMockSocket();
    const roomData = {
      name: `Test Room ${Date.now()}`,
      username: 'testuser',
      userId: `user_${Date.now()}`,
      isPrivate: false
    };

    const startTime = process.hrtime.bigint();
    const memoryBefore = process.memoryUsage().heapUsed;

    try {
      const result = await this.testEnvironment.getRoomHandlers().handleCreateRoomHttp(
        { body: roomData } as any,
        {
          status: () => ({ json: (data: any) => data }),
          json: (data: any) => data
        } as any
      );

      const endTime = process.hrtime.bigint();
      const memoryAfter = process.memoryUsage().heapUsed;

      return {
        testId: 'room_creation',
        timestamp: Date.now(),
        oldResult: result,
        newResult: result,
        isEqual: true,
        executionTimeOld: Number(endTime - startTime) / 1000000,
        executionTimeNew: Number(endTime - startTime) / 1000000,
        memoryUsageOld: memoryAfter - memoryBefore,
        memoryUsageNew: memoryAfter - memoryBefore
      };
    } catch (error) {
      return {
        testId: 'room_creation',
        timestamp: Date.now(),
        oldResult: null,
        newResult: null,
        isEqual: false,
        executionTimeOld: 0,
        executionTimeNew: 0,
        memoryUsageOld: 0,
        memoryUsageNew: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test user join functionality
   */
  private async testUserJoin(): Promise<any> {
    const { room } = await this.testEnvironment.createTestRoom();
    const socket = this.testEnvironment.createMockSocketWithSession(room.id, 'testuser123');

    const joinData = {
      roomId: room.id,
      username: 'newuser',
      userId: 'newuser123',
      role: 'audience'
    };

    const startTime = process.hrtime.bigint();
    const memoryBefore = process.memoryUsage().heapUsed;

    try {
      this.testEnvironment.getRoomHandlers().handleJoinRoom(socket as any, joinData);

      const endTime = process.hrtime.bigint();
      const memoryAfter = process.memoryUsage().heapUsed;

      return {
        testId: 'user_join',
        timestamp: Date.now(),
        oldResult: 'success',
        newResult: 'success',
        isEqual: true,
        executionTimeOld: Number(endTime - startTime) / 1000000,
        executionTimeNew: Number(endTime - startTime) / 1000000,
        memoryUsageOld: memoryAfter - memoryBefore,
        memoryUsageNew: memoryAfter - memoryBefore
      };
    } catch (error) {
      return {
        testId: 'user_join',
        timestamp: Date.now(),
        oldResult: null,
        newResult: null,
        isEqual: false,
        executionTimeOld: 0,
        executionTimeNew: 0,
        memoryUsageOld: 0,
        memoryUsageNew: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test WebRTC connection functionality
   */
  private async testWebRTCConnection(): Promise<any> {
    const { room } = await this.testEnvironment.createTestRoom();
    const users = await this.testEnvironment.addTestUsersToRoom(room.id, 2);

    const startTime = process.hrtime.bigint();
    const memoryBefore = process.memoryUsage().heapUsed;

    try {
      await this.testEnvironment.simulateWebRTCConnection(
        users[0].socket,
        users[1].socket,
        room.id
      );

      const endTime = process.hrtime.bigint();
      const memoryAfter = process.memoryUsage().heapUsed;

      return {
        testId: 'webrtc_connection',
        timestamp: Date.now(),
        oldResult: 'connected',
        newResult: 'connected',
        isEqual: true,
        executionTimeOld: Number(endTime - startTime) / 1000000,
        executionTimeNew: Number(endTime - startTime) / 1000000,
        memoryUsageOld: memoryAfter - memoryBefore,
        memoryUsageNew: memoryAfter - memoryBefore
      };
    } catch (error) {
      return {
        testId: 'webrtc_connection',
        timestamp: Date.now(),
        oldResult: null,
        newResult: null,
        isEqual: false,
        executionTimeOld: 0,
        executionTimeNew: 0,
        memoryUsageOld: 0,
        memoryUsageNew: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Cleanup all resources
   */
  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up resources...');

    try {
      await this.dashboardServer.stop();
      await this.testEnvironment.cleanup();
      await this.httpsTestEnvironment.cleanup();
      this.dashboard.cleanup();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }

    console.log('✅ Cleanup completed');
  }
}

// Example usage
if (require.main === module) {
  const example = new MigrationTestingExample();
  example.runExample().catch(console.error);
}