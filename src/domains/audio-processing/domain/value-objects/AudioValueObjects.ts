/**
 * Audio Processing Value Objects
 * 
 * Strongly-typed value objects for audio processing domain.
 * Provides type safety and validation for audio-related concepts.
 * 
 * Requirements: 1.1, 1.3, 10.2
 */

// Strongly-typed ID value objects
export class AudioBusId {
  constructor(private readonly value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error('AudioBusId cannot be empty');
    }
  }

  static generate(): AudioBusId {
    return new AudioBusId(`audiobus_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  }

  static fromString(value: string): AudioBusId {
    return new AudioBusId(value);
  }

  equals(other: AudioBusId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

export class UserId {
  constructor(private readonly value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error('UserId cannot be empty');
    }
  }

  static generate(): UserId {
    return new UserId(`user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  }

  static fromString(value: string): UserId {
    return new UserId(value);
  }

  equals(other: UserId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

// Effect Type value object
export class EffectType {
  private static readonly VALID_TYPES = ['reverb', 'delay', 'compressor', 'filter', 'distortion', 'chorus', 'flanger', 'phaser'];

  constructor(private readonly value: string) {
    if (!EffectType.VALID_TYPES.includes(value)) {
      throw new Error(`Invalid effect type: ${value}. Valid types: ${EffectType.VALID_TYPES.join(', ')}`);
    }
  }

  static reverb(): EffectType {
    return new EffectType('reverb');
  }

  static delay(): EffectType {
    return new EffectType('delay');
  }

  static compressor(): EffectType {
    return new EffectType('compressor');
  }

  static filter(): EffectType {
    return new EffectType('filter');
  }

  static distortion(): EffectType {
    return new EffectType('distortion');
  }

  static chorus(): EffectType {
    return new EffectType('chorus');
  }

  static flanger(): EffectType {
    return new EffectType('flanger');
  }

  static phaser(): EffectType {
    return new EffectType('phaser');
  }

  static fromString(value: string): EffectType {
    return new EffectType(value);
  }

  static getValidTypes(): string[] {
    return [...EffectType.VALID_TYPES];
  }

  equals(other: EffectType): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  // Business logic for effect characteristics
  isTimeBasedEffect(): boolean {
    return ['reverb', 'delay', 'chorus', 'flanger', 'phaser'].includes(this.value);
  }

  isDynamicsEffect(): boolean {
    return ['compressor'].includes(this.value);
  }

  isFrequencyEffect(): boolean {
    return ['filter'].includes(this.value);
  }

  isDistortionEffect(): boolean {
    return ['distortion'].includes(this.value);
  }

  getCategory(): string {
    if (this.isTimeBasedEffect()) return 'time-based';
    if (this.isDynamicsEffect()) return 'dynamics';
    if (this.isFrequencyEffect()) return 'frequency';
    if (this.isDistortionEffect()) return 'distortion';
    return 'other';
  }
}

// Audio Input/Output value objects
export class AudioInput {
  private static readonly VALID_TYPES = ['microphone', 'line', 'instrument', 'virtual'];

  constructor(
    private readonly type: string,
    private readonly deviceId?: string,
    private readonly channelCount: number = 2
  ) {
    if (!AudioInput.VALID_TYPES.includes(type)) {
      throw new Error(`Invalid audio input type: ${type}`);
    }
    if (channelCount < 1 || channelCount > 8) {
      throw new Error('Channel count must be between 1 and 8');
    }
  }

  static microphone(deviceId?: string): AudioInput {
    return new AudioInput('microphone', deviceId, 2);
  }

  static line(deviceId?: string): AudioInput {
    return new AudioInput('line', deviceId, 2);
  }

  static instrument(deviceId?: string): AudioInput {
    return new AudioInput('instrument', deviceId, 1);
  }

  static virtual(): AudioInput {
    return new AudioInput('virtual', undefined, 2);
  }

  getType(): string {
    return this.type;
  }

  getDeviceId(): string | undefined {
    return this.deviceId;
  }

  getChannelCount(): number {
    return this.channelCount;
  }

  isValid(): boolean {
    return AudioInput.VALID_TYPES.includes(this.type) && 
           this.channelCount >= 1 && 
           this.channelCount <= 8;
  }

  requiresProcessing(): boolean {
    return this.type === 'instrument' || this.type === 'virtual';
  }

  isCompatibleWith(output: AudioOutput): boolean {
    // Basic compatibility check - can be extended with more complex rules
    return this.channelCount <= output.getChannelCount();
  }

  equals(other: AudioInput): boolean {
    return this.type === other.type && 
           this.deviceId === other.deviceId && 
           this.channelCount === other.channelCount;
  }

  toString(): string {
    const device = this.deviceId ? ` (${this.deviceId})` : '';
    return `${this.type}${device} [${this.channelCount}ch]`;
  }
}

export class AudioOutput {
  private static readonly VALID_TYPES = ['speakers', 'headphones', 'line', 'virtual'];

  constructor(
    private readonly type: string,
    private readonly deviceId?: string,
    private readonly channelCount: number = 2
  ) {
    if (!AudioOutput.VALID_TYPES.includes(type)) {
      throw new Error(`Invalid audio output type: ${type}`);
    }
    if (channelCount < 1 || channelCount > 8) {
      throw new Error('Channel count must be between 1 and 8');
    }
  }

  static speakers(deviceId?: string): AudioOutput {
    return new AudioOutput('speakers', deviceId, 2);
  }

  static headphones(deviceId?: string): AudioOutput {
    return new AudioOutput('headphones', deviceId, 2);
  }

  static line(deviceId?: string): AudioOutput {
    return new AudioOutput('line', deviceId, 2);
  }

  static virtual(): AudioOutput {
    return new AudioOutput('virtual', undefined, 2);
  }

  getType(): string {
    return this.type;
  }

  getDeviceId(): string | undefined {
    return this.deviceId;
  }

  getChannelCount(): number {
    return this.channelCount;
  }

  isValid(): boolean {
    return AudioOutput.VALID_TYPES.includes(this.type) && 
           this.channelCount >= 1 && 
           this.channelCount <= 8;
  }

  requiresProcessing(): boolean {
    return this.type === 'virtual';
  }

  equals(other: AudioOutput): boolean {
    return this.type === other.type && 
           this.deviceId === other.deviceId && 
           this.channelCount === other.channelCount;
  }

  toString(): string {
    const device = this.deviceId ? ` (${this.deviceId})` : '';
    return `${this.type}${device} [${this.channelCount}ch]`;
  }
}

// Future: Mixer Channel value object for mixer integration
export class MixerChannelId {
  constructor(private readonly value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error('MixerChannelId cannot be empty');
    }
  }

  static generate(): MixerChannelId {
    return new MixerChannelId(`channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  }

  static fromString(value: string): MixerChannelId {
    return new MixerChannelId(value);
  }

  equals(other: MixerChannelId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

// Future: Instrument Swap Session ID for instrument swapping
export class SwapSessionId {
  constructor(private readonly value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error('SwapSessionId cannot be empty');
    }
  }

  static generate(): SwapSessionId {
    return new SwapSessionId(`swap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  }

  static fromString(value: string): SwapSessionId {
    return new SwapSessionId(value);
  }

  equals(other: SwapSessionId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}