// Shared constants for the application

export const METRONOME_CONSTANTS = {
  MIN_BPM: 1,
  MAX_BPM: 1000,
  DEFAULT_BPM: 90,
} as const;

export const ROOM_CONSTANTS = {
  MAX_PARTICIPANTS: 10,
  DEFAULT_ROOM_NAME: 'My Room',
} as const;
