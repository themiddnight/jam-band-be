import { PerformanceMonitoringService } from './PerformanceMonitoringService';
import { RegressionTest } from './RegressionDetector';
import { RoomHandlers } from '../handlers/RoomHandlers';

/**
 * Setup automated performance monitoring for the architecture refactoring migration
 * This integrates with the existing testing infrastructure to provide continuous
 * performance monitoring and regression detection
 */

export interface MigrationTestConfig {
  enableRealTimeMonitoring: boolean;
  enableRegressionTesting: boolean;
  enableAutomatedAlerts: boolean;
  testDataPath?: string;
  alertWebhookUrl?: string;
  logPath?: string;
}

/**
 * Setup performance monitoring for migration testing
 */
export function setupMigrationPerformanceMonitoring(config: MigrationTestConfig = {
  enableRealTimeMonitoring: true,
  enableRegressionTesting: true,
  enableAutomatedAlerts: true
}): PerformanceMonitoringService {
  
  const monitoringService = new PerformanceMonitoringService({
    performanceThresholds: {
      responseTime: 100, // 100ms for handler methods
      memoryUsage: 50, // 50MB memory increase limit
      cpuUsage: 80, // 80% CPU usage limit
      websocketLatency: 50, // 50ms WebSocket latency
      webrtcConnectionTime: 2000 // 2s WebRTC connection time
    },
    regressionThresholds: {
      performanceRegression: 15, // 15% performance regression threshold
      memoryRegression: 25, // 25% memory regression threshold
      criticalRegressionThreshold: 40 // 40% critical regression threshold
    },
    alerting: {
      console: {
        enabled: true,
        logLevel: 'warn'
      },
      file: {
        enabled: true,
        logPath: config.logPath || './logs/migration-performance.log',
        maxFileSize: 10 * 1024 * 1024 // 10MB
      },
      webhook: config.alertWebhookUrl ? {
        enabled: config.enableAutomatedAlerts,
        url: config.alertWebhookUrl
      } : undefined
    },
    monitoring: {
      enabled: config.enableRealTimeMonitoring,
      metricsRetentionDays: 7,
      baselineUpdateInterval: 60000, // 1 minute
      alertCooldownPeriod: 300000 // 5 minutes
    }
  });

  if (config.enableRegressionTesting) {
    setupRegressionTests(monitoringService);
  }

  if (config.enableAutomatedAlerts) {
    setupAutomatedAlerts(monitoringService);
  }

  return monitoringService;
}

/**
 * Setup regression tests for handler migration
 */
function setupRegressionTests(monitoringService: PerformanceMonitoringService): void {
  const regressionDetector = monitoringService.getRegressionDetector();

  // Room lifecycle handler regression tests
  regressionDetector.registerTest({
    name: 'room_creation_performance',
    description: 'Test room creation performance between old and new handlers',
    testFunction: async () => {
      const testHarness = monitoringService.getTestHarness();
      
      // Mock socket and data for testing
      const mockSocket = {
        id: 'test_socket',
        emit: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        to: jest.fn().mockReturnThis(),
        broadcast: jest.fn().mockReturnThis()
      };

      const testData = {
        roomName: 'Test Room',
        isPrivate: false,
        maxMembers: 8
      };

      return await testHarness.executeParallel(
        'handleCreateRoom',
        [mockSocket, testData],
        'room_creation_test'
      );
    },
    expectedPerformance: {
      maxResponseTime: 50, // 50ms max for room creation
      maxMemoryIncrease: 5 * 1024 * 1024 // 5MB max memory increase
    },
    enabled: true
  });

  // Voice connection handler regression tests
  regressionDetector.registerTest({
    name: 'voice_connection_performance',
    description: 'Test voice connection establishment performance',
    testFunction: async () => {
      const testHarness = monitoringService.getTestHarness();
      
      const mockSocket = {
        id: 'test_socket',
        emit: jest.fn(),
        join: jest.fn(),
        to: jest.fn().mockReturnThis()
      };

      const testData = {
        roomId: 'test_room',
        userId: 'test_user'
      };

      return await testHarness.executeParallel(
        'handleJoinVoice',
        [mockSocket, testData],
        'voice_connection_test'
      );
    },
    expectedPerformance: {
      maxResponseTime: 100, // 100ms max for voice connection
      maxMemoryIncrease: 10 * 1024 * 1024 // 10MB max memory increase
    },
    enabled: true
  });

  // Member management regression tests
  regressionDetector.registerTest({
    name: 'member_management_performance',
    description: 'Test member join/leave performance',
    testFunction: async () => {
      const testHarness = monitoringService.getTestHarness();
      
      const mockSocket = {
        id: 'test_socket',
        emit: jest.fn(),
        join: jest.fn(),
        to: jest.fn().mockReturnThis(),
        broadcast: jest.fn().mockReturnThis()
      };

      const testData = {
        roomId: 'test_room',
        userId: 'test_user',
        username: 'Test User'
      };

      return await testHarness.executeParallel(
        'handleJoinRoom',
        [mockSocket, testData],
        'member_management_test'
      );
    },
    expectedPerformance: {
      maxResponseTime: 75, // 75ms max for member operations
      maxMemoryIncrease: 3 * 1024 * 1024 // 3MB max memory increase
    },
    enabled: true
  });

  // Audio routing regression tests
  regressionDetector.registerTest({
    name: 'audio_routing_performance',
    description: 'Test audio parameter updates and routing',
    testFunction: async () => {
      const testHarness = monitoringService.getTestHarness();
      
      const mockSocket = {
        id: 'test_socket',
        emit: jest.fn(),
        to: jest.fn().mockReturnThis(),
        broadcast: jest.fn().mockReturnThis()
      };

      const testData = {
        roomId: 'test_room',
        userId: 'test_user',
        synthParams: {
          oscillator: { type: 'sine', frequency: 440 },
          envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 }
        }
      };

      return await testHarness.executeParallel(
        'handleUpdateSynthParams',
        [mockSocket, testData],
        'audio_routing_test'
      );
    },
    expectedPerformance: {
      maxResponseTime: 25, // 25ms max for audio updates
      maxMemoryIncrease: 1 * 1024 * 1024 // 1MB max memory increase
    },
    enabled: true
  });

  console.log('Regression tests registered for migration monitoring');
}

/**
 * Setup automated alerts for critical performance issues
 */
function setupAutomatedAlerts(monitoringService: PerformanceMonitoringService): void {
  monitoringService.on('alert', ({ alert, type }) => {
    if (alert.severity === 'critical') {
      console.error(`🚨 CRITICAL MIGRATION ISSUE DETECTED 🚨`);
      console.error(`Type: ${type}`);
      console.error(`Metric: ${alert.metricName}`);
      console.error(`Regression: ${alert.regressionPercentage.toFixed(2)}%`);
      console.error(`Current: ${alert.currentValue}, Expected: ${alert.previousValue}`);
      console.error(`Timestamp: ${new Date(alert.timestamp).toISOString()}`);
      
      // In a real system, this would trigger:
      // - Slack/Teams notifications
      // - Email alerts to development team
      // - PagerDuty incidents
      // - Automatic rollback procedures
      
      logCriticalAlert(alert, type);
    } else {
      console.warn(`⚠️  Performance warning during migration:`);
      console.warn(`${alert.metricName}: ${alert.regressionPercentage.toFixed(2)}% regression`);
    }
  });

  console.log('Automated alerts configured for migration monitoring');
}

/**
 * Log critical alerts to file for post-mortem analysis
 */
function logCriticalAlert(alert: any, type: string): void {
  const criticalAlertData = {
    timestamp: new Date().toISOString(),
    type,
    alert,
    systemInfo: {
      nodeVersion: process.version,
      platform: process.platform,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    },
    migrationContext: {
      phase: 'handler_extraction',
      component: alert.metricName,
      severity: alert.severity
    }
  };

  // In a real system, this would write to a structured log file
  console.log('CRITICAL_ALERT_DATA:', JSON.stringify(criticalAlertData, null, 2));
}

/**
 * Create performance monitoring middleware for Express/Socket.IO
 */
export function createPerformanceMiddleware(monitoringService: PerformanceMonitoringService) {
  return {
    // HTTP middleware
    httpMiddleware: (req: any, res: any, next: any) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        monitoringService.recordMetric('http_response_time', duration, 'ms', {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode
        });
      });
      
      next();
    },

    // Socket.IO middleware
    socketMiddleware: (socket: any, next: any) => {
      const originalEmit = socket.emit;
      
      socket.emit = function(event: string, ...args: any[]) {
        const startTime = Date.now();
        
        const result = originalEmit.call(this, event, ...args);
        
        const duration = Date.now() - startTime;
        monitoringService.recordMetric('websocket_emit_time', duration, 'ms', {
          event,
          socketId: socket.id
        });
        
        return result;
      };
      
      next();
    }
  };
}

/**
 * Run automated regression tests
 */
export async function runMigrationRegressionTests(
  monitoringService: PerformanceMonitoringService
): Promise<void> {
  console.log('Starting migration regression tests...');
  
  const regressionDetector = monitoringService.getRegressionDetector();
  const reports = await regressionDetector.runAllTests();
  
  console.log(`\n📊 Migration Regression Test Results:`);
  console.log(`Total tests: ${reports.length}`);
  
  const passed = reports.filter(r => r.passed).length;
  const failed = reports.filter(r => !r.passed).length;
  const performanceRegressions = reports.filter(r => r.performanceRegression).length;
  const functionalRegressions = reports.filter(r => r.functionalRegression).length;
  
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📉 Performance regressions: ${performanceRegressions}`);
  console.log(`🔧 Functional regressions: ${functionalRegressions}`);
  
  if (failed > 0) {
    console.log(`\n🚨 Failed Tests:`);
    reports.filter(r => !r.passed).forEach(report => {
      console.log(`- ${report.testName}:`);
      if (report.performanceRegression) {
        console.log(`  Performance: ${report.details.responseTime.regression.toFixed(2)}% slower`);
      }
      if (report.functionalRegression) {
        console.log(`  Functional: Results differ`);
      }
    });
  }
  
  // Generate and save detailed report
  const detailedReport = monitoringService.generateReport();
  console.log(`\n📋 Performance Summary:`);
  console.log(`Total metrics collected: ${detailedReport.summary.totalMetrics}`);
  console.log(`Active thresholds: ${detailedReport.summary.activeThresholds}`);
  console.log(`Recent alerts: ${detailedReport.summary.recentAlerts}`);
  
  if (detailedReport.recommendations.length > 0) {
    console.log(`\n💡 Recommendations:`);
    detailedReport.recommendations.forEach(rec => {
      console.log(`- ${rec}`);
    });
  }
}

/**
 * Export monitoring service instance for global use
 */
export let globalMonitoringService: PerformanceMonitoringService | null = null;

/**
 * Initialize global monitoring service
 */
export function initializeGlobalMonitoring(config?: MigrationTestConfig): PerformanceMonitoringService {
  if (globalMonitoringService) {
    globalMonitoringService.cleanup();
  }
  
  globalMonitoringService = setupMigrationPerformanceMonitoring(config);
  globalMonitoringService.start();
  
  console.log('Global performance monitoring initialized for migration');
  
  return globalMonitoringService;
}

/**
 * Cleanup global monitoring service
 */
export function cleanupGlobalMonitoring(): void {
  if (globalMonitoringService) {
    globalMonitoringService.cleanup();
    globalMonitoringService = null;
    console.log('Global performance monitoring cleaned up');
  }
}