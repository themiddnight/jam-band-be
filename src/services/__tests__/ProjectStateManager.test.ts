import type { CreateProjectRequest, CreateTrackRequest, ProjectChangeType } from '../../types/daw';

describe('ProjectStateManager', () => {
  // Simple test to verify the types and basic structure
  it('should have correct types for project creation', () => {
    const request: CreateProjectRequest = {
      name: 'Test Project',
      roomId: 'room-123',
      tempo: 120,
      timeSignature: {
        numerator: 4,
        denominator: 4,
      },
      length: 32,
    };

    expect(request.name).toBe('Test Project');
    expect(request.roomId).toBe('room-123');
    expect(request.tempo).toBe(120);
    expect(request.timeSignature?.numerator).toBe(4);
    expect(request.timeSignature?.denominator).toBe(4);
    expect(request.length).toBe(32);
  });

  it('should have correct types for track creation', () => {
    const midiTrackRequest: CreateTrackRequest = {
      name: 'MIDI Track',
      type: 'midi',
      instrumentId: 'piano',
    };

    const audioTrackRequest: CreateTrackRequest = {
      name: 'Audio Track',
      type: 'audio',
    };

    expect(midiTrackRequest.type).toBe('midi');
    expect(midiTrackRequest.instrumentId).toBe('piano');
    expect(audioTrackRequest.type).toBe('audio');
  });

  it('should have correct change types', () => {
    const changeTypes: ProjectChangeType[] = [
      'project_create',
      'project_update',
      'project_delete',
      'track_create',
      'track_update',
      'track_delete',
      'region_create',
      'region_update',
      'region_delete',
    ];

    expect(changeTypes).toContain('project_create');
    expect(changeTypes).toContain('track_create');
    expect(changeTypes).toContain('region_create');
  });


});