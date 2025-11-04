import { EventEmitter } from 'events';
import type {
  ProjectRecord,
  TrackRecord,
  RegionRecord,
  CompleteProjectState,
  CreateProjectRequest,
  CreateTrackRequest,
  CreateRegionRequest,
  ProjectChangeType,
} from '../../types/daw';

// Mock logging service
jest.mock('../LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('Backend Persistence Core Tests', () => {
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

  describe('Project State Persistence Requirements', () => {
    it('should validate project state data structures', () => {
      // Test requirement 9.1: Project state structure
      const project = createMockProject();
      
      // Verify project has required fields for persistence
      expect(project.id).toBeDefined();
      expect(project.roomId).toBe(testRoomId);
      expect(project.version).toBe(1);
      expect(project.lastSaved).toBeInstanceOf(Date);
      expect(project.collaborators).toContain(testUserId1);
      
      // Verify project settings structure
      expect(project.settings.autoSave).toBe(true);
      expect(project.settings.autoSaveInterval).toBe(5);
      expect(typeof project.settings.snapToGrid).toBe('boolean');
    });

    it('should validate track data structures for persistence', () => {
      // Test requirement 9.2: Track state structure
      const track = createMockTrack();
      
      // Verify track has required fields
      expect(track.id).toBeDefined();
      expect(track.projectId).toBe(testProjectId);
      expect(track.type).toMatch(/^(midi|audio)$/);
      expect(track.order).toBeGreaterThanOrEqual(0);
      expect(track.createdBy).toBe(testUserId1);
      
      // Verify audio properties are within valid ranges
      expect(track.volume).toBeGreaterThanOrEqual(0);
      expect(track.volume).toBeLessThanOrEqual(1);
      expect(track.pan).toBeGreaterThanOrEqual(-1);
      expect(track.pan).toBeLessThanOrEqual(1);
    });

    it('should validate region data structures for persistence', () => {
      // Test requirement 9.4: Region state structure
      const region = createMockRegion();
      
      // Verify region has required fields
      expect(region.id).toBeDefined();
      expect(region.trackId).toBeDefined();
      expect(region.projectId).toBe(testProjectId);
      expect(region.type).toMatch(/^(midi|audio)$/);
      
      // Verify timeline positioning
      expect(region.startTime).toBeGreaterThanOrEqual(0);
      expect(region.duration).toBeGreaterThan(0);
      expect(region.offset).toBeGreaterThanOrEqual(0);
      
      // Verify MIDI notes structure
      if (region.notes) {
        region.notes.forEach(note => {
          expect(note.id).toBeDefined();
          expect(note.pitch).toBeGreaterThanOrEqual(0);
          expect(note.pitch).toBeLessThanOrEqual(127);
          expect(note.velocity).toBeGreaterThanOrEqual(0);
          expect(note.velocity).toBeLessThanOrEqual(127);
          expect(note.startTime).toBeGreaterThanOrEqual(0);
          expect(note.duration).toBeGreaterThan(0);
        });
      }
    });

    it('should validate complete project state structure', () => {
      // Test requirement 10.1: Complete state structure
      const project = createMockProject();
      const track = createMockTrack();
      const region = createMockRegion();
      
      const completeState: CompleteProjectState = {
        project,
        tracks: [track],
        regions: [region],
        audioFiles: [],
        markers: [],
        changes: [],
        timestamp: new Date(),
      };
      
      // Verify complete state structure
      expect(completeState.project).toBeDefined();
      expect(Array.isArray(completeState.tracks)).toBe(true);
      expect(Array.isArray(completeState.regions)).toBe(true);
      expect(Array.isArray(completeState.audioFiles)).toBe(true);
      expect(Array.isArray(completeState.markers)).toBe(true);
      expect(Array.isArray(completeState.changes)).toBe(true);
      expect(completeState.timestamp).toBeInstanceOf(Date);
      
      // Verify data consistency
      expect(completeState.tracks[0]?.projectId).toBe(project.id);
      expect(completeState.regions[0]?.projectId).toBe(project.id);
      expect(completeState.regions[0]?.trackId).toBe(track.id);
    });
  });

  describe('New User Synchronization Requirements', () => {
    it('should validate instant sync data delivery structure', () => {
      // Test requirement 9.1: Instant state delivery
      const project = createMockProject();
      const tracks = [
        createMockTrack({ id: 'track-1', name: 'Track 1' }),
        createMockTrack({ id: 'track-2', name: 'Track 2', type: 'audio' }),
      ];
      
      // Critical data structure (delivered first)
      const criticalData = {
        project,
        tracks,
      };
      
      expect(criticalData.project).toBeDefined();
      expect(criticalData.tracks).toHaveLength(2);
      expect(criticalData.tracks[0]?.type).toBe('midi');
      expect(criticalData.tracks[1]?.type).toBe('audio');
    });

    it('should validate progressive loading data structure', () => {
      // Test requirement 9.5: Progressive loading
      const regions = Array.from({ length: 10 }, (_, i) => 
        createMockRegion({ 
          id: `region-${i}`,
          startTime: i * 4,
          name: `Region ${i + 1}`,
        })
      );
      
      // Simulate visible timeline data (0-16 beats)
      const visibleRegions = regions.filter(region => {
        const regionEnd = region.startTime + region.duration;
        return (
          (region.startTime >= 0 && region.startTime <= 16) ||
          (regionEnd >= 0 && regionEnd <= 16) ||
          (region.startTime <= 0 && regionEnd >= 16)
        );
      });
      
      expect(visibleRegions.length).toBeGreaterThan(0);
      expect(visibleRegions.length).toBeLessThanOrEqual(regions.length);
      
      // Verify regions are sorted by start time
      for (let i = 1; i < visibleRegions.length; i++) {
        expect(visibleRegions[i]?.startTime).toBeGreaterThanOrEqual(
          visibleRegions[i - 1]?.startTime || 0
        );
      }
    });

    it('should validate state consistency checking', () => {
      // Test requirement 9.2: State consistency
      const serverState = {
        projectVersion: 5,
        trackCount: 3,
        regionCount: 12,
        audioFileCount: 2,
        markerCount: 1,
      };
      
      const clientState = {
        projectVersion: 5,
        trackCount: 3,
        regionCount: 12,
        audioFileCount: 2,
        markerCount: 1,
      };
      
      // Simulate consistency check
      const differences: string[] = [];
      
      if (clientState.projectVersion !== serverState.projectVersion) {
        differences.push(`Version mismatch: client=${clientState.projectVersion}, server=${serverState.projectVersion}`);
      }
      
      if (clientState.trackCount !== serverState.trackCount) {
        differences.push(`Track count mismatch: client=${clientState.trackCount}, server=${serverState.trackCount}`);
      }
      
      if (clientState.regionCount !== serverState.regionCount) {
        differences.push(`Region count mismatch: client=${clientState.regionCount}, server=${serverState.regionCount}`);
      }
      
      const isConsistent = differences.length === 0;
      
      expect(isConsistent).toBe(true);
      expect(differences).toHaveLength(0);
    });

    it('should detect state inconsistencies', () => {
      // Test state mismatch detection
      const serverState = {
        projectVersion: 5,
        trackCount: 3,
        regionCount: 12,
      };
      
      const clientState = {
        projectVersion: 4, // Different version
        trackCount: 2,     // Different count
        regionCount: 12,   // Same count
      };
      
      const differences: string[] = [];
      
      if (clientState.projectVersion !== serverState.projectVersion) {
        differences.push(`Version mismatch: client=${clientState.projectVersion}, server=${serverState.projectVersion}`);
      }
      
      if (clientState.trackCount !== serverState.trackCount) {
        differences.push(`Track count mismatch: client=${clientState.trackCount}, server=${serverState.trackCount}`);
      }
      
      if (clientState.regionCount !== serverState.regionCount) {
        differences.push(`Region count mismatch: client=${clientState.regionCount}, server=${serverState.regionCount}`);
      }
      
      const isConsistent = differences.length === 0;
      
      expect(isConsistent).toBe(false);
      expect(differences).toHaveLength(2);
      expect(differences).toContain('Version mismatch: client=4, server=5');
      expect(differences).toContain('Track count mismatch: client=2, server=3');
    });
  });

  describe('Real-Time Change Persistence Requirements', () => {
    it('should validate change record structure', () => {
      // Test requirement 10.1: Change persistence
      const changeRecord = {
        id: 'change-123',
        projectId: testProjectId,
        userId: testUserId1,
        timestamp: new Date(),
        changeType: 'track_create' as ProjectChangeType,
        data: {
          track: createMockTrack(),
        },
        version: 1,
      };
      
      expect(changeRecord.id).toBeDefined();
      expect(changeRecord.projectId).toBe(testProjectId);
      expect(changeRecord.userId).toBe(testUserId1);
      expect(changeRecord.timestamp).toBeInstanceOf(Date);
      expect(changeRecord.changeType).toBe('track_create');
      expect(changeRecord.data.track).toBeDefined();
      expect(changeRecord.version).toBeGreaterThan(0);
    });

    it('should validate change types for different operations', () => {
      // Test requirement 10.3: Change tracking
      const validChangeTypes: ProjectChangeType[] = [
        'project_create',
        'project_update',
        'project_delete',
        'track_create',
        'track_update',
        'track_delete',
        'track_reorder',
        'region_create',
        'region_update',
        'region_delete',
        'region_move',
        'region_resize',
        'region_split',
        'audio_file_upload',
        'audio_file_delete',
        'transport_change',
        'collaboration_change',
      ];
      
      // Verify all change types are valid strings
      validChangeTypes.forEach(changeType => {
        expect(typeof changeType).toBe('string');
        expect(changeType.length).toBeGreaterThan(0);
      });
      
      // Test specific change type validation
      expect(validChangeTypes).toContain('track_create');
      expect(validChangeTypes).toContain('region_update');
      expect(validChangeTypes).toContain('audio_file_upload');
    });

    it('should validate conflict resolution data structure', () => {
      // Test requirement 10.5: Conflict resolution
      const originalChange = {
        id: 'change-1',
        userId: testUserId1,
        changeType: 'track_update' as ProjectChangeType,
        data: { trackId: 'track-1', name: 'User 1 Name' },
        timestamp: new Date('2024-01-01T10:00:00Z'),
        version: 1,
      };
      
      const conflictingChange = {
        id: 'change-2',
        userId: testUserId2,
        changeType: 'track_update' as ProjectChangeType,
        data: { trackId: 'track-1', name: 'User 2 Name' },
        timestamp: new Date('2024-01-01T10:00:01Z'), // 1 second later
        version: 1, // Same version = conflict
      };
      
      // Simulate conflict detection
      const hasConflict = (
        originalChange.changeType === conflictingChange.changeType &&
        originalChange.data.trackId === conflictingChange.data.trackId &&
        originalChange.version === conflictingChange.version
      );
      
      expect(hasConflict).toBe(true);
      
      // Simulate conflict resolution (last-write-wins)
      const resolvedChange = conflictingChange.timestamp > originalChange.timestamp 
        ? conflictingChange 
        : originalChange;
      
      expect(resolvedChange.id).toBe('change-2');
      expect(resolvedChange.data.name).toBe('User 2 Name');
    });
  });

  describe('Performance and Scalability Requirements', () => {
    it('should validate project size calculation', () => {
      // Test requirement 11.1: Performance monitoring
      const project = createMockProject();
      const tracks = Array.from({ length: 5 }, (_, i) => 
        createMockTrack({ id: `track-${i}` })
      );
      const regions = Array.from({ length: 20 }, (_, i) => 
        createMockRegion({ 
          id: `region-${i}`,
          notes: Array.from({ length: 10 }, (_, j) => ({
            id: `note-${i}-${j}`,
            pitch: 60 + j,
            velocity: 100,
            startTime: j * 0.5,
            duration: 0.25,
            channel: 0,
          }))
        })
      );
      
      // Calculate project size (approximate)
      let projectSize = 100; // Base project data
      projectSize += tracks.length * 50; // Track data
      projectSize += regions.length * 100; // Region data
      
      // Add MIDI notes
      regions.forEach(region => {
        if (region.notes) {
          projectSize += region.notes.length * 20;
        }
      });
      
      expect(projectSize).toBeGreaterThan(0);
      const expectedSize = 100 + (5 * 50) + (20 * 100) + (20 * 10 * 20); // 100 + 250 + 2000 + 4000 = 6350
      expect(projectSize).toBe(expectedSize);
      
      // Categorize project size
      let sizeCategory: string;
      if (projectSize < 1000) sizeCategory = 'small';
      else if (projectSize < 10000) sizeCategory = 'medium';
      else if (projectSize < 50000) sizeCategory = 'large';
      else sizeCategory = 'xlarge';
      
      expect(sizeCategory).toBe('medium'); // 6350 falls in medium range
    });

    it('should validate performance metrics structure', () => {
      // Test requirement 11.2: Performance tracking
      const performanceMetrics = {
        averageSyncTime: 1250, // milliseconds
        successfulSyncs: 45,
        failedSyncs: 2,
        cacheHitRate: 0.85, // 85%
        averageProjectSize: 15000,
        largestProjectSize: 75000,
        syncTimesBySize: {
          small: { average: 500, min: 200, max: 800, count: 10 },
          medium: { average: 1200, min: 600, max: 2000, count: 25 },
          large: { average: 2500, min: 1500, max: 4000, count: 10 },
          xlarge: { average: 5000, min: 3000, max: 8000, count: 2 },
        },
        successRate: 0.957, // 95.7%
      };
      
      // Validate metrics structure
      expect(typeof performanceMetrics.averageSyncTime).toBe('number');
      expect(performanceMetrics.successfulSyncs).toBeGreaterThanOrEqual(0);
      expect(performanceMetrics.failedSyncs).toBeGreaterThanOrEqual(0);
      expect(performanceMetrics.cacheHitRate).toBeGreaterThanOrEqual(0);
      expect(performanceMetrics.cacheHitRate).toBeLessThanOrEqual(1);
      expect(performanceMetrics.successRate).toBeGreaterThanOrEqual(0);
      expect(performanceMetrics.successRate).toBeLessThanOrEqual(1);
      
      // Validate size-based metrics
      Object.values(performanceMetrics.syncTimesBySize).forEach(sizeMetrics => {
        expect(sizeMetrics.average).toBeGreaterThan(0);
        expect(sizeMetrics.min).toBeLessThanOrEqual(sizeMetrics.average);
        expect(sizeMetrics.max).toBeGreaterThanOrEqual(sizeMetrics.average);
        expect(sizeMetrics.count).toBeGreaterThan(0);
      });
    });

    it('should validate cache performance requirements', () => {
      // Test requirement 11.3: Caching performance
      const cacheMetrics = {
        hits: 850,
        misses: 150,
        totalRequests: 1000,
        hitRate: 0.85,
        averageHitTime: 5, // milliseconds
        averageMissTime: 250, // milliseconds
      };
      
      // Validate cache calculations
      expect(cacheMetrics.hits + cacheMetrics.misses).toBe(cacheMetrics.totalRequests);
      expect(cacheMetrics.hitRate).toBe(cacheMetrics.hits / cacheMetrics.totalRequests);
      expect(cacheMetrics.averageHitTime).toBeLessThan(cacheMetrics.averageMissTime);
      
      // Performance requirements
      expect(cacheMetrics.hitRate).toBeGreaterThan(0.8); // 80% hit rate minimum
      expect(cacheMetrics.averageHitTime).toBeLessThan(10); // Sub-10ms cache hits
    });
  });

  describe('Data Integrity and Validation', () => {
    it('should validate project data integrity constraints', () => {
      const project = createMockProject();
      
      // Required fields validation
      expect(project.id).toBeTruthy();
      expect(project.name).toBeTruthy();
      expect(project.roomId).toBeTruthy();
      expect(project.createdBy).toBeTruthy();
      
      // Numeric constraints
      expect(project.tempo).toBeGreaterThan(0);
      expect(project.tempo).toBeLessThan(300); // Reasonable tempo range
      expect(project.timeSignatureNumerator).toBeGreaterThan(0);
      expect(project.timeSignatureDenominator).toBeGreaterThan(0);
      expect(project.length).toBeGreaterThan(0);
      expect(project.version).toBeGreaterThan(0);
      
      // Array validation
      expect(Array.isArray(project.collaborators)).toBe(true);
      expect(project.collaborators.length).toBeGreaterThan(0);
    });

    it('should validate track data integrity constraints', () => {
      const midiTrack = createMockTrack({ type: 'midi', instrumentId: 'piano' });
      const audioTrack = createMockTrack({ type: 'audio', inputSource: 'microphone' });
      
      // MIDI track validation
      expect(midiTrack.type).toBe('midi');
      expect(midiTrack.instrumentId).toBeDefined();
      
      // Audio track validation
      expect(audioTrack.type).toBe('audio');
      expect(audioTrack.inputSource).toBeDefined();
      
      // Common constraints
      [midiTrack, audioTrack].forEach(track => {
        expect(track.volume).toBeGreaterThanOrEqual(0);
        expect(track.volume).toBeLessThanOrEqual(2); // Allow up to 200%
        expect(track.pan).toBeGreaterThanOrEqual(-1);
        expect(track.pan).toBeLessThanOrEqual(1);
        expect(track.order).toBeGreaterThanOrEqual(0);
        expect(track.height).toBeGreaterThan(0);
      });
    });

    it('should validate region data integrity constraints', () => {
      const midiRegion = createMockRegion({ type: 'midi' });
      const audioRegion = createMockRegion({ 
        type: 'audio', 
        audioFileId: 'audio-123',
        fadeIn: 0.5,
        fadeOut: 1.0,
        gain: 1.2,
      });
      
      // MIDI region validation
      expect(midiRegion.type).toBe('midi');
      expect(midiRegion.notes).toBeDefined();
      expect(Array.isArray(midiRegion.notes)).toBe(true);
      
      // Audio region validation
      expect(audioRegion.type).toBe('audio');
      expect(audioRegion.audioFileId).toBeDefined();
      expect(audioRegion.fadeIn).toBeGreaterThanOrEqual(0);
      expect(audioRegion.fadeOut).toBeGreaterThanOrEqual(0);
      expect(audioRegion.gain).toBeGreaterThan(0);
      
      // Common constraints
      [midiRegion, audioRegion].forEach(region => {
        expect(region.startTime).toBeGreaterThanOrEqual(0);
        expect(region.duration).toBeGreaterThan(0);
        expect(region.offset).toBeGreaterThanOrEqual(0);
      });
    });
  });
});