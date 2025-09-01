import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';

/**
 * EffectAdded - Domain event for when an effect is added to an audio bus
 * 
 * Requirements: 5.1, 10.2
 */
export class EffectAdded extends DomainEvent {
  constructor(
    audioBusId: string,
    public readonly effectType: string,
    public readonly effectParameters: Record<string, any>
  ) {
    super(audioBusId);
  }
}