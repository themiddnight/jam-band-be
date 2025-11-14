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