import { NamespaceManager } from './NamespaceManager';
import { RoomSessionManager } from './RoomSessionManager';
import { PerformanceMonitoringService } from './PerformanceMonitoringService';
import { loggingService } from './LoggingService';

export interface CleanupMetrics {
  namespacesChecked: number;
  namespacesCleanedUp: number;
  sessionsCleanedUp: number;
  memoryFreed: number;
  cleanupDuration: number;
  lastCleanup: Date;
}

export interface CleanupRule {
  name: string;
  condition: (namespacePath: string, info: any) => boolean;
  action: (namespacePath: string) => Promise<void>;
  priority: number;
}

/**
 * Namespace Cleanup Service for automated memory management
 * Requirements: 11.3 - Add namespace cleanup automation to prevent memory leaks
 */
export class NamespaceCleanupService {
  private static instance: NamespaceCleanupService;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private aggressiveCleanupInterval: NodeJS.Timeout | null = null;
  private cleanupMetrics: CleanupMetrics;
  private cleanupRules: CleanupRule[] = [];
  
  // Configuration
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly AGGRESSIVE_CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly INACTIVE_NAMESPACE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
  private readonly EMPTY_NAMESPACE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MEMORY_PRESSURE_THRESHOLD_MB = 600; // 600MB
  private readonly STALE_SESSION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

  private constructor(
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager,
    private performanceMonitoring: PerformanceMonitoringService
  ) {
    this.cleanupMetrics = this.initializeMetrics();
    this.initializeCleanupRules();
    this.startCleanupScheduler();
    loggingService.logInfo('NamespaceCleanupService initialized');
  }

  static getInstance(
    namespaceManager: NamespaceManager,
    roomSessionManager: RoomSessionManager,
    performanceMonitoring: PerformanceMonitoringService
  ): NamespaceCleanupService {
    if (!NamespaceCleanupService.instance) {
      NamespaceCleanupService.instance = new NamespaceCleanupService(
        namespaceManager,
        roomSessionManager,
        performanceMonitoring
      );
    }
    return NamespaceCleanupService.instance;
  }

  /**
   * Initialize cleanup metrics
   */
  private initializeMetrics(): CleanupMetrics {
    return {
      namespacesChecked: 0,
      namespacesCleanedUp: 0,
      sessionsCleanedUp: 0,
      memoryFreed: 0,
      cleanupDuration: 0,
      lastCleanup: new Date()
    };
  }

  /**
   * Initialize cleanup rules
   */
  private initializeCleanupRules(): void {
    // Rule 1: Clean up empty namespaces
    this.cleanupRules.push({
      name: 'empty_namespaces',
      priority: 1,
      condition: (namespacePath: string, info: any) => {
        return info.connectionCount === 0 && 
               (Date.now() - info.lastActivity.getTime()) > this.EMPTY_NAMESPACE_THRESHOLD_MS;
      },
      action: async (namespacePath: string) => {
        await this.cleanupEmptyNamespace(namespacePath);
      }
    });

    // Rule 2: Clean up inactive namespaces
    this.cleanupRules.push({
      name: 'inactive_namespaces',
      priority: 2,
      condition: (namespacePath: string, info: any) => {
        return (Date.now() - info.lastActivity.getTime()) > this.INACTIVE_NAMESPACE_THRESHOLD_MS;
      },
      action: async (namespacePath: string) => {
        await this.cleanupInactiveNamespace(namespacePath);
      }
    });

    // Rule 3: Clean up approval namespaces that are stale
    this.cleanupRules.push({
      name: 'stale_approval_namespaces',
      priority: 3,
      condition: (namespacePath: string, info: any) => {
        return namespacePath.startsWith('/approval/') && 
               (Date.now() - info.createdAt.getTime()) > 10 * 60 * 1000; // 10 minutes
      },
      action: async (namespacePath: string) => {
        await this.cleanupStaleApprovalNamespace(namespacePath);
      }
    });

    // Rule 4: Memory pressure cleanup
    this.cleanupRules.push({
      name: 'memory_pressure_cleanup',
      priority: 4,
      condition: (namespacePath: string, info: any) => {
        const systemMetrics = this.performanceMonitoring.getSystemMetrics();
        return systemMetrics.totalMemoryUsage > this.MEMORY_PRESSURE_THRESHOLD_MB &&
               info.connectionCount < 2; // Clean up low-activity namespaces first
      },
      action: async (namespacePath: string) => {
        await this.cleanupForMemoryPressure(namespacePath);
      }
    });

    loggingService.logInfo('Cleanup rules initialized', {
      ruleCount: this.cleanupRules.length,
      rules: this.cleanupRules.map(r => ({ name: r.name, priority: r.priority }))
    });
  }

  /**
   * Start the cleanup scheduler
   */
  private startCleanupScheduler(): void {
    // Regular cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.performRegularCleanup();
    }, this.CLEANUP_INTERVAL_MS);

    // Aggressive cleanup interval (when under memory pressure)
    this.aggressiveCleanupInterval = setInterval(() => {
      this.performAggressiveCleanup();
    }, this.AGGRESSIVE_CLEANUP_INTERVAL_MS);

    loggingService.logInfo('Cleanup scheduler started', {
      regularInterval: this.CLEANUP_INTERVAL_MS,
      aggressiveInterval: this.AGGRESSIVE_CLEANUP_INTERVAL_MS
    });
  }

  /**
   * Perform regular cleanup
   */
  private async performRegularCleanup(): Promise<void> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      loggingService.logInfo('Starting regular cleanup cycle');
      
      const namespaceStats = this.namespaceManager.getNamespaceStats();
      let cleanedNamespaces = 0;
      let cleanedSessions = 0;

      // Apply cleanup rules in priority order
      const sortedRules = this.cleanupRules.sort((a, b) => a.priority - b.priority);

      for (const namespaceDetail of namespaceStats.namespaceDetails) {
        this.cleanupMetrics.namespacesChecked++;

        for (const rule of sortedRules) {
          if (rule.condition(namespaceDetail.path, namespaceDetail)) {
            try {
              await rule.action(namespaceDetail.path);
              cleanedNamespaces++;
              
              loggingService.logInfo('Namespace cleaned by rule', {
                namespacePath: namespaceDetail.path,
                rule: rule.name,
                connectionCount: namespaceDetail.connectionCount,
                age: namespaceDetail.age
              });
              
              break; // Only apply first matching rule
            } catch (error) {
              loggingService.logError(error as Error, {
                context: 'namespace_cleanup',
                rule: rule.name,
                namespacePath: namespaceDetail.path
              });
            }
          }
        }
      }

      // Clean up expired sessions
      cleanedSessions = await this.cleanupExpiredSessions();

      // Update metrics
      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;
      
      this.cleanupMetrics.namespacesCleanedUp += cleanedNamespaces;
      this.cleanupMetrics.sessionsCleanedUp += cleanedSessions;
      this.cleanupMetrics.memoryFreed += Math.max(0, startMemory - endMemory);
      this.cleanupMetrics.cleanupDuration = endTime - startTime;
      this.cleanupMetrics.lastCleanup = new Date();

      // Log cleanup results
      loggingService.logPerformanceMetric('namespace_cleanup', cleanedNamespaces, {
        cleanedNamespaces,
        cleanedSessions,
        memoryFreed: Math.round((startMemory - endMemory) / 1024 / 1024), // MB
        duration: this.cleanupMetrics.cleanupDuration,
        namespacesChecked: namespaceStats.namespaceDetails.length
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'regular_cleanup_cycle'
      });
    }
  }

  /**
   * Perform aggressive cleanup under memory pressure
   */
  private async performAggressiveCleanup(): Promise<void> {
    const systemMetrics = this.performanceMonitoring.getSystemMetrics();
    
    // Only perform aggressive cleanup if under memory pressure
    if (systemMetrics.totalMemoryUsage < this.MEMORY_PRESSURE_THRESHOLD_MB) {
      return;
    }

    loggingService.logSystemHealth('memory_pressure', 'warning', {
      message: 'Performing aggressive cleanup due to memory pressure',
      memoryUsage: systemMetrics.totalMemoryUsage,
      threshold: this.MEMORY_PRESSURE_THRESHOLD_MB
    });

    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      // Force cleanup of all inactive namespaces
      const namespaceStats = this.namespaceManager.getNamespaceStats();
      let aggressiveCleanups = 0;

      for (const namespaceDetail of namespaceStats.namespaceDetails) {
        // Skip lobby monitor namespace
        if (namespaceDetail.path === '/lobby-monitor') {
          continue;
        }

        // Clean up namespaces with low activity or old age
        const timeSinceActivity = Date.now() - namespaceDetail.lastActivity.getTime();
        const shouldCleanup = 
          namespaceDetail.connectionCount === 0 ||
          (namespaceDetail.connectionCount < 3 && timeSinceActivity > 15 * 60 * 1000) || // 15 minutes
          timeSinceActivity > this.INACTIVE_NAMESPACE_THRESHOLD_MS;

        if (shouldCleanup) {
          try {
            await this.forceCleanupNamespace(namespaceDetail.path);
            aggressiveCleanups++;
          } catch (error) {
            loggingService.logError(error as Error, {
              context: 'aggressive_cleanup',
              namespacePath: namespaceDetail.path
            });
          }
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        loggingService.logInfo('Forced garbage collection during aggressive cleanup');
      }

      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;
      const memoryFreed = Math.max(0, startMemory - endMemory);

      loggingService.logInfo('Aggressive cleanup completed', {
      cleanedNamespaces: aggressiveCleanups,
      memoryFreed: Math.round(memoryFreed / 1024 / 1024), // MB
      duration: endTime - startTime,
      finalMemoryUsage: Math.round(endMemory / 1024 / 1024) // MB
    });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'aggressive_cleanup_cycle'
      });
    }
  }

  /**
   * Clean up empty namespace
   */
  private async cleanupEmptyNamespace(namespacePath: string): Promise<void> {
    const success = this.namespaceManager.cleanupNamespace(namespacePath);
    if (success) {
      // Extract room ID from namespace path
      const roomId = this.extractRoomIdFromNamespace(namespacePath);
      if (roomId) {
        this.roomSessionManager.cleanupRoomSessions(roomId);
      }
    }
  }

  /**
   * Clean up inactive namespace
   */
  private async cleanupInactiveNamespace(namespacePath: string): Promise<void> {
    const success = this.namespaceManager.cleanupNamespace(namespacePath);
    if (success) {
      const roomId = this.extractRoomIdFromNamespace(namespacePath);
      if (roomId) {
        this.roomSessionManager.cleanupRoomSessions(roomId);
      }
    }
  }

  /**
   * Clean up stale approval namespace
   */
  private async cleanupStaleApprovalNamespace(namespacePath: string): Promise<void> {
    const success = this.namespaceManager.cleanupNamespace(namespacePath);
    if (success) {
      const roomId = this.extractRoomIdFromNamespace(namespacePath);
      if (roomId) {
        // Clean up approval sessions specifically
        const approvalSessions = this.roomSessionManager.getApprovalSessions(roomId);
        for (const [socketId] of approvalSessions) {
          this.roomSessionManager.removeSession(socketId);
        }
      }
    }
  }

  /**
   * Clean up namespace due to memory pressure
   */
  private async cleanupForMemoryPressure(namespacePath: string): Promise<void> {
    loggingService.logSystemHealth('memory_pressure_cleanup', 'warning', {
      message: 'Cleaning up namespace due to memory pressure',
      namespacePath
    });

    await this.forceCleanupNamespace(namespacePath);
  }

  /**
   * Force cleanup of a namespace
   */
  private async forceCleanupNamespace(namespacePath: string): Promise<void> {
    const success = this.namespaceManager.cleanupNamespace(namespacePath);
    if (success) {
      const roomId = this.extractRoomIdFromNamespace(namespacePath);
      if (roomId) {
        this.roomSessionManager.cleanupRoomSessions(roomId);
      }
    }
  }

  /**
   * Clean up expired sessions
   */
  private async cleanupExpiredSessions(): Promise<number> {
    const beforeCount = this.roomSessionManager.getSessionStats().totalSessions;
    this.roomSessionManager.cleanupExpiredSessions(this.STALE_SESSION_THRESHOLD_MS);
    const afterCount = this.roomSessionManager.getSessionStats().totalSessions;
    
    return Math.max(0, beforeCount - afterCount);
  }

  /**
   * Extract room ID from namespace path
   */
  private extractRoomIdFromNamespace(namespacePath: string): string | null {
    const roomMatch = namespacePath.match(/^\/room\/(.+)$/);
    if (roomMatch && roomMatch[1]) {
      return roomMatch[1];
    }
    
    const approvalMatch = namespacePath.match(/^\/approval\/(.+)$/);
    if (approvalMatch && approvalMatch[1]) {
      return approvalMatch[1];
    }
    
    return null;
  }

  /**
   * Add custom cleanup rule
   */
  addCleanupRule(rule: CleanupRule): void {
    this.cleanupRules.push(rule);
    this.cleanupRules.sort((a, b) => a.priority - b.priority);
    
    loggingService.logInfo('Custom cleanup rule added', {
      ruleName: rule.name,
      priority: rule.priority,
      totalRules: this.cleanupRules.length
    });
  }

  /**
   * Remove cleanup rule
   */
  removeCleanupRule(ruleName: string): boolean {
    const initialLength = this.cleanupRules.length;
    this.cleanupRules = this.cleanupRules.filter(rule => rule.name !== ruleName);
    
    const removed = this.cleanupRules.length < initialLength;
    if (removed) {
      loggingService.logInfo('Cleanup rule removed', {
        ruleName,
        remainingRules: this.cleanupRules.length
      });
    }
    
    return removed;
  }

  /**
   * Force immediate cleanup
   */
  async forceCleanup(): Promise<CleanupMetrics> {
    loggingService.logInfo('Forcing immediate cleanup');
    await this.performRegularCleanup();
    return { ...this.cleanupMetrics };
  }

  /**
   * Get cleanup metrics
   */
  getCleanupMetrics(): CleanupMetrics {
    return { ...this.cleanupMetrics };
  }

  /**
   * Get cleanup rules
   */
  getCleanupRules(): CleanupRule[] {
    return [...this.cleanupRules];
  }

  /**
   * Get cleanup status
   */
  getCleanupStatus(): {
    isRunning: boolean;
    nextRegularCleanup: Date;
    nextAggressiveCleanup: Date;
    metrics: CleanupMetrics;
    systemMemoryUsage: number;
    memoryPressure: boolean;
  } {
    const systemMetrics = this.performanceMonitoring.getSystemMetrics();
    const now = new Date();
    
    return {
      isRunning: this.cleanupInterval !== null,
      nextRegularCleanup: new Date(now.getTime() + this.CLEANUP_INTERVAL_MS),
      nextAggressiveCleanup: new Date(now.getTime() + this.AGGRESSIVE_CLEANUP_INTERVAL_MS),
      metrics: this.getCleanupMetrics(),
      systemMemoryUsage: systemMetrics.totalMemoryUsage,
      memoryPressure: systemMetrics.totalMemoryUsage > this.MEMORY_PRESSURE_THRESHOLD_MB
    };
  }

  /**
   * Update cleanup configuration
   */
  updateConfiguration(config: {
    cleanupInterval?: number;
    aggressiveCleanupInterval?: number;
    inactiveThreshold?: number;
    emptyThreshold?: number;
    memoryPressureThreshold?: number;
  }): void {
    if (config.cleanupInterval) {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = setInterval(() => {
          this.performRegularCleanup();
        }, config.cleanupInterval);
      }
    }

    if (config.aggressiveCleanupInterval) {
      if (this.aggressiveCleanupInterval) {
        clearInterval(this.aggressiveCleanupInterval);
        this.aggressiveCleanupInterval = setInterval(() => {
          this.performAggressiveCleanup();
        }, config.aggressiveCleanupInterval);
      }
    }

    loggingService.logInfo('Cleanup configuration updated', config);
  }

  /**
   * Shutdown the cleanup service
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.aggressiveCleanupInterval) {
      clearInterval(this.aggressiveCleanupInterval);
      this.aggressiveCleanupInterval = null;
    }

    loggingService.logInfo('NamespaceCleanupService shutdown completed', {
      finalMetrics: this.cleanupMetrics
    });
  }
}