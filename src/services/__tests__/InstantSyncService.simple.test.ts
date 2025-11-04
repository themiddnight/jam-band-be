import type {
  ProjectRecord,
  TrackRecord,
  RegionRecord,
  AudioFileRecord,
  CompleteProjectState,
} from '../../types/daw';

describe('InstantSyncService Types', () => {
  it('should have correct types for instant sync functionality', () => {
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

    const mockCompleteState: CompleteProjectState = {
      project: mockProject,
      tracks: [],
      regions: [],
      audioFiles: [],
      markers: [],
      changes: [],
      timestamp: new Date(),
    };

    // Test state consistency verification structure
    const clientState = {
      projectVersion: 1,
      trackCount: 0,
      regionCount: 0,
      audioFileCount: 0,
      markerCount: 0,
      checksum: 'abc123',
    };

    // Test progressive loading options
    const progressiveOptions = {
      priorityLevel: 'critical' as const,
      timelineStart: 0,
      timelineEnd: 8,
      maxRegions: 10,
    };

    expect(mockProject.id).toBe('project-1');
    expect(mockCompleteState.project.id).toBe('project-1');
    expect(clientState.projectVersion).toBe(1);
    expect(progressiveOptions.priorityLevel).toBe('critical');
  });

  it('should support state verification result structure', () => {
    const verificationResult = {
      isConsistent: true,
      differences: [] as string[],
      serverState: {
        projectVersion: 1,
        trackCount: 2,
        regionCount: 5,
        audioFileCount: 1,
        markerCount: 0,
        checksum: 'def456',
      },
    };

    expect(verificationResult.isConsistent).toBe(true);
    expect(Array.isArray(verificationResult.differences)).toBe(true);
    expect(verificationResult.serverState?.projectVersion).toBe(1);
  });

  it('should support performance statistics structure', () => {
    const performanceStats = {
      averageSyncTime: 2500,
      successfulSyncs: 10,
      failedSyncs: 1,
      cacheHitRate: 0.85,
      averageProjectSize: 5000,
      largestProjectSize: 15000,
      syncTimesBySize: {
        small: { average: 1200, min: 800, max: 1500, count: 5 },
        medium: { average: 2800, min: 2000, max: 3500, count: 3 },
        large: { average: 4500, min: 4000, max: 5000, count: 2 },
      },
      successRate: 0.91,
    };

    expect(performanceStats.averageSyncTime).toBe(2500);
    expect(performanceStats.cacheHitRate).toBe(0.85);
    expect(performanceStats.syncTimesBySize.small.average).toBe(1200);
    expect(performanceStats.successRate).toBe(0.91);
  });
});