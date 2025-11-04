import { EventEmitter } from 'events';
import { LoggingService } from './LoggingService';

export interface DAWMetrics {
  // Audio processing metrics
  audioLatency: number;
  bufferUnderruns: number;
  bufferOverruns: number;
  audioProcessingCpuUsage: number;
  audioMemoryUsage: number;
  audioFileProcessingTime: number;

  // Collaboration metrics
  syncLatency: number;
  conflictRate: number;
  connectionStability: number;
  dataTransferEfficiency: number;
  concurrentUsers: number;

  // System resource metrics
  serverCpuUsage: number;
  serverMemoryUsage: number;
  databaseQueryTime: number;
  cacheHitRate: number;
  networkBandwidth: number;
  storageIOPS: number;

  // User experience metrics
  userSessionDuration: number;
  featureUsageStats: Record<string, number>;
  errorRate: number;
  userSatisfactionScore?: number;
}

export interface DAWAlert {
  id: string;
  type: 'critical' | 'warning' | 'info';
  category: 'audio' | 'collaboration' | 'system' | 'user';
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  resolved?: boolean;
  resolvedAt?: Date;
}

export interface DAWPerformanceThresholds {
  audioLatency: { warning: number; critical: number };
  bufferUnderrunRate: { warning: number; critical: number };
  cpuUsage: { warning: number; critical: number };
  memoryUsage: { warning: number; critical: number };
  errorRate: { warning: number; critical: number };
  syncLatency: { warning: number; critical: number };
  conflictRate: { warning: number; critical: number };
}

export class DAWMonitoringService extends EventEmitter {
  private metrics: Map<string, DAWMetrics> = new Map();
  private alerts: DAWAlert[] = [];
  private isMonitoring = false;
  private monitoringInterval: NodeJS.Timeout | undefined;
  private logger: LoggingService;

  private readonly defaultThresholds: DAWPerformanceThresholds = {
    audioLatency: { warning: 50, critical: 100 }, // milliseconds
    bufferUnderrunRate: { warning: 0.01, critical: 0.05 }, // percentage
    cpuUsage: { warning: 70, critical: 85 }, // percentage
    memoryUsage: { warning: 80, critical: 90 }, // percentage
    errorRate: { warning: 0.02, critical: 0.05 }, // percentage
    syncLatency: { warning: 100, critical: 200 }, // milliseconds
    conflictRate: { warning: 0.1, critical: 0.2 } // conflicts per minute
  };

  constructor(logger: LoggingService) {
    super();
    this.logger = logger;
  }

  /**
   * Start monitoring DAW system performance
   */
  public startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, intervalMs);

    this.logger.info('DAW monitoring service started', {
      interval: intervalMs,
      service: 'DAWMonitoringService'
    });
  }

  /**
   * Stop monitoring
   */
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;

    this.logger.info('DAW monitoring service stopped', {
      service: 'DAWMonitoringService'
    });
  }

  /**
   * Record audio processing metrics
   */
  public recordAudioMetrics(roomId: string, metrics: Partial<DAWMetrics>): void {
    const existing = this.metrics.get(roomId) || this.createEmptyMetrics();
    const updated = { ...existing, ...metrics, timestamp: Date.now() };
    
    this.metrics.set(roomId, updated);
    this.checkThresholds(roomId, updated);

    this.emit('audioMetrics', { roomId, metrics: updated });
  }

  /**
   * Record collaboration metrics
   */
  public recordCollaborationMetrics(roomId: string, metrics: Partial<DAWMetrics>): void {
    const existing = this.metrics.get(roomId) || this.createEmptyMetrics();
    const updated = { ...existing, ...metrics, timestamp: Date.now() };
    
    this.metrics.set(roomId, updated);
    this.checkThresholds(roomId, updated);

    this.emit('collaborationMetrics', { roomId, metrics: updated });
  }

  /**
   * Record system resource metrics
   */
  public recordSystemMetrics(metrics: Partial<DAWMetrics>): void {
    const systemMetrics = { ...metrics, timestamp: Date.now() };
    this.metrics.set('system', systemMetrics as DAWMetrics);
    this.checkSystemThresholds(systemMetrics as DAWMetrics);

    this.emit('systemMetrics', { metrics: systemMetrics });
  }

  /**
   * Record user experience metrics
   */
  public recordUserMetrics(userId: string, roomId: string, metrics: Partial<DAWMetrics>): void {
    const key = `${roomId}:${userId}`;
    const existing = this.metrics.get(key) || this.createEmptyMetrics();
    const updated = { ...existing, ...metrics, timestamp: Date.now() };
    
    this.metrics.set(key, updated);

    this.emit('userMetrics', { userId, roomId, metrics: updated });
  }

  /**
   * Create alert
   */
  public createAlert(
    type: DAWAlert['type'],
    category: DAWAlert['category'],
    message: string,
    metadata?: Record<string, any>
  ): DAWAlert {
    const alert: DAWAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      category,
      message,
      timestamp: new Date(),
      ...(metadata !== undefined ? { metadata } : {}),
      resolved: false
    } as DAWAlert;

    this.alerts.push(alert);
    this.emit('alert', alert);

    this.logger.warn('DAW alert created', {
      alertId: alert.id,
      type: alert.type,
      category: alert.category,
      message: alert.message,
      metadata: alert.metadata,
      service: 'DAWMonitoringService'
    });

    return alert;
  }

  /**
   * Resolve alert
   */
  public resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      this.emit('alertResolved', alert);

      this.logger.info('DAW alert resolved', {
        alertId: alert.id,
        resolvedAt: alert.resolvedAt,
        service: 'DAWMonitoringService'
      });

      return true;
    }
    return false;
  }

  /**
   * Get current metrics for a room
   */
  public getMetrics(roomId: string): DAWMetrics | null {
    return this.metrics.get(roomId) || null;
  }

  /**
   * Get all active alerts
   */
  public getActiveAlerts(): DAWAlert[] {
    return this.alerts.filter(alert => !alert.resolved);
  }

  /**
   * Get system health summary
   */
  public getSystemHealth(): {
    status: 'healthy' | 'warning' | 'critical';
    activeAlerts: number;
    criticalAlerts: number;
    systemMetrics: DAWMetrics | null;
  } {
    const activeAlerts = this.getActiveAlerts();
    const criticalAlerts = activeAlerts.filter(a => a.type === 'critical');
    const systemMetrics = this.metrics.get('system') || null;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (criticalAlerts.length > 0) {
      status = 'critical';
    } else if (activeAlerts.length > 0) {
      status = 'warning';
    }

    return {
      status,
      activeAlerts: activeAlerts.length,
      criticalAlerts: criticalAlerts.length,
      systemMetrics
    };
  }

  /**
   * Get performance analytics
   */
  public getPerformanceAnalytics(timeRange: { start: Date; end: Date }): {
    averageMetrics: Partial<DAWMetrics>;
    peakMetrics: Partial<DAWMetrics>;
    alertSummary: { total: number; byType: Record<string, number>; byCategory: Record<string, number> };
  } {
    const timeRangeAlerts = this.alerts.filter(
      alert => alert.timestamp >= timeRange.start && alert.timestamp <= timeRange.end
    );

    const alertSummary = {
      total: timeRangeAlerts.length,
      byType: this.groupBy(timeRangeAlerts, 'type'),
      byCategory: this.groupBy(timeRangeAlerts, 'category')
    };

    // Calculate average and peak metrics from stored data
    const allMetrics = Array.from(this.metrics.values());
    const averageMetrics = this.calculateAverageMetrics(allMetrics);
    const peakMetrics = this.calculatePeakMetrics(allMetrics);

    return {
      averageMetrics,
      peakMetrics,
      alertSummary
    };
  }

  /**
   * Export metrics data
   */
  public exportMetrics(format: 'json' | 'csv' = 'json'): string {
    const data = {
      timestamp: new Date().toISOString(),
      metrics: Object.fromEntries(this.metrics),
      alerts: this.alerts,
      systemHealth: this.getSystemHealth()
    };

    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    } else {
      // Convert to CSV format
      return this.convertToCSV(data);
    }
  }

  private collectMetrics(): void {
    // Collect system-wide metrics
    const systemMetrics = {
      serverCpuUsage: process.cpuUsage().system / 1000000, // Convert to percentage
      serverMemoryUsage: (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100,
      timestamp: Date.now()
    };

    this.recordSystemMetrics(systemMetrics);
  }

  private checkThresholds(roomId: string, metrics: DAWMetrics): void {
    // Check audio latency
    if (metrics.audioLatency > this.defaultThresholds.audioLatency.critical) {
      this.createAlert('critical', 'audio', `High audio latency detected: ${metrics.audioLatency}ms`, {
        roomId,
        latency: metrics.audioLatency
      });
    } else if (metrics.audioLatency > this.defaultThresholds.audioLatency.warning) {
      this.createAlert('warning', 'audio', `Elevated audio latency: ${metrics.audioLatency}ms`, {
        roomId,
        latency: metrics.audioLatency
      });
    }

    // Check sync latency
    if (metrics.syncLatency > this.defaultThresholds.syncLatency.critical) {
      this.createAlert('critical', 'collaboration', `High sync latency detected: ${metrics.syncLatency}ms`, {
        roomId,
        syncLatency: metrics.syncLatency
      });
    } else if (metrics.syncLatency > this.defaultThresholds.syncLatency.warning) {
      this.createAlert('warning', 'collaboration', `Elevated sync latency: ${metrics.syncLatency}ms`, {
        roomId,
        syncLatency: metrics.syncLatency
      });
    }

    // Check conflict rate
    if (metrics.conflictRate > this.defaultThresholds.conflictRate.critical) {
      this.createAlert('critical', 'collaboration', `High conflict rate detected: ${metrics.conflictRate}`, {
        roomId,
        conflictRate: metrics.conflictRate
      });
    }
  }

  private checkSystemThresholds(metrics: DAWMetrics): void {
    // Check CPU usage
    if (metrics.serverCpuUsage > this.defaultThresholds.cpuUsage.critical) {
      this.createAlert('critical', 'system', `Critical CPU usage: ${metrics.serverCpuUsage}%`, {
        cpuUsage: metrics.serverCpuUsage
      });
    } else if (metrics.serverCpuUsage > this.defaultThresholds.cpuUsage.warning) {
      this.createAlert('warning', 'system', `High CPU usage: ${metrics.serverCpuUsage}%`, {
        cpuUsage: metrics.serverCpuUsage
      });
    }

    // Check memory usage
    if (metrics.serverMemoryUsage > this.defaultThresholds.memoryUsage.critical) {
      this.createAlert('critical', 'system', `Critical memory usage: ${metrics.serverMemoryUsage}%`, {
        memoryUsage: metrics.serverMemoryUsage
      });
    } else if (metrics.serverMemoryUsage > this.defaultThresholds.memoryUsage.warning) {
      this.createAlert('warning', 'system', `High memory usage: ${metrics.serverMemoryUsage}%`, {
        memoryUsage: metrics.serverMemoryUsage
      });
    }
  }

  private createEmptyMetrics(): DAWMetrics {
    return {
      audioLatency: 0,
      bufferUnderruns: 0,
      bufferOverruns: 0,
      audioProcessingCpuUsage: 0,
      audioMemoryUsage: 0,
      audioFileProcessingTime: 0,
      syncLatency: 0,
      conflictRate: 0,
      connectionStability: 100,
      dataTransferEfficiency: 100,
      concurrentUsers: 0,
      serverCpuUsage: 0,
      serverMemoryUsage: 0,
      databaseQueryTime: 0,
      cacheHitRate: 100,
      networkBandwidth: 0,
      storageIOPS: 0,
      userSessionDuration: 0,
      featureUsageStats: {},
      errorRate: 0
    };
  }

  private groupBy<T>(array: T[], key: keyof T): Record<string, number> {
    return array.reduce((acc, item) => {
      const value = String(item[key]);
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private calculateAverageMetrics(metrics: DAWMetrics[]): Partial<DAWMetrics> {
    if (metrics.length === 0) return {};

    const sums = metrics.reduce((acc, metric) => {
      Object.keys(metric).forEach(key => {
        if (typeof metric[key as keyof DAWMetrics] === 'number') {
          acc[key] = (acc[key] || 0) + (metric[key as keyof DAWMetrics] as number);
        }
      });
      return acc;
    }, {} as Record<string, number>);

    const averages: Partial<DAWMetrics> = {};
    Object.keys(sums).forEach(key => {
      (averages as any)[key] = (sums[key] ?? 0) / metrics.length;
    });

    return averages;
  }

  private calculatePeakMetrics(metrics: DAWMetrics[]): Partial<DAWMetrics> {
    if (metrics.length === 0) return {};

    const peaks = metrics.reduce((acc, metric) => {
      Object.keys(metric).forEach(key => {
        if (typeof metric[key as keyof DAWMetrics] === 'number') {
          const value = metric[key as keyof DAWMetrics] as number;
          acc[key] = Math.max(acc[key] || 0, value);
        }
      });
      return acc;
    }, {} as Record<string, number>);

    return peaks as Partial<DAWMetrics>;
  }

  private convertToCSV(data: any): string {
    // Simple CSV conversion for metrics data
    const headers = ['timestamp', 'roomId', 'metric', 'value'];
    const rows = [headers.join(',')];

    Object.entries(data.metrics).forEach(([roomId, metrics]) => {
      Object.entries(metrics as any).forEach(([metric, value]) => {
        if (typeof value === 'number') {
          rows.push([new Date().toISOString(), roomId, metric, value].join(','));
        }
      });
    });

    return rows.join('\n');
  }
}