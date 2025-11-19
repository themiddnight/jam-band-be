import { Socket, Namespace } from 'socket.io';
import { ArrangeRoomStateService } from '../../../../services/ArrangeRoomStateService';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import { RoomService } from '../../../../services/RoomService';
import { loggingService } from '../../../../services/LoggingService';
import { AudioRegionStorageService } from '../../../../services/AudioRegionStorageService';
import type { Track, Region, LockInfo, ArrangeTimeSignature, AudioRegion } from '../../domain/models/ArrangeRoomState';

export class ArrangeRoomHandler {
  constructor(
    private arrangeRoomStateService: ArrangeRoomStateService,
    private roomSessionManager: RoomSessionManager,
    private roomService: RoomService,
    private audioRegionStorageService?: AudioRegionStorageService
  ) {}

  /**
   * Get session info from socket
   */
  private getSession(socket: Socket): { roomId: string; userId: string; username: string } | null {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return null;
    }

    const room = this.roomService.getRoom(session.roomId);
    if (!room || room.roomType !== 'arrange') {
      return null;
    }

    const user = room.users.get(session.userId);
    if (!user) {
      return null;
    }

    return {
      roomId: session.roomId,
      userId: session.userId,
      username: user.username,
    };
  }

  /**
   * Handle request for current state (late joiner)
   */
  handleRequestState(socket: Socket, data: { roomId: string }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      socket.emit('error', { message: 'Invalid session or room' });
      return;
    }

    const state = this.arrangeRoomStateService.getState(data.roomId);
    if (!state) {
      // Initialize empty state
      this.arrangeRoomStateService.initializeState(data.roomId);
    socket.emit('arrange:state_sync', {
      tracks: [],
      regions: [],
      locks: [],
      selectedTrackId: null,
      selectedRegionIds: [],
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      synthStates: {},
    });
      return;
    }

    // Convert locks Map to array for JSON serialization
    const locksArray = Array.from(state.locks.entries()).map(([elementId, lock]) => ({
      elementId,
      ...lock,
    }));

    socket.emit('arrange:state_sync', {
      tracks: state.tracks,
      regions: state.regions,
      locks: locksArray,
      selectedTrackId: state.selectedTrackId,
      selectedRegionIds: state.selectedRegionIds,
    bpm: state.bpm,
    timeSignature: state.timeSignature,
    synthStates: state.synthStates,
    });

    loggingService.logInfo('Arrange room state requested', {
      roomId: data.roomId,
      userId: session.userId,
      trackCount: state.tracks.length,
      regionCount: state.regions.length,
    });
  }

  /**
   * Handle track add
   */
  handleTrackAdd(socket: Socket, namespace: Namespace, data: { roomId: string; track: Track }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      this.arrangeRoomStateService.addTrack(data.roomId, data.track);
      namespace.to(data.roomId).emit('arrange:track_added', { track: data.track, userId: session.userId });
      loggingService.logInfo('Track added', { roomId: data.roomId, trackId: data.track.id, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleTrackAdd', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to add track' });
    }
  }

  /**
   * Handle track update
   */
  handleTrackUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; updates: Partial<Track> }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Check if track property is locked
    const lockKey = `track_${data.trackId}_property`;
    const lock = this.arrangeRoomStateService.isLocked(data.roomId, lockKey);
    if (lock && lock.userId !== session.userId) {
      socket.emit('arrange:lock_conflict', { elementId: lockKey, lockedBy: lock.username });
      return;
    }

    try {
      this.arrangeRoomStateService.updateTrack(data.roomId, data.trackId, data.updates);
      namespace.to(data.roomId).emit('arrange:track_updated', {
        trackId: data.trackId,
        updates: data.updates,
        userId: session.userId,
      });
      loggingService.logInfo('Track updated', { roomId: data.roomId, trackId: data.trackId, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleTrackUpdate', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to update track' });
    }
  }

  /**
   * Handle track delete
   */
  handleTrackDelete(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      const state = this.arrangeRoomStateService.getState(data.roomId);
      const audioRegions =
        state?.regions.filter(
          (region): region is AudioRegion =>
            region.trackId === data.trackId && region.type === 'audio'
        ) ?? [];

      this.arrangeRoomStateService.removeTrack(data.roomId, data.trackId);
      namespace.to(data.roomId).emit('arrange:track_deleted', { trackId: data.trackId, userId: session.userId });
      loggingService.logInfo('Track deleted', { roomId: data.roomId, trackId: data.trackId, userId: session.userId });

      const storage = this.audioRegionStorageService;
      if (audioRegions.length && storage && state) {
        const removedIds = new Set(audioRegions.map((region) => region.id));
        const handledStorageIds = new Set<string>();
        const deletionPromises = audioRegions.map(async (region) => {
          const audioUrl = region.audioUrl;
          const hasOtherReferences =
            !!audioUrl &&
            state.regions.some(
              (candidate) =>
                !removedIds.has(candidate.id) &&
                candidate.type === 'audio' &&
                candidate.audioUrl === audioUrl
            );

          if (hasOtherReferences) {
            return;
          }

          const storageRegionId =
            (audioUrl && storage.extractRegionIdFromPlaybackPath(audioUrl)) || region.id;

          if (handledStorageIds.has(storageRegionId)) {
            return;
          }

          handledStorageIds.add(storageRegionId);

          await storage
            .deleteRegionAudio(data.roomId, storageRegionId)
            .catch((error) =>
              loggingService.logError(error as Error, {
                context: 'ArrangeRoomHandler:deleteTrackAudio',
                roomId: data.roomId,
                regionId: storageRegionId,
              })
            );
        });

        void Promise.all(deletionPromises);
      }
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleTrackDelete', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to delete track' });
    }
  }

  /**
   * Handle track reorder
   */
  handleTrackReorder(socket: Socket, namespace: Namespace, data: { roomId: string; trackIds: string[] }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      this.arrangeRoomStateService.reorderTracks(data.roomId, data.trackIds);
      namespace.to(data.roomId).emit('arrange:track_reordered', {
        trackIds: data.trackIds,
        userId: session.userId,
      });
      loggingService.logInfo('Tracks reordered', {
        roomId: data.roomId,
        trackCount: data.trackIds.length,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeRoomHandler:handleTrackReorder',
        roomId: data.roomId,
      });
      socket.emit('error', { message: 'Failed to reorder tracks' });
    }
  }

  /**
   * Handle track instrument change
   */
  handleTrackInstrumentChange(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; instrumentId: string; instrumentCategory?: string }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      const updates: Partial<Track> = {
        instrumentId: data.instrumentId,
      };
      if (data.instrumentCategory !== undefined) {
        updates.instrumentCategory = data.instrumentCategory;
      }
      this.arrangeRoomStateService.updateTrack(data.roomId, data.trackId, updates);
      namespace.to(data.roomId).emit('arrange:track_instrument_changed', {
        trackId: data.trackId,
        instrumentId: data.instrumentId,
        instrumentCategory: data.instrumentCategory,
        userId: session.userId,
      });
      loggingService.logInfo('Track instrument changed', {
        roomId: data.roomId,
        trackId: data.trackId,
        instrumentId: data.instrumentId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeRoomHandler:handleTrackInstrumentChange',
        roomId: data.roomId,
      });
      socket.emit('error', { message: 'Failed to change track instrument' });
    }
  }

  /**
   * Handle synth parameter update
   */
  handleSynthParamsUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; params: Record<string, unknown> }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      this.arrangeRoomStateService.updateSynthParams(data.roomId, data.trackId, data.params);
      namespace.to(data.roomId).emit('arrange:synth_params_updated', {
        trackId: data.trackId,
        params: data.params,
        userId: session.userId,
      });
      loggingService.logInfo('Synth params updated', {
        roomId: data.roomId,
        trackId: data.trackId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeRoomHandler:handleSynthParamsUpdate',
        roomId: data.roomId,
      });
      socket.emit('error', { message: 'Failed to update synth parameters' });
    }
  }

  /**
   * Handle BPM change
   */
  handleBpmChange(socket: Socket, namespace: Namespace, data: { roomId: string; bpm: number }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      this.arrangeRoomStateService.setBpm(data.roomId, data.bpm);
      namespace.to(data.roomId).emit('arrange:bpm_changed', {
        bpm: data.bpm,
        userId: session.userId,
      });
      loggingService.logInfo('BPM changed', {
        roomId: data.roomId,
        bpm: data.bpm,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeRoomHandler:handleBpmChange',
        roomId: data.roomId,
      });
      socket.emit('error', { message: 'Failed to change BPM' });
    }
  }

  /**
   * Handle time signature change
   */
  handleTimeSignatureChange(socket: Socket, namespace: Namespace, data: { roomId: string; timeSignature: ArrangeTimeSignature }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      this.arrangeRoomStateService.setTimeSignature(data.roomId, data.timeSignature);
      namespace.to(data.roomId).emit('arrange:time_signature_changed', {
        timeSignature: data.timeSignature,
        userId: session.userId,
      });
      loggingService.logInfo('Time signature changed', {
        roomId: data.roomId,
        timeSignature: data.timeSignature,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeRoomHandler:handleTimeSignatureChange',
        roomId: data.roomId,
      });
      socket.emit('error', { message: 'Failed to change time signature' });
    }
  }

  /**
   * Handle region add
   */
  handleRegionAdd(socket: Socket, namespace: Namespace, data: { roomId: string; region: Region }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      this.arrangeRoomStateService.addRegion(data.roomId, data.region);
      namespace.to(data.roomId).emit('arrange:region_added', { region: data.region, userId: session.userId });
      loggingService.logInfo('Region added', { roomId: data.roomId, regionId: data.region.id, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleRegionAdd', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to add region' });
    }
  }

  /**
   * Handle region update
   */
  handleRegionUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; updates: Partial<Region> }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Check if region is locked
    const lock = this.arrangeRoomStateService.isLocked(data.roomId, data.regionId);
    if (lock && lock.userId !== session.userId) {
      socket.emit('arrange:lock_conflict', { elementId: data.regionId, lockedBy: lock.username });
      return;
    }

    try {
      this.arrangeRoomStateService.updateRegion(data.roomId, data.regionId, data.updates);
      namespace.to(data.roomId).emit('arrange:region_updated', {
        regionId: data.regionId,
        updates: data.updates,
        userId: session.userId,
      });
      loggingService.logInfo('Region updated', { roomId: data.roomId, regionId: data.regionId, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleRegionUpdate', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to update region' });
    }
  }

  /**
   * Handle region move
   */
  handleRegionMove(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; deltaBeats: number }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Check if region is locked
    const lock = this.arrangeRoomStateService.isLocked(data.roomId, data.regionId);
    if (lock && lock.userId !== session.userId) {
      socket.emit('arrange:lock_conflict', { elementId: data.regionId, lockedBy: lock.username });
      return;
    }

    try {
      const state = this.arrangeRoomStateService.getState(data.roomId);
      if (!state) {
        return;
      }

      const region = state.regions.find((r) => r.id === data.regionId);
      if (!region) {
        return;
      }

      const newStart = Math.max(0, region.start + data.deltaBeats);
      this.arrangeRoomStateService.updateRegion(data.roomId, data.regionId, { start: newStart });
      namespace.to(data.roomId).emit('arrange:region_moved', {
        regionId: data.regionId,
        newStart,
        userId: session.userId,
      });
      loggingService.logInfo('Region moved', { roomId: data.roomId, regionId: data.regionId, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleRegionMove', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to move region' });
    }
  }

  /**
   * Handle region delete
   */
  handleRegionDelete(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Check if region is locked
    const lock = this.arrangeRoomStateService.isLocked(data.roomId, data.regionId);
    if (lock && lock.userId !== session.userId) {
      socket.emit('arrange:lock_conflict', { elementId: data.regionId, lockedBy: lock.username });
      return;
    }

    try {
      const state = this.arrangeRoomStateService.getState(data.roomId);
      const region = state?.regions.find((r) => r.id === data.regionId);

      this.arrangeRoomStateService.removeRegion(data.roomId, data.regionId);
      namespace.to(data.roomId).emit('arrange:region_deleted', { regionId: data.regionId, userId: session.userId });
      loggingService.logInfo('Region deleted', { roomId: data.roomId, regionId: data.regionId, userId: session.userId });

      const storage = this.audioRegionStorageService;
      if (region?.type === 'audio' && storage && state) {
        const audioUrl = region.audioUrl;
        const hasOtherReferences =
          !!audioUrl &&
          state.regions.some(
            (candidate) =>
              candidate.id !== region.id &&
              candidate.type === 'audio' &&
              candidate.audioUrl === audioUrl
          );

        if (!hasOtherReferences) {
          const storageRegionId =
            (audioUrl && storage.extractRegionIdFromPlaybackPath(audioUrl)) || region.id;

          storage
            .deleteRegionAudio(data.roomId, storageRegionId)
            .catch((error) =>
              loggingService.logError(error as Error, {
                context: 'ArrangeRoomHandler:handleRegionDeleteAudio',
                roomId: data.roomId,
                regionId: storageRegionId,
              })
            );
        }
      }
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleRegionDelete', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to delete region' });
    }
  }

  /**
   * Handle note add
   */
  handleNoteAdd(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; note: any }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Check if region is locked
    const lock = this.arrangeRoomStateService.isLocked(data.roomId, data.regionId);
    if (lock && lock.userId !== session.userId) {
      socket.emit('arrange:lock_conflict', { elementId: data.regionId, lockedBy: lock.username });
      return;
    }

    try {
      const state = this.arrangeRoomStateService.getState(data.roomId);
      if (!state) {
        return;
      }

      const region = state.regions.find((r) => r.id === data.regionId && r.type === 'midi');
      if (!region || region.type !== 'midi') {
        return;
      }

      const updatedNotes = [...region.notes, data.note];
      this.arrangeRoomStateService.updateRegion(data.roomId, data.regionId, { notes: updatedNotes });
      namespace.to(data.roomId).emit('arrange:note_added', {
        regionId: data.regionId,
        note: data.note,
        userId: session.userId,
      });
      loggingService.logInfo('Note added', {
        roomId: data.roomId,
        regionId: data.regionId,
        noteId: data.note.id,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleNoteAdd', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to add note' });
    }
  }

  /**
   * Handle note update
   */
  handleNoteUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; noteId: string; updates: any }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Check if region is locked
    const lock = this.arrangeRoomStateService.isLocked(data.roomId, data.regionId);
    if (lock && lock.userId !== session.userId) {
      socket.emit('arrange:lock_conflict', { elementId: data.regionId, lockedBy: lock.username });
      return;
    }

    try {
      const state = this.arrangeRoomStateService.getState(data.roomId);
      if (!state) {
        return;
      }

      const region = state.regions.find((r) => r.id === data.regionId && r.type === 'midi');
      if (!region || region.type !== 'midi') {
        return;
      }

      const updatedNotes = region.notes.map((note) =>
        note.id === data.noteId ? { ...note, ...data.updates } : note
      );
      this.arrangeRoomStateService.updateRegion(data.roomId, data.regionId, { notes: updatedNotes });
      namespace.to(data.roomId).emit('arrange:note_updated', {
        regionId: data.regionId,
        noteId: data.noteId,
        updates: data.updates,
        userId: session.userId,
      });
      loggingService.logInfo('Note updated', {
        roomId: data.roomId,
        regionId: data.regionId,
        noteId: data.noteId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleNoteUpdate', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to update note' });
    }
  }

  /**
   * Handle note delete
   */
  handleNoteDelete(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; noteId: string }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Check if region is locked
    const lock = this.arrangeRoomStateService.isLocked(data.roomId, data.regionId);
    if (lock && lock.userId !== session.userId) {
      socket.emit('arrange:lock_conflict', { elementId: data.regionId, lockedBy: lock.username });
      return;
    }

    try {
      const state = this.arrangeRoomStateService.getState(data.roomId);
      if (!state) {
        return;
      }

      const region = state.regions.find((r) => r.id === data.regionId && r.type === 'midi');
      if (!region || region.type !== 'midi') {
        return;
      }

      const updatedNotes = region.notes.filter((note) => note.id !== data.noteId);
      this.arrangeRoomStateService.updateRegion(data.roomId, data.regionId, { notes: updatedNotes });
      namespace.to(data.roomId).emit('arrange:note_deleted', {
        regionId: data.regionId,
        noteId: data.noteId,
        userId: session.userId,
      });
      loggingService.logInfo('Note deleted', {
        roomId: data.roomId,
        regionId: data.regionId,
        noteId: data.noteId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRoomHandler:handleNoteDelete', roomId: data.roomId });
      socket.emit('error', { message: 'Failed to delete note' });
    }
  }

  /**
   * Handle effect chain update
   */
  handleEffectChainUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; chainType: string; effectChain: any }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Check if track property is locked
    const lockKey = `track_${data.trackId}_property`;
    const lock = this.arrangeRoomStateService.isLocked(data.roomId, lockKey);
    if (lock && lock.userId !== session.userId) {
      socket.emit('arrange:lock_conflict', { elementId: lockKey, lockedBy: lock.username });
      return;
    }

    try {
      // Store effect chain in track metadata (we'll need to extend Track type or use a separate store)
      // For now, we'll just broadcast it
      namespace.to(data.roomId).emit('arrange:effect_chain_updated', {
        trackId: data.trackId,
        chainType: data.chainType,
        effectChain: data.effectChain,
        userId: session.userId,
      });
      loggingService.logInfo('Effect chain updated', {
        roomId: data.roomId,
        trackId: data.trackId,
        chainType: data.chainType,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeRoomHandler:handleEffectChainUpdate',
        roomId: data.roomId,
      });
      socket.emit('error', { message: 'Failed to update effect chain' });
    }
  }

  /**
   * Handle selection change
   */
  handleSelectionChange(socket: Socket, namespace: Namespace, data: { roomId: string; selectedTrackId?: string | null; selectedRegionIds?: string[] }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      const state = this.arrangeRoomStateService.getState(data.roomId);
      if (!state) {
        return;
      }

      const selectedTrackId = data.selectedTrackId !== undefined ? data.selectedTrackId : state.selectedTrackId;
      const selectedRegionIds = data.selectedRegionIds !== undefined ? data.selectedRegionIds : state.selectedRegionIds;

      this.arrangeRoomStateService.updateSelection(data.roomId, selectedTrackId, selectedRegionIds);
      namespace.to(data.roomId).emit('arrange:selection_changed', {
        selectedTrackId,
        selectedRegionIds,
        userId: session.userId,
        username: session.username,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeRoomHandler:handleSelectionChange',
        roomId: data.roomId,
      });
    }
  }

  /**
   * Handle lock acquire
   */
  handleLockAcquire(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string; type: 'region' | 'track' | 'track_property' }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const lockInfo: LockInfo = {
      userId: session.userId,
      username: session.username,
      type: data.type,
      timestamp: Date.now(),
    };

    const acquired = this.arrangeRoomStateService.acquireLock(data.roomId, data.elementId, lockInfo);
    if (acquired) {
      namespace.to(data.roomId).emit('arrange:lock_acquired', {
        elementId: data.elementId,
        lockInfo,
      });
    } else {
      const existingLock = this.arrangeRoomStateService.isLocked(data.roomId, data.elementId);
      socket.emit('arrange:lock_conflict', {
        elementId: data.elementId,
        lockedBy: existingLock?.username || 'Unknown',
      });
    }
  }

  /**
   * Handle lock release
   */
  handleLockRelease(socket: Socket, namespace: Namespace, data: { roomId: string; elementId: string }): void {
    const session = this.getSession(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const released = this.arrangeRoomStateService.releaseLock(data.roomId, data.elementId, session.userId);
    if (released) {
      namespace.to(data.roomId).emit('arrange:lock_released', {
        elementId: data.elementId,
      });
    }
  }

  /**
   * Clean up locks when user leaves
   */
  handleUserLeave(roomId: string, userId: string): void {
    this.arrangeRoomStateService.releaseUserLocks(roomId, userId);
  }
}

