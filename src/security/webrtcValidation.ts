import { Socket } from 'socket.io';

// WebRTC security validation
export interface WebRTCValidationResult {
  isValid: boolean;
  error?: string;
}

// Validate RTCSessionDescriptionInit (offer/answer)
export const validateSessionDescription = (sdp: any): WebRTCValidationResult => {
  if (!sdp || typeof sdp !== 'object') {
    return { isValid: false, error: 'Invalid session description format' };
  }

  // Check for required fields
  if (sdp.type !== 'offer' && sdp.type !== 'answer') {
    return { isValid: false, error: 'Invalid session description type' };
  }

  if (!sdp.sdp || typeof sdp.sdp !== 'string') {
    return { isValid: false, error: 'Missing or invalid SDP content' };
  }

  // Validate SDP content length (prevent extremely long SDPs)
  if (sdp.sdp.length > 10000) {
    return { isValid: false, error: 'SDP content too long' };
  }

  // Basic SDP content validation
  const sdpContent = sdp.sdp.toLowerCase();
  
  // Check for potentially malicious content
  const suspiciousPatterns = [
    'javascript:',
    'data:',
    'vbscript:',
    '<script',
    'onload=',
    'onerror='
  ];

  for (const pattern of suspiciousPatterns) {
    if (sdpContent.includes(pattern)) {
      return { isValid: false, error: 'Suspicious content detected in SDP' };
    }
  }

  return { isValid: true };
};

// Validate RTCIceCandidateInit
export const validateIceCandidate = (candidate: any): WebRTCValidationResult => {
  if (!candidate || typeof candidate !== 'object') {
    return { isValid: false, error: 'Invalid ICE candidate format' };
  }

  // Check for required fields
  if (!candidate.candidate || typeof candidate.candidate !== 'string') {
    return { isValid: false, error: 'Missing or invalid candidate field' };
  }

  // Validate candidate string length
  if (candidate.candidate.length > 1000) {
    return { isValid: false, error: 'ICE candidate string too long' };
  }

  // Basic candidate string validation
  const candidateStr = candidate.candidate.toLowerCase();
  
  // Check for potentially malicious content
  const suspiciousPatterns = [
    'javascript:',
    'data:',
    'vbscript:',
    '<script',
    'onload=',
    'onerror='
  ];

  for (const pattern of suspiciousPatterns) {
    if (candidateStr.includes(pattern)) {
      return { isValid: false, error: 'Suspicious content detected in ICE candidate' };
    }
  }

  return { isValid: true };
};

// Validate WebRTC connection request
export const validateWebRTCConnection = (
  socket: Socket, 
  targetUserId: string, 
  roomId: string
): WebRTCValidationResult => {
  // Check if user is authenticated
  if (!socket.data?.userId) {
    return { isValid: false, error: 'User not authenticated' };
  }

  // Check if user is in the specified room
  if (!socket.data?.roomId || socket.data.roomId !== roomId) {
    return { isValid: false, error: 'User not in specified room' };
  }

  // Check if target user is different from sender
  if (socket.data.userId === targetUserId) {
    return { isValid: false, error: 'Cannot establish connection with self' };
  }

  // Validate user IDs (basic format check)
  if (!targetUserId || typeof targetUserId !== 'string' || targetUserId.length > 100) {
    return { isValid: false, error: 'Invalid target user ID' };
  }

  if (!roomId || typeof roomId !== 'string' || roomId.length > 100) {
    return { isValid: false, error: 'Invalid room ID' };
  }

  return { isValid: true };
};

// Validate WebRTC media constraints (if any are sent)
export const validateMediaConstraints = (constraints: any): WebRTCValidationResult => {
  if (!constraints || typeof constraints !== 'object') {
    return { isValid: false, error: 'Invalid media constraints format' };
  }

  // Check for audio/video constraints
  if (constraints.audio && typeof constraints.audio !== 'boolean' && typeof constraints.audio !== 'object') {
    return { isValid: false, error: 'Invalid audio constraints' };
  }

  if (constraints.video && typeof constraints.video !== 'boolean' && typeof constraints.video !== 'object') {
    return { isValid: false, error: 'Invalid video constraints' };
  }

  // Validate constraint object depth (prevent deeply nested objects)
  const maxDepth = 3;
  const checkDepth = (obj: any, depth: number = 0): boolean => {
    if (depth > maxDepth) return false;
    if (typeof obj !== 'object' || obj === null) return true;
    
    for (const key in obj) {
      if (!checkDepth(obj[key], depth + 1)) return false;
    }
    return true;
  };

  if (!checkDepth(constraints)) {
    return { isValid: false, error: 'Media constraints too deeply nested' };
  }

  return { isValid: true };
};

// Comprehensive WebRTC validation for all connection types
export const validateWebRTCRequest = (
  socket: Socket,
  eventType: 'offer' | 'answer' | 'ice-candidate',
  data: any
): WebRTCValidationResult => {
  // Basic connection validation
  const connectionValidation = validateWebRTCConnection(
    socket, 
    data.targetUserId, 
    data.roomId
  );
  
  if (!connectionValidation.isValid) {
    return connectionValidation;
  }

  // Event-specific validation
  switch (eventType) {
    case 'offer':
      return validateSessionDescription(data.offer);
    
    case 'answer':
      return validateSessionDescription(data.answer);
    
    case 'ice-candidate':
      return validateIceCandidate(data.candidate);
    
    default:
      return { isValid: false, error: 'Unknown WebRTC event type' };
  }
}; 