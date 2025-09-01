#!/usr/bin/env bun

/**
 * Script to run load tests for the refactored backend
 */

import { execSync } from 'child_process';
import { monitoringDashboard } from '../src/shared/infrastructure/monitoring';

async function runLoadTests() {
  console.log('🚀 Starting Backend Load Tests');
  console.log('================================');
  
  try {
    // Run the load tests
    console.log('📊 Running general load tests...');
    execSync('bun test src/testing/__tests__/load.test.ts --timeout 120000', {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    console.log('\n🔗 Running WebRTC load tests...');
    execSync('bun test src/testing/__tests__/webrtc-load.test.ts --timeout 120000', {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    // Generate final monitoring report
    console.log('\n📈 Generating Performance Report...');
    const dashboardMetrics = monitoringDashboard.getDashboardMetrics();
    
    console.log('\n🎯 Performance Summary:');
    console.log(`Total Contexts: ${dashboardMetrics.contexts.length}`);
    console.log(`Event Processing Success Rate: ${(dashboardMetrics.eventProcessing.successRate * 100).toFixed(2)}%`);
    console.log(`Memory Usage: ${dashboardMetrics.systemHealth.memoryUsage.percentage.toFixed(2)}%`);
    
    if (dashboardMetrics.recommendations.length > 0) {
      console.log('\n⚠️  Recommendations:');
      dashboardMetrics.recommendations.forEach(rec => {
        console.log(`  • ${rec}`);
      });
    } else {
      console.log('\n✅ No performance issues detected!');
    }
    
    // Export detailed metrics
    const metricsReport = monitoringDashboard.exportMetrics();
    await Bun.write('load-test-metrics.json', metricsReport);
    console.log('\n📄 Detailed metrics exported to load-test-metrics.json');
    
    console.log('\n🎉 Load tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Load tests failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  runLoadTests();
}