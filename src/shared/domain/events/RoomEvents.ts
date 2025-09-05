import { DomainEvent } from './DomainEvent';

/**
 * Room Management Domain Events
 * 
 * Events published by the Room aggregate to communicate state changes
 * to other bounded contexts.
 * 
 * Requirements: 5.1, 5.2
 */

/**
 * Published when a new room is created
 */
export class RoomCreated extends DomainEvent {
  constructor(
    roomId: string,
    public readonly ownerId: string,
    public readonly roomName: string,
    public readonly isPrivate: boolean = false
  ) {
    super(roomId);
  }
}

/**
 * Published when a member joins a room
 */
export class MemberJoined extends DomainEvent {
  constructor(
    roomId: string,
    public readonly userId: string,
    public readonly username: string,
    public readonly role: string
  ) {
    super(roomId);
  }
}

/**
 * Published when a member leaves a room
 */
export class MemberLeft extends DomainEvent {
  constructor(
    roomId: string,
    public readonly userId: string,
    public readonly username: string
  ) {
    super(roomId);
  }
}

/**
 * Published when room ownership is transferred
 */
export class OwnershipTransferred extends DomainEvent {
  constructor(
    roomId: string,
    public readonly previousOwnerId: string,
    public readonly newOwnerId: string
  ) {
    super(roomId);
  }
}

/**
 * Published when room settings are updated
 */
export class RoomSettingsUpdated extends DomainEvent {
  constructor(
    roomId: string,
    public readonly updatedBy: string,
    public readonly changes: Record<string, any>
  ) {
    super(roomId);
  }
}

/**
 * Published when a room is closed/deleted
 */
export class RoomClosed extends DomainEvent {
  constructor(
    roomId: string,
    public readonly closedBy: string,
    public readonly reason?: string
  ) {
    super(roomId);
  }
}