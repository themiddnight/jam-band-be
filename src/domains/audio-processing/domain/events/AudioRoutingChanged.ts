import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';

/**
 * AudioRoutingChanged - Domain event for when audio routing configuration changes
 * 
 * Requirements: 5.1, 10.2
 */
export class AudioRoutingChanged extends DomainEvent {
  constructor(
    audioBusId: string,
    public readonly inputType: string,
    public readonly outputType: string
  ) {
    super(audioBusId);
  }
}