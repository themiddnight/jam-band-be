import { AudioBus } from '../models/AudioBus';
import { MixerChannel } from '../models/MixerChannel';
import { UserAudioState } from '../models/InstrumentSwapSession';

/**
 * Audio Processing Types
 * 
 * Type definitions for audio processing coordination and services.
 * 
 * Requirements: 10.2, 10.3
 */

export interface UserAudioSetupResult {
  audioBus: AudioBus;
  mixerChannel: MixerChannel;
  isReady: boolean;
  setupLatency: number;
}

export interface SwapValidationResult {
  canSwap: boolean;
  issues: string[];
  estimatedSwapTime: number;
}

export interface SwapCoordinationResult {
  success: boolean;
  requesterNewState: UserAudioState;
  targetNewState: UserAudioState;
  swapDuration: number;
}

export interface ProcessingLoadResult {
  totalCost: number;
  latency: number;
  effectCount: number;
  isOptimal: boolean;
  recommendations: string[];
}