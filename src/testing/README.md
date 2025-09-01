# Migration Testing Infrastructure

This directory contains a comprehensive testing infrastructure for architecture migration, implementing all requirements from task 1 of the architecture refactoring specification.

## 🎯 Completed Implementation

### ✅ 1.1 Parallel Testing Harness
- **ParallelTestHarness**: Compare old vs new implementations side-by-side
- **MockSocket & MockSocketFactory**: Controllable socket interfaces for testing
- **TestEnvironment**: Isolated testing scenarios with HTTP support
- **Result comparison and validation logic**: Deep equality checks and performance metrics

### ✅ 1.2 HTTPS Testing Environment  
- **HTTPSTestEnvironment**: SSL-enabled testing with existing certificates
- **FrontendHTTPSConfigManager**: Generate Vite and Jest configurations for HTTPS
- **WebRTC HTTPS testing**: Validate mesh connections work with SSL certificates
- **mkcert compatibility**: Support for development certificates

### ✅ 1.3 Performance Monitoring & Regression Detection
- **PerformanceMonitor**: Track response times, memory usage, and custom metrics
- **RegressionDetector**: Automated detection of performance and functional regressions
- **Baseline calculation**: Statistical analysis with standard deviation
- **Automated alerts**: Configurable thresholds and regression detection

### ✅ 1.4 Migration Dashboard with Rollback
- **MigrationDashboard**: Real-time monitoring with rollback capabilities
- **DashboardServer**: HTTP server with REST API and Server-Sent Events
- **HTML Dashboard**: Live updating web interface
- **Rollback triggers**: Automatic rollback on critical failures

## 🚀 Quick Start

```typescript
import { 
  TestEnvironment, 
  ParallelTestHarness, 
  PerformanceMonitor,
  RegressionDetector,
  MigrationDashboard,
  DashboardServer
} from './testing';

// Initialize infrastructure
const testEnv = new TestEnvironment();
const testHarness = new ParallelTestHarness();
const perfMonitor = new PerformanceMonitor();
const regressionDetector = new RegressionDetector(perfMonitor, testHarness);
const dashboard = new MigrationDashboard(perfMonitor, regressionDetector, testHarness);
const dashboardServer = new DashboardServer(dashboard);

// Start testing
await testEnv.initialize();
await dashboardServer.start();

// Register implementations for comparison
testHarness.registerImplementations(oldImplementation, newImplementation);

// Run parallel tests
const result = await testHarness.executeParallel('methodName', [args]);

// Access dashboard at http://localhost:3002
```

## 📁 File Structure

```
src/testing/
├── ParallelTestHarness.ts          # Core parallel testing functionality
├── MockSocket.ts                   # Mock socket implementations
├── TestEnvironment.ts              # HTTP test environment
├── HTTPSTestEnvironment.ts         # HTTPS test environment with SSL
├── PerformanceMonitor.ts           # Performance metrics and monitoring
├── RegressionDetector.ts           # Automated regression detection
├── MigrationDashboard.ts           # Real-time dashboard with rollback
├── DashboardServer.ts              # HTTP server for dashboard
├── FrontendHTTPSConfig.ts          # Frontend HTTPS configuration
├── examples/
│   └── MigrationTestingExample.ts  # Complete usage example
├── __tests__/
│   ├── ParallelTestHarness.test.ts
│   ├── PerformanceMonitor.test.ts
│   ├── MigrationDashboard.test.ts
│   └── HTTPSTestEnvironment.test.ts
└── index.ts                        # Main exports
```

## 🔧 Features

### Parallel Testing
- Side-by-side execution of old vs new implementations
- Deep equality comparison with detailed diff reporting
- Performance measurement (execution time, memory usage)
- Error handling and graceful failure recovery

### HTTPS Testing
- SSL certificate management (existing + self-signed generation)
- WebRTC testing over HTTPS with proper certificate validation
- Frontend configuration generation (Vite, Jest)
- mkcert compatibility validation

### Performance Monitoring
- Real-time metrics collection (response time, memory, CPU)
- Configurable thresholds with violation alerts
- Baseline calculation with statistical analysis
- Regression detection with percentage thresholds

### Migration Dashboard
- Real-time web interface showing migration progress
- Performance metrics visualization
- Error and warning tracking
- Automatic rollback triggers on critical failures
- REST API for programmatic access
- Server-Sent Events for live updates

## 🧪 Testing

All components include comprehensive test coverage:

```bash
# Run all testing infrastructure tests
npm test -- src/testing/__tests__

# Run specific test with cleanup verification
npm test -- src/testing/__tests__/ParallelTestHarness.test.ts --forceExit
```

## 📊 Dashboard API

The migration dashboard provides several endpoints:

- `GET /` - HTML dashboard interface
- `GET /api/dashboard` - Complete dashboard data (JSON)
- `GET /api/status` - Migration status only
- `GET /api/metrics` - Performance metrics
- `POST /api/rollback` - Trigger manual rollback
- `GET /api/stream` - Server-Sent Events stream

## 🔄 Rollback System

The dashboard includes automatic rollback capabilities:

- **Critical Failures**: Automatic rollback after 3 critical alerts
- **Performance Regression**: Rollback on >50% performance degradation  
- **Functional Failures**: Rollback after 5 functional test failures
- **Manual Rollback**: Dashboard button for immediate rollback

## 🎛️ Configuration

### Performance Thresholds
```typescript
monitor.setThreshold('response_time', 100, 'ms');
monitor.setThreshold('memory_usage', 50, 'MB');
monitor.setThreshold('webrtc_connection_time', 2000, 'ms');
```

### Rollback Thresholds
```typescript
const dashboard = new MigrationDashboard(monitor, detector, harness, {
  rollbackThresholds: {
    criticalFailures: 3,
    performanceRegressionPercent: 50,
    functionalFailures: 5
  }
});
```

## 🔗 Integration

This infrastructure integrates with:
- Existing RoomHandlers.ts for baseline testing
- Socket.IO namespaces for WebRTC testing
- SSL certificates in `.ssl/` directory
- Frontend Vite configuration for HTTPS development

## 📈 Requirements Satisfied

- ✅ **7.1, 7.2**: Parallel testing with result comparison and validation
- ✅ **8.1, 8.4**: HTTPS testing environment with SSL certificates  
- ✅ **8.1, 8.2**: Performance monitoring and regression detection
- ✅ **7.2, 11.4**: Migration dashboard with rollback capabilities

The infrastructure is now ready to support the architecture refactoring process with comprehensive testing, monitoring, and safety mechanisms.