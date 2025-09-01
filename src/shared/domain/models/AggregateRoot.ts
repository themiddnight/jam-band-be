import { DomainEvent } from '../events/DomainEvent';

/**
 * Base Aggregate Root class
 * 
 * Provides domain event management functionality for aggregate roots.
 * All aggregate roots should extend this class.
 * 
 * Requirements: 1.1, 5.1
 */
export abstract class AggregateRoot {
  private _domainEvents: DomainEvent[] = [];

  get domainEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  clearDomainEvents(): void {
    this._domainEvents = [];
  }

  markEventsAsCommitted(): void {
    this.clearDomainEvents();
  }
}