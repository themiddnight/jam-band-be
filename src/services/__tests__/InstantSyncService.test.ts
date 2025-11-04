import { EventEmitter } from 'events';
import { InstantSyncService } from '../InstantSyncService';
import { ProjectStateManager } from '../ProjectStateManager';
import { AudioFileStorageService } from '../AudioFileStorageService';
import { CacheService } from '../CacheService';
import type {
  ProjectRecord,
  TrackRecord,
  RegionRecord,
  AudioFileRecord,
  CompleteProjectState,
} from '../../types/daw';

// Mock dependencies
jest.mock('../ProjectStateManager');
jest.mock('../AudioFileStorageService');
jest.mock('../CacheService');
jest.mock('../LoggingService');

describe('InstantSyncService', () => {
  let instantSyncService: InstantSyncService;
  let mockProjectStateManager: jest.Mocked<ProjectStateManager>;
  let mockAudioFileStorageService: jest.Mocked<AudioFileStorageService>;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockDatabase: any;

  const mockProject: ProjectRecord = {
    id: 'project-1',
    name: 'Test Project',
    roomId: 'room-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user-1',
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    length: 32,
    settings: {
      autoSave: true,
      autoSaveInterval: 5,
      snapToGrid: true,
      gridResolution: 0.25,
      defaultTrackHeight: 64,
      showWaveforms: true,
      showMIDINotes: true,
    },
    collaborators: ['user-1'],
    version: 1,
    lastSaved: new Date(),
  };

  const mockTrack: TrackRecord = {
    id: 'track-1',
    projectId: 'project-1',
    name: 'Test Track',
    type: 'midi',
    color: '#3b82f6',
    order: 0,
    height: 64,
    muted: false,
    soloed: false,
    volume: 1.0,
    pan: 0,
    settings: {
      recordEnabled: false,
      monitorInput: false,
      frozen: false,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user-1',
  };

  const mockRegion: RegionRecord = {
    id: 'region-1',
    trackId: 'track-1',
    projectId: 'project-1',
    type: 'midi',
    startTime: 0,
    duration: 4,
    offset: 0,
    name: 'Test Region',
    selected: false,
    muted: false,
    notes: [
      {
        id: 'note-1',
        pitch: 60,
        velocity: 100,
        startTime: 0,
        duration: 1,
        channel: 0,
      },
    ],
    settings: {
      showNotes: true,
      noteHeight: 4,
      velocityOpacity: true,
      colorByVelocity: false,
      colorByPitch: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user-1',
  };

  const mockAudioFile: AudioFileRecord = {
    id: 'audio-1',
    projectId: 'project-1',
    filename: 'test.wav',
    originalName: 'test.wav',
    size: 1024000,
    duration: 10.5,
    sampleRate: 44100,
    channels: 2,
    format: 'audio/wav',
    storagePath: '/storage/audio-1.wav',
    url: '/api/audio-files/audio-1/download',
    uploadedBy: 'user-1',
    uploadedAt: new Date(),
    processed: true,
  };

  const mockCompleteState: CompleteProjectState = {
    project: mockProject,
    tracks: [mockTrack],
    regions: [mockRegion],
    audioFiles: [mockAudioFile],
    markers: [],
    changes: [],
    timestamp: new Date(),
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock database
    mockDatabase = {
      getRegionsByProject: jest.fn(),
      getMarkersByProject: jest.fn(),
      getAudioFile: jest.fn(),
    };

    // Setup mock implementations
    mockProjectStateManager = {
      getProjectsByRoom: jest.fn(),
      getCompleteProjectState: jest.fn(),
      getProject: jest.fn(),
      getTracksByProject: jest.fn(),
      getAudioFilesByProject: jest.fn(),
      getDatabase: jest.fn().mockReturnValue(mockDatabase),
    } as any;

    mockAudioFileStorageService = {
      getAudioFile: jest.fn(),
    } as any;

    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as any;

    // Mock static getInstance methods
    (ProjectStateManager.getInstance as jest.Mock).mockReturnValue(mockProjectStateManager);
    (AudioFileStorageService.getInstance as jest.Mock).mockReturnValue(mockAudioFileStorageService);
    (CacheService.getInstance as jest.Mock).mockReturnValue(mockCacheService);

    instantSyncService = InstantSyncService.getInstance();
  });

  describe('onUserJoinRoom', () => {
    it('should sync all projects in a room to a new user', async () => {
      // Setup
      mockProjectStateManager.getProjectsByRoom.mockResolvedValue([mockProject]);
      mockCacheService.get.mockReturnValue(null); // No cache
      mockProjectStateManager.getProject.mockResolvedValue(mockProject);
      mockProjectStateManager.getTracksByProject.mockResolvedValue([mockTrack]);
      mockDatabase.getRegionsByProject.mockResolvedValue([mockRegion]);
      mockProjectStateManager.getAudioFilesByProject.mockResolvedValue([mockAudioFile]);
      mockDatabase.getMarkersByProject.mockResolvedValue([]);
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue(mockCompleteState);

      const eventSpy = jest.fn();
      instantSyncService.on('user_sync_completed', eventSpy);

      // Execute
      await instantSyncService.onUserJoinRoom('user-2', 'room-1');

      // Verify
      expect(mockProjectStateManager.getProjectsByRoom).toHaveBeenCalledWith('room-1');
      expect(eventSpy).toHaveBeenCalledWith({
        userId: 'user-2',
        roomId: 'room-1',
        projectCount: 1,
      });
    });

    it('should handle empty room gracefully', async () => {
      // Setup
      mockProjectStateManager.getProjectsByRoom.mockResolvedValue([]);

      const eventSpy = jest.fn();
      instantSyncService.on('user_sync_completed', eventSpy);

      // Execute
      await instantSyncService.onUserJoinRoom('user-2', 'room-1');

      // Verify
      expect(eventSpy).toHaveBeenCalledWith({
        userId: 'user-2',
        roomId: 'room-1',
        projectCount: 0,
      });
    });

    it('should emit failure event on error', async () => {
      // Setup
      const error = new Error('Database error');
      mockProjectStateManager.getProjectsByRoom.mockRejectedValue(error);

      const eventSpy = jest.fn();
      instantSyncService.on('user_sync_failed', eventSpy);

      // Execute
      await instantSyncService.onUserJoinRoom('user-2', 'room-1');

      // Verify
      expect(eventSpy).toHaveBeenCalledWith({
        userId: 'user-2',
        roomId: 'room-1',
        error: 'Database error',
      });
    });
  });

  describe('syncProjectToUser', () => {
    it('should use cached complete state when available', async () => {
      // Setup
      mockCacheService.get.mockReturnValue(mockCompleteState);

      const criticalDataSpy = jest.fn();
      const remainingDataSpy = jest.fn();
      instantSyncService.on('deliver_critical_data', criticalDataSpy);
      instantSyncService.on('deliver_remaining_data', remainingDataSpy);

      // Execute
      await instantSyncService.syncProjectToUser('user-2', 'project-1');

      // Verify cache was used
      expect(mockCacheService.get).toHaveBeenCalledWith('complete_project_state:project-1');
      expect(criticalDataSpy).toHaveBeenCalled();
      expect(remainingDataSpy).toHaveBeenCalled();
    });

    it('should load from database when cache miss', async () => {
      // Setup
      mockCacheService.get.mockReturnValue(null); // Cache miss
      mockProjectStateManager.getProject.mockResolvedValue(mockProject);
      mockProjectStateManager.getTracksByProject.mockResolvedValue([mockTrack]);
      mockDatabase.getRegionsByProject.mockResolvedValue([mockRegion]);
      mockProjectStateManager.getAudioFilesByProject.mockResolvedValue([mockAudioFile]);
      mockDatabase.getMarkersByProject.mockResolvedValue([]);
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue(mockCompleteState);

      const criticalDataSpy = jest.fn();
      instantSyncService.on('deliver_critical_data', criticalDataSpy);

      // Execute
      await instantSyncService.syncProjectToUser('user-2', 'project-1');

      // Verify database was queried
      expect(mockProjectStateManager.getProject).toHaveBeenCalledWith('project-1');
      expect(mockProjectStateManager.getTracksByProject).toHaveBeenCalledWith('project-1');
      expect(criticalDataSpy).toHaveBeenCalled();
    });

    it('should handle project not found error', async () => {
      // Setup
      mockCacheService.get.mockReturnValue(null);
      mockProjectStateManager.getProject.mockResolvedValue(null);

      // Execute & Verify
      await expect(instantSyncService.syncProjectToUser('user-2', 'project-1'))
        .rejects.toThrow('Project project-1 not found');
    });
  });

  describe('verifyStateConsistency', () => {
    it('should return consistent state when everything matches', async () => {
      // Setup
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue(mockCompleteState);

      const clientState = {
        projectVersion: 1,
        trackCount: 1,
        regionCount: 1,
        audioFileCount: 1,
        markerCount: 0,
      };

      // Execute
      const result = await instantSyncService.verifyStateConsistency('user-2', 'project-1', clientState);

      // Verify
      expect(result.isConsistent).toBe(true);
      expect(result.differences).toHaveLength(0);
    });

    it('should detect version mismatch', async () => {
      // Setup
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue(mockCompleteState);

      const clientState = {
        projectVersion: 2, // Different from server version 1
        trackCount: 1,
        regionCount: 1,
        audioFileCount: 1,
        markerCount: 0,
      };

      // Execute
      const result = await instantSyncService.verifyStateConsistency('user-2', 'project-1', clientState);

      // Verify
      expect(result.isConsistent).toBe(false);
      expect(result.differences).toContain('Version mismatch: client=2, server=1');
    });

    it('should detect count mismatches', async () => {
      // Setup
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue(mockCompleteState);

      const clientState = {
        projectVersion: 1,
        trackCount: 2, // Different from server count 1
        regionCount: 1,
        audioFileCount: 1,
        markerCount: 1, // Different from server count 0
      };

      // Execute
      const result = await instantSyncService.verifyStateConsistency('user-2', 'project-1', clientState);

      // Verify
      expect(result.isConsistent).toBe(false);
      expect(result.differences).toContain('Track count mismatch: client=2, server=1');
      expect(result.differences).toContain('Marker count mismatch: client=1, server=0');
    });

    it('should handle project not found', async () => {
      // Setup
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue(null);

      const clientState = {
        projectVersion: 1,
        trackCount: 1,
        regionCount: 1,
        audioFileCount: 1,
        markerCount: 0,
      };

      // Execute
      const result = await instantSyncService.verifyStateConsistency('user-2', 'project-1', clientState);

      // Verify
      expect(result.isConsistent).toBe(false);
      expect(result.differences).toContain('Project not found on server');
    });
  });

  describe('loadProjectProgressively', () => {
    it('should load only critical data for critical priority', async () => {
      // Setup
      mockCacheService.get.mockReturnValue(null);
      mockProjectStateManager.getProject.mockResolvedValue(mockProject);
      mockProjectStateManager.getTracksByProject.mockResolvedValue([mockTrack]);

      const criticalDataSpy = jest.fn();
      instantSyncService.on('deliver_critical_data', criticalDataSpy);

      // Execute
      await instantSyncService.loadProjectProgressively('user-2', 'project-1', {
        priorityLevel: 'critical',
      });

      // Verify
      expect(criticalDataSpy).toHaveBeenCalled();
      expect(mockProjectStateManager.getProject).toHaveBeenCalledWith('project-1');
      expect(mockProjectStateManager.getTracksByProject).toHaveBeenCalledWith('project-1');
    });

    it('should load visible timeline data for high priority', async () => {
      // Setup
      mockDatabase.getRegionsByProject.mockResolvedValue([mockRegion]);
      mockDatabase.getAudioFile.mockResolvedValue(mockAudioFile);

      const visibleRegionsSpy = jest.fn();
      instantSyncService.on('deliver_visible_regions', visibleRegionsSpy);

      // Execute
      await instantSyncService.loadProjectProgressively('user-2', 'project-1', {
        priorityLevel: 'high',
        timelineStart: 0,
        timelineEnd: 8,
        maxRegions: 10,
      });

      // Verify
      expect(visibleRegionsSpy).toHaveBeenCalled();
      expect(mockDatabase.getRegionsByProject).toHaveBeenCalledWith('project-1');
    });
  });

  describe('cacheCompleteProjectState', () => {
    it('should cache complete project state', async () => {
      // Setup
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue(mockCompleteState);

      // Execute
      await instantSyncService.cacheCompleteProjectState('project-1');

      // Verify
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'complete_project_state:project-1',
        mockCompleteState,
        120
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'critical_data:project-1',
        {
          project: mockProject,
          tracks: [mockTrack],
        },
        300
      );
    });

    it('should handle project not found gracefully', async () => {
      // Setup
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue(null);

      // Execute
      await instantSyncService.cacheCompleteProjectState('project-1');

      // Verify - should not cache anything
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('warmupProjectCache', () => {
    it('should cache all projects in a room', async () => {
      // Setup
      mockProjectStateManager.getProjectsByRoom.mockResolvedValue([mockProject]);
      mockProjectStateManager.getCompleteProjectState.mockResolvedValue(mockCompleteState);

      // Execute
      await instantSyncService.warmupProjectCache('room-1');

      // Verify
      expect(mockProjectStateManager.getProjectsByRoom).toHaveBeenCalledWith('room-1');
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'complete_project_state:project-1',
        mockCompleteState,
        120
      );
    });
  });

  describe('getPerformanceStats', () => {
    it('should return performance statistics', async () => {
      // Execute
      const stats = await instantSyncService.getPerformanceStats();

      // Verify
      expect(stats).toHaveProperty('averageSyncTime');
      expect(stats).toHaveProperty('successfulSyncs');
      expect(stats).toHaveProperty('failedSyncs');
      expect(stats).toHaveProperty('cacheHitRate');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('syncTimesBySize');
    });
  });

  describe('invalidateProjectCache', () => {
    it('should invalidate all cache keys for a project', () => {
      // Execute
      instantSyncService.invalidateProjectCache('project-1');

      // Verify
      expect(mockCacheService.del).toHaveBeenCalledWith('critical_data:project-1');
      expect(mockCacheService.del).toHaveBeenCalledWith('remaining_data:project-1');
      expect(mockCacheService.del).toHaveBeenCalledWith('complete_project_state:project-1');
    });
  });

  describe('invalidateRoomCache', () => {
    it('should invalidate cache for all projects in a room', async () => {
      // Setup
      mockProjectStateManager.getProjectsByRoom.mockResolvedValue([mockProject]);

      // Execute
      await instantSyncService.invalidateRoomCache('room-1');

      // Verify
      expect(mockProjectStateManager.getProjectsByRoom).toHaveBeenCalledWith('room-1');
      expect(mockCacheService.del).toHaveBeenCalledWith('critical_data:project-1');
      expect(mockCacheService.del).toHaveBeenCalledWith('remaining_data:project-1');
      expect(mockCacheService.del).toHaveBeenCalledWith('complete_project_state:project-1');
    });
  });
});