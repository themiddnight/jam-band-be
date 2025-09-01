# Performance Monitoring and Regression Detection System

This directory contains a comprehensive performance monitoring and regression detection system designed specifically for the architecture refactoring migration. The system provides automated performance monitoring, regression detection, and alerting capabilities.

## Overview

The performance monitoring system consists of several key components:

1. **PerformanceMonitor** - Core metrics collection and threshold monitoring
2. **RegressionDetector** - Automated regression detection and testing
3. **ParallelTestHarness** - Side-by-side comparison of old vs new implementations
4. **PerformanceMonitoringService** - Integrated service that orchestrates all components
5. **Setup utilities** - Easy configuration and integration helpers

## Key Features

### 🔍 Real-time Performance Monitoring
- Automatic metrics collection for response times, memory usage, CPU usage
- Configurable performance thresholds with automatic violation detection
- Baseline calculation and statistical analysis
- Real-time alerting for performance degradation

### 📊 Regression Detection
- Automated comparison between old and new implementations
- Statistical regression detection using baseline analysis
- Configurable regression thresholds (performance and functional)
- Comprehensive test reporting with recommendations

### 🚨 Automated Alerting
- Multi-channel alerting (console, file, webhook, email)
- Configurable alert severity levels (warning, critical)
- Alert cooldown periods to prevent spam
- Structured alert data for integration with monitoring systems

### 🧪 Migration Testing
- Parallel execution of old vs new implementations
- Performance and functional equivalence testing
- Memory usage and execution time comparison
- Automated test suite for handler migration

## Quick Start

### Basic Usage

```typescript
import { setupMigrationPerformanceMonitoring } from './setupPerformanceMonitoring';

// Initialize monitoring service
const monitoringService = setupMigrationPerformanceMonitoring({
  enableRealTimeMonitoring: true,
  enableRegressionTesting: true,
  enableAutomatedAlerts: true
});

// Start monitoring
monitoringService.start();

// Record performance metrics
monitoringService.recordMetric('response_time', 85, 'ms', {
  endpoint: '/api/rooms',
  method: 'POST'
});

// Generate performance report
const report = monitoringService.generateReport();
console.log('Performance Summary:', report.summary);
```

### Running Tests

```bash
# Run performance monitoring test
bun run test:performance

# Run integration tests
bun test src/testing/__tests__/PerformanceMonitoringIntegration.test.ts --run

# Run core performance monitor tests
bun test src/testing/__tests__/PerformanceMonitor.test.ts --run
```

## Configuration

### Performance Thresholds

```typescript
const config = {
  performanceThresholds: {
    responseTime: 100,        // 100ms max response time
    memoryUsage: 50,          // 50MB max memory increase
    cpuUsage: 80,             // 80% max CPU usage
    websocketLatency: 50,     // 50ms max WebSocket latency
    webrtcConnectionTime: 2000 // 2s max WebRTC connection time
  }
};
```

### Regression Thresholds

```typescript
const config = {
  regressionThresholds: {
    performanceRegression: 20,    // 20% performance regression threshold
    memoryRegression: 30,         // 30% memory regression threshold
    criticalRegressionThreshold: 50 // 50% critical regression threshold
  }
};
```

### Alerting Configuration

```typescript
const config = {
  alerting: {
    console: {
      enabled: true,
      logLevel: 'warn'
    },
    file: {
      enabled: true,
      logPath: './logs/performance-alerts.log',
      maxFileSize: 10 * 1024 * 1024 // 10MB
    },
    webhook: {
      enabled: true,
      url: 'https://hooks.slack.com/services/...',
      headers: { 'Content-Type': 'application/json' }
    }
  }
};
```

## Architecture

### Component Relationships

```
PerformanceMonitoringService
├── PerformanceMonitor (metrics collection & thresholds)
├── RegressionDetector (automated regression testing)
├── ParallelTestHarness (old vs new comparison)
└── AlertingSystem (multi-channel notifications)
```

### Data Flow

1. **Metric Collection**: Performance metrics are recorded during system operation
2. **Baseline Calculation**: Statistical baselines are automatically calculated
3. **Threshold Monitoring**: Real-time comparison against configured thresholds
4. **Regression Detection**: Statistical analysis to detect performance regressions
5. **Alert Generation**: Automated alerts for violations and regressions
6. **Report Generation**: Comprehensive performance reports with recommendations

## Migration Integration

### Handler Migration Testing

The system includes pre-configured regression tests for the architecture refactoring:

- **Room Creation Performance**: Tests room creation handler performance
- **Voice Connection Performance**: Tests WebRTC connection establishment
- **Member Management Performance**: Tests user join/leave operations
- **Audio Routing Performance**: Tests audio parameter updates

### Automated Migration Monitoring

```typescript
// Setup monitoring for migration
const monitoringService = setupMigrationPerformanceMonitoring({
  enableRealTimeMonitoring: true,
  enableRegressionTesting: true,
  enableAutomatedAlerts: true,
  alertWebhookUrl: 'https://your-webhook-url'
});

// Run regression tests
await runMigrationRegressionTests(monitoringService);
```

## API Reference

### PerformanceMonitoringService

#### Methods

- `start()` - Start the monitoring service
- `stop()` - Stop the monitoring service
- `recordMetric(name, value, unit, context?)` - Record a performance metric
- `generateReport()` - Generate comprehensive performance report
- `getConfiguration()` - Get current configuration
- `updateConfiguration(config)` - Update configuration
- `cleanup()` - Cleanup resources

#### Events

- `started` - Emitted when service starts
- `stopped` - Emitted when service stops
- `alert` - Emitted when performance alert is triggered

### PerformanceMonitor

#### Methods

- `recordMetric(name, value, unit, context?)` - Record a metric
- `setThreshold(name, maxValue, unit, enabled?)` - Set performance threshold
- `getMetrics(name, limit?)` - Get metrics for a specific name
- `getBaseline(name)` - Get baseline statistics
- `exportMetrics()` - Export all metrics data
- `clearMetrics()` - Clear all metrics

#### Events

- `metricRecorded` - Emitted when metric is recorded
- `thresholdViolation` - Emitted when threshold is violated
- `regressionDetected` - Emitted when regression is detected

### RegressionDetector

#### Methods

- `registerTest(test)` - Register a regression test
- `runAllTests()` - Run all registered tests
- `generateSummary()` - Generate test summary
- `getTestReports(limit?)` - Get test reports
- `clearHistory()` - Clear test history

## Best Practices

### 1. Metric Naming

Use consistent, descriptive metric names:

```typescript
// Good
monitoringService.recordMetric('room_creation_time', 45, 'ms');
monitoringService.recordMetric('webrtc_connection_latency', 120, 'ms');

// Avoid
monitoringService.recordMetric('time', 45, 'ms');
monitoringService.recordMetric('latency', 120, 'ms');
```

### 2. Context Information

Include relevant context with metrics:

```typescript
monitoringService.recordMetric('api_response_time', 85, 'ms', {
  endpoint: '/api/rooms',
  method: 'POST',
  userId: 'user123',
  roomId: 'room456'
});
```

### 3. Threshold Configuration

Set realistic thresholds based on your system requirements:

```typescript
// For real-time audio applications
const audioConfig = {
  performanceThresholds: {
    audioLatency: 20,        // 20ms for real-time audio
    webrtcConnectionTime: 1000, // 1s max connection time
    memoryUsage: 100         // 100MB for audio processing
  }
};
```

### 4. Alert Management

Configure appropriate alert channels and cooldown periods:

```typescript
const alertConfig = {
  alerting: {
    console: { enabled: true, logLevel: 'warn' },
    file: { enabled: true, logPath: './logs/alerts.log' },
    webhook: { 
      enabled: true, 
      url: process.env.SLACK_WEBHOOK_URL 
    }
  },
  monitoring: {
    alertCooldownPeriod: 300000 // 5 minutes
  }
};
```

## Troubleshooting

### Common Issues

#### High Memory Usage
```typescript
// Check memory metrics
const report = monitoringService.generateReport();
console.log('Memory metrics:', report.metrics.memoryUsage);

// Clear old metrics if needed
monitoringService.getPerformanceMonitor().clearMetrics();
```

#### False Positive Alerts
```typescript
// Adjust thresholds
monitoringService.updateConfiguration({
  performanceThresholds: {
    responseTime: 150 // Increase threshold
  }
});

// Increase cooldown period
monitoringService.updateConfiguration({
  monitoring: {
    alertCooldownPeriod: 600000 // 10 minutes
  }
});
```

#### Missing Regression Detection
```typescript
// Ensure enough baseline samples
for (let i = 0; i < 20; i++) {
  monitoringService.recordMetric('baseline_metric', 50, 'ms');
}

// Wait for baseline calculation
await new Promise(resolve => setTimeout(resolve, 1000));

// Then record test metric
monitoringService.recordMetric('baseline_metric', 100, 'ms');
```

## Performance Impact

The monitoring system is designed to have minimal performance impact:

- **Memory Usage**: ~5-10MB for typical workloads
- **CPU Overhead**: <1% for metric recording
- **Storage**: Configurable metric retention (default: 7 days)
- **Network**: Optional webhook alerts only

## Integration Examples

### Express.js Integration

```typescript
import { createPerformanceMiddleware } from './setupPerformanceMonitoring';

const middleware = createPerformanceMiddleware(monitoringService);

app.use(middleware.httpMiddleware);
```

### Socket.IO Integration

```typescript
const middleware = createPerformanceMiddleware(monitoringService);

io.use(middleware.socketMiddleware);
```

### Custom Handler Integration

```typescript
class RoomHandler {
  async handleCreateRoom(socket, data) {
    const startTime = Date.now();
    
    try {
      const result = await this.createRoom(data);
      
      // Record success metric
      monitoringService.recordMetric('room_creation_time', 
        Date.now() - startTime, 'ms', {
          success: true,
          roomType: data.isPrivate ? 'private' : 'public'
        });
      
      return result;
    } catch (error) {
      // Record error metric
      monitoringService.recordMetric('room_creation_time', 
        Date.now() - startTime, 'ms', {
          success: false,
          error: error.message
        });
      
      throw error;
    }
  }
}
```

## Contributing

When adding new performance monitoring features:

1. Add comprehensive tests
2. Update configuration interfaces
3. Document new metrics and thresholds
4. Include integration examples
5. Update this README

## License

This performance monitoring system is part of the jam-band project and follows the same license terms.