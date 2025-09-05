/**
 * Base Domain Event class
 * 
 * All domain events should extend this class to ensure consistent
 * event structure and metadata.
 * 
 * Requirements: 5.1, 5.4
 */
export abstract class DomainEvent {
  public readonly occurredOn: Date;
  public readonly eventId: string;
  
  constructor(public readonly aggregateId: string) {
    this.occurredOn = new Date();
    this.eventId = this.generateEventId();
  }

  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}