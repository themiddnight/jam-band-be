import { SwapSessionId, UserId } from '../value-objects/AudioValueObjects';
import { AggregateRoot } from '../../../../shared/domain/models/AggregateRoot';
import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';

/**
 * InstrumentSwapSession - Aggregate root for instrument swapping between users
 * 
 * Manages the workflow of swapping instruments between band members,
 * including approval, coordination, and state synchronization.
 * 
 * Requirements: 10.2, 10.3
 */
export class InstrumentSwapSession extends AggregateRoot {
  private constructor(
    private readonly id: SwapSessionId,
    private readonly requester: UserId,
    private readonly target: UserId,
    private readonly roomId: string,
    private status: SwapStatus = SwapStatus.PENDING,
    private readonly createdAt: Date = new Date()
  ) {
    super();
  }

  static create(requester: UserId, target: UserId, roomId: string): InstrumentSwapSession {
    const session = new InstrumentSwapSession(
      SwapSessionId.generate(),
      requester,
      target,
      roomId,
      SwapStatus.PENDING
    );

    session.addDomainEvent(new SwapRequested(
      session.id.toString(),
      requester.toString(),
      target.toString(),
      roomId
    ));

    return session;
  }

  static fromSnapshot(
    id: SwapSessionId,
    requester: UserId,
    target: UserId,
    roomId: string,
    status: SwapStatus,
    createdAt: Date
  ): InstrumentSwapSession {
    return new InstrumentSwapSession(id, requester, target, roomId, status, createdAt);
  }

  getId(): SwapSessionId {
    return this.id;
  }

  getRequester(): UserId {
    return this.requester;
  }

  getTarget(): UserId {
    return this.target;
  }

  getRoomId(): string {
    return this.roomId;
  }

  getStatus(): SwapStatus {
    return this.status;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  accept(): void {
    if (this.status !== SwapStatus.PENDING) {
      throw new InvalidSwapStateError(`Cannot accept swap in state: ${this.status}`);
    }

    this.status = SwapStatus.ACCEPTED;
    
    this.addDomainEvent(new SwapAccepted(
      this.id.toString(),
      this.requester.toString(),
      this.target.toString()
    ));
  }

  reject(): void {
    if (this.status !== SwapStatus.PENDING) {
      throw new InvalidSwapStateError(`Cannot reject swap in state: ${this.status}`);
    }

    this.status = SwapStatus.REJECTED;
    
    this.addDomainEvent(new SwapRejected(
      this.id.toString(),
      this.requester.toString(),
      this.target.toString()
    ));
  }

  complete(requesterState: UserAudioState, targetState: UserAudioState): void {
    if (this.status !== SwapStatus.ACCEPTED) {
      throw new InvalidSwapStateError(`Cannot complete swap in state: ${this.status}`);
    }

    this.status = SwapStatus.COMPLETED;
    
    this.addDomainEvent(new SwapCompleted(
      this.id.toString(),
      this.requester.toString(),
      this.target.toString(),
      requesterState,
      targetState
    ));
  }

  cancel(): void {
    if (this.status === SwapStatus.COMPLETED) {
      throw new InvalidSwapStateError('Cannot cancel completed swap');
    }

    this.status = SwapStatus.CANCELLED;
    
    this.addDomainEvent(new SwapCancelled(
      this.id.toString(),
      this.requester.toString(),
      this.target.toString()
    ));
  }

  timeout(): void {
    if (this.status !== SwapStatus.PENDING) {
      return; // Only pending swaps can timeout
    }

    this.status = SwapStatus.TIMEOUT;
    
    this.addDomainEvent(new SwapTimedOut(
      this.id.toString(),
      this.requester.toString(),
      this.target.toString()
    ));
  }

  // Business logic
  isExpired(timeoutMinutes: number = 5): boolean {
    const now = new Date();
    const expiryTime = new Date(this.createdAt.getTime() + timeoutMinutes * 60 * 1000);
    return now > expiryTime && this.status === SwapStatus.PENDING;
  }

  canBeAccepted(): boolean {
    return this.status === SwapStatus.PENDING && !this.isExpired();
  }

  canBeRejected(): boolean {
    return this.status === SwapStatus.PENDING;
  }

  canBeCancelled(): boolean {
    return this.status === SwapStatus.PENDING || this.status === SwapStatus.ACCEPTED;
  }

  isActive(): boolean {
    return this.status === SwapStatus.PENDING || this.status === SwapStatus.ACCEPTED;
  }

  isFinal(): boolean {
    return [SwapStatus.COMPLETED, SwapStatus.REJECTED, SwapStatus.CANCELLED, SwapStatus.TIMEOUT]
      .includes(this.status);
  }
}

// Swap Status enumeration
export enum SwapStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout'
}

// User Audio State for swap coordination
export interface UserAudioState {
  instrument: string;
  category: string;
  synthParams?: Record<string, any>;
  effectChain?: any[]; // Will be properly typed when effect system is implemented
  audioRouting?: any;  // Will be properly typed when routing system is implemented
}

// Domain Events
class SwapRequested extends DomainEvent {
  constructor(
    swapId: string,
    public readonly requesterId: string,
    public readonly targetId: string,
    public readonly roomId: string
  ) {
    super(swapId);
  }
}

class SwapAccepted extends DomainEvent {
  constructor(
    swapId: string,
    public readonly requesterId: string,
    public readonly targetId: string
  ) {
    super(swapId);
  }
}

class SwapRejected extends DomainEvent {
  constructor(
    swapId: string,
    public readonly requesterId: string,
    public readonly targetId: string
  ) {
    super(swapId);
  }
}

class SwapCompleted extends DomainEvent {
  constructor(
    swapId: string,
    public readonly requesterId: string,
    public readonly targetId: string,
    public readonly requesterState: UserAudioState,
    public readonly targetState: UserAudioState
  ) {
    super(swapId);
  }
}

class SwapCancelled extends DomainEvent {
  constructor(
    swapId: string,
    public readonly requesterId: string,
    public readonly targetId: string
  ) {
    super(swapId);
  }
}

class SwapTimedOut extends DomainEvent {
  constructor(
    swapId: string,
    public readonly requesterId: string,
    public readonly targetId: string
  ) {
    super(swapId);
  }
}

// Domain Exception
export class InvalidSwapStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSwapStateError';
  }
}