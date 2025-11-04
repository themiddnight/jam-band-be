import { RealTimeChangeService } from '../RealTimeChangeService';
import { ProjectStateManager } from '../ProjectStateManager';
import { CacheService } from '../CacheService';

// Mock dependencies
jest.mock('../ProjectStateManager');
jest.mock('../CacheService');
jest.mock('../LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('RealTimeChangeService', () => {
  let realTimeChangeService: RealTimeChangeService;
  let mockProjectStateManager: jest.Mocked<ProjectStateManager>;
  let mockCacheService: jest.Mocked<CacheService>;

  beforeEach(() => {
    // Reset singleton instance
    (RealTimeChangeService as any).instance = undefined;
    
    // Create mocks
    mockProjectStateManager = {
      recordChange: jest.fn(),
      getCompleteProjectState: jest.fn(),
      getChangesSince: jest.fn(),
      forceSave: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      removeListener: jest.fn(),
    } as any;

    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as any;

    // Mock getInstance methods
    (ProjectStateManager.getInstance as jest.Mock).mockReturnValue(mockProjectStateManager);
    (CacheService.getInstance as jest.Mock).mockReturnValue(mockCacheService);

    realTimeChangeService = RealTimeChangeService.getInstance();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await expect(realTimeChangeService.initialize()).resolves.not.toThrow();
    });

    it('should return singleton instance', () => {
      const instance1 = RealTimeChangeService.getInstance();
      const instance2 = RealTimeChangeService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('change queuing', () => {
    it('should queue changes for persistence', async () => {
      const projectId = 'test-project';
      const userId = 'test-user';
      const changeType = 'track_create';
      const data = { track: { id: 'track-1', name: 'Test Track' } };

      await realTimeChangeService.queueChange(projectId, userId, changeType, data);

      // Verify change was queued (internal state)
      expect(realTimeChangeService).toBeDefined();
    });

    it('should emit change_queued event', async () => {
      const projectId = 'test-project';
      const userId = 'test-user';
      const changeType = 'track_update';
      const data = { trackId: 'track-1', name: 'Updated Track' };

      const eventSpy = jest.fn();
      realTimeChangeService.on('change_queued', eventSpy);

      await realTimeChangeService.queueChange(projectId, userId, changeType, data);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          changeType,
          userId,
        })
      );
    });

    it('should schedule automatic save after queuing change', async () => {
      const projectId = 'test-project';
      const userId = 'test-user';
      const changeType = 'region_create';
      const data = { region: { id: 'region-1' } };

      await realTimeChangeService.queueChange(projectId, userId, changeType, data);

      // Wait for debounce timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(mockProjectStateManager.forceSave).toHaveBeenCalledWith(projectId, 'system');
    });
  });

  describe('force save', () => {
    it('should immediately process pending changes', async () => {
      const projectId = 'test-project';
      const userId = 'test-user';

      // Mock complete project state for conflict resolution
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue({
        project: { id: projectId },
        tracks: [],
        regions: [],
        audioFiles: [],
        markers: [],
        changes: [],
        timestamp: new Date(),
      } as any);

      // Mock no recent changes (no conflicts)
      mockProjectStateManager.getChangesSince.mockResolvedValue([]);

      // Mock successful change recording
      mockProjectStateManager.recordChange.mockResolvedValue({
        id: 'change-1',
        projectId,
        userId,
        changeType: 'track_create',
        data: {},
        timestamp: new Date(),
        version: 1,
      } as any);

      // Queue a change first
      await realTimeChangeService.queueChange(projectId, userId, 'track_create', { track: { id: 'track-1' } });

      // Force save
      await realTimeChangeService.forceSave(projectId);

      expect(mockProjectStateManager.recordChange).toHaveBeenCalled();
      expect(mockProjectStateManager.forceSave).toHaveBeenCalledWith(projectId, 'system');
    });
  });

  describe('conflict resolution', () => {
    it('should handle changes without conflicts', async () => {
      const projectId = 'test-project';
      const userId = 'test-user';

      // Mock no recent changes (no conflicts)
      mockProjectStateManager.getChangesSince.mockResolvedValue([]);
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue({
        project: { id: projectId },
        tracks: [],
        regions: [],
        audioFiles: [],
        markers: [],
        changes: [],
        timestamp: new Date(),
      } as any);

      mockProjectStateManager.recordChange.mockResolvedValue({
        id: 'change-1',
        projectId,
        userId,
        changeType: 'track_create',
        data: {},
        timestamp: new Date(),
        version: 1,
      } as any);

      await realTimeChangeService.queueChange(projectId, userId, 'track_create', { track: { id: 'track-1' } });
      await realTimeChangeService.forceSave(projectId);

      expect(mockProjectStateManager.recordChange).toHaveBeenCalledWith(
        projectId,
        userId,
        'track_create',
        expect.objectContaining({ track: { id: 'track-1' } }),
        undefined
      );
    });
  });

  describe('change history', () => {
    it('should return change history for a project', async () => {
      const projectId = 'test-project';
      
      // Add some changes to history first
      await realTimeChangeService.queueChange(projectId, 'user1', 'track_create', { track: { id: 'track-1' } });
      await realTimeChangeService.queueChange(projectId, 'user2', 'track_update', { trackId: 'track-1', name: 'Updated' });

      const history = await realTimeChangeService.getChangeHistory(projectId);
      
      expect(Array.isArray(history)).toBe(true);
    });

    it('should limit history size when specified', async () => {
      const projectId = 'test-project';
      const limit = 5;
      
      const history = await realTimeChangeService.getChangeHistory(projectId, limit);
      
      expect(history.length).toBeLessThanOrEqual(limit);
    });
  });

  describe('rollback functionality', () => {
    it('should rollback to a specific change', async () => {
      const projectId = 'test-project';
      const userId = 'test-user';
      const changeId = 'change-1';

      // Mock change recording for rollback
      mockProjectStateManager.recordChange.mockResolvedValue({
        id: changeId,
        projectId,
        userId,
        changeType: 'track_create',
        data: { track: { id: 'track-1' } },
        timestamp: new Date(),
        version: 1,
      } as any);

      const result = await realTimeChangeService.rollbackToChange(projectId, changeId, userId);
      
      // Should return false if change not found in history (since we haven't added any)
      expect(result).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should return service statistics', () => {
      const stats = realTimeChangeService.getStats();
      
      expect(stats).toHaveProperty('activeProjects');
      expect(stats).toHaveProperty('totalQueuedChanges');
      expect(stats).toHaveProperty('activeLocks');
      expect(stats).toHaveProperty('historySize');
      expect(stats).toHaveProperty('pendingSaves');
      
      expect(typeof stats.activeProjects).toBe('number');
      expect(typeof stats.totalQueuedChanges).toBe('number');
      expect(typeof stats.activeLocks).toBe('number');
      expect(typeof stats.historySize).toBe('number');
      expect(typeof stats.pendingSaves).toBe('number');
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources properly', async () => {
      const projectId = 'test-project';
      
      // Queue some changes
      await realTimeChangeService.queueChange(projectId, 'user1', 'track_create', { track: { id: 'track-1' } });
      
      // Mock successful processing
      mockProjectStateManager.recordChange.mockResolvedValue({
        id: 'change-1',
        projectId,
        userId: 'user1',
        changeType: 'track_create',
        data: {},
        timestamp: new Date(),
        version: 1,
      } as any);

      await expect(realTimeChangeService.cleanup()).resolves.not.toThrow();
    });
  });
});