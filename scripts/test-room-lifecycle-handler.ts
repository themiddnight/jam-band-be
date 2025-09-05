#!/usr/bin/env bun

/**
 * Bun Test Runner for RoomLifecycleHandler Integration Tests
 * Runs comprehensive test suite with performance monitoring
 * Requirements: 7.2, 8.1
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface TestSuite {
  name: string;
  file: string;
  description: string;
  timeout?: number;
}

const TEST_SUITES: TestSuite[] = [
  {
    name: 'Integration Tests',
    file: 'src/handlers/__tests__/RoomLifecycleHandler.integration.test.ts',
    description: 'Comprehensive integration tests with Bun performance APIs',
    timeout: 30000
  },
  {
    name: 'Edge Cases',
    file: 'src/handlers/__tests__/RoomLifecycleHandler.edgecases.test.ts',
    description: 'Complex scenarios and edge case testing',
    timeout: 45000
  },
  {
    name: 'Performance Benchmarks',
    file: 'src/handlers/__tests__/RoomLifecycleHandler.performance.test.ts',
    description: 'Performance benchmarks with regression detection',
    timeout: 60000
  },
  {
    name: 'Simple Tests',
    file: 'src/handlers/__tests__/RoomLifecycleHandler.simple.test.ts',
    description: 'Core functionality tests (Jest-based)',
    timeout: 15000
  },
  {
    name: 'Full Integration',
    file: 'src/handlers/__tests__/RoomLifecycleHandler.test.ts',
    description: 'Original comprehensive integration tests (Jest-based)',
    timeout: 30000
  }
];

interface TestResult {
  suite: string;
  passed: boolean;
  duration: number;
  output: string;
  error?: string;
}

async function main() {
  console.log('🧪 RoomLifecycleHandler Test Suite Runner');
  console.log('==========================================');
  console.log(`Runtime: Bun ${Bun.version}`);
  console.log(`Platform: ${process.platform}`);
  console.log(`Node Version: ${process.version}`);
  console.log(`Working Directory: ${process.cwd()}`);
  console.log('==========================================\n');

  const results: TestResult[] = [];
  let totalStartTime = Date.now();

  // Check if test files exist
  console.log('📋 Checking test files...');
  for (const suite of TEST_SUITES) {
    const filePath = join(process.cwd(), suite.file);
    if (!existsSync(filePath)) {
      console.log(`❌ Test file not found: ${suite.file}`);
      process.exit(1);
    } else {
      console.log(`✅ Found: ${suite.file}`);
    }
  }
  console.log('');

  // Run each test suite
  for (const suite of TEST_SUITES) {
    console.log(`🚀 Running: ${suite.name}`);
    console.log(`📝 Description: ${suite.description}`);
    console.log(`⏱️  Timeout: ${suite.timeout || 30000}ms`);
    console.log('------------------------------------------');

    const startTime = Date.now();
    let result: TestResult;

    try {
      let command: string;
      let output: string;

      // Use appropriate test runner based on file type
      if (suite.file.includes('.integration.test.ts') || 
          suite.file.includes('.edgecases.test.ts') || 
          suite.file.includes('.performance.test.ts')) {
        // Use Bun test runner for Bun-specific tests
        command = `bun test ${suite.file} --timeout ${suite.timeout || 30000}`;
        console.log(`🔧 Command: ${command}`);
        
        output = execSync(command, {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: suite.timeout || 30000,
          cwd: process.cwd()
        });
      } else {
        // Use Jest for legacy tests
        command = `npm test -- --testPathPattern=${suite.file.replace('src/', '')} --verbose --runInBand`;
        console.log(`🔧 Command: ${command}`);
        
        output = execSync(command, {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: suite.timeout || 30000,
          cwd: process.cwd()
        });
      }

      const duration = Date.now() - startTime;
      
      result = {
        suite: suite.name,
        passed: true,
        duration,
        output
      };

      console.log(`✅ ${suite.name} PASSED (${duration}ms)`);
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      result = {
        suite: suite.name,
        passed: false,
        duration,
        output: error.stdout || '',
        error: error.stderr || error.message
      };

      console.log(`❌ ${suite.name} FAILED (${duration}ms)`);
      if (error.stderr) {
        console.log('Error output:');
        console.log(error.stderr);
      }
    }

    results.push(result);
    console.log('------------------------------------------\n');
  }

  // Generate summary report
  const totalDuration = Date.now() - totalStartTime;
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = results.filter(r => !r.passed).length;

  console.log('📊 TEST SUMMARY REPORT');
  console.log('======================');
  console.log(`Total Duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
  console.log(`Test Suites: ${results.length}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Success Rate: ${((passedTests / results.length) * 100).toFixed(1)}%`);
  console.log('');

  // Detailed results
  console.log('📋 DETAILED RESULTS');
  console.log('===================');
  results.forEach(result => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    const duration = `${result.duration}ms`;
    console.log(`${status} ${result.suite.padEnd(25)} ${duration.padStart(10)}`);
  });
  console.log('');

  // Performance analysis
  console.log('⚡ PERFORMANCE ANALYSIS');
  console.log('=======================');
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const slowestTest = results.reduce((prev, current) => 
    (prev.duration > current.duration) ? prev : current
  );
  const fastestTest = results.reduce((prev, current) => 
    (prev.duration < current.duration) ? prev : current
  );

  console.log(`Average Duration: ${avgDuration.toFixed(2)}ms`);
  console.log(`Slowest Test: ${slowestTest.suite} (${slowestTest.duration}ms)`);
  console.log(`Fastest Test: ${fastestTest.suite} (${fastestTest.duration}ms)`);
  console.log('');

  // Error details for failed tests
  const failedResults = results.filter(r => !r.passed);
  if (failedResults.length > 0) {
    console.log('🚨 FAILURE DETAILS');
    console.log('==================');
    failedResults.forEach(result => {
      console.log(`\n❌ ${result.suite}:`);
      if (result.error) {
        console.log('Error:');
        console.log(result.error);
      }
      if (result.output) {
        console.log('Output:');
        console.log(result.output.slice(-500)); // Last 500 chars
      }
    });
    console.log('');
  }

  // Export results to JSON for CI/CD integration
  const reportData = {
    timestamp: new Date().toISOString(),
    runtime: {
      bun: Bun.version,
      node: process.version,
      platform: process.platform
    },
    summary: {
      totalDuration,
      totalSuites: results.length,
      passed: passedTests,
      failed: failedTests,
      successRate: (passedTests / results.length) * 100
    },
    results: results.map(r => ({
      suite: r.suite,
      passed: r.passed,
      duration: r.duration,
      hasError: !!r.error
    })),
    performance: {
      averageDuration: avgDuration,
      slowestTest: {
        suite: slowestTest.suite,
        duration: slowestTest.duration
      },
      fastestTest: {
        suite: fastestTest.suite,
        duration: fastestTest.duration
      }
    }
  };

  try {
    await Bun.write('test-results.json', JSON.stringify(reportData, null, 2));
    console.log('📄 Test results exported to test-results.json');
  } catch (error) {
    console.log('⚠️  Could not export test results to file');
  }

  // Exit with appropriate code
  if (failedTests > 0) {
    console.log('\n❌ Some tests failed. Check the details above.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed successfully!');
    
    // Additional success metrics
    if (avgDuration < 5000) {
      console.log('🚀 Excellent performance: Average test duration under 5 seconds');
    } else if (avgDuration < 10000) {
      console.log('⚡ Good performance: Average test duration under 10 seconds');
    } else {
      console.log('⏳ Consider optimizing: Average test duration over 10 seconds');
    }
    
    process.exit(0);
  }
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n🛑 Test execution interrupted by user');
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Test execution terminated');
  process.exit(143);
});

// Run the test suite
main().catch(error => {
  console.error('💥 Test runner failed:', error);
  process.exit(1);
});