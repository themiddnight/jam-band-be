#!/usr/bin/env bun

/**
 * Load test runner script
 * Usage: bun run test:load
 * Requirements: 8.4, 8.5
 */

import { LoadTestHarness, LoadTestConfig } from '../src/testing/LoadTestHarness';
import { boundedContextMonitor } from '../src/shared/infrastructure/monitoring';
import { performanceMetrics } from '../src/shared/infrastructure/monitoring';

interface TestSuite {
  name: string;
  config: LoadTestConfig;
  description: string;
}

const TEST_SUITES: TestSuite[] = [
  {
    name: 'basic-load',
    description: 'Basic load test with moderate user count',
    config: {
      concurrentUsers: 25,
      testDurationMs: 30000, // 30 seconds
      rampUpTimeMs: 5000, // 5 seconds
      roomsPerTest: 5,
      messagesPerUser: 10,
      webrtcEnabled: false,
      httpsEnabled: false
    }
  },
  {
    name: 'high-load',
    description: 'High load test with 50+ concurrent users',
    config: {
      concurrentUsers: 50,
      testDurationMs: 60000, // 1 minute
      rampUpTimeMs: 10000, // 10 seconds
      roomsPerTest: 10,
      messagesPerUser: 20,
      webrtcEnabled: false,
      httpsEnabled: false
    }
  },
  {
    name: 'webrtc-mesh',
    description: 'WebRTC mesh network performance test',
    config: {
      concurrentUsers: 20,
      testDurationMs: 45000, // 45 seconds
      rampUpTimeMs: 8000, // 8 seconds
      roomsPerTest: 4,
      messagesPerUser: 5,
      webrtcEnabled: true,
      httpsEnabled: true
    }
  },
  {
    name: 'stress-test',
    description: 'Stress test with maximum concurrent users',
    config: {
      concurrentUsers: 100,
      testDurationMs: 120000, // 2 minutes
      rampUpTimeMs: 20000, // 20 seconds
      roomsPerTest: 20,
      messagesPerUser: 15,
      webrtcEnabled: false,
      httpsEnabled: false
    }
  }
];

async function runLoadTest(suite: TestSuite): Promise<void> {
  console.log(`\n🚀 Running ${suite.name}: ${suite.description}`);
  console.log('='.repeat(60));

  const harness = new LoadTestHarness(suite.config);
  
  try {
    // Clear previous metrics
    boundedContextMonitor.clearContextMetrics();
    performanceMetrics.clearMetrics();

    // Run the load test
    const startTime = Date.now();
    const metrics = await harness.runLoadTest();
    const duration = Date.now() - startTime;

    // Display results
    console.log('\n📊 Load Test Results:');
    console.log('-'.repeat(40));
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`Total Users: ${metrics.totalUsers}`);
    console.log(`Total Rooms: ${metrics.totalRooms}`);
    console.log(`Total Messages: ${metrics.totalMessages}`);
    console.log(`Throughput: ${metrics.throughput.toFixed(2)} messages/sec`);
    console.log(`Average Latency: ${metrics.averageLatency.toFixed(2)}ms`);
    console.log(`Max Latency: ${metrics.maxLatency.toFixed(2)}ms`);
    console.log(`Min Latency: ${metrics.minLatency.toFixed(2)}ms`);
    console.log(`Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`);
    console.log(`Memory Usage: ${metrics.memoryUsage.toFixed(2)}MB`);
    console.log(`CPU Usage: ${metrics.cpuUsage.toFixed(2)}ms`);

    if (suite.config.webrtcEnabled) {
      console.log(`WebRTC Connections: ${metrics.webrtcConnections}`);
      console.log(`WebRTC Failures: ${metrics.webrtcFailures}`);
    }

    // Performance analysis
    const analysis = boundedContextMonitor.analyzePerformance();
    if (analysis.recommendations.length > 0) {
      console.log('\n⚠️ Performance Recommendations:');
      analysis.recommendations.forEach(rec => console.log(`  • ${rec}`));
    }

    // Success criteria
    const success = evaluateTestSuccess(metrics, suite.config);
    if (success.passed) {
      console.log('\n✅ Load test PASSED');
    } else {
      console.log('\n❌ Load test FAILED');
      success.failures.forEach(failure => console.log(`  • ${failure}`));
    }

  } catch (error) {
    console.error(`\n❌ Load test failed: ${error}`);
    throw error;
  }
}

function evaluateTestSuccess(metrics: any, config: LoadTestConfig): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];

  // Error rate should be less than 5%
  if (metrics.errorRate > 0.05) {
    failures.push(`High error rate: ${(metrics.errorRate * 100).toFixed(2)}% (threshold: 5%)`);
  }

  // Average latency should be reasonable
  const latencyThreshold = config.webrtcEnabled ? 200 : 100; // ms
  if (metrics.averageLatency > latencyThreshold) {
    failures.push(`High average latency: ${metrics.averageLatency.toFixed(2)}ms (threshold: ${latencyThreshold}ms)`);
  }

  // Memory usage should not be excessive
  const memoryThreshold = config.concurrentUsers * 2; // 2MB per user
  if (metrics.memoryUsage > memoryThreshold) {
    failures.push(`High memory usage: ${metrics.memoryUsage.toFixed(2)}MB (threshold: ${memoryThreshold}MB)`);
  }

  // Throughput should meet minimum requirements
  const minThroughput = config.concurrentUsers * 0.5; // 0.5 messages/sec per user
  if (metrics.throughput < minThroughput) {
    failures.push(`Low throughput: ${metrics.throughput.toFixed(2)} msg/sec (threshold: ${minThroughput} msg/sec)`);
  }

  // WebRTC specific checks
  if (config.webrtcEnabled) {
    const webrtcSuccessRate = metrics.webrtcConnections / (metrics.webrtcConnections + metrics.webrtcFailures);
    if (webrtcSuccessRate < 0.9) {
      failures.push(`Low WebRTC success rate: ${(webrtcSuccessRate * 100).toFixed(2)}% (threshold: 90%)`);
    }
  }

  return {
    passed: failures.length === 0,
    failures
  };
}

async function generateLoadTestReport(results: Array<{ suite: TestSuite; metrics: any; success: boolean }>): Promise<void> {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalTests: results.length,
      passedTests: results.filter(r => r.success).length,
      failedTests: results.filter(r => !r.success).length
    },
    results: results.map(r => ({
      testName: r.suite.name,
      description: r.suite.description,
      config: r.suite.config,
      metrics: r.metrics,
      success: r.success
    })),
    systemInfo: {
      platform: process.platform,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    }
  };

  const reportPath = `load-test-report-${Date.now()}.json`;
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Load test report saved to: ${reportPath}`);
}

async function main(): Promise<void> {
  console.log('🎯 Jam Band Backend Load Testing Suite');
  console.log('=====================================');

  const args = process.argv.slice(2);
  const testName = args[0];

  let suitesToRun: TestSuite[];

  if (testName) {
    const suite = TEST_SUITES.find(s => s.name === testName);
    if (!suite) {
      console.error(`❌ Test suite '${testName}' not found`);
      console.log('\nAvailable test suites:');
      TEST_SUITES.forEach(s => console.log(`  • ${s.name}: ${s.description}`));
      process.exit(1);
    }
    suitesToRun = [suite];
  } else {
    suitesToRun = TEST_SUITES;
  }

  const results: Array<{ suite: TestSuite; metrics: any; success: boolean }> = [];

  for (const suite of suitesToRun) {
    try {
      const harness = new LoadTestHarness(suite.config);
      const metrics = await harness.runLoadTest();
      const success = evaluateTestSuccess(metrics, suite.config);
      
      results.push({
        suite,
        metrics,
        success: success.passed
      });

      // Wait between tests to allow system recovery
      if (suitesToRun.length > 1) {
        console.log('\n⏳ Waiting 10 seconds before next test...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }

    } catch (error) {
      console.error(`❌ Test suite '${suite.name}' failed:`, error);
      results.push({
        suite,
        metrics: null,
        success: false
      });
    }
  }

  // Generate report
  await generateLoadTestReport(results);

  // Summary
  const passedTests = results.filter(r => r.success).length;
  const totalTests = results.length;

  console.log('\n🏁 Load Testing Complete');
  console.log('========================');
  console.log(`Passed: ${passedTests}/${totalTests}`);
  console.log(`Failed: ${totalTests - passedTests}/${totalTests}`);

  if (passedTests === totalTests) {
    console.log('✅ All load tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some load tests failed');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Load test interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Load test terminated');
  process.exit(1);
});

// Run the load tests
main().catch(error => {
  console.error('💥 Load test runner failed:', error);
  process.exit(1);
});