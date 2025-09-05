import { EffectType } from '../value-objects/AudioValueObjects';

/**
 * AudioEffect - Entity representing an individual audio effect
 * 
 * Encapsulates the configuration and parameters of audio effects
 * that can be applied in an effect chain.
 * 
 * Requirements: 10.2, 10.3
 */
export class AudioEffect {
  private constructor(
    private readonly id: string,
    private readonly type: EffectType,
    private readonly parameters: Record<string, any>,
    private readonly isEnabled: boolean = true
  ) {
    this.validateParameters();
  }

  static create(type: EffectType, parameters: Record<string, any> = {}): AudioEffect {
    const id = this.generateId();
    const defaultParams = this.getDefaultParameters(type);
    const mergedParams = { ...defaultParams, ...parameters };
    
    return new AudioEffect(id, type, mergedParams, true);
  }

  static fromSnapshot(
    id: string,
    type: EffectType,
    parameters: Record<string, any>,
    isEnabled: boolean
  ): AudioEffect {
    return new AudioEffect(id, type, parameters, isEnabled);
  }

  getId(): string {
    return this.id;
  }

  getType(): EffectType {
    return this.type;
  }

  getParameters(): Record<string, any> {
    return { ...this.parameters };
  }

  getParameter(name: string): any {
    return this.parameters[name];
  }

  isEffectEnabled(): boolean {
    return this.isEnabled;
  }

  updateParameters(newParameters: Record<string, any>): AudioEffect {
    const mergedParams = { ...this.parameters, ...newParameters };
    return new AudioEffect(this.id, this.type, mergedParams, this.isEnabled);
  }

  updateParameter(name: string, value: any): AudioEffect {
    return this.updateParameters({ [name]: value });
  }

  enable(): AudioEffect {
    return new AudioEffect(this.id, this.type, this.parameters, true);
  }

  disable(): AudioEffect {
    return new AudioEffect(this.id, this.type, this.parameters, false);
  }

  // Business logic for effect validation
  isParameterValid(name: string, value: any): boolean {
    const constraints = this.getParameterConstraints();
    const constraint = constraints[name];
    
    if (!constraint) {
      return false; // Unknown parameter
    }

    return this.validateParameterValue(value, constraint);
  }

  getParameterConstraints(): Record<string, ParameterConstraint> {
    switch (this.type.toString()) {
      case 'reverb':
        return {
          roomSize: { type: 'number', min: 0, max: 1 },
          damping: { type: 'number', min: 0, max: 1 },
          wetLevel: { type: 'number', min: 0, max: 1 },
          dryLevel: { type: 'number', min: 0, max: 1 }
        };
      case 'delay':
        return {
          delayTime: { type: 'number', min: 0, max: 2000 }, // milliseconds
          feedback: { type: 'number', min: 0, max: 0.95 },
          wetLevel: { type: 'number', min: 0, max: 1 },
          dryLevel: { type: 'number', min: 0, max: 1 }
        };
      case 'compressor':
        return {
          threshold: { type: 'number', min: -60, max: 0 }, // dB
          ratio: { type: 'number', min: 1, max: 20 },
          attack: { type: 'number', min: 0, max: 100 }, // milliseconds
          release: { type: 'number', min: 0, max: 1000 }, // milliseconds
          makeupGain: { type: 'number', min: 0, max: 20 } // dB
        };
      case 'filter':
        return {
          frequency: { type: 'number', min: 20, max: 20000 }, // Hz
          resonance: { type: 'number', min: 0.1, max: 30 },
          type: { type: 'string', values: ['lowpass', 'highpass', 'bandpass', 'notch'] }
        };
      default:
        return {};
    }
  }

  // Get processing cost for performance optimization
  getProcessingCost(): number {
    switch (this.type.toString()) {
      case 'reverb': return 10; // High CPU cost
      case 'delay': return 5;   // Medium CPU cost
      case 'compressor': return 3; // Low-medium CPU cost
      case 'filter': return 2;  // Low CPU cost
      default: return 1;
    }
  }

  equals(other: AudioEffect): boolean {
    return this.id === other.id;
  }

  toString(): string {
    const status = this.isEnabled ? 'ON' : 'OFF';
    return `${this.type.toString()} (${status})`;
  }

  private static generateId(): string {
    return `effect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private static getDefaultParameters(type: EffectType): Record<string, any> {
    switch (type.toString()) {
      case 'reverb':
        return {
          roomSize: 0.5,
          damping: 0.5,
          wetLevel: 0.3,
          dryLevel: 0.7
        };
      case 'delay':
        return {
          delayTime: 250,
          feedback: 0.3,
          wetLevel: 0.3,
          dryLevel: 0.7
        };
      case 'compressor':
        return {
          threshold: -12,
          ratio: 4,
          attack: 3,
          release: 100,
          makeupGain: 0
        };
      case 'filter':
        return {
          frequency: 1000,
          resonance: 1,
          type: 'lowpass'
        };
      default:
        return {};
    }
  }

  private validateParameters(): void {
    const constraints = this.getParameterConstraints();
    
    for (const [name, value] of Object.entries(this.parameters)) {
      const constraint = constraints[name];
      if (constraint && !this.validateParameterValue(value, constraint)) {
        throw new InvalidEffectParameterError(this.type.toString(), name, value);
      }
    }
  }

  private validateParameterValue(value: any, constraint: ParameterConstraint): boolean {
    if (constraint.type === 'number') {
      if (typeof value !== 'number') return false;
      if (constraint.min !== undefined && value < constraint.min) return false;
      if (constraint.max !== undefined && value > constraint.max) return false;
      return true;
    }
    
    if (constraint.type === 'string') {
      if (typeof value !== 'string') return false;
      if (constraint.values && !constraint.values.includes(value)) return false;
      return true;
    }
    
    return false;
  }
}

// Supporting types
interface ParameterConstraint {
  type: 'number' | 'string' | 'boolean';
  min?: number;
  max?: number;
  values?: string[];
}

// Domain Exception
export class InvalidEffectParameterError extends Error {
  constructor(effectType: string, parameterName: string, value: any) {
    super(`Invalid parameter '${parameterName}' for effect '${effectType}': ${value}`);
    this.name = 'InvalidEffectParameterError';
  }
}