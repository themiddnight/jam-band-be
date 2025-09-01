#!/usr/bin/env bun

/**
 * Test script for performance monitoring and regression detection
 * This script demonstrates the automated performance monitoring capabilities
 * for the architecture refactoring migration
 */

import { 
  setupMigrationPerformanceMonitoring, 
  runMigrationRegressionTests,
  createPerformanceMiddleware 
} from '../src/testing/setupPerformanceMonitoring';

async function main() {
  console.log('🚀 Starting Performance Monitoring Test\n');

  // Initialize performance monitoring service
  const monitoringService = setupMigrationPerformanceMonitoring({
    enableRealTimeMonitoring: true,
    enableRegressionTesting: true,
    enableAutomatedAlerts: true,
    logPath: './logs/test-performance-monitoring.log'
  });

  // Start monitoring
  monitoringService.start();

  console.log('📊 Performance monitoring service started\n');

  // Simulate some performance metrics
  console.log('📈 Recording sample performance metrics...');
  
  // Good performance metrics
  for (let i = 0; i < 10; i++) {
    monitoringService.recordMetric('response_time', 45 + Math.random() * 10, 'ms', {
      endpoint: '/api/rooms',
      iteration: i
    });
    
    monitoringService.recordMetric('memory_usage', 20 + Math.random() * 5, 'MB', {
      component: 'room_handler',
      iteration: i
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('✅ Baseline metrics recorded\n');

  // Wait for baseline to be established
  await new Promise(resolve => setTimeout(resolve, 500));

  // Simulate performance degradation
  console.log('⚠️  Simulating performance degradation...');
  
  // This should trigger threshold violations
  monitoringService.recordMetric('response_time', 150, 'ms', {
    endpoint: '/api/rooms',
    issue: 'threshold_violation'
  });

  // This should trigger regression detection
  monitoringService.recordMetric('response_time', 120, 'ms', {
    endpoint: '/api/rooms',
    issue: 'regression'
  });

  // Memory spike
  monitoringService.recordMetric('memory_usage', 75, 'MB', {
    component: 'room_handler',
    issue: 'memory_spike'
  });

  // WebRTC connection timeout
  monitoringService.recordMetric('webrtc_connection_time', 3000, 'ms', {
    userId: 'test_user',
    issue: 'connection_timeout'
  });

  console.log('🔥 Performance issues simulated\n');

  // Wait for alerts to be processed
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test parallel execution with mock implementations
  console.log('🔄 Testing parallel execution comparison...');
  
  const testHarness = monitoringService.getTestHarness();
  
  // Mock old implementation (slower)
  const oldImplementation = {
    handleCreateRoom: async (socket: any, data: any) => {
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
      return {
        roomId: 'room_123',
        success: true,
        members: []
      };
    },
    
    handleJoinRoom: async (socket: any, data: any) => {
      await new Promise(resolve => setTimeout(resolve, 30)); // 30ms delay
      return {
        success: true,
        roomData: { id: data.roomId, members: ['user1'] }
      };
    }
  };

  // Mock new implementation (faster)
  const newImplementation = {
    handleCreateRoom: async (socket: any, data: any) => {
      await new Promise(resolve => setTimeout(resolve, 25)); // 25ms delay (50% faster)
      return {
        roomId: 'room_123',
        success: true,
        members: []
      };
    },
    
    handleJoinRoom: async (socket: any, data: any) => {
      await new Promise(resolve => setTimeout(resolve, 20)); // 20ms delay (33% faster)
      return {
        success: true,
        roomData: { id: data.roomId, members: ['user1'] }
      };
    }
  };

  testHarness.registerImplementations(oldImplementation, newImplementation);

  // Test room creation performance
  const mockSocket = { id: 'test_socket', emit: () => {} };
  const roomData = { roomName: 'Test Room', isPrivate: false };
  
  const createRoomResult = await testHarness.executeParallel(
    'handleCreateRoom',
    [mockSocket, roomData],
    'create_room_test'
  );

  console.log(`Room creation test: ${createRoomResult.isEqual ? '✅' : '❌'} Equal results`);
  console.log(`Performance improvement: ${((1 - createRoomResult.executionTimeNew / createRoomResult.executionTimeOld) * 100).toFixed(1)}%`);

  // Test room join performance
  const joinData = { roomId: 'room_123', userId: 'user1' };
  
  const joinRoomResult = await testHarness.executeParallel(
    'handleJoinRoom',
    [mockSocket, joinData],
    'join_room_test'
  );

  console.log(`Room join test: ${joinRoomResult.isEqual ? '✅' : '❌'} Equal results`);
  console.log(`Performance improvement: ${((1 - joinRoomResult.executionTimeNew / joinRoomResult.executionTimeOld) * 100).toFixed(1)}%\n`);

  // Run regression tests
  console.log('🧪 Running automated regression tests...\n');
  await runMigrationRegressionTests(monitoringService);

  // Generate comprehensive report
  console.log('\n📋 Generating comprehensive performance report...\n');
  const report = monitoringService.generateReport();

  console.log('='.repeat(60));
  console.log('📊 PERFORMANCE MONITORING REPORT');
  console.log('='.repeat(60));
  
  console.log(`\n📈 Summary:`);
  console.log(`- Total metrics collected: ${report.summary.totalMetrics}`);
  console.log(`- Active thresholds: ${report.summary.activeThresholds}`);
  console.log(`- Recent alerts: ${report.summary.recentAlerts}`);
  console.log(`- Regression tests: ${report.summary.regressionTests}`);
  console.log(`- Critical issues: ${report.summary.criticalIssues}`);

  if (report.alerts.length > 0) {
    console.log(`\n🚨 Recent Alerts:`);
    report.alerts.slice(0, 5).forEach(alert => {
      const severity = alert.severity === 'critical' ? '🔴' : '🟡';
      console.log(`${severity} ${alert.metricName}: ${alert.regressionPercentage.toFixed(1)}% regression`);
    });
  }

  if (report.recommendations.length > 0) {
    console.log(`\n💡 Recommendations:`);
    report.recommendations.forEach(rec => {
      console.log(`- ${rec}`);
    });
  }

  // Test middleware functionality
  console.log(`\n🔧 Testing performance middleware...`);
  const middleware = createPerformanceMiddleware(monitoringService);
  
  // Mock HTTP request/response
  const mockReq = { method: 'GET', path: '/api/test' };
  const mockRes = {
    statusCode: 200,
    on: (event: string, callback: Function) => {
      if (event === 'finish') {
        setTimeout(callback, 50); // Simulate 50ms response time
      }
    }
  };

  middleware.httpMiddleware(mockReq, mockRes, () => {
    console.log('✅ HTTP middleware test completed');
  });

  // Mock Socket.IO
  const mockSocket2 = {
    id: 'test_socket_2',
    emit: function(event: string, ...args: any[]) {
      console.log(`Socket emit: ${event}`);
      return true;
    }
  };

  middleware.socketMiddleware(mockSocket2, () => {
    console.log('✅ Socket middleware test completed');
    
    // Test the wrapped emit function
    mockSocket2.emit('test_event', { data: 'test' });
  });

  // Wait for middleware tests to complete
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log(`\n🎯 Performance monitoring test completed successfully!`);
  console.log(`Check the log file at: ./logs/test-performance-monitoring.log`);

  // Cleanup
  monitoringService.stop();
  monitoringService.cleanup();
  
  console.log(`\n✨ Cleanup completed. Performance monitoring service stopped.`);
}

// Handle errors and cleanup
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, cleaning up...');
  process.exit(0);
});

// Run the test
main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});