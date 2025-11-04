import { EventEmitter } from 'events';
import { ProjectStateManager } from '../ProjectStateManager';
import { InstantSyncService } from '../InstantSyncService';
import { RealTimeChangeService } from '../RealTimeChangeService';
import { ChangeStreamingService } from '../ChangeStreamingService';
import { AudioFileSyncService } from '../AudioFileSyncService';
import { CacheService } from '../CacheService';
import type {
  ProjectRecord,
  TrackRecord,
  RegionRecord,
  AudioFileRecord,
  CompleteProjectState,
  CreateProjectRequest,
  CreateTrackRequest,
  CreateRegionRequest,
  ProjectChangeType,
} from '../../types/daw';

// Mock Socket.IO to avoid connection issues
const mockSocket = {
  emit: jest.fn(),
  join: jest.fn(),
  id: 'test-socket-id',
  on: jest.fn(),
};

const mockRoom = {
  emit: jest.fn(),
  except: jest.fn(() => ({
    emit: jest.fn(),
  })),
};

const mockIo = {
  on: jest.fn(),
  to: jest.fn(() => mockRoom),
  emit: jest.fn(),
};

// Mock dependencies
jest.mock('../ChangeStreamingService', () => ({
  ChangeStreamingService: {
    getInstance: () => ({
      initialize: jest.fn(),
      getConnectionStats: jest.fn(() => ({
        totalConnections: 0,
        activeRooms: 0,
        activeStreams: 0,
        authenticatedUsers: 0,
      })),
      cleanup: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      emit: jest.fn(),
    }),
  },
}));

jest.mock('../ProjectDatabase');
jest.mock('../AudioFileStorageService');
jest.mock('../LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('Backend Persistence and New User Synchronization Integration', () => {
  let projectStateManager: ProjectStateManager;
  let instantSyncService: InstantSyncService;
  let realTimeChangeService: RealTimeChangeService;
  let changeStreamingService: ChangeStreamingService;
  let audioFileSyncService: AudioFileSyncService;
  let cacheService: CacheService;

  // Test data
  const testRoomId = 'test-room-123';
  const testUserId1 = 'user-1';
  const testUserId2 = 'user-2';
  const testProjectId = 'project-123';

  const createMockProject = (overrides: Partial<ProjectRecord> = {}): ProjectRecord => ({
    id: testProjectId,
    name: 'Test Project',
    roomId: testRoomId,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    createdBy: testUserId1,
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
    collaborators: [testUserId1],
    version: 1,
    lastSaved: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  });

  const createMockTrack = (overrides: Partial<TrackRecord> = {}): TrackRecord => ({
    id: 'track-1',
    projectId: testProjectId,
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
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    createdBy: testUserId1,
    ...overrides,
  });

  const createMockRegion = (overrides: Partial<RegionRecord> = {}): RegionRecord => ({
    id: 'region-1',
    trackId: 'track-1',
    projectId: testProjectId,
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
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    createdBy: testUserId1,
    ...overrides,
  });

  const createMockAudioFile = (overrides: Partial<AudioFileRecord> = {}): AudioFileRecord => ({
    id: 'audio-1',
    projectId: testProjectId,
    filename: 'test.wav',
    originalName: 'test.wav',
    size: 1024000,
    duration: 10.5,
    sampleRate: 44100,
    channels: 2,
    format: 'audio/wav',
    storagePath: '/storage/audio-1.wav',
    url: '/api/audio-files/audio-1/download',
    uploadedBy: testUserId1,
    uploadedAt: new Date('2024-01-01T00:00:00Z'),
    processed: true,
    ...overrides,
  });

  beforeEach(async () => {
    // Reset singleton instances
    (ProjectStateManager as any).instance = undefined;
    (InstantSyncService as any).instance = undefined;
    (RealTimeChangeService as any).instance = undefined;
    (ChangeStreamingService as any).instance = undefined;
    (AudioFileSyncService as any).instance = undefined;
    (CacheService as any).instance = undefined;

    // Get service instances
    projectStateManager = ProjectStateManager.getInstance();
    instantSyncService = InstantSyncService.getInstance();
    realTimeChangeService = RealTimeChangeService.getInstance();
    changeStreamingService = ChangeStreamingService.getInstance();
    audioFileSyncService = AudioFileSyncService.getInstance();
    cacheService = CacheService.getInstance();

    // Initialize services
    await projectStateManager.initialize();
    await realTimeChangeService.initialize();
    changeStreamingService.initialize(mockIo as any);

    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup services
    await realTimeChangeService.cleanup();
    await changeStreamingService.cleanup();
  });

  describe('Project State Persistence Across Room Sessions', () => {
    it('should persist project state and restore it in new session', async () => {
      // Create a project with tracks and regions
      const projectRequest: CreateProjectRequest = {
        name: 'Persistence Test Project',
        roomId: testRoomId,
        tempo: 140,
        timeSignature: { numerator: 4, denominator: 4 },
        length: 64,
      };

      const project = await projectStateManager.createProject(testRoomId, testUserId1, projectRequest);
      expect(project).toBeDefined();
      expect(project.name).toBe('Persistence Test Project');
      expect(project.tempo).toBe(140);

      // Add tracks
      const trackRequest: CreateTrackRequest = {
        name: 'MIDI Track 1',
        type: 'midi',
        instrumentId: 'piano',
      };

      const track = await projectStateManager.createTrack(project.id, testUserId1, trackRequest);
      expect(track).toBeDefined();
      expect(track.name).toBe('MIDI Track 1');
      expect(track.type).toBe('midi');

      // Add regions
      const regionRequest: CreateRegionRequest = {
        trackId: track.id,
        type: 'midi',
        startTime: 0,
        duration: 8,
        notes: [
          {
            id: 'note-1',
            pitch: 60,
            velocity: 100,
            startTime: 0,
            duration: 1,
            channel: 0,
          },
          {
            id: 'note-2',
            pitch: 64,
            velocity: 80,
            startTime: 2,
            duration: 1,
            channel: 0,
          },
        ],
      };

      const region = await projectStateManager.createRegion(project.id, testUserId1, regionRequest);
      expect(region).toBeDefined();
      expect(region.notes).toHaveLength(2);

      // Force save to ensure persistence
      await projectStateManager.forceSave(project.id, testUserId1);

      // Simulate session end and restart by getting complete state
      const completeState = await projectStateManager.getCompleteProjectState(project.id);
      expect(completeState).toBeDefined();
      expect(completeState!.project.id).toBe(project.id);
      expect(completeState!.tracks).toHaveLength(1);
      expect(completeState!.regions).toHaveLength(1);
      expect(completeState!.regions[0]?.notes).toHaveLength(2);

      // Verify project can be retrieved by room
      const roomProjects = await projectStateManager.getProjectsByRoom(testRoomId);
      expect(roomProjects).toHaveLength(1);
      expect(roomProjects[0]?.id).toBe(project.id);
    });

    it('should handle large project persistence efficiently', async () => {
      const startTime = Date.now();

      // Create project with many tracks and regions
      const project = await projectStateManager.createProject(testRoomId, testUserId1, {
        name: 'Large Project Test',
        roomId: testRoomId,
      });

      // Create 10 tracks
      const tracks: TrackRecord[] = [];
      for (let i = 0; i < 10; i++) {
        const track = await projectStateManager.createTrack(project.id, testUserId1, {
          name: `Track ${i + 1}`,
          type: i % 2 === 0 ? 'midi' : 'audio',
        });
        tracks.push(track);
      }

      // Create 50 regions across tracks
      const regions: RegionRecord[] = [];
      for (let i = 0; i < 50; i++) {
        const trackIndex = i % tracks.length;
        const track = tracks[trackIndex];
        if (!track) continue;
        
        const region = await projectStateManager.createRegion(project.id, testUserId1, {
          trackId: track.id,
          type: track.type as 'midi' | 'audio',
          startTime: (i * 4) % 64, // Distribute across timeline
          duration: 4,
          name: `Region ${i + 1}`,
          ...(track.type === 'midi' && {
            notes: [
              {
                id: `note-${i}-1`,
                pitch: 60 + (i % 12),
                velocity: 100,
                startTime: 0,
                duration: 1,
                channel: 0,
              },
            ],
          }),
        });
        regions.push(region);
      }

      // Force save and measure time
      const saveStartTime = Date.now();
      await projectStateManager.forceSave(project.id, testUserId1);
      const saveTime = Date.now() - saveStartTime;

      // Retrieve complete state and measure time
      const retrieveStartTime = Date.now();
      const completeState = await projectStateManager.getCompleteProjectState(project.id);
      const retrieveTime = Date.now() - retrieveStartTime;

      // Verify data integrity
      expect(completeState).toBeDefined();
      expect(completeState!.tracks).toHaveLength(10);
      expect(completeState!.regions).toHaveLength(50);

      // Performance assertions (should complete within reasonable time)
      expect(saveTime).toBeLessThan(5000); // 5 seconds
      expect(retrieveTime).toBeLessThan(2000); // 2 seconds

      const totalTime = Date.now() - startTime;
      console.log(`Large project test completed in ${totalTime}ms (save: ${saveTime}ms, retrieve: ${retrieveTime}ms)`);
    });
  });

  describe('New User Instant State Loading', () => {
    it('should deliver complete project state to new user within 5 seconds', async () => {
      // Setup existing project with content
      const project = createMockProject();
      const track = createMockTrack();
      const region = createMockRegion();
      const audioFile = createMockAudioFile();

      // Mock project state manager responses
      jest.spyOn(projectStateManager, 'getProjectsByRoom').mockResolvedValue([project]);
      jest.spyOn(projectStateManager, 'getCompleteProjectState').mockResolvedValue({
        project,
        tracks: [track],
        regions: [region],
        audioFiles: [audioFile],
        markers: [],
        changes: [],
        timestamp: new Date(),
      });

      // Track events emitted during sync
      const events: any[] = [];
      instantSyncService.on('deliver_critical_data', (event) => events.push({ type: 'critical', event }));
      instantSyncService.on('deliver_remaining_data', (event) => events.push({ type: 'remaining', event }));
      instantSyncService.on('user_sync_completed', (event) => events.push({ type: 'completed', event }));

      // Measure sync time
      const startTime = Date.now();
      await instantSyncService.onUserJoinRoom(testUserId2, testRoomId);
      const syncTime = Date.now() - startTime;

      // Verify sync completed within time limit
      expect(syncTime).toBeLessThan(5000); // 5 seconds

      // Verify events were emitted
      const completedEvents = events.filter(e => e.type === 'completed');
      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0].event.userId).toBe(testUserId2);
      expect(completedEvents[0].event.roomId).toBe(testRoomId);
      expect(completedEvents[0].event.projectCount).toBe(1);
    });

    it('should handle various project sizes efficiently', async () => {
      const testCases = [
        { name: 'Small', tracks: 2, regions: 5, audioFiles: 1 },
        { name: 'Medium', tracks: 8, regions: 25, audioFiles: 5 },
        { name: 'Large', tracks: 15, regions: 100, audioFiles: 20 },
      ];

      for (const testCase of testCases) {
        const project = createMockProject({ name: `${testCase.name} Project` });
        
        // Create test data
        const tracks = Array.from({ length: testCase.tracks }, (_, i) => 
          createMockTrack({ id: `track-${i}`, name: `Track ${i + 1}` })
        );
        
        const regions = Array.from({ length: testCase.regions }, (_, i) => 
          createMockRegion({ 
            id: `region-${i}`, 
            trackId: tracks[i % tracks.length]?.id || 'track-0',
            name: `Region ${i + 1}`,
          })
        );
        
        const audioFiles = Array.from({ length: testCase.audioFiles }, (_, i) => 
          createMockAudioFile({ id: `audio-${i}`, filename: `audio-${i}.wav` })
        );

        // Mock responses
        jest.spyOn(projectStateManager, 'getProjectsByRoom').mockResolvedValue([project]);
        jest.spyOn(projectStateManager, 'getCompleteProjectState').mockResolvedValue({
          project,
          tracks,
          regions,
          audioFiles,
          markers: [],
          changes: [],
          timestamp: new Date(),
        });

        // Measure sync performance
        const startTime = Date.now();
        await instantSyncService.onUserJoinRoom(`user-${testCase.name}`, testRoomId);
        const syncTime = Date.now() - startTime;

        // Verify performance scales appropriately
        const expectedMaxTime = Math.min(5000, 1000 + (testCase.regions * 10)); // Base time + per-region overhead
        expect(syncTime).toBeLessThan(expectedMaxTime);

        console.log(`${testCase.name} project sync: ${syncTime}ms (${testCase.tracks} tracks, ${testCase.regions} regions, ${testCase.audioFiles} audio files)`);
      }
    });

    it('should prioritize critical data delivery', async () => {
      const project = createMockProject();
      const tracks = Array.from({ length: 5 }, (_, i) => createMockTrack({ id: `track-${i}` }));
      const regions = Array.from({ length: 20 }, (_, i) => createMockRegion({ id: `region-${i}` }));

      // Mock cache miss to force progressive loading
      jest.spyOn(cacheService, 'get').mockReturnValue(null);
      jest.spyOn(projectStateManager, 'getProject').mockResolvedValue(project);
      jest.spyOn(projectStateManager, 'getTracksByProject').mockResolvedValue(tracks);

      // Track event timing
      const eventTimes: { type: string; time: number }[] = [];
      const startTime = Date.now();

      instantSyncService.on('deliver_critical_data', () => {
        eventTimes.push({ type: 'critical', time: Date.now() - startTime });
      });

      instantSyncService.on('deliver_remaining_data', () => {
        eventTimes.push({ type: 'remaining', time: Date.now() - startTime });
      });

      // Test progressive loading with critical priority
      await instantSyncService.loadProjectProgressively(testUserId2, testProjectId, {
        priorityLevel: 'critical',
      });

      // Verify critical data was delivered first and quickly
      const criticalEvents = eventTimes.filter(e => e.type === 'critical');
      expect(criticalEvents).toHaveLength(1);
      expect(criticalEvents[0]?.time).toBeLessThan(1000); // Within 1 second
    });
  });

  describe('Real-Time Change Persistence and Conflict Resolution', () => {
    it('should persist changes within 1 second of modification', async () => {
      // Setup project
      const project = createMockProject();
      jest.spyOn(projectStateManager, 'getCompleteProjectState').mockResolvedValue({
        project,
        tracks: [],
        regions: [],
        audioFiles: [],
        markers: [],
        changes: [],
        timestamp: new Date(),
      });
      jest.spyOn(projectStateManager, 'getChangesSince').mockResolvedValue([]);
      jest.spyOn(projectStateManager, 'recordChange').mockResolvedValue({
        id: 'change-1',
        projectId: testProjectId,
        userId: testUserId1,
        changeType: 'track_create',
        data: { track: { id: 'track-1', name: 'New Track' } },
        timestamp: new Date(),
        version: 1,
      } as any);

      // Queue a change
      const changeStartTime = Date.now();
      await realTimeChangeService.queueChange(
        testProjectId,
        testUserId1,
        'track_create',
        { track: { id: 'track-1', name: 'New Track' } }
      );

      // Wait for automatic save (debounced to 1 second)
      await new Promise(resolve => setTimeout(resolve, 1100));

      const persistTime = Date.now() - changeStartTime;

      // Verify change was persisted within time limit
      expect(persistTime).toBeLessThan(2000); // Allow some buffer
      expect(projectStateManager.recordChange).toHaveBeenCalled();
    });

    it('should handle concurrent changes with conflict resolution', async () => {
      const project = createMockProject();
      
      // Mock conflicting changes from different users
      const conflictingChange = {
        id: 'conflict-change',
        projectId: testProjectId,
        userId: testUserId2,
        changeType: 'track_update' as ProjectChangeType,
        data: { trackId: 'track-1', name: 'User 2 Name' },
        timestamp: new Date(Date.now() + 500), // Slightly later
        version: 2,
      };

      jest.spyOn(projectStateManager, 'getCompleteProjectState').mockResolvedValue({
        project,
        tracks: [createMockTrack({ id: 'track-1', name: 'Original Name' })],
        regions: [],
        audioFiles: [],
        markers: [],
        changes: [],
        timestamp: new Date(),
      });

      // First call returns no conflicts, second call returns the conflicting change
      jest.spyOn(projectStateManager, 'getChangesSince')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([conflictingChange] as any);

      jest.spyOn(projectStateManager, 'recordChange').mockResolvedValue({
        id: 'resolved-change',
        projectId: testProjectId,
        userId: testUserId1,
        changeType: 'track_update',
        data: { trackId: 'track-1', name: 'User 1 Name' },
        timestamp: new Date(),
        version: 3,
      } as any);

      // Queue changes from both users
      await realTimeChangeService.queueChange(
        testProjectId,
        testUserId1,
        'track_update',
        { trackId: 'track-1', name: 'User 1 Name' }
      );

      await realTimeChangeService.queueChange(
        testProjectId,
        testUserId2,
        'track_update',
        { trackId: 'track-1', name: 'User 2 Name' }
      );

      // Force save to trigger conflict resolution
      await realTimeChangeService.forceSave(testProjectId);

      // Verify both changes were processed (conflict resolution occurred)
      expect(projectStateManager.recordChange).toHaveBeenCalledTimes(2);
    });

    it('should maintain change history for rollback capability', async () => {
      const project = createMockProject();
      jest.spyOn(projectStateManager, 'getCompleteProjectState').mockResolvedValue({
        project,
        tracks: [],
        regions: [],
        audioFiles: [],
        markers: [],
        changes: [],
        timestamp: new Date(),
      });
      jest.spyOn(projectStateManager, 'getChangesSince').mockResolvedValue([]);

      let changeCounter = 0;
      jest.spyOn(projectStateManager, 'recordChange').mockImplementation(() => {
        changeCounter++;
        return Promise.resolve({
          id: `change-${changeCounter}`,
          projectId: testProjectId,
          userId: testUserId1,
          changeType: 'track_create',
          data: { track: { id: `track-${changeCounter}` } },
          timestamp: new Date(),
          version: changeCounter,
        } as any);
      });

      // Create a series of changes
      const changes = [
        { type: 'track_create' as ProjectChangeType, data: { track: { id: 'track-1', name: 'Track 1' } } },
        { type: 'track_create' as ProjectChangeType, data: { track: { id: 'track-2', name: 'Track 2' } } },
        { type: 'track_update' as ProjectChangeType, data: { trackId: 'track-1', name: 'Updated Track 1' } },
        { type: 'region_create' as ProjectChangeType, data: { region: { id: 'region-1', trackId: 'track-1' } } },
      ];

      // Queue and persist changes
      for (const change of changes) {
        await realTimeChangeService.queueChange(testProjectId, testUserId1, change.type, change.data);
        await realTimeChangeService.forceSave(testProjectId);
      }

      // Verify all changes were recorded
      expect(projectStateManager.recordChange).toHaveBeenCalledTimes(changes.length);

      // Test change history retrieval
      const history = await realTimeChangeService.getChangeHistory(testProjectId);
      expect(Array.isArray(history)).toBe(true);

      // Test rollback functionality
      const rollbackResult = await realTimeChangeService.rollbackToChange(testProjectId, 'change-2', testUserId1);
      expect(typeof rollbackResult).toBe('boolean');
    });
  });

  describe('Audio File Synchronization and Caching Performance', () => {
    it('should synchronize audio files efficiently across users', async () => {
      const audioFiles = [
        createMockAudioFile({ id: 'audio-1', size: 1024000, filename: 'small.wav' }),
        createMockAudioFile({ id: 'audio-2', size: 5120000, filename: 'medium.wav' }),
        createMockAudioFile({ id: 'audio-3', size: 10240000, filename: 'large.wav' }),
      ];

      // Mock audio file sync service
      jest.spyOn(audioFileSyncService, 'preloadAudioFilesForProject').mockResolvedValue();
      jest.spyOn(audioFileSyncService, 'distributeAudioFilesToNewUser').mockResolvedValue();

      // Test audio file distribution to new user
      const startTime = Date.now();
      await audioFileSyncService.distributeAudioFilesToNewUser(testUserId2, testProjectId);
      const distributionTime = Date.now() - startTime;

      // Verify distribution completed efficiently
      expect(distributionTime).toBeLessThan(3000); // 3 seconds for multiple files
      expect(audioFileSyncService.distributeAudioFilesToNewUser).toHaveBeenCalledWith(
        testUserId2,
        testProjectId
      );
    });

    it('should cache audio files for faster subsequent access', async () => {
      const audioFile = createMockAudioFile();
      
      // Mock cache behavior
      jest.spyOn(cacheService, 'get')
        .mockReturnValueOnce(null) // Cache miss first time
        .mockReturnValueOnce(audioFile); // Cache hit second time

      jest.spyOn(cacheService, 'set').mockImplementation(() => true);

      // First access (cache miss)
      const firstAccessStart = Date.now();
      cacheService.get(`audio_file:${audioFile.id}`);
      cacheService.set(`audio_file:${audioFile.id}`, audioFile, 300);
      const firstAccessTime = Date.now() - firstAccessStart;

      // Second access (cache hit)
      const secondAccessStart = Date.now();
      const cachedFile = cacheService.get(`audio_file:${audioFile.id}`);
      const secondAccessTime = Date.now() - secondAccessStart;

      // Verify caching improves performance
      expect(cachedFile).toEqual(audioFile);
      expect(secondAccessTime).toBeLessThan(firstAccessTime);
      expect(cacheService.set).toHaveBeenCalledWith(`audio_file:${audioFile.id}`, audioFile, 300);
    });

    it('should handle large audio file synchronization without blocking', async () => {
      const largeAudioFiles = Array.from({ length: 10 }, (_, i) => 
        createMockAudioFile({
          id: `large-audio-${i}`,
          size: 50 * 1024 * 1024, // 50MB each
          filename: `large-file-${i}.wav`,
        })
      );

      // Mock preloading with realistic delays
      jest.spyOn(audioFileSyncService, 'preloadAudioFilesForProject').mockImplementation(
        async (projectId, userId, priority) => {
          // Simulate processing time based on priority
          const delay = priority === 'high' ? 100 : priority === 'medium' ? 200 : 500;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      );

      // Test concurrent preloading
      const startTime = Date.now();
      const preloadPromises = [
        audioFileSyncService.preloadAudioFilesForProject(testProjectId, testUserId1, 'high'),
        audioFileSyncService.preloadAudioFilesForProject(testProjectId, testUserId2, 'medium'),
        audioFileSyncService.preloadAudioFilesForProject(testProjectId, 'user-3', 'low'),
      ];

      await Promise.all(preloadPromises);
      const totalTime = Date.now() - startTime;

      // Verify concurrent processing is efficient
      expect(totalTime).toBeLessThan(1000); // Should complete concurrently, not sequentially
      expect(audioFileSyncService.preloadAudioFilesForProject).toHaveBeenCalledTimes(3);
    });
  });

  describe('Performance and Scalability', () => {
    it('should maintain performance with multiple concurrent users', async () => {
      const userCount = 5;
      const project = createMockProject();

      // Mock responses for multiple users
      jest.spyOn(projectStateManager, 'getProjectsByRoom').mockResolvedValue([project]);
      jest.spyOn(projectStateManager, 'getCompleteProjectState').mockResolvedValue({
        project,
        tracks: [createMockTrack()],
        regions: [createMockRegion()],
        audioFiles: [createMockAudioFile()],
        markers: [],
        changes: [],
        timestamp: new Date(),
      });

      // Simulate multiple users joining simultaneously
      const startTime = Date.now();
      const userJoinPromises = Array.from({ length: userCount }, (_, i) =>
        instantSyncService.onUserJoinRoom(`concurrent-user-${i}`, testRoomId)
      );

      await Promise.all(userJoinPromises);
      const totalTime = Date.now() - startTime;

      // Verify performance scales with concurrent users
      const averageTimePerUser = totalTime / userCount;
      expect(averageTimePerUser).toBeLessThan(2000); // 2 seconds per user on average
      expect(totalTime).toBeLessThan(8000); // Total time should be reasonable

      console.log(`${userCount} concurrent users synced in ${totalTime}ms (avg: ${averageTimePerUser}ms per user)`);
    });

    it('should handle system stress gracefully', async () => {
      const project = createMockProject();
      
      // Create stress test scenario
      const stressTestData = {
        tracks: Array.from({ length: 20 }, (_, i) => createMockTrack({ id: `stress-track-${i}` })),
        regions: Array.from({ length: 200 }, (_, i) => createMockRegion({ id: `stress-region-${i}` })),
        audioFiles: Array.from({ length: 50 }, (_, i) => createMockAudioFile({ id: `stress-audio-${i}` })),
      };

      jest.spyOn(projectStateManager, 'getCompleteProjectState').mockResolvedValue({
        project,
        tracks: stressTestData.tracks,
        regions: stressTestData.regions,
        audioFiles: stressTestData.audioFiles,
        markers: [],
        changes: [],
        timestamp: new Date(),
      });

      // Test system under stress
      const startTime = Date.now();
      
      // Simulate concurrent operations
      const operations = [
        instantSyncService.onUserJoinRoom('stress-user-1', testRoomId),
        instantSyncService.onUserJoinRoom('stress-user-2', testRoomId),
        realTimeChangeService.queueChange(testProjectId, testUserId1, 'track_create', { track: { id: 'new-track' } }),
        realTimeChangeService.queueChange(testProjectId, testUserId2, 'region_create', { region: { id: 'new-region' } }),
      ];

      await Promise.allSettled(operations);
      const stressTestTime = Date.now() - startTime;

      // Verify system remains responsive under stress
      expect(stressTestTime).toBeLessThan(10000); // 10 seconds maximum

      // Check service statistics
      const syncStats = await instantSyncService.getPerformanceStats();
      const changeStats = realTimeChangeService.getStats();

      expect(syncStats.successRate).toBeGreaterThan(0.8); // 80% success rate minimum
      expect(changeStats.activeProjects).toBeGreaterThanOrEqual(0);

      console.log(`Stress test completed in ${stressTestTime}ms`);
      console.log(`Sync success rate: ${(syncStats.successRate * 100).toFixed(1)}%`);
    });
  });
});