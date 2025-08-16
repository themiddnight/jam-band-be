export interface User {
  id: string;
  username: string;
  role: 'room_owner' | 'band_member' | 'audience';
  currentInstrument?: string;
  currentCategory?: string;
  isReady: boolean;
}

export interface Room {
  id: string;
  name: string;
  owner: string;
  users: Map<string, User>;
  pendingMembers: Map<string, User>;
  isPrivate: boolean;
  isHidden: boolean;
  createdAt: Date;
  metronome: MetronomeState;
}

export interface UserSession {
  roomId: string;
  userId: string;
}

export interface JoinRoomData {
  roomId: string;
  username: string;
  userId: string;
  role: 'band_member' | 'audience';
}

export interface CreateRoomData {
  name: string;
  username: string;
  userId: string;
  isPrivate: boolean;
  isHidden: boolean;
}

export interface ApproveMemberData {
  userId: string;
}

export interface RejectMemberData {
  userId: string;
}

export interface PlayNoteData {
  notes: string[];
  velocity: number;
  instrument: string;
  category: string;
  eventType: 'note_on' | 'note_off' | 'sustain_on' | 'sustain_off';
  isKeyHeld?: boolean;
}

export interface ChangeInstrumentData {
  instrument: string;
  category: string;
}

export interface UpdateSynthParamsData {
  params: any;
}

export interface TransferOwnershipData {
  newOwnerId: string;
}

export interface RoomListResponse {
  id: string;
  name: string;
  userCount: number;
  owner: string;
  isPrivate: boolean;
  isHidden: boolean;
  createdAt: Date;
}

// WebRTC Voice Communication Types
export interface VoiceOfferData {
  offer: any; // RTCSessionDescriptionInit
  targetUserId: string;
  roomId: string;
}

export interface VoiceAnswerData {
  answer: any; // RTCSessionDescriptionInit
  targetUserId: string;
  roomId: string;
}

export interface VoiceIceCandidateData {
  candidate: any; // RTCIceCandidateInit
  targetUserId: string;
  roomId: string;
}

export interface JoinVoiceData {
  roomId: string;
  userId: string;
  username: string;
}

export interface LeaveVoiceData {
  roomId: string;
  userId: string;
}

export interface VoiceMuteChangedData {
  roomId: string;
  userId: string;
  isMuted: boolean;
}

export interface RequestVoiceParticipantsData {
  roomId: string;
}

export interface VoiceParticipantInfo {
  userId: string;
  username: string;
  isMuted: boolean;
  lastHeartbeat?: number;
  connectionStates?: Record<string, { connectionState: string; iceConnectionState: string }>;
}

// Chat Message Types
export interface ChatMessageData {
  message: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

// Metronome Types
export interface MetronomeState {
  bpm: number;
  lastTickTimestamp: number;
}

export interface UpdateMetronomeData {
  bpm: number;
}

export interface MetronomeTickData {
  timestamp: number;
  bpm: number;
} 