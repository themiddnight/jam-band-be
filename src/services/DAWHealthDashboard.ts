import { EventEmitter } from 'events';
import { DAWMonitoringService, DAWMetrics, DAWAlert } from './DAWMonitoringService';
import { LoggingService } from './LoggingService';

export interface HealthDashboardConfig {
  refreshInterval: number;
  alertRetentionDays: number;
  metricsRetentionDays: number;
  enableRealTimeUpdates: boolean;
}

export interface SystemHealthStatus {
  overall: 'healthy' | 'warning' | 'critical' | 'unknown';
  components: {
    audio: 'healthy' | 'warning' | 'critical';
    collaboration: 'healthy' | 'warning' | 'critical';
    system: 'healthy' | 'warning' | 'critical';
    database: 'healthy' | 'warning' | 'critical';
  };
  metrics: {
    activeRooms: number;
    totalUsers: number;
    averageLatency: number;
    errorRate: number;
    uptime: number;
  };
  alerts: {
    critical: number;
    warning: number;
    total: number;
  };
  lastUpdated: Date;
}

export interface PerformanceTrend {
  metric: string;
  timeRange: string;
  data: Array<{
    timestamp: Date;
    value: number;
  }>;
  trend: 'improving' | 'stable' | 'degrading';
  changePercent: number;
}

export class DAWHealthDashboard extends EventEmitter {
  private monitoringService: DAWMonitoringService;
  private logger: LoggingService;
  private config: HealthDashboardConfig;
  private healthStatus: SystemHealthStatus;
  private performanceTrends: Map<string, PerformanceTrend> = new Map();
  private updateInterval?: NodeJS.Timeout;
  private startTime: Date;

  constructor(
    monitoringService: DAWMonitoringService,
    logger: LoggingService,
    config: Partial<HealthDashboardConfig> = {}
  ) {
    super();
    this.monitoringService = monitoringService;
    this.logger = logger;
    this.startTime = new Date();
    
    this.config = {
      refreshInterval: 30000, // 30 seconds
      alertRetentionDays: 30,
      metricsRetentionDays: 7,
      enableRealTimeUpdates: true,
      ...config
    };

    this.healthStatus = this.initializeHealthStatus();
    this.setupEventListeners();
  }

  /**
   * Start the health dashboard
   */
  public start(): void {
    this.updateHealthStatus();
    
    if (this.config.enableRealTimeUpdates) {
      this.updateInterval = setInterval(() => {
        this.updateHealthStatus();
      }, this.config.refreshInterval);
    }

    this.logger.info('DAW Health Dashboard started', {
      refreshInterval: this.config.refreshInterval,
      service: 'DAWHealthDashboard'
    });
  }

  /**
   * Stop the health dashboard
   */
  public stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }

    this.logger.info('DAW Health Dashboard stopped', {
      service: 'DAWHealthDashboard'
    });
  }

  /**
   * Get current system health status
   */
  public getHealthStatus(): SystemHealthStatus {
    return { ...this.healthStatus };
  }

  /**
   * Get performance trends
   */
  public getPerformanceTrends(timeRange: '1h' | '24h' | '7d' = '24h'): PerformanceTrend[] {
    return Array.from(this.performanceTrends.values())
      .filter(trend => trend.timeRange === timeRange);
  }

  /**
   * Get detailed system metrics
   */
  public getDetailedMetrics(): {
    systemMetrics: DAWMetrics | null;
    roomMetrics: Array<{ roomId: string; metrics: DAWMetrics }>;
    activeAlerts: DAWAlert[];
    performanceSummary: {
      averageAudioLatency: number;
      averageSyncLatency: number;
      totalErrors: number;
      uptime: string;
    };
  } {
    const systemHealth = this.monitoringService.getSystemHealth();
    const activeAlerts = this.monitoringService.getActiveAlerts();
    
    // Calculate performance summary
    const uptime = Date.now() - this.startTime.getTime();
    const uptimeString = this.formatUptime(uptime);

    return {
      systemMetrics: systemHealth.systemMetrics,
      roomMetrics: [], // Would be populated from monitoring service
      activeAlerts,
      performanceSummary: {
        averageAudioLatency: this.calculateAverageLatency('audio'),
        averageSyncLatency: this.calculateAverageLatency('sync'),
        totalErrors: this.calculateTotalErrors(),
        uptime: uptimeString
      }
    };
  }

  /**
   * Generate health report
   */
  public generateHealthReport(timeRange: { start: Date; end: Date }): {
    summary: SystemHealthStatus;
    analytics: any;
    recommendations: string[];
    exportData: string;
  } {
    const analytics = this.monitoringService.getPerformanceAnalytics(timeRange);
    const recommendations = this.generateRecommendations();
    const exportData = this.monitoringService.exportMetrics('json');

    return {
      summary: this.healthStatus,
      analytics,
      recommendations,
      exportData
    };
  }

  /**
   * Get real-time dashboard data for web interface
   */
  public getDashboardData(): {
    health: SystemHealthStatus;
    charts: {
      audioLatency: Array<{ time: string; value: number }>;
      syncLatency: Array<{ time: string; value: number }>;
      cpuUsage: Array<{ time: string; value: number }>;
      memoryUsage: Array<{ time: string; value: number }>;
      activeUsers: Array<{ time: string; value: number }>;
    };
    alerts: DAWAlert[];
    uptime: string;
  } {
    const uptime = Date.now() - this.startTime.getTime();
    
    return {
      health: this.healthStatus,
      charts: {
        audioLatency: this.getChartData('audioLatency'),
        syncLatency: this.getChartData('syncLatency'),
        cpuUsage: this.getChartData('cpuUsage'),
        memoryUsage: this.getChartData('memoryUsage'),
        activeUsers: this.getChartData('activeUsers')
      },
      alerts: this.monitoringService.getActiveAlerts(),
      uptime: this.formatUptime(uptime)
    };
  }

  /**
   * Check if system is healthy
   */
  public isSystemHealthy(): boolean {
    return this.healthStatus.overall === 'healthy';
  }

  /**
   * Get system status for external monitoring
   */
  public getSystemStatus(): {
    status: 'up' | 'down' | 'degraded';
    timestamp: Date;
    details: {
      audio: boolean;
      collaboration: boolean;
      database: boolean;
      api: boolean;
    };
  } {
    const health = this.healthStatus;
    let status: 'up' | 'down' | 'degraded' = 'up';

    if (health.overall === 'critical') {
      status = 'down';
    } else if (health.overall === 'warning') {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date(),
      details: {
        audio: health.components.audio !== 'critical',
        collaboration: health.components.collaboration !== 'critical',
        database: health.components.database !== 'critical',
        api: health.components.system !== 'critical'
      }
    };
  }

  private initializeHealthStatus(): SystemHealthStatus {
    return {
      overall: 'unknown',
      components: {
        audio: 'healthy',
        collaboration: 'healthy',
        system: 'healthy',
        database: 'healthy'
      },
      metrics: {
        activeRooms: 0,
        totalUsers: 0,
        averageLatency: 0,
        errorRate: 0,
        uptime: 0
      },
      alerts: {
        critical: 0,
        warning: 0,
        total: 0
      },
      lastUpdated: new Date()
    };
  }

  private setupEventListeners(): void {
    // Listen for monitoring service events
    this.monitoringService.on('alert', (alert: DAWAlert) => {
      this.updateHealthStatus();
      this.emit('alertCreated', alert);
    });

    this.monitoringService.on('alertResolved', (alert: DAWAlert) => {
      this.updateHealthStatus();
      this.emit('alertResolved', alert);
    });

    this.monitoringService.on('audioMetrics', (data: any) => {
      this.updatePerformanceTrends('audioLatency', data.metrics.audioLatency);
      this.emit('metricsUpdated', { type: 'audio', data });
    });

    this.monitoringService.on('systemMetrics', (data: any) => {
      this.updatePerformanceTrends('cpuUsage', data.metrics.serverCpuUsage);
      this.updatePerformanceTrends('memoryUsage', data.metrics.serverMemoryUsage);
      this.emit('metricsUpdated', { type: 'system', data });
    });
  }

  private updateHealthStatus(): void {
    const systemHealth = this.monitoringService.getSystemHealth();
    const activeAlerts = this.monitoringService.getActiveAlerts();
    
    // Update component health based on alerts
    const audioAlerts = activeAlerts.filter(a => a.category === 'audio');
    const collaborationAlerts = activeAlerts.filter(a => a.category === 'collaboration');
    const systemAlerts = activeAlerts.filter(a => a.category === 'system');

    this.healthStatus = {
      overall: systemHealth.status,
      components: {
        audio: this.getComponentHealth(audioAlerts),
        collaboration: this.getComponentHealth(collaborationAlerts),
        system: this.getComponentHealth(systemAlerts),
        database: 'healthy' // Would be determined by database health checks
      },
      metrics: {
        activeRooms: this.calculateActiveRooms(),
        totalUsers: this.calculateTotalUsers(),
        averageLatency: this.calculateAverageLatency('audio'),
        errorRate: this.calculateErrorRate(),
        uptime: Date.now() - this.startTime.getTime()
      },
      alerts: {
        critical: activeAlerts.filter(a => a.type === 'critical').length,
        warning: activeAlerts.filter(a => a.type === 'warning').length,
        total: activeAlerts.length
      },
      lastUpdated: new Date()
    };

    this.emit('healthStatusUpdated', this.healthStatus);
  }

  private getComponentHealth(alerts: DAWAlert[]): 'healthy' | 'warning' | 'critical' {
    const criticalAlerts = alerts.filter(a => a.type === 'critical');
    const warningAlerts = alerts.filter(a => a.type === 'warning');

    if (criticalAlerts.length > 0) return 'critical';
    if (warningAlerts.length > 0) return 'warning';
    return 'healthy';
  }

  private updatePerformanceTrends(metric: string, value: number): void {
    const now = new Date();
    const trend = this.performanceTrends.get(metric) || {
      metric,
      timeRange: '24h',
      data: [],
      trend: 'stable',
      changePercent: 0
    };

    // Add new data point
    trend.data.push({ timestamp: now, value });

    // Keep only last 24 hours of data
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    trend.data = trend.data.filter(d => d.timestamp > cutoff);

    // Calculate trend
    if (trend.data.length > 1) {
      const recent = trend.data.slice(-10); // Last 10 data points
      const older = trend.data.slice(-20, -10); // Previous 10 data points
      
      if (older.length > 0) {
        const recentAvg = recent.reduce((sum, d) => sum + d.value, 0) / recent.length;
        const olderAvg = older.reduce((sum, d) => sum + d.value, 0) / older.length;
        
        const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;
        trend.changePercent = changePercent;
        
        if (Math.abs(changePercent) < 5) {
          trend.trend = 'stable';
        } else if (changePercent > 0) {
          trend.trend = 'degrading'; // Higher values are generally worse for performance metrics
        } else {
          trend.trend = 'improving';
        }
      }
    }

    this.performanceTrends.set(metric, trend);
  }

  private calculateActiveRooms(): number {
    // Would be implemented to count active DAW rooms
    return 0;
  }

  private calculateTotalUsers(): number {
    // Would be implemented to count total active users
    return 0;
  }

  private calculateAverageLatency(type: 'audio' | 'sync'): number {
    // Would calculate average latency from metrics
    return 0;
  }

  private calculateErrorRate(): number {
    // Would calculate error rate from metrics
    return 0;
  }

  private calculateTotalErrors(): number {
    // Would calculate total errors from metrics
    return 0;
  }

  private getChartData(metric: string): Array<{ time: string; value: number }> {
    const trend = this.performanceTrends.get(metric);
    if (!trend) return [];

    return trend.data.slice(-20).map(d => ({
      time: d.timestamp.toISOString(),
      value: d.value
    }));
  }

  private formatUptime(uptimeMs: number): string {
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else {
      return `${minutes}m ${seconds % 60}s`;
    }
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const health = this.healthStatus;

    if (health.components.audio === 'warning' || health.components.audio === 'critical') {
      recommendations.push('Consider optimizing audio buffer sizes or reducing audio processing load');
    }

    if (health.components.collaboration === 'warning' || health.components.collaboration === 'critical') {
      recommendations.push('Check network connectivity and WebRTC configuration');
    }

    if (health.components.system === 'warning' || health.components.system === 'critical') {
      recommendations.push('Monitor server resources and consider scaling up infrastructure');
    }

    if (health.metrics.errorRate > 0.05) {
      recommendations.push('Investigate high error rate and implement additional error handling');
    }

    if (recommendations.length === 0) {
      recommendations.push('System is operating normally');
    }

    return recommendations;
  }
}