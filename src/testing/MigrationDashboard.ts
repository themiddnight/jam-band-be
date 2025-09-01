import { EventEmitter } from 'events';
import { PerformanceMonitor, PerformanceMetric, RegressionAlert } from './PerformanceMonitor';
import { RegressionDetector, RegressionReport } from './RegressionDetector';
import { ParallelTestHarness, TestResult } from './ParallelTestHarness';

export interface DashboardConfig {
  refreshInterval: number; // milliseconds
  maxHistoryItems: number;
  enableRealTimeUpdates: boolean;
  rollbackThresholds: {
    criticalFailures: number;
    performanceRegressionPercent: number;
    functionalFailures: number;
  };
}

export interface MigrationStatus {
  phase: 'setup' | 'testing' | 'migrating' | 'completed' | 'rolled_back';
  progress: number; // 0-100
  currentTask: string;
  startTime: number;
  lastUpdate: number;
  errors: string[];
  warnings: string[];
}

export interface DashboardData {
  migrationStatus: MigrationStatus;
  performanceSummary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    averagePerformanceRatio: number;
    criticalAlerts: number;
  };
  recentTests: TestResult[];
  recentAlerts: RegressionAlert[];
  recentReports: RegressionReport[];
  systemMetrics: {
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
  };
  rollbackStatus: {
    canRollback: boolean;
    reason?: string;
    criticalIssues: number;
  };
}

/**
 * Real-time migration dashboard for monitoring progress and triggering rollbacks
 * Provides comprehensive view of migration status, performance, and health
 */
export class MigrationDashboard extends EventEmitter {
  private config: DashboardConfig;
  private performanceMonitor: PerformanceMonitor;
  private regressionDetector: RegressionDetector;
  private testHarness: ParallelTestHarness;
  private migrationStatus: MigrationStatus;
  private refreshTimer?: NodeJS.Timeout;
  private dashboardData: DashboardData;
  private rollbackCallbacks: Array<() => Promise<void>> = [];

  constructor(
    performanceMonitor: PerformanceMonitor,
    regressionDetector: RegressionDetector,
    testHarness: ParallelTestHarness,
    config: Partial<DashboardConfig> = {}
  ) {
    super();

    this.config = {
      refreshInterval: 1000, // 1 second
      maxHistoryItems: 50,
      enableRealTimeUpdates: true,
      rollbackThresholds: {
        criticalFailures: 3,
        performanceRegressionPercent: 50,
        functionalFailures: 5
      },
      ...config
    };

    this.performanceMonitor = performanceMonitor;
    this.regressionDetector = regressionDetector;
    this.testHarness = testHarness;

    this.migrationStatus = {
      phase: 'setup',
      progress: 0,
      currentTask: 'Initializing migration dashboard',
      startTime: Date.now(),
      lastUpdate: Date.now(),
      errors: [],
      warnings: []
    };

    this.dashboardData = this.generateDashboardData();

    this.setupEventListeners();
    this.startRealTimeUpdates();
  }

  /**
   * Setup event listeners for real-time updates
   */
  private setupEventListeners(): void {
    // Listen for performance alerts
    this.performanceMonitor.on('regressionDetected', (alert) => {
      this.handleRegressionAlert(alert);
    });

    this.performanceMonitor.on('thresholdViolation', (alert) => {
      this.handleThresholdViolation(alert);
    });

    // Listen for test completions
    this.testHarness.on('testCompleted', (result) => {
      this.handleTestCompletion(result);
    });

    // Listen for regression detector alerts
    this.regressionDetector.onAlert((alert) => {
      this.handleCriticalAlert(alert);
    });
  }

  /**
   * Start real-time dashboard updates
   */
  private startRealTimeUpdates(): void {
    if (!this.config.enableRealTimeUpdates) return;

    this.refreshTimer = setInterval(() => {
      this.updateDashboard();
    }, this.config.refreshInterval);
  }

  /**
   * Stop real-time updates
   */
  private stopRealTimeUpdates(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Update migration status
   */
  updateMigrationStatus(
    phase: MigrationStatus['phase'],
    progress: number,
    currentTask: string
  ): void {
    this.migrationStatus.phase = phase;
    this.migrationStatus.progress = Math.max(0, Math.min(100, progress));
    this.migrationStatus.currentTask = currentTask;
    this.migrationStatus.lastUpdate = Date.now();

    this.updateDashboard();
    this.emit('statusUpdated', this.migrationStatus);
  }

  /**
   * Add error to migration status
   */
  addError(error: string): void {
    this.migrationStatus.errors.push(`${new Date().toISOString()}: ${error}`);
    
    // Limit error history
    if (this.migrationStatus.errors.length > this.config.maxHistoryItems) {
      this.migrationStatus.errors = this.migrationStatus.errors.slice(-this.config.maxHistoryItems);
    }

    this.updateDashboard();
    this.emit('errorAdded', error);
  }

  /**
   * Add warning to migration status
   */
  addWarning(warning: string): void {
    this.migrationStatus.warnings.push(`${new Date().toISOString()}: ${warning}`);
    
    // Limit warning history
    if (this.migrationStatus.warnings.length > this.config.maxHistoryItems) {
      this.migrationStatus.warnings = this.migrationStatus.warnings.slice(-this.config.maxHistoryItems);
    }

    this.updateDashboard();
    this.emit('warningAdded', warning);
  }

  /**
   * Handle regression alert
   */
  private handleRegressionAlert(alert: RegressionAlert): void {
    const message = `Performance regression detected: ${alert.metricName} (${alert.regressionPercentage.toFixed(2)}%)`;
    
    if (alert.severity === 'critical') {
      this.addError(message);
    } else {
      this.addWarning(message);
    }

    this.checkRollbackConditions();
  }

  /**
   * Handle threshold violation
   */
  private handleThresholdViolation(alert: RegressionAlert): void {
    const message = `Threshold violation: ${alert.metricName} (${alert.currentValue} > ${alert.threshold})`;
    this.addWarning(message);
  }

  /**
   * Handle test completion
   */
  private handleTestCompletion(result: TestResult): void {
    if (result.error) {
      this.addError(`Test failed: ${result.testId} - ${result.error}`);
    } else if (!result.isEqual) {
      this.addWarning(`Functional difference detected in test: ${result.testId}`);
    }

    this.checkRollbackConditions();
  }

  /**
   * Handle critical alert
   */
  private handleCriticalAlert(alert: RegressionAlert): void {
    this.addError(`CRITICAL: ${alert.metricName} regression of ${alert.regressionPercentage.toFixed(2)}%`);
    this.checkRollbackConditions();
  }

  /**
   * Check if rollback conditions are met
   */
  private checkRollbackConditions(): void {
    const rollbackStatus = this.evaluateRollbackConditions();
    
    if (rollbackStatus.canRollback && rollbackStatus.criticalIssues > 0) {
      this.emit('rollbackTriggered', rollbackStatus);
      
      if (this.config.rollbackThresholds.criticalFailures <= rollbackStatus.criticalIssues) {
        this.triggerAutomaticRollback(rollbackStatus.reason || 'Critical failure threshold exceeded');
      }
    }
  }

  /**
   * Evaluate rollback conditions
   */
  private evaluateRollbackConditions(): DashboardData['rollbackStatus'] {
    const recentReports = this.regressionDetector.getTestReports(10);
    const recentAlerts = this.performanceMonitor.getRecentAlerts(10);
    
    const criticalAlerts = recentAlerts.filter(a => a.severity === 'critical').length;
    const functionalFailures = recentReports.filter(r => r.functionalRegression).length;
    const performanceRegressions = recentAlerts.filter(
      a => a.regressionPercentage > this.config.rollbackThresholds.performanceRegressionPercent
    ).length;

    const criticalIssues = criticalAlerts + functionalFailures + performanceRegressions;

    let canRollback = false;
    let reason: string | undefined;

    if (criticalAlerts >= this.config.rollbackThresholds.criticalFailures) {
      canRollback = true;
      reason = `Critical alerts threshold exceeded (${criticalAlerts}/${this.config.rollbackThresholds.criticalFailures})`;
    } else if (functionalFailures >= this.config.rollbackThresholds.functionalFailures) {
      canRollback = true;
      reason = `Functional failures threshold exceeded (${functionalFailures}/${this.config.rollbackThresholds.functionalFailures})`;
    } else if (performanceRegressions > 0) {
      canRollback = true;
      reason = `Severe performance regressions detected (${performanceRegressions})`;
    }

    return {
      canRollback,
      reason,
      criticalIssues
    };
  }

  /**
   * Trigger automatic rollback
   */
  private async triggerAutomaticRollback(reason: string): Promise<void> {
    this.addError(`AUTOMATIC ROLLBACK TRIGGERED: ${reason}`);
    this.updateMigrationStatus('rolled_back', 0, 'Rolling back changes');

    try {
      // Execute rollback callbacks
      for (const callback of this.rollbackCallbacks) {
        await callback();
      }

      this.addWarning('Rollback completed successfully');
      this.emit('rollbackCompleted', { success: true, reason });
    } catch (error) {
      const errorMessage = `Rollback failed: ${error}`;
      this.addError(errorMessage);
      this.emit('rollbackCompleted', { success: false, reason, error: errorMessage });
    }
  }

  /**
   * Register rollback callback
   */
  onRollback(callback: () => Promise<void>): void {
    this.rollbackCallbacks.push(callback);
  }

  /**
   * Update dashboard data
   */
  private updateDashboard(): void {
    this.dashboardData = this.generateDashboardData();
    this.emit('dashboardUpdated', this.dashboardData);
  }

  /**
   * Generate current dashboard data
   */
  private generateDashboardData(): DashboardData {
    const performanceSummary = this.performanceMonitor.getPerformanceSummary();
    const testReport = this.testHarness.generateReport();
    const recentAlerts = this.performanceMonitor.getRecentAlerts(this.config.maxHistoryItems);
    const recentReports = this.regressionDetector.getTestReports(this.config.maxHistoryItems);
    const recentTests = this.testHarness.getAllResults().slice(-this.config.maxHistoryItems);

    return {
      migrationStatus: { ...this.migrationStatus },
      performanceSummary: {
        totalTests: testReport.totalTests,
        passedTests: testReport.passedTests,
        failedTests: testReport.failedTests,
        averagePerformanceRatio: testReport.averagePerformanceRatio,
        criticalAlerts: recentAlerts.filter(a => a.severity === 'critical').length
      },
      recentTests,
      recentAlerts,
      recentReports,
      systemMetrics: this.getSystemMetrics(),
      rollbackStatus: this.evaluateRollbackConditions()
    };
  }

  /**
   * Get current system metrics
   */
  private getSystemMetrics(): DashboardData['systemMetrics'] {
    const memoryUsage = process.memoryUsage();
    
    return {
      memoryUsage: memoryUsage.heapUsed / 1024 / 1024, // MB
      cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
      activeConnections: 0 // Would be populated from actual connection count
    };
  }

  /**
   * Get current dashboard data
   */
  getDashboardData(): DashboardData {
    return { ...this.dashboardData };
  }

  /**
   * Generate HTML dashboard
   */
  generateHTMLDashboard(): string {
    const data = this.getDashboardData();
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Migration Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .dashboard { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .status-${data.migrationStatus.phase} { border-left: 4px solid #007bff; }
        .status-rolled_back { border-left: 4px solid #dc3545; }
        .status-completed { border-left: 4px solid #28a745; }
        .progress-bar { width: 100%; height: 20px; background: #e9ecef; border-radius: 10px; overflow: hidden; }
        .progress-fill { height: 100%; background: #007bff; transition: width 0.3s; }
        .metric { display: flex; justify-content: space-between; margin: 10px 0; }
        .error { color: #dc3545; }
        .warning { color: #ffc107; }
        .success { color: #28a745; }
        .alert-critical { background: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .alert-warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .rollback-button { background: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
        .rollback-button:disabled { background: #6c757d; cursor: not-allowed; }
    </style>
</head>
<body>
    <h1>Migration Dashboard</h1>
    
    <div class="dashboard">
        <div class="card status-${data.migrationStatus.phase}">
            <h2>Migration Status</h2>
            <div class="metric">
                <span>Phase:</span>
                <span><strong>${data.migrationStatus.phase.toUpperCase()}</strong></span>
            </div>
            <div class="metric">
                <span>Progress:</span>
                <span>${data.migrationStatus.progress}%</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${data.migrationStatus.progress}%"></div>
            </div>
            <div class="metric">
                <span>Current Task:</span>
                <span>${data.migrationStatus.currentTask}</span>
            </div>
            <div class="metric">
                <span>Duration:</span>
                <span>${Math.round((Date.now() - data.migrationStatus.startTime) / 1000)}s</span>
            </div>
        </div>

        <div class="card">
            <h2>Performance Summary</h2>
            <div class="metric">
                <span>Total Tests:</span>
                <span>${data.performanceSummary.totalTests}</span>
            </div>
            <div class="metric">
                <span>Passed:</span>
                <span class="success">${data.performanceSummary.passedTests}</span>
            </div>
            <div class="metric">
                <span>Failed:</span>
                <span class="error">${data.performanceSummary.failedTests}</span>
            </div>
            <div class="metric">
                <span>Performance Ratio:</span>
                <span>${data.performanceSummary.averagePerformanceRatio.toFixed(2)}x</span>
            </div>
            <div class="metric">
                <span>Critical Alerts:</span>
                <span class="error">${data.performanceSummary.criticalAlerts}</span>
            </div>
        </div>

        <div class="card">
            <h2>System Metrics</h2>
            <div class="metric">
                <span>Memory Usage:</span>
                <span>${data.systemMetrics.memoryUsage.toFixed(1)} MB</span>
            </div>
            <div class="metric">
                <span>CPU Usage:</span>
                <span>${data.systemMetrics.cpuUsage.toFixed(2)}s</span>
            </div>
            <div class="metric">
                <span>Active Connections:</span>
                <span>${data.systemMetrics.activeConnections}</span>
            </div>
        </div>

        <div class="card">
            <h2>Rollback Status</h2>
            <div class="metric">
                <span>Can Rollback:</span>
                <span class="${data.rollbackStatus.canRollback ? 'error' : 'success'}">
                    ${data.rollbackStatus.canRollback ? 'YES' : 'NO'}
                </span>
            </div>
            <div class="metric">
                <span>Critical Issues:</span>
                <span class="error">${data.rollbackStatus.criticalIssues}</span>
            </div>
            ${data.rollbackStatus.reason ? `
            <div class="metric">
                <span>Reason:</span>
                <span class="error">${data.rollbackStatus.reason}</span>
            </div>
            ` : ''}
            <button class="rollback-button" ${!data.rollbackStatus.canRollback ? 'disabled' : ''}>
                Trigger Manual Rollback
            </button>
        </div>
    </div>

    <div class="card" style="grid-column: 1 / -1; margin-top: 20px;">
        <h2>Recent Alerts</h2>
        ${data.recentAlerts.slice(-5).map(alert => `
            <div class="alert-${alert.severity}">
                <strong>${alert.metricName}</strong>: ${alert.regressionPercentage.toFixed(2)}% regression
                (${alert.currentValue} vs ${alert.previousValue})
            </div>
        `).join('')}
    </div>

    <script>
        // Auto-refresh every 5 seconds
        setTimeout(() => location.reload(), 5000);
    </script>
</body>
</html>`;
  }

  /**
   * Cleanup dashboard
   */
  cleanup(): void {
    try {
      this.stopRealTimeUpdates();
      this.removeAllListeners();
      
      // Clear any remaining callbacks
      this.rollbackCallbacks = [];
      
      // Clear dashboard data
      this.dashboardData = this.generateDashboardData();
    } catch (error) {
      console.error('Error during dashboard cleanup:', error);
    }
  }
}