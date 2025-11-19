import type { ArrangeRoomState, LockInfo, Track, Region } from '../domains/arrange-room/domain/models/ArrangeRoomState';

export class ArrangeRoomStateService {
  private roomStates = new Map<string, ArrangeRoomState>();

  /**
   * Get the current state for a room
   */
  getState(roomId: string): ArrangeRoomState | undefined {
    return this.roomStates.get(roomId);
  }

  /**
   * Initialize state for a new room
   */
  initializeState(roomId: string): ArrangeRoomState {
    const state: ArrangeRoomState = {
      roomId,
      tracks: [],
      regions: [],
      locks: new Map(),
      selectedTrackId: null,
      selectedRegionIds: [],
      synthStates: {},
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      lastUpdated: new Date(),
    };
    this.roomStates.set(roomId, state);
    return state;
  }

  /**
   * Update state with changes
   */
  updateState(roomId: string, updates: Partial<Omit<ArrangeRoomState, 'roomId' | 'locks'>> & { locks?: Map<string, LockInfo> }): ArrangeRoomState {
    const currentState = this.roomStates.get(roomId);
    if (!currentState) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    const updatedState: ArrangeRoomState = {
      ...currentState,
      ...updates,
      locks: updates.locks ?? currentState.locks,
      lastUpdated: new Date(),
    };

    this.roomStates.set(roomId, updatedState);
    return updatedState;
  }

  /**
   * Add a track
   */
  addTrack(roomId: string, track: Track): ArrangeRoomState {
    const state = this.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    return this.updateState(roomId, {
      tracks: [...state.tracks, track],
    });
  }

  /**
   * Update a track
   */
  updateTrack(roomId: string, trackId: string, updates: Partial<Track>): ArrangeRoomState {
    const state = this.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    return this.updateState(roomId, {
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, ...updates } : t)),
    });
  }

  /**
   * Remove a track
   */
  removeTrack(roomId: string, trackId: string): ArrangeRoomState {
    const state = this.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    // Also remove regions associated with this track
    const regionsToRemove = state.regions.filter((r) => r.trackId === trackId).map((r) => r.id);
    const updatedRegions = state.regions.filter((r) => r.trackId !== trackId);

    return this.updateState(roomId, {
      tracks: state.tracks.filter((t) => t.id !== trackId),
      regions: updatedRegions,
      selectedTrackId: state.selectedTrackId === trackId ? null : state.selectedTrackId,
      selectedRegionIds: state.selectedRegionIds.filter((id) => !regionsToRemove.includes(id)),
    });
  }

  /**
   * Reorder tracks
   */
  reorderTracks(roomId: string, trackIds: string[]): ArrangeRoomState {
    const state = this.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    // Create a map of tracks by ID
    const trackMap = new Map(state.tracks.map((track) => [track.id, track]));
    
    // Reorder tracks based on the provided order
    const reorderedTracks = trackIds
      .map((id) => trackMap.get(id))
      .filter((track): track is Track => track !== undefined);
    
    // Add any tracks that weren't in the reorder list (safety check)
    const existingIds = new Set(trackIds);
    const remainingTracks = state.tracks.filter((track) => !existingIds.has(track.id));
    
    return this.updateState(roomId, {
      tracks: [...reorderedTracks, ...remainingTracks],
    });
  }

  /**
   * Add a region
   */
  addRegion(roomId: string, region: Region): ArrangeRoomState {
    const state = this.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    // Update track's regionIds
    const updatedTracks = state.tracks.map((t) =>
      t.id === region.trackId && !t.regionIds.includes(region.id)
        ? { ...t, regionIds: [...t.regionIds, region.id] }
        : t
    );

    return this.updateState(roomId, {
      tracks: updatedTracks,
      regions: [...state.regions, region],
    });
  }

  /**
   * Update a region
   */
  updateRegion(roomId: string, regionId: string, updates: Partial<Region>): ArrangeRoomState {
    const state = this.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    const existingRegion = state.regions.find((r) => r.id === regionId);
    if (!existingRegion) {
      throw new Error(`Region ${regionId} not found in room ${roomId}`);
    }

    const updatedRegion: Region = { ...existingRegion, ...updates } as Region;

    let updatedTracks = state.tracks;
    if (updates.trackId && updates.trackId !== existingRegion.trackId) {
      updatedTracks = state.tracks.map((track) => {
        if (track.id === existingRegion.trackId) {
          return {
            ...track,
            regionIds: track.regionIds.filter((id) => id !== regionId),
          };
        }
        if (track.id === updates.trackId && !track.regionIds.includes(regionId)) {
          return {
            ...track,
            regionIds: [...track.regionIds, regionId],
          };
        }
        return track;
      });
    }

    return this.updateState(roomId, {
      tracks: updatedTracks,
      regions: state.regions.map((r) => (r.id === regionId ? updatedRegion : r)),
    });
  }

  setBpm(roomId: string, bpm: number): ArrangeRoomState {
    return this.updateState(roomId, { bpm });
  }

  setTimeSignature(roomId: string, timeSignature: { numerator: number; denominator: number }): ArrangeRoomState {
    return this.updateState(roomId, { timeSignature });
  }

  updateSynthParams(roomId: string, trackId: string, params: Record<string, unknown>): ArrangeRoomState {
    const state = this.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }
    const currentSynth = state.synthStates[trackId] ?? {};
    return this.updateState(roomId, {
      synthStates: {
        ...state.synthStates,
        [trackId]: { ...currentSynth, ...params },
      },
    });
  }

  /**
   * Remove a region
   */
  removeRegion(roomId: string, regionId: string): ArrangeRoomState {
    const state = this.getState(roomId);
    if (!state) {
      throw new Error(`Room state not found for room: ${roomId}`);
    }

    const region = state.regions.find((r) => r.id === regionId);
    const updatedTracks = region
      ? state.tracks.map((t) =>
          t.id === region.trackId
            ? { ...t, regionIds: t.regionIds.filter((id) => id !== regionId) }
            : t
        )
      : state.tracks;

    return this.updateState(roomId, {
      tracks: updatedTracks,
      regions: state.regions.filter((r) => r.id !== regionId),
      selectedRegionIds: state.selectedRegionIds.filter((id) => id !== regionId),
    });
  }

  /**
   * Acquire a lock
   */
  acquireLock(roomId: string, elementId: string, lockInfo: LockInfo): boolean {
    const state = this.getState(roomId);
    if (!state) {
      return false;
    }

    // Check if already locked by someone else
    const existingLock = state.locks.get(elementId);
    if (existingLock && existingLock.userId !== lockInfo.userId) {
      return false; // Lock conflict
    }

    const newLocks = new Map(state.locks);
    newLocks.set(elementId, lockInfo);

    this.updateState(roomId, { locks: newLocks });
    return true;
  }

  /**
   * Release a lock
   */
  releaseLock(roomId: string, elementId: string, userId: string): boolean {
    const state = this.getState(roomId);
    if (!state) {
      return false;
    }

    const lock = state.locks.get(elementId);
    if (!lock || lock.userId !== userId) {
      return false; // Not locked by this user
    }

    const newLocks = new Map(state.locks);
    newLocks.delete(elementId);

    this.updateState(roomId, { locks: newLocks });
    return true;
  }

  /**
   * Release all locks for a user (e.g., when they leave)
   */
  releaseUserLocks(roomId: string, userId: string): void {
    const state = this.getState(roomId);
    if (!state) {
      return;
    }

    const newLocks = new Map(state.locks);
    for (const [elementId, lock] of state.locks.entries()) {
      if (lock.userId === userId) {
        newLocks.delete(elementId);
      }
    }

    this.updateState(roomId, { locks: newLocks });
  }

  /**
   * Update selection state
   */
  updateSelection(roomId: string, selectedTrackId: string | null, selectedRegionIds: string[]): ArrangeRoomState {
    return this.updateState(roomId, {
      selectedTrackId,
      selectedRegionIds,
    });
  }

  /**
   * Clear state for a room
   */
  clearState(roomId: string): void {
    this.roomStates.delete(roomId);
  }

  /**
   * Check if an element is locked
   */
  isLocked(roomId: string, elementId: string): LockInfo | null {
    const state = this.getState(roomId);
    if (!state) {
      return null;
    }
    return state.locks.get(elementId) || null;
  }
}

