import { MixerChannelId, UserId, AudioBusId } from '../value-objects/AudioValueObjects';
import { AggregateRoot } from '../../../../shared/domain/models/AggregateRoot';
import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';

/**
 * MixerChannel - Aggregate root for mixer channel functionality
 * 
 * Represents a channel in the audio mixer with level control, EQ,
 * muting, soloing, and routing capabilities. Prepares for future
 * mixer functionality in the audio processing system.
 * 
 * Requirements: 10.2, 10.3
 */
export class MixerChannel extends AggregateRoot {
  private constructor(
    private readonly id: MixerChannelId,
    private readonly userId: UserId,
    private readonly audioBusId: AudioBusId,
    private level: number = 0.75, // 0.0 to 1.0
    private isMuted: boolean = false,
    private isSoloed: boolean = false,
    private panPosition: number = 0.0, // -1.0 (left) to 1.0 (right)
    private eqSettings: EQSettings = EQSettings.flat(),
    private readonly channelNumber: number
  ) {
    super();
    this.validateChannelSettings();
  }

  static create(
    userId: UserId,
    audioBusId: AudioBusId,
    channelNumber: number
  ): MixerChannel {
    const channel = new MixerChannel(
      MixerChannelId.generate(),
      userId,
      audioBusId,
      0.75,
      false,
      false,
      0.0,
      EQSettings.flat(),
      channelNumber
    );

    channel.addDomainEvent(new MixerChannelCreated(
      channel.id.toString(),
      userId.toString(),
      audioBusId.toString(),
      channelNumber
    ));

    return channel;
  }

  static fromSnapshot(
    id: MixerChannelId,
    userId: UserId,
    audioBusId: AudioBusId,
    level: number,
    isMuted: boolean,
    isSoloed: boolean,
    panPosition: number,
    eqSettings: EQSettings,
    channelNumber: number
  ): MixerChannel {
    return new MixerChannel(
      id,
      userId,
      audioBusId,
      level,
      isMuted,
      isSoloed,
      panPosition,
      eqSettings,
      channelNumber
    );
  }

  getId(): MixerChannelId {
    return this.id;
  }

  getUserId(): UserId {
    return this.userId;
  }

  getAudioBusId(): AudioBusId {
    return this.audioBusId;
  }

  getLevel(): number {
    return this.level;
  }

  isMutedState(): boolean {
    return this.isMuted;
  }

  isSoloedState(): boolean {
    return this.isSoloed;
  }

  getPanPosition(): number {
    return this.panPosition;
  }

  getEQSettings(): EQSettings {
    return this.eqSettings;
  }

  getChannelNumber(): number {
    return this.channelNumber;
  }

  setLevel(level: number): void {
    if (level < 0 || level > 1) {
      throw new InvalidChannelLevelError(level);
    }

    const oldLevel = this.level;
    this.level = level;

    this.addDomainEvent(new ChannelLevelChanged(
      this.id.toString(),
      oldLevel,
      level
    ));
  }

  mute(): void {
    if (this.isMuted) return;

    this.isMuted = true;
    
    this.addDomainEvent(new ChannelMuted(
      this.id.toString(),
      this.userId.toString()
    ));
  }

  unmute(): void {
    if (!this.isMuted) return;

    this.isMuted = false;
    
    this.addDomainEvent(new ChannelUnmuted(
      this.id.toString(),
      this.userId.toString()
    ));
  }

  solo(): void {
    if (this.isSoloed) return;

    this.isSoloed = true;
    
    this.addDomainEvent(new ChannelSoloed(
      this.id.toString(),
      this.userId.toString()
    ));
  }

  unsolo(): void {
    if (!this.isSoloed) return;

    this.isSoloed = false;
    
    this.addDomainEvent(new ChannelUnsoloed(
      this.id.toString(),
      this.userId.toString()
    ));
  }

  setPanPosition(position: number): void {
    if (position < -1 || position > 1) {
      throw new InvalidPanPositionError(position);
    }

    const oldPosition = this.panPosition;
    this.panPosition = position;

    this.addDomainEvent(new ChannelPanChanged(
      this.id.toString(),
      oldPosition,
      position
    ));
  }

  updateEQ(eqSettings: EQSettings): void {
    const oldSettings = this.eqSettings;
    this.eqSettings = eqSettings;

    this.addDomainEvent(new ChannelEQChanged(
      this.id.toString(),
      oldSettings,
      eqSettings
    ));
  }

  // Business logic
  getEffectiveLevel(): number {
    return this.isMuted ? 0 : this.level;
  }

  isAudible(): boolean {
    return !this.isMuted && this.level > 0;
  }

  getLeftChannelGain(): number {
    const effectiveLevel = this.getEffectiveLevel();
    // Simple linear pan law
    const panGain = this.panPosition <= 0 ? 1 : 1 - this.panPosition;
    return effectiveLevel * panGain;
  }

  getRightChannelGain(): number {
    const effectiveLevel = this.getEffectiveLevel();
    // Simple linear pan law
    const panGain = this.panPosition >= 0 ? 1 : 1 + this.panPosition;
    return effectiveLevel * panGain;
  }

  canBeSoloed(): boolean {
    return !this.isMuted;
  }

  equals(other: MixerChannel): boolean {
    return this.id.equals(other.id);
  }

  toString(): string {
    const muteStatus = this.isMuted ? ' (MUTED)' : '';
    const soloStatus = this.isSoloed ? ' (SOLO)' : '';
    return `Channel ${this.channelNumber}: ${(this.level * 100).toFixed(0)}%${muteStatus}${soloStatus}`;
  }

  private validateChannelSettings(): void {
    if (this.level < 0 || this.level > 1) {
      throw new InvalidChannelLevelError(this.level);
    }

    if (this.panPosition < -1 || this.panPosition > 1) {
      throw new InvalidPanPositionError(this.panPosition);
    }

    if (this.channelNumber < 1 || this.channelNumber > 64) {
      throw new InvalidChannelNumberError(this.channelNumber);
    }
  }
}

/**
 * EQSettings - Value object for equalizer settings
 */
export class EQSettings {
  constructor(
    private readonly lowGain: number = 0,    // -12dB to +12dB
    private readonly midGain: number = 0,    // -12dB to +12dB
    private readonly highGain: number = 0,   // -12dB to +12dB
    private readonly lowFreq: number = 80,   // Hz
    private readonly midFreq: number = 1000, // Hz
    private readonly highFreq: number = 8000 // Hz
  ) {
    this.validateEQSettings();
  }

  static flat(): EQSettings {
    return new EQSettings(0, 0, 0, 80, 1000, 8000);
  }

  static preset(name: string): EQSettings {
    switch (name.toLowerCase()) {
      case 'vocal':
        return new EQSettings(-2, 3, 2, 100, 2000, 8000);
      case 'bass':
        return new EQSettings(4, -1, -2, 60, 500, 5000);
      case 'drums':
        return new EQSettings(2, -1, 3, 80, 800, 10000);
      case 'guitar':
        return new EQSettings(-1, 2, 1, 100, 1500, 6000);
      default:
        return EQSettings.flat();
    }
  }

  getLowGain(): number {
    return this.lowGain;
  }

  getMidGain(): number {
    return this.midGain;
  }

  getHighGain(): number {
    return this.highGain;
  }

  getLowFreq(): number {
    return this.lowFreq;
  }

  getMidFreq(): number {
    return this.midFreq;
  }

  getHighFreq(): number {
    return this.highFreq;
  }

  withLowGain(gain: number): EQSettings {
    return new EQSettings(gain, this.midGain, this.highGain, this.lowFreq, this.midFreq, this.highFreq);
  }

  withMidGain(gain: number): EQSettings {
    return new EQSettings(this.lowGain, gain, this.highGain, this.lowFreq, this.midFreq, this.highFreq);
  }

  withHighGain(gain: number): EQSettings {
    return new EQSettings(this.lowGain, this.midGain, gain, this.lowFreq, this.midFreq, this.highFreq);
  }

  isFlat(): boolean {
    return this.lowGain === 0 && this.midGain === 0 && this.highGain === 0;
  }

  equals(other: EQSettings): boolean {
    return this.lowGain === other.lowGain &&
           this.midGain === other.midGain &&
           this.highGain === other.highGain &&
           this.lowFreq === other.lowFreq &&
           this.midFreq === other.midFreq &&
           this.highFreq === other.highFreq;
  }

  toString(): string {
    return `EQ: L${this.lowGain > 0 ? '+' : ''}${this.lowGain}dB M${this.midGain > 0 ? '+' : ''}${this.midGain}dB H${this.highGain > 0 ? '+' : ''}${this.highGain}dB`;
  }

  private validateEQSettings(): void {
    if (this.lowGain < -12 || this.lowGain > 12) {
      throw new InvalidEQGainError('low', this.lowGain);
    }
    if (this.midGain < -12 || this.midGain > 12) {
      throw new InvalidEQGainError('mid', this.midGain);
    }
    if (this.highGain < -12 || this.highGain > 12) {
      throw new InvalidEQGainError('high', this.highGain);
    }
    if (this.lowFreq < 20 || this.lowFreq > 500) {
      throw new InvalidEQFrequencyError('low', this.lowFreq);
    }
    if (this.midFreq < 200 || this.midFreq > 5000) {
      throw new InvalidEQFrequencyError('mid', this.midFreq);
    }
    if (this.highFreq < 2000 || this.highFreq > 20000) {
      throw new InvalidEQFrequencyError('high', this.highFreq);
    }
  }
}

// Domain Events
class MixerChannelCreated extends DomainEvent {
  constructor(
    channelId: string,
    public readonly userId: string,
    public readonly audioBusId: string,
    public readonly channelNumber: number
  ) {
    super(channelId);
  }
}

class ChannelLevelChanged extends DomainEvent {
  constructor(
    channelId: string,
    public readonly oldLevel: number,
    public readonly newLevel: number
  ) {
    super(channelId);
  }
}

class ChannelMuted extends DomainEvent {
  constructor(
    channelId: string,
    public readonly userId: string
  ) {
    super(channelId);
  }
}

class ChannelUnmuted extends DomainEvent {
  constructor(
    channelId: string,
    public readonly userId: string
  ) {
    super(channelId);
  }
}

class ChannelSoloed extends DomainEvent {
  constructor(
    channelId: string,
    public readonly userId: string
  ) {
    super(channelId);
  }
}

class ChannelUnsoloed extends DomainEvent {
  constructor(
    channelId: string,
    public readonly userId: string
  ) {
    super(channelId);
  }
}

class ChannelPanChanged extends DomainEvent {
  constructor(
    channelId: string,
    public readonly oldPosition: number,
    public readonly newPosition: number
  ) {
    super(channelId);
  }
}

class ChannelEQChanged extends DomainEvent {
  constructor(
    channelId: string,
    public readonly oldSettings: EQSettings,
    public readonly newSettings: EQSettings
  ) {
    super(channelId);
  }
}

// Domain Exceptions
export class InvalidChannelLevelError extends Error {
  constructor(level: number) {
    super(`Invalid channel level: ${level}. Must be between 0 and 1`);
    this.name = 'InvalidChannelLevelError';
  }
}

export class InvalidPanPositionError extends Error {
  constructor(position: number) {
    super(`Invalid pan position: ${position}. Must be between -1 and 1`);
    this.name = 'InvalidPanPositionError';
  }
}

export class InvalidChannelNumberError extends Error {
  constructor(channelNumber: number) {
    super(`Invalid channel number: ${channelNumber}. Must be between 1 and 64`);
    this.name = 'InvalidChannelNumberError';
  }
}

export class InvalidEQGainError extends Error {
  constructor(band: string, gain: number) {
    super(`Invalid EQ gain for ${band} band: ${gain}dB. Must be between -12 and +12dB`);
    this.name = 'InvalidEQGainError';
  }
}

export class InvalidEQFrequencyError extends Error {
  constructor(band: string, frequency: number) {
    super(`Invalid EQ frequency for ${band} band: ${frequency}Hz`);
    this.name = 'InvalidEQFrequencyError';
  }
}