/**
 * DAW-specific types for backend project storage system
 * Mirrors frontend types but optimized for database storage
 */

// ============================================================================
// Project Types
// ============================================================================

export interface ProjectRecord {
  id: string;
  name: string;
  roomId: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  
  // Timeline settings
  tempo: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  length: number; // in bars
  
  // Project settings (stored as JSON)
  settings: ProjectSettings;
  
  // Collaboration
  collaborators: string[]; // Array of user IDs
  
  // Versioning
  version: number;
  lastSaved: Date;
  
  // Click track settings (stored as JSON)
  clickTrackSettings?: ClickTrackSettings;
}

export interface ProjectSettings {
  autoSave: boolean;
  autoSaveInterval: number; // in seconds
  snapToGrid: boolean;
  gridResolution: number; // in beats
  defaultTrackHeight: number;
  showWaveforms: boolean;
  showMIDINotes: boolean;
}

export interface ClickTrackSettings {
  enabled: boolean;
  volume: number; // 0-1
  sound: 'click' | 'beep' | 'wood' | 'digital';
  accentBeats: boolean;
}

// ============================================================================
// Track Types
// ============================================================================

export type TrackType = 'midi' | 'audio';

export interface TrackRecord {
  id: string;
  projectId: string;
  name: string;
  type: TrackType;
  
  // Visual properties
  color: string;
  order: number;
  height: number;
  
  // Audio properties
  muted: boolean;
  soloed: boolean;
  volume: number; // 0-1
  pan: number; // -1 to 1
  
  // Effects
  effectChainId?: string;
  
  // MIDI-specific properties (null for audio tracks)
  instrumentId?: string;
  midiChannel?: number; // 0-15
  
  // Audio-specific properties (null for MIDI tracks)
  inputSource?: string;
  
  // Settings (stored as JSON)
  settings: TrackSettings;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface TrackSettings {
  recordEnabled: boolean;
  monitorInput: boolean;
  frozen: boolean;
  
  // MIDI-specific settings
  velocityCurve?: 'linear' | 'exponential' | 'logarithmic';
  quantizeInput?: boolean;
  quantizeResolution?: number; // in beats
  transposeOctaves?: number;
  transposeSemitones?: number;
  
  // Audio-specific settings
  inputGain?: number; // 0-2 (200%)
  lowCutFilter?: boolean;
  lowCutFrequency?: number; // Hz
  phaseInvert?: boolean;
}

// ============================================================================
// Region Types
// ============================================================================

export type RegionType = 'midi' | 'audio';

export interface RegionRecord {
  id: string;
  trackId: string;
  projectId: string;
  type: RegionType;
  
  // Timeline positioning
  startTime: number; // in beats
  duration: number; // in beats
  offset: number; // offset within the source material (in beats)
  
  // Visual properties
  name: string;
  color?: string;
  
  // State
  selected: boolean;
  muted: boolean;
  
  // MIDI-specific properties (null for audio regions)
  notes?: MIDINoteEvent[]; // Stored as JSON
  quantization?: number; // Grid quantization in beats
  velocity?: number; // Global velocity multiplier (0-1)
  
  // Audio-specific properties (null for MIDI regions)
  audioFileId?: string;
  audioFileName?: string;
  fadeIn?: number; // in beats
  fadeOut?: number; // in beats
  gain?: number; // 0-2 (200%)
  pitch?: number; // semitones (-12 to +12)
  timeStretch?: number; // ratio (0.5 to 2.0)
  
  // Settings (stored as JSON)
  settings: RegionSettings;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface MIDINoteEvent {
  id: string;
  pitch: number; // MIDI note number (0-127)
  velocity: number; // 0-127
  startTime: number; // in beats
  duration: number; // in beats
  channel: number; // MIDI channel
}

export interface RegionSettings {
  // MIDI-specific settings
  showNotes?: boolean;
  noteHeight?: number;
  velocityOpacity?: boolean;
  colorByVelocity?: boolean;
  colorByPitch?: boolean;
  
  // Audio-specific settings
  showWaveform?: boolean;
  waveformDetail?: 'low' | 'medium' | 'high';
  normalizeDisplay?: boolean;
  showSpectrum?: boolean;
}

// ============================================================================
// Audio File Types
// ============================================================================

export interface AudioFileRecord {
  id: string;
  projectId: string;
  filename: string;
  originalName: string;
  size: number;
  duration: number; // in seconds
  sampleRate: number;
  channels: number;
  format: string;
  
  // Storage
  storagePath: string;
  url: string;
  
  // Metadata
  uploadedBy: string;
  uploadedAt: Date;
  
  // Processing status
  processed: boolean;
  waveformData?: number[]; // Stored as JSON
  peakData?: number[]; // Stored as JSON
}

// ============================================================================
// Change Tracking Types
// ============================================================================

export interface ProjectChangeRecord {
  id: string;
  projectId: string;
  userId: string;
  timestamp: Date;
  changeType: ProjectChangeType;
  
  // Change data (stored as JSON)
  data: any;
  previousData?: any;
  
  // Versioning
  version: number;
  
  // Metadata
  description?: string;
}

export type ProjectChangeType = 
  | 'project_create'
  | 'project_update'
  | 'project_delete'
  | 'track_create'
  | 'track_update'
  | 'track_delete'
  | 'track_reorder'
  | 'region_create'
  | 'region_update'
  | 'region_delete'
  | 'region_move'
  | 'region_resize'
  | 'region_split'
  | 'audio_file_upload'
  | 'audio_file_delete'
  | 'transport_change'
  | 'collaboration_change';

// ============================================================================
// Marker Types
// ============================================================================

export interface MarkerRecord {
  id: string;
  projectId: string;
  name: string;
  position: number; // in beats
  color: string;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

// ============================================================================
// Complete Project State Types
// ============================================================================

export interface CompleteProjectState {
  project: ProjectRecord;
  tracks: TrackRecord[];
  regions: RegionRecord[];
  audioFiles: AudioFileRecord[];
  markers: MarkerRecord[];
  changes: ProjectChangeRecord[];
  timestamp: Date;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateProjectRequest {
  name: string;
  roomId: string;
  tempo?: number;
  timeSignature?: {
    numerator: number;
    denominator: number;
  };
  length?: number;
  settings?: Partial<ProjectSettings>;
}

export interface UpdateProjectRequest {
  name?: string;
  tempo?: number;
  timeSignatureNumerator?: number;
  timeSignatureDenominator?: number;
  length?: number;
  settings?: Partial<ProjectSettings>;
  clickTrackSettings?: ClickTrackSettings;
}

export interface CreateTrackRequest {
  name: string;
  type: TrackType;
  color?: string;
  instrumentId?: string; // For MIDI tracks
  settings?: Partial<TrackSettings>;
}

export interface UpdateTrackRequest {
  name?: string;
  color?: string;
  order?: number;
  height?: number;
  muted?: boolean;
  soloed?: boolean;
  volume?: number;
  pan?: number;
  effectChainId?: string;
  instrumentId?: string;
  midiChannel?: number;
  inputSource?: string;
  settings?: Partial<TrackSettings>;
}

export interface CreateRegionRequest {
  trackId: string;
  type: RegionType;
  startTime: number;
  duration: number;
  name?: string;
  
  // MIDI-specific
  notes?: MIDINoteEvent[];
  quantization?: number;
  velocity?: number;
  
  // Audio-specific
  audioFileId?: string;
  fadeIn?: number;
  fadeOut?: number;
  gain?: number;
  pitch?: number;
  timeStretch?: number;
  
  settings?: Partial<RegionSettings>;
}

export interface UpdateRegionRequest {
  startTime?: number;
  duration?: number;
  offset?: number;
  name?: string;
  color?: string;
  selected?: boolean;
  muted?: boolean;
  
  // MIDI-specific
  notes?: MIDINoteEvent[];
  quantization?: number;
  velocity?: number;
  
  // Audio-specific
  audioFileId?: string;
  audioFileName?: string;
  // Optional convenience field (not stored directly on RegionRecord)
  audioFileUrl?: string;
  fadeIn?: number;
  fadeOut?: number;
  gain?: number;
  pitch?: number;
  timeStretch?: number;
  
  settings?: Partial<RegionSettings>;
}

export interface UploadAudioFileRequest {
  projectId: string;
  file: Buffer;
  filename: string;
  originalName: string;
  format: string;
}

// ============================================================================
// Storage Configuration
// ============================================================================

export interface StorageConfig {
  audioFilesPath: string;
  maxFileSize: number; // in bytes
  allowedFormats: string[];
  waveformResolution: number;
  peakDataResolution: number;
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  audioFilesPath: './storage/audio-files',
  maxFileSize: 100 * 1024 * 1024, // 100MB
  allowedFormats: ['wav', 'mp3', 'flac', 'aac', 'm4a'],
  waveformResolution: 1024,
  peakDataResolution: 256,
};