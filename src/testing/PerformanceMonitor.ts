import { EventEmitter } from 'events';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  context?: Record<string, any>;
}

export interface PerformanceThreshold {
  name: string;
  maxValue: number;
  unit: string;
  enabled: boolean;
}

export interface RegressionAlert {
  metricName: string;
  currentValue: number;
  previousValue: number;
  threshold: number;
  regressionPercentage: number;
  timestamp: number;
  severity: 'warning' | 'critical';
}

export interface PerformanceBaseline {
  metricName: string;
  averageValue: number;
  minValue: number;
  maxValue: number;
  standardDeviation: number;
  sampleCount: number;
  lastUpdated: number;
}

/**
 * Performance monitoring system for tracking metrics and detecting regressions
 * Monitors response times, memory usage, and other performance indicators
 */
export class PerformanceMonitor extends EventEmitter {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private thresholds: Map<string, PerformanceThreshold> = new Map();
  private baselines: Map<string, PerformanceBaseline> = new Map();
  private alertHistory: RegressionAlert[] = [];
  private maxMetricHistory: number = 1000;
  private maxAlertHistory: number = 100;

  constructor() {
    super();
    this.setupDefaultThresholds();
  }

  /**
   * Setup default performance thresholds
   */
  private setupDefaultThresholds(): void {
    this.setThreshold('response_time', 100, 'ms'); // 100ms max response time
    this.setThreshold('memory_usage', 50, 'MB'); // 50MB max memory increase
    this.setThreshold('cpu_usage', 80, '%'); // 80% max CPU usage
    this.setThreshold('websocket_latency', 50, 'ms'); // 50ms max WebSocket latency
    this.setThreshold('webrtc_connection_time', 2000, 'ms'); // 2s max WebRTC connection time
  }

  /**
   * Record a performance metric
   */
  recordMetric(name: string, value: number, unit: string, context?: Record<string, any>): void {
    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      context
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricHistory = this.metrics.get(name)!;
    metricHistory.push(metric);

    // Limit history size
    if (metricHistory.length > this.maxMetricHistory) {
      metricHistory.splice(0, metricHistory.length - this.maxMetricHistory);
    }

    // Update baseline
    this.updateBaseline(name);

    // Check for threshold violations
    this.checkThreshold(metric);

    // Check for regressions
    this.checkRegression(metric);

    this.emit('metricRecorded', metric);
  }

  /**
   * Set performance threshold for a metric
   */
  setThreshold(name: string, maxValue: number, unit: string, enabled: boolean = true): void {
    this.thresholds.set(name, { name, maxValue, unit, enabled });
  }

  /**
   * Update baseline statistics for a metric
   */
  private updateBaseline(metricName: string): void {
    const metrics = this.metrics.get(metricName);
    if (!metrics || metrics.length === 0) return;

    const values = metrics.map(m => m.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const average = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Calculate standard deviation
    const squaredDiffs = values.map(value => Math.pow(value - average, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    const standardDeviation = Math.sqrt(avgSquaredDiff);

    const baseline: PerformanceBaseline = {
      metricName,
      averageValue: average,
      minValue: min,
      maxValue: max,
      standardDeviation,
      sampleCount: values.length,
      lastUpdated: Date.now()
    };

    this.baselines.set(metricName, baseline);
  }

  /**
   * Check if metric violates threshold
   */
  private checkThreshold(metric: PerformanceMetric): void {
    const threshold = this.thresholds.get(metric.name);
    if (!threshold || !threshold.enabled) return;

    if (metric.value > threshold.maxValue) {
      const alert: RegressionAlert = {
        metricName: metric.name,
        currentValue: metric.value,
        previousValue: threshold.maxValue,
        threshold: threshold.maxValue,
        regressionPercentage: ((metric.value - threshold.maxValue) / threshold.maxValue) * 100,
        timestamp: metric.timestamp,
        severity: metric.value > threshold.maxValue * 1.5 ? 'critical' : 'warning'
      };

      this.recordAlert(alert);
      this.emit('thresholdViolation', alert);
    }
  }

  /**
   * Check for performance regression compared to baseline
   */
  private checkRegression(metric: PerformanceMetric): void {
    const baseline = this.baselines.get(metric.name);
    if (!baseline || baseline.sampleCount < 10) return; // Need enough samples for baseline

    const regressionThreshold = 0.2; // 20% regression threshold
    const expectedMax = baseline.averageValue + (2 * baseline.standardDeviation);

    if (metric.value > expectedMax) {
      const regressionPercentage = ((metric.value - baseline.averageValue) / baseline.averageValue) * 100;

      if (regressionPercentage > regressionThreshold * 100) {
        const alert: RegressionAlert = {
          metricName: metric.name,
          currentValue: metric.value,
          previousValue: baseline.averageValue,
          threshold: expectedMax,
          regressionPercentage,
          timestamp: metric.timestamp,
          severity: regressionPercentage > 50 ? 'critical' : 'warning'
        };

        this.recordAlert(alert);
        this.emit('regressionDetected', alert);
      }
    }
  }

  /**
   * Record a regression alert
   */
  private recordAlert(alert: RegressionAlert): void {
    this.alertHistory.push(alert);

    // Limit alert history
    if (this.alertHistory.length > this.maxAlertHistory) {
      this.alertHistory.splice(0, this.alertHistory.length - this.maxAlertHistory);
    }
  }

  /**
   * Get performance metrics for a specific metric name
   */
  getMetrics(name: string, limit?: number): PerformanceMetric[] {
    const metrics = this.metrics.get(name) || [];
    return limit ? metrics.slice(-limit) : [...metrics];
  }

  /**
   * Get baseline for a metric
   */
  getBaseline(name: string): PerformanceBaseline | undefined {
    return this.baselines.get(name);
  }

  /**
   * Get all baselines
   */
  getAllBaselines(): PerformanceBaseline[] {
    return Array.from(this.baselines.values());
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 10): RegressionAlert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    totalMetrics: number;
    activeThresholds: number;
    recentAlerts: number;
    baselines: PerformanceBaseline[];
  } {
    const totalMetrics = Array.from(this.metrics.values())
      .reduce((sum, metrics) => sum + metrics.length, 0);

    const activeThresholds = Array.from(this.thresholds.values())
      .filter(t => t.enabled).length;

    const recentAlerts = this.alertHistory.filter(
      alert => Date.now() - alert.timestamp < 24 * 60 * 60 * 1000 // Last 24 hours
    ).length;

    return {
      totalMetrics,
      activeThresholds,
      recentAlerts,
      baselines: this.getAllBaselines()
    };
  }

  /**
   * Clear all metrics and baselines
   */
  clearMetrics(): void {
    this.metrics.clear();
    this.baselines.clear();
    this.alertHistory = [];
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics(): {
    metrics: Record<string, PerformanceMetric[]>;
    baselines: Record<string, PerformanceBaseline>;
    alerts: RegressionAlert[];
    thresholds: Record<string, PerformanceThreshold>;
  } {
    const metricsObj: Record<string, PerformanceMetric[]> = {};
    for (const [name, metrics] of this.metrics) {
      metricsObj[name] = metrics;
    }

    const baselinesObj: Record<string, PerformanceBaseline> = {};
    for (const [name, baseline] of this.baselines) {
      baselinesObj[name] = baseline;
    }

    const thresholdsObj: Record<string, PerformanceThreshold> = {};
    for (const [name, threshold] of this.thresholds) {
      thresholdsObj[name] = threshold;
    }

    return {
      metrics: metricsObj,
      baselines: baselinesObj,
      alerts: [...this.alertHistory],
      thresholds: thresholdsObj
    };
  }

  /**
   * Import metrics from exported data
   */
  importMetrics(data: {
    metrics: Record<string, PerformanceMetric[]>;
    baselines: Record<string, PerformanceBaseline>;
    alerts: RegressionAlert[];
    thresholds: Record<string, PerformanceThreshold>;
  }): void {
    // Import metrics
    for (const [name, metrics] of Object.entries(data.metrics)) {
      this.metrics.set(name, metrics);
    }

    // Import baselines
    for (const [name, baseline] of Object.entries(data.baselines)) {
      this.baselines.set(name, baseline);
    }

    // Import alerts
    this.alertHistory = data.alerts;

    // Import thresholds
    for (const [name, threshold] of Object.entries(data.thresholds)) {
      this.thresholds.set(name, threshold);
    }
  }
}