import { EffectType } from '../value-objects/AudioValueObjects';
import { AudioEffect } from './AudioEffect';

/**
 * EffectChain - Value object representing a chain of audio effects
 * 
 * Manages the order and configuration of audio effects in a processing chain.
 * Provides validation and business rules for effect combinations.
 * 
 * Requirements: 10.2, 10.3
 */
export class EffectChain {
  private static readonly MAX_EFFECTS = 8;
  private static readonly MAX_LATENCY_MS = 50; // Maximum acceptable latency

  private constructor(private readonly effects: AudioEffect[]) {
    this.validateChain();
  }

  static empty(): EffectChain {
    return new EffectChain([]);
  }

  static fromEffects(effects: AudioEffect[]): EffectChain {
    return new EffectChain([...effects]);
  }

  getEffects(): AudioEffect[] {
    return [...this.effects];
  }

  addEffect(effect: AudioEffect): EffectChain {
    if (this.effects.length >= EffectChain.MAX_EFFECTS) {
      throw new MaxEffectsExceededError();
    }

    const newEffects = [...this.effects, effect];
    return new EffectChain(newEffects);
  }

  removeEffect(effectId: string): EffectChain {
    const newEffects = this.effects.filter(effect => effect.getId() !== effectId);
    return new EffectChain(newEffects);
  }

  updateEffectParameters(effectId: string, parameters: Record<string, any>): EffectChain {
    const newEffects = this.effects.map(effect => 
      effect.getId() === effectId 
        ? effect.updateParameters(parameters)
        : effect
    );
    return new EffectChain(newEffects);
  }

  moveEffect(effectId: string, newPosition: number): EffectChain {
    if (newPosition < 0 || newPosition >= this.effects.length) {
      throw new InvalidEffectPositionError();
    }

    const effectIndex = this.effects.findIndex(effect => effect.getId() === effectId);
    if (effectIndex === -1) {
      throw new EffectNotFoundError(effectId);
    }

    const newEffects = [...this.effects];
    const [movedEffect] = newEffects.splice(effectIndex, 1);
    if (!movedEffect) {
      throw new EffectNotFoundError(effectId);
    }
    newEffects.splice(newPosition, 0, movedEffect);

    return new EffectChain(newEffects);
  }

  canAddEffect(effectType: EffectType): boolean {
    if (this.effects.length >= EffectChain.MAX_EFFECTS) {
      return false;
    }

    // Business rules for effect combinations
    const existingTypes = this.effects.map(effect => effect.getType());
    
    // Only allow one compressor in the chain
    if (effectType.toString() === 'compressor' && 
        existingTypes.some(type => type.toString() === 'compressor')) {
      return false;
    }

    // Check if adding this effect would exceed latency limits
    const potentialLatency = this.getTotalLatency() + this.getEffectLatency(effectType);
    if (potentialLatency > EffectChain.MAX_LATENCY_MS) {
      return false;
    }

    return true;
  }

  getTotalLatency(): number {
    return this.effects.reduce((total, effect) => {
      return total + this.getEffectLatency(effect.getType());
    }, 0);
  }

  isEmpty(): boolean {
    return this.effects.length === 0;
  }

  getEffectCount(): number {
    return this.effects.length;
  }

  hasEffectType(effectType: EffectType): boolean {
    return this.effects.some(effect => effect.getType().equals(effectType));
  }

  // Get recommended effect order for optimal processing
  getOptimalOrder(): EffectChain {
    const orderedEffects = [...this.effects].sort((a, b) => {
      return this.getEffectPriority(a.getType()) - this.getEffectPriority(b.getType());
    });
    
    return new EffectChain(orderedEffects);
  }

  private validateChain(): void {
    if (this.effects.length > EffectChain.MAX_EFFECTS) {
      throw new MaxEffectsExceededError();
    }

    if (this.getTotalLatency() > EffectChain.MAX_LATENCY_MS) {
      throw new ExcessiveLatencyError();
    }
  }

  private getEffectLatency(effectType: EffectType): number {
    // Estimated latency in milliseconds for different effect types
    switch (effectType.toString()) {
      case 'compressor': return 2;
      case 'filter': return 1;
      case 'delay': return 5;
      case 'reverb': return 10;
      default: return 3;
    }
  }

  private getEffectPriority(effectType: EffectType): number {
    // Optimal processing order (lower number = earlier in chain)
    switch (effectType.toString()) {
      case 'compressor': return 1;
      case 'filter': return 2;
      case 'delay': return 3;
      case 'reverb': return 4;
      default: return 5;
    }
  }
}

// Domain Exceptions
export class MaxEffectsExceededError extends Error {
  constructor() {
    super(`Cannot add more than 8 effects to a chain`);
    this.name = 'MaxEffectsExceededError';
  }
}

export class InvalidEffectPositionError extends Error {
  constructor() {
    super('Invalid effect position in chain');
    this.name = 'InvalidEffectPositionError';
  }
}

export class EffectNotFoundError extends Error {
  constructor(effectId: string) {
    super(`Effect not found: ${effectId}`);
    this.name = 'EffectNotFoundError';
  }
}

export class ExcessiveLatencyError extends Error {
  constructor() {
    super(`Effect chain latency exceeds maximum of 50ms`);
    this.name = 'ExcessiveLatencyError';
  }
}