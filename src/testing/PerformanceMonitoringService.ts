import { EventEmitter } from 'events';
import { PerformanceMonitor, RegressionAlert, PerformanceMetric } from './PerformanceMonitor';
import { RegressionDetector, RegressionReport } from './RegressionDetector';
import { ParallelTestHarness } from './ParallelTestHarness';

export interface AlertConfiguration {
  email?: {
    enabled: boolean;
    recipients: string[];
    smtpConfig?: any;
  };
  webhook?: {
    enabled: boolean;
    url: string;
    headers?: Record<string, string>;
  };
  console?: {
    enabled: boolean;
    logLevel: 'info' | 'warn' | 'error';
  };
  file?: {
    enabled: boolean;
    logPath: string;
    maxFileSize: number;
  };
}

export interface MonitoringConfiguration {
  performanceThresholds: {
    responseTime: number; // ms
    memoryUsage: number; // MB
    cpuUsage: number; // %
    websocketLatency: number; // ms
    webrtcConnectionTime: number; // ms
  };
  regressionThresholds: {
    performanceRegression: number; // %
    memoryRegression: number; // %
    criticalRegressionThreshold: number; // %
  };
  alerting: AlertConfiguration;
  monitoring: {
    enabled: boolean;
    metricsRetentionDays: number;
    baselineUpdateInterval: number; // ms
    alertCooldownPeriod: number; // ms
  };
}

export interface PerformanceReport {
  timestamp: number;
  summary: {
    totalMetrics: number;
    activeThresholds: number;
    recentAlerts: number;
    regressionTests: number;
    criticalIssues: number;
  };
  metrics: {
    responseTime: PerformanceMetric[];
    memoryUsage: PerformanceMetric[];
    webrtcLatency: PerformanceMetric[];
  };
  regressions: RegressionReport[];
  alerts: RegressionAlert[];
  recommendations: string[];
}

/**
 * Comprehensive performance monitoring service that integrates
 * performance monitoring, regression detection, and automated alerting
 */
export class PerformanceMonitoringService extends EventEmitter {
  private performanceMonitor: PerformanceMonitor;
  private regressionDetector: RegressionDetector;
  private testHarness: ParallelTestHarness;
  private config: MonitoringConfiguration;
  private alertCooldowns: Map<string, number> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;

  constructor(config?: Partial<MonitoringConfiguration>) {
    super();
    
    this.config = this.mergeWithDefaults(config);
    this.performanceMonitor = new PerformanceMonitor();
    this.testHarness = new ParallelTestHarness();
    this.regressionDetector = new RegressionDetector(this.performanceMonitor, this.testHarness);
    
    this.setupEventHandlers();
    this.setupPerformanceThresholds();
  }

  /**
   * Merge user config with defaults
   */
  private mergeWithDefaults(config?: Partial<MonitoringConfiguration>): MonitoringConfiguration {
    return {
      performanceThresholds: {
        responseTime: 100, // 100ms
        memoryUsage: 50, // 50MB
        cpuUsage: 80, // 80%
        websocketLatency: 50, // 50ms
        webrtcConnectionTime: 2000, // 2s
        ...config?.performanceThresholds
      },
      regressionThresholds: {
        performanceRegression: 20, // 20%
        memoryRegression: 30, // 30%
        criticalRegressionThreshold: 50, // 50%
        ...config?.regressionThresholds
      },
      alerting: {
        console: { enabled: true, logLevel: 'warn' },
        file: { enabled: true, logPath: './logs/performance-alerts.log', maxFileSize: 10 * 1024 * 1024 },
        ...config?.alerting
      },
      monitoring: {
        enabled: true,
        metricsRetentionDays: 7,
        baselineUpdateInterval: 60000, // 1 minute
        alertCooldownPeriod: 300000, // 5 minutes
        ...config?.monitoring
      }
    };
  }

  /**
   * Setup event handlers for monitoring components
   */
  private setupEventHandlers(): void {
    // Performance monitor events
    this.performanceMonitor.on('thresholdViolation', (alert) => {
      this.handleAlert(alert, 'threshold');
    });

    this.performanceMonitor.on('regressionDetected', (alert) => {
      this.handleAlert(alert, 'regression');
    });

    // Regression detector events
    this.regressionDetector.onAlert((alert) => {
      this.handleAlert(alert, 'regression_test');
    });

    // Test harness events
    this.testHarness.on('testCompleted', (result) => {
      this.recordTestMetrics(result);
    });
  }

  /**
   * Setup performance thresholds based on configuration
   */
  private setupPerformanceThresholds(): void {
    const thresholds = this.config.performanceThresholds;
    
    this.performanceMonitor.setThreshold('response_time', thresholds.responseTime, 'ms');
    this.performanceMonitor.setThreshold('memory_usage', thresholds.memoryUsage, 'MB');
    this.performanceMonitor.setThreshold('cpu_usage', thresholds.cpuUsage, '%');
    this.performanceMonitor.setThreshold('websocket_latency', thresholds.websocketLatency, 'ms');
    this.performanceMonitor.setThreshold('webrtc_connection_time', thresholds.webrtcConnectionTime, 'ms');
  }

  /**
   * Start monitoring service
   */
  start = (): void => {
    if (this.isRunning) {
      console.warn('Performance monitoring service is already running');
      return;
    }

    if (!this.config.monitoring.enabled) {
      console.log('Performance monitoring is disabled in configuration');
      return;
    }

    this.isRunning = true;
    
    // Setup automated regression detection
    this.regressionDetector.setupAutomatedAlerts();
    
    // Start periodic baseline updates
    this.monitoringInterval = setInterval(() => {
      this.updateBaselines();
      this.cleanupOldMetrics();
    }, this.config.monitoring.baselineUpdateInterval);

    console.log('Performance monitoring service started');
    this.emit('started');
  }

  /**
   * Stop monitoring service
   */
  stop = (): void => {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    console.log('Performance monitoring service stopped');
    this.emit('stopped');
  }

  /**
   * Record a performance metric
   */
  recordMetric(name: string, value: number, unit: string, context?: Record<string, any>): void {
    this.performanceMonitor.recordMetric(name, value, unit, context);
  }

  /**
   * Record test execution metrics
   */
  private recordTestMetrics(result: any): void {
    this.recordMetric('test_execution_time_old', result.executionTimeOld, 'ms', {
      testId: result.testId,
      type: 'old_implementation'
    });

    this.recordMetric('test_execution_time_new', result.executionTimeNew, 'ms', {
      testId: result.testId,
      type: 'new_implementation'
    });

    this.recordMetric('test_memory_usage_old', result.memoryUsageOld, 'bytes', {
      testId: result.testId,
      type: 'old_implementation'
    });

    this.recordMetric('test_memory_usage_new', result.memoryUsageNew, 'bytes', {
      testId: result.testId,
      type: 'new_implementation'
    });

    // Calculate and record performance ratios
    const performanceRatio = result.executionTimeOld > 0 
      ? (result.executionTimeNew / result.executionTimeOld) 
      : 1;

    const memoryRatio = result.memoryUsageOld > 0 
      ? (result.memoryUsageNew / result.memoryUsageOld) 
      : 1;

    this.recordMetric('performance_ratio', performanceRatio, 'ratio', {
      testId: result.testId,
      improvement: performanceRatio < 1
    });

    this.recordMetric('memory_ratio', memoryRatio, 'ratio', {
      testId: result.testId,
      improvement: memoryRatio < 1
    });
  }

  /**
   * Handle alerts with cooldown and routing
   */
  private async handleAlert(alert: RegressionAlert, type: string): Promise<void> {
    const alertKey = `${alert.metricName}_${type}`;
    const now = Date.now();
    
    // Check cooldown period
    const lastAlert = this.alertCooldowns.get(alertKey);
    if (lastAlert && (now - lastAlert) < this.config.monitoring.alertCooldownPeriod) {
      return; // Skip alert due to cooldown
    }

    this.alertCooldowns.set(alertKey, now);

    // Route alert to configured channels
    await this.routeAlert(alert, type);

    this.emit('alert', { alert, type });
  }

  /**
   * Route alert to configured channels
   */
  private async routeAlert(alert: RegressionAlert, type: string): Promise<void> {
    const alertConfig = this.config.alerting;

    // Console logging
    if (alertConfig.console?.enabled) {
      this.logToConsole(alert, type, alertConfig.console.logLevel);
    }

    // File logging
    if (alertConfig.file?.enabled) {
      await this.logToFile(alert, type, alertConfig.file.logPath);
    }

    // Webhook notifications
    if (alertConfig.webhook?.enabled) {
      await this.sendWebhookAlert(alert, type, alertConfig.webhook);
    }

    // Email notifications (placeholder - would need actual SMTP implementation)
    if (alertConfig.email?.enabled) {
      await this.sendEmailAlert(alert, type, alertConfig.email);
    }
  }

  /**
   * Log alert to console
   */
  private logToConsole(alert: RegressionAlert, type: string, logLevel: string): void {
    const message = this.formatAlertMessage(alert, type);
    
    switch (logLevel) {
      case 'error':
        console.error(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      default:
        console.log(message);
    }
  }

  /**
   * Log alert to file
   */
  private async logToFile(alert: RegressionAlert, type: string, logPath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Ensure log directory exists
      const logDir = path.dirname(logPath);
      await fs.mkdir(logDir, { recursive: true });

      const logEntry = {
        timestamp: new Date().toISOString(),
        type,
        alert,
        message: this.formatAlertMessage(alert, type)
      };

      await fs.appendFile(logPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write alert to file:', error);
    }
  }

  /**
   * Send webhook alert
   */
  private async sendWebhookAlert(alert: RegressionAlert, type: string, webhookConfig: any): Promise<void> {
    try {
      const payload = {
        timestamp: new Date().toISOString(),
        type,
        alert,
        message: this.formatAlertMessage(alert, type),
        severity: alert.severity
      };

      // In a real implementation, this would use fetch or axios
      console.log(`Would send webhook to ${webhookConfig.url}:`, payload);
    } catch (error) {
      console.error('Failed to send webhook alert:', error);
    }
  }

  /**
   * Send email alert (placeholder)
   */
  private async sendEmailAlert(alert: RegressionAlert, type: string, emailConfig: any): Promise<void> {
    try {
      const subject = `Performance Alert: ${alert.metricName} ${type}`;
      const body = this.formatAlertMessage(alert, type);

      // In a real implementation, this would use nodemailer or similar
      console.log(`Would send email to ${emailConfig.recipients.join(', ')}:`);
      console.log(`Subject: ${subject}`);
      console.log(`Body: ${body}`);
    } catch (error) {
      console.error('Failed to send email alert:', error);
    }
  }

  /**
   * Format alert message
   */
  private formatAlertMessage(alert: RegressionAlert, type: string): string {
    const severity = alert.severity === 'critical' ? '🚨 CRITICAL' : '⚠️  WARNING';
    const regression = alert.regressionPercentage.toFixed(2);
    
    return `${severity} ${type.toUpperCase()}: ${alert.metricName}\n` +
           `Regression: ${regression}% (${alert.currentValue} vs ${alert.previousValue})\n` +
           `Timestamp: ${new Date(alert.timestamp).toISOString()}`;
  }

  /**
   * Update baselines for all metrics
   */
  private updateBaselines(): void {
    // Baselines are automatically updated by PerformanceMonitor
    // This method can be extended for custom baseline logic
    const summary = this.performanceMonitor.getPerformanceSummary();
    
    if (summary.recentAlerts > 0) {
      console.log(`Performance monitoring: ${summary.recentAlerts} recent alerts detected`);
    }
  }

  /**
   * Clean up old metrics based on retention policy
   */
  private cleanupOldMetrics(): void {
    const retentionMs = this.config.monitoring.metricsRetentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionMs;

    // This would need to be implemented in PerformanceMonitor
    // For now, we just log the cleanup intention
    console.log(`Would clean up metrics older than ${new Date(cutoffTime).toISOString()}`);
  }

  /**
   * Generate comprehensive performance report
   */
  generateReport(): PerformanceReport {
    const performanceSummary = this.performanceMonitor.getPerformanceSummary();
    const regressionSummary = this.regressionDetector.generateSummary();
    const testReport = this.testHarness.generateReport();

    const recommendations: string[] = [];

    // Generate recommendations based on current state
    if (regressionSummary.performanceRegressions > 0) {
      recommendations.push(`${regressionSummary.performanceRegressions} performance regressions detected - investigate recent changes`);
    }

    if (regressionSummary.criticalIssues > 0) {
      recommendations.push(`${regressionSummary.criticalIssues} critical issues require immediate attention`);
    }

    if (testReport.averagePerformanceRatio > 1.1) {
      recommendations.push(`Average performance degradation of ${((testReport.averagePerformanceRatio - 1) * 100).toFixed(1)}% - consider optimization`);
    }

    if (testReport.averageMemoryRatio > 1.2) {
      recommendations.push(`Memory usage increased by ${((testReport.averageMemoryRatio - 1) * 100).toFixed(1)}% - check for memory leaks`);
    }

    return {
      timestamp: Date.now(),
      summary: {
        totalMetrics: performanceSummary.totalMetrics,
        activeThresholds: performanceSummary.activeThresholds,
        recentAlerts: performanceSummary.recentAlerts,
        regressionTests: regressionSummary.totalTests,
        criticalIssues: regressionSummary.criticalIssues
      },
      metrics: {
        responseTime: this.performanceMonitor.getMetrics('response_time', 50),
        memoryUsage: this.performanceMonitor.getMetrics('memory_usage', 50),
        webrtcLatency: this.performanceMonitor.getMetrics('webrtc_connection_time', 50)
      },
      regressions: regressionSummary.recentReports,
      alerts: this.performanceMonitor.getRecentAlerts(20),
      recommendations
    };
  }

  /**
   * Get performance monitor instance
   */
  getPerformanceMonitor(): PerformanceMonitor {
    return this.performanceMonitor;
  }

  /**
   * Get regression detector instance
   */
  getRegressionDetector(): RegressionDetector {
    return this.regressionDetector;
  }

  /**
   * Get test harness instance
   */
  getTestHarness(): ParallelTestHarness {
    return this.testHarness;
  }

  /**
   * Update configuration
   */
  updateConfiguration(config: Partial<MonitoringConfiguration>): void {
    this.config = this.mergeWithDefaults(config);
    this.setupPerformanceThresholds();
  }

  /**
   * Get current configuration
   */
  getConfiguration(): MonitoringConfiguration {
    return { ...this.config };
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stop();
    this.performanceMonitor.clearMetrics();
    this.regressionDetector.clearHistory();
    this.testHarness.clearResults();
    this.alertCooldowns.clear();
    this.removeAllListeners();
  }
}