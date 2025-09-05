import { AudioBusId, UserId, EffectType } from '../value-objects/AudioValueObjects';
import { EffectChain } from './EffectChain';
import { AudioRouting } from './AudioRouting';
import { AudioEffect } from './AudioEffect';
import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';
import { EffectAdded } from '../events/EffectAdded';
import { AudioRoutingChanged } from '../events/AudioRoutingChanged';
import { AggregateRoot } from '../../../../shared/domain/models/AggregateRoot';

/**
 * AudioBus - Aggregate root for audio processing
 * 
 * Represents a user's audio processing pipeline including:
 * - Effect chain for audio processing
 * - Audio routing configuration
 * - Future mixer channel integration
 * 
 * Requirements: 10.2, 10.3
 */
export class AudioBus extends AggregateRoot {
  private constructor(
    private readonly id: AudioBusId,
    private readonly userId: UserId,
    private effectChain: EffectChain,
    private routing: AudioRouting
  ) {
    super();
  }

  static create(userId: UserId, roomId: string): AudioBus {
    const audioBus = new AudioBus(
      AudioBusId.generate(),
      userId,
      EffectChain.empty(),
      AudioRouting.default()
    );

    audioBus.addDomainEvent(new AudioBusCreated(
      audioBus.id.toString(),
      userId.toString(),
      roomId
    ));

    return audioBus;
  }

  static fromSnapshot(
    id: AudioBusId,
    userId: UserId,
    effectChain: EffectChain,
    routing: AudioRouting
  ): AudioBus {
    return new AudioBus(id, userId, effectChain, routing);
  }

  getId(): AudioBusId {
    return this.id;
  }

  getUserId(): UserId {
    return this.userId;
  }

  getEffectChain(): EffectChain {
    return this.effectChain;
  }

  getRouting(): AudioRouting {
    return this.routing;
  }

  addEffect(effect: AudioEffect): void {
    this.effectChain = this.effectChain.addEffect(effect);
    
    this.addDomainEvent(new EffectAdded(
      this.id.toString(),
      effect.getType().toString(),
      effect.getParameters()
    ));
  }

  removeEffect(effectId: string): void {
    this.effectChain = this.effectChain.removeEffect(effectId);
    
    this.addDomainEvent(new EffectRemoved(
      this.id.toString(),
      effectId
    ));
  }

  updateEffectParameters(effectId: string, parameters: Record<string, any>): void {
    this.effectChain = this.effectChain.updateEffectParameters(effectId, parameters);
    
    this.addDomainEvent(new EffectParametersUpdated(
      this.id.toString(),
      effectId,
      parameters
    ));
  }

  setRouting(routing: AudioRouting): void {
    this.routing = routing;
    
    this.addDomainEvent(new AudioRoutingChanged(
      this.id.toString(),
      routing.getInput().toString(),
      routing.getOutput().toString()
    ));
  }

  // Future: Mixer integration
  setMixerChannel(channelId: string, level: number): void {
    // Implementation for future mixer functionality
    this.addDomainEvent(new MixerChannelAssigned(
      this.id.toString(),
      channelId,
      level
    ));
  }

  // Business logic for audio processing
  canAddEffect(effectType: EffectType): boolean {
    return this.effectChain.canAddEffect(effectType);
  }

  getProcessingLatency(): number {
    return this.effectChain.getTotalLatency();
  }

  isRoutingValid(): boolean {
    return this.routing.isValid();
  }
}

// Domain Events
class AudioBusCreated extends DomainEvent {
  constructor(
    audioBusId: string,
    public readonly userId: string,
    public readonly roomId: string
  ) {
    super(audioBusId);
  }
}

class EffectRemoved extends DomainEvent {
  constructor(
    audioBusId: string,
    public readonly effectId: string
  ) {
    super(audioBusId);
  }
}

class EffectParametersUpdated extends DomainEvent {
  constructor(
    audioBusId: string,
    public readonly effectId: string,
    public readonly parameters: Record<string, any>
  ) {
    super(audioBusId);
  }
}

class MixerChannelAssigned extends DomainEvent {
  constructor(
    audioBusId: string,
    public readonly channelId: string,
    public readonly level: number
  ) {
    super(audioBusId);
  }
}