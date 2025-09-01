import { AudioInput, AudioOutput } from '../value-objects/AudioValueObjects';

/**
 * AudioRouting - Value object representing audio input/output routing configuration
 * 
 * Manages the routing of audio signals through the processing chain.
 * Provides validation for routing configurations and future mixer integration.
 * 
 * Requirements: 10.2, 10.3
 */
export class AudioRouting {
  private constructor(
    private readonly input: AudioInput,
    private readonly output: AudioOutput,
    private readonly gain: number = 1.0,
    private readonly isMuted: boolean = false
  ) {
    this.validateRouting();
  }

  static create(input: AudioInput, output: AudioOutput, gain: number = 1.0): AudioRouting {
    return new AudioRouting(input, output, gain, false);
  }

  static default(): AudioRouting {
    return new AudioRouting(
      AudioInput.microphone(),
      AudioOutput.speakers(),
      1.0,
      false
    );
  }

  static fromSnapshot(
    input: AudioInput,
    output: AudioOutput,
    gain: number,
    isMuted: boolean
  ): AudioRouting {
    return new AudioRouting(input, output, gain, isMuted);
  }

  getInput(): AudioInput {
    return this.input;
  }

  getOutput(): AudioOutput {
    return this.output;
  }

  getGain(): number {
    return this.gain;
  }

  isMutedState(): boolean {
    return this.isMuted;
  }

  withInput(input: AudioInput): AudioRouting {
    return new AudioRouting(input, this.output, this.gain, this.isMuted);
  }

  withOutput(output: AudioOutput): AudioRouting {
    return new AudioRouting(this.input, output, this.gain, this.isMuted);
  }

  withGain(gain: number): AudioRouting {
    if (gain < 0 || gain > 2.0) {
      throw new InvalidGainError(gain);
    }
    return new AudioRouting(this.input, this.output, gain, this.isMuted);
  }

  mute(): AudioRouting {
    return new AudioRouting(this.input, this.output, this.gain, true);
  }

  unmute(): AudioRouting {
    return new AudioRouting(this.input, this.output, this.gain, false);
  }

  // Business logic for routing validation
  isValid(): boolean {
    try {
      this.validateRouting();
      return true;
    } catch {
      return false;
    }
  }

  canRouteToOutput(output: AudioOutput): boolean {
    // Check if the input type is compatible with the output type
    return this.input.isCompatibleWith(output);
  }

  getEffectiveGain(): number {
    return this.isMuted ? 0 : this.gain;
  }

  // Future: Mixer integration
  getMixerChannelId(): string | null {
    // Will be implemented when mixer functionality is added
    return null;
  }

  // Future: Advanced routing for multi-channel audio
  getChannelMapping(): Record<number, number> {
    // Default stereo mapping (left to left, right to right)
    return { 0: 0, 1: 1 };
  }

  // Audio processing configuration
  getLatencyCompensation(): number {
    // Compensation in milliseconds based on routing complexity
    if (this.input.requiresProcessing() || this.output.requiresProcessing()) {
      return 5; // Additional latency for processing
    }
    return 0;
  }

  equals(other: AudioRouting): boolean {
    return this.input.equals(other.input) &&
           this.output.equals(other.output) &&
           this.gain === other.gain &&
           this.isMuted === other.isMuted;
  }

  toString(): string {
    const muteStatus = this.isMuted ? ' (MUTED)' : '';
    return `${this.input.toString()} -> ${this.output.toString()} (gain: ${this.gain})${muteStatus}`;
  }

  private validateRouting(): void {
    if (this.gain < 0 || this.gain > 2.0) {
      throw new InvalidGainError(this.gain);
    }

    if (!this.input.isValid()) {
      throw new InvalidAudioInputError();
    }

    if (!this.output.isValid()) {
      throw new InvalidAudioOutputError();
    }

    if (!this.canRouteToOutput(this.output)) {
      throw new IncompatibleRoutingError(this.input.toString(), this.output.toString());
    }
  }
}

// Domain Exceptions
export class InvalidGainError extends Error {
  constructor(gain: number) {
    super(`Invalid gain value: ${gain}. Must be between 0 and 2.0`);
    this.name = 'InvalidGainError';
  }
}

export class InvalidAudioInputError extends Error {
  constructor() {
    super('Invalid audio input configuration');
    this.name = 'InvalidAudioInputError';
  }
}

export class InvalidAudioOutputError extends Error {
  constructor() {
    super('Invalid audio output configuration');
    this.name = 'InvalidAudioOutputError';
  }
}

export class IncompatibleRoutingError extends Error {
  constructor(input: string, output: string) {
    super(`Incompatible routing: ${input} cannot route to ${output}`);
    this.name = 'IncompatibleRoutingError';
  }
}