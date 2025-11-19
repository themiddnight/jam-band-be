import Joi from 'joi';
import { METRONOME_CONSTANTS } from '../constants';

// Room creation validation
export const createRoomSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).optional(),
  roomType: Joi.string().valid('perform', 'arrange').default('perform'),
  username: Joi.string().min(1).max(50).required(),
  userId: Joi.string().min(1).max(100).required(),
  isPrivate: Joi.boolean().required(),
  isHidden: Joi.boolean().required(),
});

// Room join validation
export const joinRoomSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  username: Joi.string().min(1).max(50).required(),
  userId: Joi.string().min(1).max(100).required(),
  role: Joi.string().valid('audience', 'band_member').default('audience'),
});

// Chat message validation
export const chatMessageSchema = Joi.object({
  message: Joi.string().min(1).max(500).required(),
  roomId: Joi.string().uuid().required(),
});

// Musical validation schemas removed for performance and flexibility
// Note: Musical data (notes, instruments, synth params) are now passed through without validation
// This is safe as they are only relayed to other clients for audio processing

// Ownership transfer validation
export const transferOwnershipSchema = Joi.object({
  newOwnerId: Joi.string().min(1).max(100).required(),
});

// Member approval/rejection validation
export const memberActionSchema = Joi.object({
  userId: Joi.string().min(1).max(100).required(),
});

// WebRTC validation schemas
export const voiceOfferSchema = Joi.object({
  targetUserId: Joi.string().min(1).max(100).required(),
  roomId: Joi.string().uuid().required(),
  offer: Joi.object().required(), // RTCSessionDescriptionInit
});

export const voiceAnswerSchema = Joi.object({
  targetUserId: Joi.string().min(1).max(100).required(),
  roomId: Joi.string().uuid().required(),
  answer: Joi.object().required(), // RTCSessionDescriptionInit
});

export const voiceIceCandidateSchema = Joi.object({
  targetUserId: Joi.string().min(1).max(100).required(),
  roomId: Joi.string().uuid().required(),
  candidate: Joi.object().required(), // RTCIceCandidateInit
});

export const voiceJoinSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  userId: Joi.string().min(1).max(100).required(),
  username: Joi.string().min(1).max(50).required(),
});

export const voiceLeaveSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  userId: Joi.string().min(1).max(100).required(),
});

export const voiceMuteChangedSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  userId: Joi.string().min(1).max(100).required(),
  isMuted: Joi.boolean().required(),
});

export const requestVoiceParticipantsSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
});

// Metronome validation schemas
export const updateMetronomeSchema = Joi.object({
  bpm: Joi.number().min(METRONOME_CONSTANTS.MIN_BPM).max(METRONOME_CONSTANTS.MAX_BPM).required(),
});

// Generic validation function with better error handling
export const validateData = <T>(schema: Joi.ObjectSchema, data: any): { error?: string; value?: T } => {
  try {
    const { error, value } = schema.validate(data, { 
      abortEarly: false, 
      stripUnknown: true 
    });
    
    if (error) {
      const errorMessage = error.details.map((detail: Joi.ValidationErrorItem) => detail.message).join(', ');
      return { error: errorMessage };
    }
    
    return { value: value as T };
  } catch (validationError) {
    return { error: `Validation error: ${validationError instanceof Error ? validationError.message : 'Unknown error'}` };
  }
};

// HTTP route validation
export const leaveRoomHttpSchema = Joi.object({
  userId: Joi.string().min(1).max(100).required(),
});

// Approval validation schemas
export const approvalRequestSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  userId: Joi.string().min(1).max(100).required(),
  username: Joi.string().min(1).max(50).required(),
  role: Joi.string().valid('audience', 'band_member').required(),
});

export const approvalResponseSchema = Joi.object({
  userId: Joi.string().min(1).max(100).required(),
  approved: Joi.boolean().required(),
  message: Joi.string().max(200).optional(),
});

export const approvalCancelSchema = Joi.object({
  userId: Joi.string().min(1).max(100).required(),
  roomId: Joi.string().uuid().required(),
});

// Room settings update validation
export const updateRoomSettingsSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  description: Joi.string().max(500).optional().allow(''),
  isPrivate: Joi.boolean().optional(),
  isHidden: Joi.boolean().optional(),
  updatedBy: Joi.string().min(1).max(100).required(),
});

// Arrange room validation schemas
export const arrangeRequestStateSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
});

export const arrangeTrackAddSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  track: Joi.object({
    id: Joi.string().required(),
    name: Joi.string().required(),
    type: Joi.string().valid('midi', 'audio').required(),
    instrumentId: Joi.string().optional(),
    instrumentCategory: Joi.string().optional(),
    volume: Joi.number().min(0).max(1).required(),
    pan: Joi.number().min(-1).max(1).required(),
    mute: Joi.boolean().required(),
    solo: Joi.boolean().required(),
    color: Joi.string().required(),
    regionIds: Joi.array().items(Joi.string()).required(),
  }).required(),
});

export const arrangeTrackUpdateSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  trackId: Joi.string().required(),
  updates: Joi.object({
    name: Joi.string().optional(),
    volume: Joi.number().min(0).max(1).optional(),
    pan: Joi.number().min(-1).max(1).optional(),
    color: Joi.string().optional(),
  }).min(1).required(),
});

export const arrangeTrackDeleteSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  trackId: Joi.string().required(),
});

export const arrangeTrackReorderSchema = Joi.object({
  roomId: Joi.string().required(),
  trackIds: Joi.array().items(Joi.string()).required(),
});

export const arrangeTrackInstrumentChangeSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  trackId: Joi.string().required(),
  instrumentId: Joi.string().required(),
  instrumentCategory: Joi.string().optional(),
});

export const arrangeRegionAddSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  region: Joi.object({
    id: Joi.string().required(),
    trackId: Joi.string().required(),
    name: Joi.string().required(),
    start: Joi.number().min(0).required(),
    length: Joi.number().min(0.25).required(),
    type: Joi.string().valid('midi', 'audio').required(),
    loopEnabled: Joi.boolean().optional(),
    loopIterations: Joi.number().min(1).optional(),
    color: Joi.string().optional(),
    notes: Joi.array().optional(),
    sustainEvents: Joi.array().optional(),
    audioUrl: Joi.string().optional(),
    trimStart: Joi.number().optional(),
    originalLength: Joi.number().optional(),
    gain: Joi.number().optional(),
    fadeInDuration: Joi.number().optional(),
    fadeOutDuration: Joi.number().optional(),
  }).required(),
});

export const arrangeRegionUpdateSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  regionId: Joi.string().required(),
  updates: Joi.object({
    name: Joi.string().optional(),
    start: Joi.number().min(0).optional(),
    length: Joi.number().min(0.25).optional(),
    loopEnabled: Joi.boolean().optional(),
    loopIterations: Joi.number().min(1).optional(),
    color: Joi.string().optional(),
    trackId: Joi.string().optional(),
    // MIDI region specific
    notes: Joi.array().items(Joi.object({
      id: Joi.string().required(),
      pitch: Joi.number().min(0).max(127).required(),
      start: Joi.number().min(0).required(),
      duration: Joi.number().min(0.01).required(),
      velocity: Joi.number().min(0).max(127).required(),
    })).optional(),
    sustainEvents: Joi.array().items(Joi.object({
      id: Joi.string().required(),
      start: Joi.number().min(0).required(),
      end: Joi.number().min(0).required(),
    })).optional(),
    // Audio region specific
    trimStart: Joi.number().min(0).optional(),
    originalLength: Joi.number().min(0).optional(),
    gain: Joi.number().optional(),
    fadeInDuration: Joi.number().min(0).optional(),
    fadeOutDuration: Joi.number().min(0).optional(),
    audioBuffer: Joi.any().optional(),
    audioUrl: Joi.string().optional(),
  }).min(1).required(),
});

export const arrangeRegionMoveSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  regionId: Joi.string().required(),
  deltaBeats: Joi.number().required(),
});

export const arrangeRegionDeleteSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  regionId: Joi.string().required(),
});

export const arrangeNoteAddSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  regionId: Joi.string().required(),
  note: Joi.object({
    id: Joi.string().required(),
    pitch: Joi.number().min(0).max(127).required(),
    velocity: Joi.number().min(0).max(127).required(),
    start: Joi.number().min(0).required(),
    duration: Joi.number().min(0.25).required(),
  }).required(),
});

export const arrangeNoteUpdateSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  regionId: Joi.string().required(),
  noteId: Joi.string().required(),
  updates: Joi.object({
    pitch: Joi.number().min(0).max(127).optional(),
    velocity: Joi.number().min(0).max(127).optional(),
    start: Joi.number().min(0).optional(),
    duration: Joi.number().min(0.25).optional(),
  }).min(1).required(),
});

export const arrangeNoteDeleteSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  regionId: Joi.string().required(),
  noteId: Joi.string().required(),
});

export const arrangeEffectChainUpdateSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  trackId: Joi.string().required(),
  chainType: Joi.string().required(),
  effectChain: Joi.object().required(),
});

export const arrangeSynthParamsUpdateSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  trackId: Joi.string().required(),
  params: Joi.object().min(1).required(),
});

export const arrangeBpmUpdateSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  bpm: Joi.number().min(40).max(300).required(),
});

export const arrangeTimeSignatureUpdateSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  timeSignature: Joi.object({
    numerator: Joi.number().integer().min(1).max(32).required(),
    denominator: Joi.number().valid(2, 4, 8, 16).required(),
  }).required(),
});

export const arrangeSelectionChangeSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  selectedTrackId: Joi.string().allow(null).optional(),
  selectedRegionIds: Joi.array().items(Joi.string()).optional(),
});

export const arrangeLockAcquireSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  elementId: Joi.string().required(),
  type: Joi.string().valid('region', 'track', 'track_property').required(),
});

export const arrangeLockReleaseSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  elementId: Joi.string().required(),
}); 