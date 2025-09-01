import { PerformanceMonitor, PerformanceMetric, RegressionAlert } from './PerformanceMonitor';
import { ParallelTestHarness, TestResult } from './ParallelTestHarness';

export interface RegressionTest {
  name: string;
  description: string;
  testFunction: () => Promise<TestResult>;
  expectedPerformance: {
    maxResponseTime: number;
    maxMemoryIncrease: number;
  };
  enabled: boolean;
}

export interface RegressionReport {
  testName: string;
  passed: boolean;
  performanceRegression: boolean;
  functionalRegression: boolean;
  details: {
    responseTime: {
      old: number;
      new: number;
      regression: number;
    };
    memoryUsage: {
      old: number;
      new: number;
      regression: number;
    };
    functionalDifferences: string[];
  };
  timestamp: number;
}

/**
 * Automated regression detection system
 * Combines performance monitoring with functional testing
 */
export class RegressionDetector {
  private performanceMonitor: PerformanceMonitor;
  private testHarness: ParallelTestHarness;
  private regressionTests: Map<string, RegressionTest> = new Map();
  private testReports: RegressionReport[] = [];
  private alertCallbacks: Array<(alert: RegressionAlert) => void> = [];

  constructor(performanceMonitor: PerformanceMonitor, testHarness: ParallelTestHarness) {
    this.performanceMonitor = performanceMonitor;
    this.testHarness = testHarness;

    // Listen for performance alerts
    this.performanceMonitor.on('regressionDetected', (alert) => {
      this.handlePerformanceAlert(alert);
    });

    this.performanceMonitor.on('thresholdViolation', (alert) => {
      this.handleThresholdViolation(alert);
    });
  }

  /**
   * Register a regression test
   */
  registerTest(test: RegressionTest): void {
    this.regressionTests.set(test.name, test);
  }

  /**
   * Run all enabled regression tests
   */
  async runAllTests(): Promise<RegressionReport[]> {
    const reports: RegressionReport[] = [];

    for (const [name, test] of this.regressionTests) {
      if (!test.enabled) continue;

      try {
        const report = await this.runSingleTest(test);
        reports.push(report);
        this.testReports.push(report);
      } catch (error) {
        const errorReport: RegressionReport = {
          testName: test.name,
          passed: false,
          performanceRegression: true,
          functionalRegression: true,
          details: {
            responseTime: { old: 0, new: 0, regression: 0 },
            memoryUsage: { old: 0, new: 0, regression: 0 },
            functionalDifferences: [`Test execution failed: ${error}`]
          },
          timestamp: Date.now()
        };
        reports.push(errorReport);
        this.testReports.push(errorReport);
      }
    }

    return reports;
  }

  /**
   * Run a single regression test
   */
  async runSingleTest(test: RegressionTest): Promise<RegressionReport> {
    const startTime = Date.now();

    // Execute the test
    const testResult = await test.testFunction();

    // Analyze results
    const responseTimeRegression = this.calculateRegression(
      testResult.executionTimeOld,
      testResult.executionTimeNew
    );

    const memoryRegression = this.calculateRegression(
      testResult.memoryUsageOld,
      testResult.memoryUsageNew
    );

    // Check for functional differences
    const functionalDifferences: string[] = [];
    if (!testResult.isEqual) {
      functionalDifferences.push('Results are not functionally equivalent');
      functionalDifferences.push(`Old result: ${JSON.stringify(testResult.oldResult)}`);
      functionalDifferences.push(`New result: ${JSON.stringify(testResult.newResult)}`);
    }

    // Determine if there are regressions
    const performanceRegression = 
      responseTimeRegression > 10 || // 10% performance regression threshold
      memoryRegression > 20 || // 20% memory regression threshold
      testResult.executionTimeNew > test.expectedPerformance.maxResponseTime ||
      testResult.memoryUsageNew > test.expectedPerformance.maxMemoryIncrease;

    const functionalRegression = !testResult.isEqual;

    const report: RegressionReport = {
      testName: test.name,
      passed: !performanceRegression && !functionalRegression,
      performanceRegression,
      functionalRegression,
      details: {
        responseTime: {
          old: testResult.executionTimeOld,
          new: testResult.executionTimeNew,
          regression: responseTimeRegression
        },
        memoryUsage: {
          old: testResult.memoryUsageOld,
          new: testResult.memoryUsageNew,
          regression: memoryRegression
        },
        functionalDifferences
      },
      timestamp: Date.now()
    };

    // Record performance metrics
    this.performanceMonitor.recordMetric(
      `${test.name}_response_time`,
      testResult.executionTimeNew,
      'ms',
      { testName: test.name, oldTime: testResult.executionTimeOld }
    );

    this.performanceMonitor.recordMetric(
      `${test.name}_memory_usage`,
      testResult.memoryUsageNew,
      'bytes',
      { testName: test.name, oldMemory: testResult.memoryUsageOld }
    );

    return report;
  }

  /**
   * Calculate regression percentage
   */
  private calculateRegression(oldValue: number, newValue: number): number {
    if (oldValue === 0) return newValue > 0 ? 100 : 0;
    return ((newValue - oldValue) / oldValue) * 100;
  }

  /**
   * Handle performance alert
   */
  private handlePerformanceAlert(alert: RegressionAlert): void {
    console.warn(`Performance regression detected: ${alert.metricName}`);
    console.warn(`Current: ${alert.currentValue}, Previous: ${alert.previousValue}`);
    console.warn(`Regression: ${alert.regressionPercentage.toFixed(2)}%`);

    // Notify registered callbacks
    this.alertCallbacks.forEach(callback => {
      try {
        callback(alert);
      } catch (error) {
        console.error('Error in alert callback:', error);
      }
    });
  }

  /**
   * Handle threshold violation
   */
  private handleThresholdViolation(alert: RegressionAlert): void {
    console.warn(`Threshold violation: ${alert.metricName}`);
    console.warn(`Value: ${alert.currentValue}, Threshold: ${alert.threshold}`);

    // Notify registered callbacks
    this.alertCallbacks.forEach(callback => {
      try {
        callback(alert);
      } catch (error) {
        console.error('Error in threshold violation callback:', error);
      }
    });
  }

  /**
   * Register alert callback
   */
  onAlert(callback: (alert: RegressionAlert) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Get test reports
   */
  getTestReports(limit?: number): RegressionReport[] {
    return limit ? this.testReports.slice(-limit) : [...this.testReports];
  }

  /**
   * Get failed tests
   */
  getFailedTests(): RegressionReport[] {
    return this.testReports.filter(report => !report.passed);
  }

  /**
   * Get performance regressions
   */
  getPerformanceRegressions(): RegressionReport[] {
    return this.testReports.filter(report => report.performanceRegression);
  }

  /**
   * Get functional regressions
   */
  getFunctionalRegressions(): RegressionReport[] {
    return this.testReports.filter(report => report.functionalRegression);
  }

  /**
   * Generate regression summary
   */
  generateSummary(): {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    performanceRegressions: number;
    functionalRegressions: number;
    criticalIssues: number;
    recentReports: RegressionReport[];
  } {
    const totalTests = this.testReports.length;
    const passedTests = this.testReports.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    const performanceRegressions = this.getPerformanceRegressions().length;
    const functionalRegressions = this.getFunctionalRegressions().length;
    
    // Critical issues are tests that fail both functionally and performance-wise
    const criticalIssues = this.testReports.filter(
      r => r.performanceRegression && r.functionalRegression
    ).length;

    const recentReports = this.getTestReports(10);

    return {
      totalTests,
      passedTests,
      failedTests,
      performanceRegressions,
      functionalRegressions,
      criticalIssues,
      recentReports
    };
  }

  /**
   * Clear test history
   */
  clearHistory(): void {
    this.testReports = [];
  }

  /**
   * Export regression data
   */
  exportData(): {
    tests: Record<string, RegressionTest>;
    reports: RegressionReport[];
    performanceData: any;
  } {
    const testsObj: Record<string, RegressionTest> = {};
    for (const [name, test] of this.regressionTests) {
      testsObj[name] = test;
    }

    return {
      tests: testsObj,
      reports: [...this.testReports],
      performanceData: this.performanceMonitor.exportMetrics()
    };
  }

  /**
   * Create automated alert system
   */
  setupAutomatedAlerts(): void {
    this.onAlert((alert) => {
      if (alert.severity === 'critical') {
        console.error(`🚨 CRITICAL REGRESSION DETECTED: ${alert.metricName}`);
        console.error(`Regression: ${alert.regressionPercentage.toFixed(2)}%`);
        console.error(`Current: ${alert.currentValue}, Expected: ${alert.previousValue}`);
        
        // In a real system, this would send notifications (email, Slack, etc.)
        this.sendCriticalAlert(alert);
      } else {
        console.warn(`⚠️  Performance warning: ${alert.metricName}`);
        console.warn(`Regression: ${alert.regressionPercentage.toFixed(2)}%`);
      }
    });
  }

  /**
   * Send critical alert (placeholder for real notification system)
   */
  private sendCriticalAlert(alert: RegressionAlert): void {
    // This would integrate with real alerting systems like:
    // - Email notifications
    // - Slack/Teams webhooks
    // - PagerDuty
    // - Custom monitoring dashboards
    
    console.log(`Would send critical alert for ${alert.metricName} regression`);
  }
}