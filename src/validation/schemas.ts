import Joi from 'joi';

// Base user validation
const userBaseSchema = Joi.object({
  userId: Joi.string().min(1).max(100).required(),
  username: Joi.string().min(1).max(50).required(),
});

// Room creation validation
export const createRoomSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
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

// Note playing validation
export const playNoteSchema = Joi.object({
  notes: Joi.when('eventType', {
    is: Joi.string().valid('sustain_on', 'sustain_off'),
    then: Joi.array().items(Joi.string().min(1).max(50)).min(0).max(10).optional(), // Sustain events can have empty notes
    otherwise: Joi.array().items(Joi.string().min(1).max(50)).min(1).max(10).required(), // Note events must have notes (increased max length for drum samples)
  }),
  velocity: Joi.number().min(0).max(127).required(),
  instrument: Joi.string().min(1).max(100).required(),
  category: Joi.string().min(1).max(50).required(), // Allow any category string
  eventType: Joi.string().valid('note_on', 'note_off', 'sustain_on', 'sustain_off').required(),
  isKeyHeld: Joi.boolean().optional(), // Make truly optional for note_off events
});

// Instrument change validation
export const changeInstrumentSchema = Joi.object({
  instrument: Joi.string().min(1).max(100).required(),
  category: Joi.string().min(1).max(50).required(), // Allow any category string
});

// Synth params validation
export const updateSynthParamsSchema = Joi.object({
  params: Joi.object({
    attack: Joi.number().min(0).max(10).optional(),
    decay: Joi.number().min(0).max(10).optional(),
    sustain: Joi.number().min(0).max(1).optional(),
    release: Joi.number().min(0).max(10).optional(),
    waveform: Joi.string().valid('sine', 'square', 'sawtooth', 'triangle').optional(),
    filterCutoff: Joi.number().min(20).max(20000).optional(),
    filterResonance: Joi.number().min(0).max(20).optional(),
  }).required(),
});

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