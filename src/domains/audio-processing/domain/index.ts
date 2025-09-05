/**
 * Audio Processing Domain - Public API
 * 
 * Exports all domain models, value objects, services, and events
 * for the audio processing bounded context.
 * 
 * Requirements: 10.2, 10.3
 */

// Models
export { AudioBus } from './models/AudioBus';
export { AudioEffect, InvalidEffectParameterError } from './models/AudioEffect';
export { 
  AudioRouting, 
  InvalidGainError, 
  InvalidAudioInputError, 
  InvalidAudioOutputError, 
  IncompatibleRoutingError 
} from './models/AudioRouting';
export { 
  EffectChain, 
  MaxEffectsExceededError, 
  InvalidEffectPositionError, 
  EffectNotFoundError, 
  ExcessiveLatencyError 
} from './models/EffectChain';
export { 
  InstrumentSwapSession, 
  SwapStatus, 
  InvalidSwapStateError
} from './models/InstrumentSwapSession';
export type { 
  UserAudioState,
  EffectChainSnapshot,
  EffectSnapshot,
  AudioRoutingSnapshot,
  MixerChannelSnapshot
} from './models/InstrumentSwapSession';
export { 
  MixerChannel, 
  EQSettings,
  InvalidChannelLevelError,
  InvalidPanPositionError,
  InvalidChannelNumberError,
  InvalidEQGainError,
  InvalidEQFrequencyError
} from './models/MixerChannel';

// Value Objects
export { 
  AudioBusId, 
  UserId, 
  EffectType, 
  AudioInput, 
  AudioOutput, 
  MixerChannelId, 
  SwapSessionId 
} from './value-objects/AudioValueObjects';

// Services
export { 
  AudioProcessingCoordinationService,
  SwapValidationError
} from './services/AudioProcessingCoordinationService';

// Events
export { EffectAdded } from './events/EffectAdded';
export { AudioRoutingChanged } from './events/AudioRoutingChanged';