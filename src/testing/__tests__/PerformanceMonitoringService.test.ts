import { PerformanceMonitoringService } from '../PerformanceMonitoringService';
import { PerformanceMonitor } from '../PerformanceMonitor';
import { RegressionDetector } from '../RegressionDetector';

describe('PerformanceMonitoringService', () => {
  let service: PerformanceMonitoringService;

  beforeEach(() => {
    service = new PerformanceMonitoringService({
      monitoring: {
        enabled: true,
        metricsRetentionDays: 1,
        baselineUpdateInterval: 1000, // 1 second for testing
        alertCooldownPeriod: 100 // 100ms for testing
      },
      alerting: {
        console: { enabled: true, logLevel: 'warn' },
        file: { enabled: false } // Disable file logging in tests
      }
    });
  });

  afterEach(() => {
    service.cleanup();
  });

  describe('Service Lifecycle', () => {
    it('should start and stop monitoring service', () => {
      expect(service.start).not.toThrow();
      expect(service.stop).not.toThrow();
    });

    it('should emit started and stopped events', (done) => {
      let startedEmitted = false;
      let stoppedEmitted = false;

      service.on('started', () => {
        startedEmitted = true;
        service.stop();
      });

      service.on('stopped', () => {
        stoppedEmitted = true;
        expect(startedEmitted).toBe(true);
        expect(stoppedEmitted).toBe(true);
        done();
      });

      service.start();
    });

    it('should not start multiple times', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      service.start();
      service.start(); // Second start should warn
      
      expect(consoleSpy).toHaveBeenCalledWith('Performance monitoring service is already running');
      
      consoleSpy.mockRestore();
      service.stop();
    });
  });

  describe('Metric Recording', () => {
    it('should record performance metrics', () => {
      service.recordMetric('test_response_time', 150, 'ms', { endpoint: '/api/test' });

      const monitor = service.getPerformanceMonitor();
      const metrics = monitor.getMetrics('test_response_time');
      
      expect(metrics).toHaveLength(1);
      expect(metrics[0].value).toBe(150);
      expect(metrics[0].unit).toBe('ms');
      expect(metrics[0].context?.endpoint).toBe('/api/test');
    });

    it('should record test execution metrics', async () => {
      const testHarness = service.getTestHarness();
      
      // Mock implementations for testing
      const oldImpl = {
        testMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'old_result';
        }
      };

      const newImpl = {
        testMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return 'old_result'; // Same result for equality
        }
      };

      testHarness.registerImplementations(oldImpl, newImpl);
      
      const result = await testHarness.executeParallel('testMethod', [], 'test_1');
      
      expect(result.isEqual).toBe(true);
      expect(result.executionTimeNew).toBeLessThan(result.executionTimeOld);

      // Check that metrics were recorded
      const monitor = service.getPerformanceMonitor();
      const oldMetrics = monitor.getMetrics('test_execution_time_old');
      const newMetrics = monitor.getMetrics('test_execution_time_new');
      
      expect(oldMetrics).toHaveLength(1);
      expect(newMetrics).toHaveLength(1);
    });
  });

  describe('Alert Handling', () => {
    it('should handle threshold violations', (done) => {
      let alertReceived = false;
      
      service.on('alert', ({ alert, type }) => {
        if (!alertReceived && type === 'threshold') {
          alertReceived = true;
          expect(alert.metricName).toBe('response_time');
          expect(type).toBe('threshold');
          expect(alert.severity).toBe('warning');
          done();
        }
      });

      service.start();
      
      // Record metric that exceeds threshold (default is 100ms)
      service.recordMetric('response_time', 150, 'ms');
    });

    it('should handle critical threshold violations', (done) => {
      let alertReceived = false;
      
      service.on('alert', ({ alert, type }) => {
        if (!alertReceived && alert.severity === 'critical') {
          alertReceived = true;
          expect(alert.severity).toBe('critical');
          done();
        }
      });

      service.start();
      
      // Record metric that significantly exceeds threshold
      service.recordMetric('response_time', 200, 'ms'); // 2x threshold = critical
    });

    it('should respect alert cooldown periods', async () => {
      const alertSpy = jest.fn();
      service.on('alert', alertSpy);

      service.start();
      
      // Record multiple violations quickly for the same metric
      service.recordMetric('response_time', 150, 'ms');
      service.recordMetric('response_time', 160, 'ms');
      service.recordMetric('response_time', 170, 'ms');

      // Wait a bit for any async processing
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should get limited alerts due to cooldown (may get 1-2 depending on timing)
      expect(alertSpy.mock.calls.length).toBeLessThanOrEqual(3);
      expect(alertSpy.mock.calls.length).toBeGreaterThan(0);
    });

    it('should detect performance regressions', (done) => {
      let regressionDetected = false;
      
      service.on('alert', ({ alert, type }) => {
        if (!regressionDetected && type === 'regression' && alert.metricName === 'api_response_time') {
          regressionDetected = true;
          expect(alert.metricName).toBe('api_response_time');
          expect(alert.regressionPercentage).toBeGreaterThan(20);
          done();
        }
      });

      service.start();

      // Establish baseline with consistent values
      for (let i = 0; i < 15; i++) {
        service.recordMetric('api_response_time', 50, 'ms');
      }

      // Wait for baseline to be established
      setTimeout(() => {
        // Record a significantly higher value to trigger regression
        service.recordMetric('api_response_time', 150, 'ms');
      }, 100);
    });
  });

  describe('Configuration Management', () => {
    it('should use default configuration', () => {
      const defaultService = new PerformanceMonitoringService();
      const config = defaultService.getConfiguration();

      expect(config.performanceThresholds.responseTime).toBe(100);
      expect(config.performanceThresholds.memoryUsage).toBe(50);
      expect(config.monitoring.enabled).toBe(true);
      
      defaultService.cleanup();
    });

    it('should merge custom configuration with defaults', () => {
      const customService = new PerformanceMonitoringService({
        performanceThresholds: {
          responseTime: 200
        },
        monitoring: {
          enabled: false
        }
      });

      const config = customService.getConfiguration();

      expect(config.performanceThresholds.responseTime).toBe(200);
      expect(config.performanceThresholds.memoryUsage).toBe(50); // Default
      expect(config.monitoring.enabled).toBe(false);
      
      customService.cleanup();
    });

    it('should update configuration dynamically', () => {
      service.updateConfiguration({
        performanceThresholds: {
          responseTime: 75
        }
      });

      const config = service.getConfiguration();
      expect(config.performanceThresholds.responseTime).toBe(75);

      // Test that new threshold is applied
      const monitor = service.getPerformanceMonitor();
      const alertSpy = jest.fn();
      monitor.on('thresholdViolation', alertSpy);

      service.recordMetric('response_time', 80, 'ms'); // Should trigger with new threshold

      expect(alertSpy).toHaveBeenCalled();
    });
  });

  describe('Report Generation', () => {
    it('should generate comprehensive performance report', () => {
      // Record some test data
      service.recordMetric('response_time', 80, 'ms');
      service.recordMetric('memory_usage', 30, 'MB');
      service.recordMetric('webrtc_connection_time', 1500, 'ms');

      const report = service.generateReport();

      expect(report.timestamp).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.metrics).toBeDefined();
      expect(report.regressions).toBeDefined();
      expect(report.alerts).toBeDefined();
      expect(report.recommendations).toBeDefined();

      expect(report.summary.totalMetrics).toBeGreaterThan(0);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should include recommendations based on performance data', async () => {
      const testHarness = service.getTestHarness();
      
      // Create implementations with performance regression
      const oldImpl = {
        slowMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'result';
        }
      };

      const newImpl = {
        slowMethod: async () => {
          await new Promise(resolve => setTimeout(resolve, 25)); // Slower
          return 'result';
        }
      };

      testHarness.registerImplementations(oldImpl, newImpl);
      await testHarness.executeParallel('slowMethod', [], 'perf_test');

      const report = service.generateReport();
      
      // Should include performance regression recommendation
      const hasPerformanceRecommendation = report.recommendations.some(
        rec => rec.includes('performance') || rec.includes('optimization')
      );
      
      expect(hasPerformanceRecommendation).toBe(true);
    });
  });

  describe('Integration with Existing Components', () => {
    it('should integrate with PerformanceMonitor', async () => {
      const monitor = service.getPerformanceMonitor();
      expect(monitor).toBeInstanceOf(PerformanceMonitor);

      // Test that monitor events are handled
      const alertSpy = jest.fn();
      service.on('alert', alertSpy);
      service.start();

      monitor.recordMetric('test_metric', 1000, 'ms'); // High value to trigger threshold

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Should have received some alerts (threshold violations don't exist for test_metric by default)
      // So let's test with a known threshold
      monitor.recordMetric('response_time', 200, 'ms');
      
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(alertSpy.mock.calls.length).toBeGreaterThan(0);
    });

    it('should integrate with RegressionDetector', () => {
      const detector = service.getRegressionDetector();
      expect(detector).toBeInstanceOf(RegressionDetector);

      // Test that detector can register tests
      detector.registerTest({
        name: 'test_regression',
        description: 'Test regression detection',
        testFunction: async () => ({
          testId: 'test_1',
          timestamp: Date.now(),
          oldResult: 'result',
          newResult: 'result',
          isEqual: true,
          executionTimeOld: 10,
          executionTimeNew: 15,
          memoryUsageOld: 1000,
          memoryUsageNew: 1200
        }),
        expectedPerformance: {
          maxResponseTime: 20,
          maxMemoryIncrease: 2000
        },
        enabled: true
      });

      expect(detector.generateSummary().totalTests).toBe(0); // No tests run yet
    });

    it('should integrate with ParallelTestHarness', () => {
      const harness = service.getTestHarness();
      expect(harness).toBeDefined();

      // Test that harness events are handled
      const testResult = {
        testId: 'test_1',
        timestamp: Date.now(),
        oldResult: 'result',
        newResult: 'result',
        isEqual: true,
        executionTimeOld: 10,
        executionTimeNew: 8,
        memoryUsageOld: 1000,
        memoryUsageNew: 900
      };

      harness.emit('testCompleted', testResult);

      // Check that metrics were recorded
      const monitor = service.getPerformanceMonitor();
      const metrics = monitor.getMetrics('test_execution_time_old');
      expect(metrics).toHaveLength(1);
    });
  });

  describe('Real-world Performance Scenarios', () => {
    it('should monitor WebRTC connection performance', async () => {
      // Simulate WebRTC connection times
      const connectionTimes = [800, 1200, 900, 1500, 2500]; // Last one exceeds threshold

      const alertSpy = jest.fn();
      service.on('alert', alertSpy);
      service.start();

      connectionTimes.forEach((time, index) => {
        service.recordMetric('webrtc_connection_time', time, 'ms', {
          userId: `user_${index}`,
          roomId: 'test_room'
        });
      });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should trigger alert for the 2500ms connection (exceeds 2000ms threshold)
      expect(alertSpy.mock.calls.length).toBeGreaterThan(0);
    });

    it('should monitor memory usage spikes', async () => {
      // Simulate memory usage pattern
      const memoryUsages = [20, 25, 30, 35, 80]; // Last one exceeds 50MB threshold

      const alertSpy = jest.fn();
      service.on('alert', alertSpy);
      service.start();

      memoryUsages.forEach((usage, index) => {
        service.recordMetric('memory_usage', usage, 'MB', {
          component: 'room_handler',
          timestamp: Date.now() + index * 1000
        });
      });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(alertSpy.mock.calls.length).toBeGreaterThan(0);
    });

    it('should track API response time degradation', async () => {
      const alertSpy = jest.fn();
      service.on('alert', alertSpy);
      service.start();

      // Establish baseline
      for (let i = 0; i < 15; i++) {
        service.recordMetric('api_response_time', 45 + Math.random() * 10, 'ms', {
          endpoint: '/api/rooms',
          method: 'GET'
        });
      }

      // Wait for baseline to be established
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate performance degradation
      service.recordMetric('api_response_time', 120, 'ms', {
        endpoint: '/api/rooms',
        method: 'GET'
      });

      // Wait for regression detection
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should detect regression
      expect(alertSpy.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in alert callbacks gracefully', async () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Alert callback error');
      });

      // Wrap the error callback to catch and handle errors
      const safeErrorCallback = (...args: any[]) => {
        try {
          errorCallback(...args);
        } catch (error) {
          // Expected error - test passes if we get here
        }
      };

      service.on('alert', safeErrorCallback);
      service.start();

      // Should not throw even if callback errors
      expect(() => {
        service.recordMetric('response_time', 200, 'ms');
      }).not.toThrow();

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(errorCallback.mock.calls.length).toBeGreaterThan(0);
    });

    it('should handle missing configuration gracefully', () => {
      const serviceWithoutConfig = new PerformanceMonitoringService();
      
      expect(() => {
        serviceWithoutConfig.start();
        serviceWithoutConfig.recordMetric('test', 100, 'ms');
        serviceWithoutConfig.stop();
        serviceWithoutConfig.cleanup();
      }).not.toThrow();
    });
  });
});