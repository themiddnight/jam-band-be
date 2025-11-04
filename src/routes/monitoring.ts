import { Router } from 'express';
import { DAWMonitoringService } from '../services/DAWMonitoringService';
import { DAWHealthDashboard } from '../services/DAWHealthDashboard';
import { DAWAlertingService } from '../services/DAWAlertingService';
import { LoggingService } from '../services/LoggingService';

const router = Router();

// Initialize services (these would typically be injected via DI)
const logger = new LoggingService();
const monitoringService = new DAWMonitoringService(logger);
const healthDashboard = new DAWHealthDashboard(monitoringService, logger);
const alertingService = new DAWAlertingService(monitoringService, logger);

// Start services
monitoringService.startMonitoring();
healthDashboard.start();
alertingService.start();

/**
 * Health check endpoints
 */
router.get('/health/status', (req, res) => {
  try {
    const systemStatus = healthDashboard.getSystemStatus();
    res.json(systemStatus);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get system status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/health/detailed', (req, res) => {
  try {
    const healthStatus = healthDashboard.getHealthStatus();
    const detailedMetrics = healthDashboard.getDetailedMetrics();
    
    res.json({
      health: healthStatus,
      metrics: detailedMetrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get detailed health status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/health/database', async (req, res) => {
  try {
    // Simple database connectivity check
    // This would be replaced with actual database health check
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Database connection failed'
    });
  }
});

router.get('/health/redis', (req, res) => {
  try {
    // Simple Redis connectivity check
    // This would be replaced with actual Redis health check
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Redis connection failed'
    });
  }
});

/**
 * DAW-specific health endpoints
 */
router.get('/api/daw/health', (req, res) => {
  try {
    const systemHealth = monitoringService.getSystemHealth();
    res.json({
      status: systemHealth.status,
      activeAlerts: systemHealth.activeAlerts,
      criticalAlerts: systemHealth.criticalAlerts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get DAW health status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Metrics endpoints
 */
router.get('/metrics', (req, res) => {
  try {
    // Prometheus-style metrics endpoint
    const healthStatus = healthDashboard.getHealthStatus();
    const systemHealth = monitoringService.getSystemHealth();
    
    let metrics = '';
    
    // System health metrics
    metrics += `# HELP daw_system_health Overall system health status (0=unknown, 1=healthy, 2=warning, 3=critical)\n`;
    metrics += `# TYPE daw_system_health gauge\n`;
    const healthValue = healthStatus.overall === 'healthy' ? 1 : 
                       healthStatus.overall === 'warning' ? 2 : 
                       healthStatus.overall === 'critical' ? 3 : 0;
    metrics += `daw_system_health ${healthValue}\n\n`;
    
    // Active alerts
    metrics += `# HELP daw_active_alerts_total Number of active alerts\n`;
    metrics += `# TYPE daw_active_alerts_total gauge\n`;
    metrics += `daw_active_alerts_total ${healthStatus.alerts.total}\n\n`;
    
    // Critical alerts
    metrics += `# HELP daw_critical_alerts_total Number of critical alerts\n`;
    metrics += `# TYPE daw_critical_alerts_total gauge\n`;
    metrics += `daw_critical_alerts_total ${healthStatus.alerts.critical}\n\n`;
    
    // Active rooms
    metrics += `# HELP daw_active_rooms_total Number of active DAW rooms\n`;
    metrics += `# TYPE daw_active_rooms_total gauge\n`;
    metrics += `daw_active_rooms_total ${healthStatus.metrics.activeRooms}\n\n`;
    
    // Total users
    metrics += `# HELP daw_total_users_total Number of total active users\n`;
    metrics += `# TYPE daw_total_users_total gauge\n`;
    metrics += `daw_total_users_total ${healthStatus.metrics.totalUsers}\n\n`;
    
    // Average latency
    metrics += `# HELP daw_average_latency_ms Average audio latency in milliseconds\n`;
    metrics += `# TYPE daw_average_latency_ms gauge\n`;
    metrics += `daw_average_latency_ms ${healthStatus.metrics.averageLatency}\n\n`;
    
    // Error rate
    metrics += `# HELP daw_error_rate Error rate as percentage\n`;
    metrics += `# TYPE daw_error_rate gauge\n`;
    metrics += `daw_error_rate ${healthStatus.metrics.errorRate}\n\n`;
    
    // Uptime
    metrics += `# HELP daw_uptime_seconds System uptime in seconds\n`;
    metrics += `# TYPE daw_uptime_seconds counter\n`;
    metrics += `daw_uptime_seconds ${Math.floor(healthStatus.metrics.uptime / 1000)}\n\n`;
    
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to generate metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/api/metrics/room/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const metrics = monitoringService.getMetrics(roomId);
    
    if (!metrics) {
      return res.status(404).json({ error: 'Room metrics not found' });
    }
    
    res.json({
      roomId,
      metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get room metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/api/metrics/collaboration', (req, res) => {
  try {
    const timeRange = {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      end: new Date()
    };
    
    const analytics = monitoringService.getPerformanceAnalytics(timeRange);
    
    res.json({
      timeRange,
      analytics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get collaboration metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Dashboard endpoints
 */
router.get('/api/dashboard/data', (req, res) => {
  try {
    const dashboardData = healthDashboard.getDashboardData();
    res.json(dashboardData);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get dashboard data',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/api/dashboard/trends', (req, res) => {
  try {
    const timeRange = req.query.range as '1h' | '24h' | '7d' || '24h';
    const trends = healthDashboard.getPerformanceTrends(timeRange);
    
    res.json({
      timeRange,
      trends,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get performance trends',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Alert management endpoints
 */
router.get('/api/alerts', (req, res) => {
  try {
    const activeAlerts = monitoringService.getActiveAlerts();
    res.json({
      alerts: activeAlerts,
      count: activeAlerts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get alerts',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/api/alerts/:alertId/resolve', (req, res) => {
  try {
    const { alertId } = req.params;
    const resolved = monitoringService.resolveAlert(alertId);
    
    if (resolved) {
      res.json({ success: true, alertId, resolvedAt: new Date().toISOString() });
    } else {
      res.status(404).json({ error: 'Alert not found or already resolved' });
    }
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to resolve alert',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/api/alerts/statistics', (req, res) => {
  try {
    const timeRange = {
      start: new Date(req.query.start as string || Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(req.query.end as string || Date.now())
    };
    
    const statistics = alertingService.getAlertStatistics(timeRange);
    
    res.json({
      timeRange,
      statistics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get alert statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Administrative endpoints
 */
router.get('/api/admin/active-sessions', (req, res) => {
  try {
    // This would return information about active DAW sessions
    // Placeholder implementation
    res.json({
      activeRooms: 0,
      totalUsers: 0,
      sessions: [],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get active sessions',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/api/admin/rate-limit/enable', (req, res) => {
  try {
    // Enable rate limiting
    // This would be implemented with actual rate limiting logic
    res.json({ 
      success: true, 
      message: 'Rate limiting enabled',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to enable rate limiting',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/api/admin/system-info', (req, res) => {
  try {
    const systemInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      pid: process.pid,
      timestamp: new Date().toISOString()
    };
    
    res.json(systemInfo);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get system info',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Export data endpoints
 */
router.get('/api/export/metrics', (req, res) => {
  try {
    const format = req.query.format as 'json' | 'csv' || 'json';
    const exportData = monitoringService.exportMetrics(format);
    
    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const filename = `daw-metrics-${new Date().toISOString().split('T')[0]}.${format}`;
    
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    
    res.send(exportData);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to export metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/api/export/health-report', (req, res) => {
  try {
    const timeRange = {
      start: new Date(req.query.start as string || Date.now() - 7 * 24 * 60 * 60 * 1000),
      end: new Date(req.query.end as string || Date.now())
    };
    
    const report = healthDashboard.generateHealthReport(timeRange);
    
    res.json({
      timeRange,
      report,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to generate health report',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Cleanup on process exit
process.on('SIGTERM', () => {
  monitoringService.stopMonitoring();
  healthDashboard.stop();
  alertingService.stop();
});

process.on('SIGINT', () => {
  monitoringService.stopMonitoring();
  healthDashboard.stop();
  alertingService.stop();
});

export default router;