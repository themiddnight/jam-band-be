export type TrackId = string;
export type RegionId = string;
export type NoteId = string;

export type TrackType = 'midi' | 'audio';

export type LockType =
  | 'region'
  | 'track'
  | 'track_property'
  | 'note'
  | 'sustain'
  | 'control';

export interface LockInfo {
  userId: string;
  username: string;
  type: LockType;
  timestamp: number;
}

export interface MidiNote {
  id: NoteId;
  pitch: number;
  velocity: number;
  start: number;
  duration: number;
}

export interface SustainEvent {
  id: string;
  start: number;
  end: number;
}

export interface BaseRegion {
  id: RegionId;
  trackId: TrackId;
  name: string;
  start: number;
  length: number;
  loopEnabled: boolean;
  loopIterations: number;
  color?: string;
  type: TrackType;
}

export interface MidiRegion extends BaseRegion {
  type: 'midi';
  notes: MidiNote[];
  sustainEvents: SustainEvent[];
}

export interface AudioRegion extends BaseRegion {
  type: 'audio';
  audioUrl?: string;
  trimStart?: number;
  originalLength?: number;
  gain?: number;
  fadeInDuration?: number;
  fadeOutDuration?: number;
}

export type Region = MidiRegion | AudioRegion;

export interface Track {
  id: TrackId;
  name: string;
  type: TrackType;
  instrumentId?: string;
  instrumentCategory?: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  color: string;
  regionIds: RegionId[];
}

export interface ArrangeTimeSignature {
  numerator: number;
  denominator: number;
}

export interface TimeMarker {
  id: string;
  position: number;
  description: string;
  color?: string;
}

export interface EffectParameterState {
  name: string;
  value: number;
}

export interface EffectInstanceState {
  id: string;
  type: string;
  bypassed: boolean;
  order: number;
  parameters: EffectParameterState[];
}

export interface EffectChainState {
  type: string;
  effects: EffectInstanceState[];
}

export interface ArrangeRoomState {
  roomId: string;
  tracks: Track[];
  regions: Region[];
  locks: Map<string, LockInfo>;
  selectedTrackId: string | null;
  selectedRegionIds: string[];
  bpm: number;
  timeSignature: ArrangeTimeSignature;
  ownerScale?: { rootNote: string; scale: 'major' | 'minor' };
  synthStates: Record<string, Record<string, unknown>>;
  effectChains: Record<string, EffectChainState>; // Key is chainType (e.g., "track:trackId")
  markers: TimeMarker[];
  voiceStates: Record<string, { isMuted: boolean }>;
  broadcastStates: Record<
    string,
    {
      username: string;
      trackId: string | null;
    }
  >;
  lastUpdated: Date;
}


