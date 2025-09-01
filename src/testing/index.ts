// Core Testing Infrastructure
export { ParallelTestHarness, TestResult, TestComparison } from './ParallelTestHarness';
export { MockSocket, MockBroadcastOperator, MockSocketFactory } from './MockSocket';
export { TestEnvironment, TestEnvironmentConfig } from './TestEnvironment';
export { HTTPSTestEnvironment, HTTPSTestConfig } from './HTTPSTestEnvironment';

// Performance Monitoring
export { 
  PerformanceMonitor, 
  PerformanceMetric, 
  PerformanceThreshold, 
  RegressionAlert, 
  PerformanceBaseline 
} from './PerformanceMonitor';

// Regression Detection
export { 
  RegressionDetector, 
  RegressionTest, 
  RegressionReport 
} from './RegressionDetector';

// Migration Dashboard
export { 
  MigrationDashboard, 
  DashboardConfig, 
  MigrationStatus, 
  DashboardData 
} from './MigrationDashboard';

export { DashboardServer, DashboardServerConfig } from './DashboardServer';

// Frontend Configuration
export { 
  FrontendHTTPSConfigManager, 
  FrontendHTTPSConfig 
} from './FrontendHTTPSConfig';

// Examples
export { MigrationTestingExample } from './examples/MigrationTestingExample';

/**
 * Migration Testing Infrastructure
 * 
 * This module provides a comprehensive testing infrastructure for architecture migration:
 * 
 * 1. **Parallel Testing**: Compare old vs new implementations side-by-side
 * 2. **HTTPS Testing**: Test WebRTC functionality over HTTPS with SSL certificates
 * 3. **Performance Monitoring**: Track metrics and detect regressions automatically
 * 4. **Migration Dashboard**: Real-time monitoring with rollback capabilities
 * 
 * ## Quick Start
 * 
 * ```typescript
 * import { 
 *   TestEnvironment, 
 *   ParallelTestHarness, 
 *   PerformanceMonitor,
 *   RegressionDetector,
 *   MigrationDashboard,
 *   DashboardServer
 * } from './testing';
 * 
 * // Setup testing infrastructure
 * const testEnv = new TestEnvironment();
 * const testHarness = new ParallelTestHarness();
 * const perfMonitor = new PerformanceMonitor();
 * const regressionDetector = new RegressionDetector(perfMonitor, testHarness);
 * const dashboard = new MigrationDashboard(perfMonitor, regressionDetector, testHarness);
 * const dashboardServer = new DashboardServer(dashboard);
 * 
 * // Initialize and run tests
 * await testEnv.initialize();
 * await dashboardServer.start();
 * 
 * // Register implementations for comparison
 * testHarness.registerImplementations(oldImplementation, newImplementation);
 * 
 * // Run parallel tests
 * const result = await testHarness.executeParallel('methodName', [args]);
 * 
 * // Monitor performance
 * perfMonitor.recordMetric('response_time', 50, 'ms');
 * 
 * // Access dashboard at http://localhost:3002
 * ```
 * 
 * ## HTTPS Testing
 * 
 * ```typescript
 * import { HTTPSTestEnvironment, FrontendHTTPSConfigManager } from './testing';
 * 
 * // Setup HTTPS testing
 * const httpsEnv = new HTTPSTestEnvironment({
 *   enableHTTPS: true,
 *   allowSelfSigned: true
 * });
 * 
 * await httpsEnv.initialize();
 * 
 * // Generate frontend configuration
 * const configManager = new FrontendHTTPSConfigManager(httpsEnv.getPort());
 * const viteConfig = configManager.generateViteConfig();
 * ```
 * 
 * ## Performance Monitoring
 * 
 * ```typescript
 * import { PerformanceMonitor, RegressionDetector } from './testing';
 * 
 * const monitor = new PerformanceMonitor();
 * const detector = new RegressionDetector(monitor, testHarness);
 * 
 * // Set thresholds
 * monitor.setThreshold('response_time', 100, 'ms');
 * 
 * // Register regression tests
 * detector.registerTest({
 *   name: 'room_creation_test',
 *   testFunction: async () => testRoomCreation(),
 *   expectedPerformance: { maxResponseTime: 100, maxMemoryIncrease: 10485760 },
 *   enabled: true
 * });
 * 
 * // Run tests and get reports
 * const reports = await detector.runAllTests();
 * ```
 */