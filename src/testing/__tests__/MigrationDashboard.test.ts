import { MigrationDashboard } from '../MigrationDashboard';
import { PerformanceMonitor } from '../PerformanceMonitor';
import { RegressionDetector } from '../RegressionDetector';
import { ParallelTestHarness } from '../ParallelTestHarness';

describe('MigrationDashboard', () => {
  let dashboard: MigrationDashboard;
  let performanceMonitor: PerformanceMonitor;
  let regressionDetector: RegressionDetector;
  let testHarness: ParallelTestHarness;

  beforeEach(() => {
    performanceMonitor = new PerformanceMonitor();
    testHarness = new ParallelTestHarness();
    regressionDetector = new RegressionDetector(performanceMonitor, testHarness);
    
    dashboard = new MigrationDashboard(
      performanceMonitor,
      regressionDetector,
      testHarness,
      {
        refreshInterval: 100, // Fast refresh for testing
        enableRealTimeUpdates: false // Disable for controlled testing
      }
    );
  });

  afterEach(() => {
    if (dashboard) {
      dashboard.cleanup();
    }
    if (performanceMonitor) {
      performanceMonitor.clearMetrics();
    }
    if (regressionDetector) {
      regressionDetector.clearHistory();
    }
    if (testHarness) {
      testHarness.clearResults();
    }
  });

  describe('Migration Status Management', () => {
    it('should initialize with setup phase', () => {
      const data = dashboard.getDashboardData();
      expect(data.migrationStatus.phase).toBe('setup');
      expect(data.migrationStatus.progress).toBe(0);
    });

    it('should update migration status', () => {
      dashboard.updateMigrationStatus('testing', 25, 'Running tests');
      
      const data = dashboard.getDashboardData();
      expect(data.migrationStatus.phase).toBe('testing');
      expect(data.migrationStatus.progress).toBe(25);
      expect(data.migrationStatus.currentTask).toBe('Running tests');
    });

    it('should emit status update events', (done) => {
      dashboard.on('statusUpdated', (status) => {
        expect(status.phase).toBe('migrating');
        expect(status.progress).toBe(50);
        done();
      });

      dashboard.updateMigrationStatus('migrating', 50, 'Applying changes');
    });

    it('should clamp progress values', () => {
      dashboard.updateMigrationStatus('testing', -10, 'Invalid progress');
      expect(dashboard.getDashboardData().migrationStatus.progress).toBe(0);

      dashboard.updateMigrationStatus('testing', 150, 'Invalid progress');
      expect(dashboard.getDashboardData().migrationStatus.progress).toBe(100);
    });
  });

  describe('Error and Warning Management', () => {
    it('should add and track errors', () => {
      dashboard.addError('Test error message');
      
      const data = dashboard.getDashboardData();
      expect(data.migrationStatus.errors).toHaveLength(1);
      expect(data.migrationStatus.errors[0]).toContain('Test error message');
    });

    it('should add and track warnings', () => {
      dashboard.addWarning('Test warning message');
      
      const data = dashboard.getDashboardData();
      expect(data.migrationStatus.warnings).toHaveLength(1);
      expect(data.migrationStatus.warnings[0]).toContain('Test warning message');
    });

    it('should limit error history size', () => {
      // Add more errors than the limit
      for (let i = 0; i < 60; i++) {
        dashboard.addError(`Error ${i}`);
      }

      const data = dashboard.getDashboardData();
      expect(data.migrationStatus.errors.length).toBeLessThanOrEqual(50);
    });

    it('should emit error and warning events', () => {
      const errorSpy = jest.fn();
      const warningSpy = jest.fn();

      dashboard.on('errorAdded', errorSpy);
      dashboard.on('warningAdded', warningSpy);

      dashboard.addError('Test error');
      dashboard.addWarning('Test warning');

      expect(errorSpy).toHaveBeenCalledWith('Test error');
      expect(warningSpy).toHaveBeenCalledWith('Test warning');
    });
  });

  describe('Performance Integration', () => {
    it('should respond to performance alerts', () => {
      const errorSpy = jest.fn();
      dashboard.on('errorAdded', errorSpy);

      // Trigger a critical performance alert
      performanceMonitor.recordMetric('test_metric', 1000, 'ms');
      performanceMonitor.setThreshold('test_metric', 100, 'ms');
      performanceMonitor.recordMetric('test_metric', 200, 'ms');

      // Should have added a warning for threshold violation
      const data = dashboard.getDashboardData();
      expect(data.migrationStatus.warnings.length).toBeGreaterThan(0);
    });

    it('should include performance summary in dashboard data', () => {
      // Add some test data
      performanceMonitor.recordMetric('response_time', 50, 'ms');
      performanceMonitor.recordMetric('memory_usage', 100, 'MB');

      const data = dashboard.getDashboardData();
      expect(data.performanceSummary).toBeDefined();
      expect(data.systemMetrics).toBeDefined();
    });
  });

  describe('Rollback Conditions', () => {
    it('should evaluate rollback conditions', () => {
      const data = dashboard.getDashboardData();
      expect(data.rollbackStatus).toBeDefined();
      expect(data.rollbackStatus.canRollback).toBe(false);
      expect(data.rollbackStatus.criticalIssues).toBe(0);
    });

    it('should trigger rollback on critical failures', (done) => {
      dashboard.on('rollbackTriggered', (rollbackStatus) => {
        expect(rollbackStatus.canRollback).toBe(true);
        expect(rollbackStatus.criticalIssues).toBeGreaterThan(0);
        done();
      });

      // Add multiple critical errors to trigger rollback
      for (let i = 0; i < 5; i++) {
        dashboard.addError(`Critical error ${i}`);
      }
    });

    it('should register and execute rollback callbacks', async () => {
      const rollbackCallback = jest.fn().mockResolvedValue(undefined);
      dashboard.onRollback(rollbackCallback);

      // Trigger automatic rollback
      dashboard['triggerAutomaticRollback']('Test rollback');

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(rollbackCallback).toHaveBeenCalled();
    });
  });

  describe('Dashboard Data Generation', () => {
    it('should generate complete dashboard data', () => {
      const data = dashboard.getDashboardData();

      expect(data.migrationStatus).toBeDefined();
      expect(data.performanceSummary).toBeDefined();
      expect(data.recentTests).toBeDefined();
      expect(data.recentAlerts).toBeDefined();
      expect(data.recentReports).toBeDefined();
      expect(data.systemMetrics).toBeDefined();
      expect(data.rollbackStatus).toBeDefined();
    });

    it('should include system metrics', () => {
      const data = dashboard.getDashboardData();
      
      expect(data.systemMetrics.memoryUsage).toBeGreaterThan(0);
      expect(data.systemMetrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(data.systemMetrics.activeConnections).toBeGreaterThanOrEqual(0);
    });
  });

  describe('HTML Dashboard Generation', () => {
    it('should generate valid HTML dashboard', () => {
      const html = dashboard.generateHTMLDashboard();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Migration Dashboard</title>');
      expect(html).toContain('Migration Status');
      expect(html).toContain('Performance Summary');
      expect(html).toContain('Rollback Status');
    });

    it('should include current status in HTML', () => {
      dashboard.updateMigrationStatus('testing', 75, 'Running integration tests');
      
      const html = dashboard.generateHTMLDashboard();
      
      expect(html).toContain('TESTING');
      expect(html).toContain('75%');
      expect(html).toContain('Running integration tests');
    });

    it('should show rollback button state correctly', () => {
      // Initially should be disabled
      let html = dashboard.generateHTMLDashboard();
      expect(html).toContain('disabled');

      // Add errors to enable rollback
      for (let i = 0; i < 5; i++) {
        dashboard.addError(`Error ${i}`);
      }

      html = dashboard.generateHTMLDashboard();
      expect(html).not.toContain('disabled');
    });
  });

  describe('Real-time Updates', () => {
    it('should emit dashboard update events', (done) => {
      dashboard.on('dashboardUpdated', (data) => {
        expect(data.migrationStatus).toBeDefined();
        done();
      });

      dashboard.updateMigrationStatus('testing', 10, 'Starting tests');
    });

    it('should handle multiple concurrent updates', () => {
      const updateSpy = jest.fn();
      dashboard.on('dashboardUpdated', updateSpy);

      // Trigger multiple updates
      dashboard.updateMigrationStatus('testing', 10, 'Test 1');
      dashboard.addError('Error 1');
      dashboard.addWarning('Warning 1');
      dashboard.updateMigrationStatus('testing', 20, 'Test 2');

      expect(updateSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources properly', () => {
      const listenerCount = dashboard.listenerCount('dashboardUpdated');
      
      dashboard.cleanup();
      
      // Should remove all listeners
      expect(dashboard.listenerCount('dashboardUpdated')).toBe(0);
    });
  });
});