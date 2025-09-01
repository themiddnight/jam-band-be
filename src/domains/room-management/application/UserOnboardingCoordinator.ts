import { EventBus } from '../../../shared/domain/events/EventBus';
import { 
  UserJoinedRoom,
  UserInstrumentsReady,
  UserAudioRoutingReady,
  UserVoiceConnectionReady,
  UserReadyForPlayback,
  UserOnboardingFailed,
  UserOnboardingTimeout
} from '../../../shared/domain/events/UserOnboardingEvents';

/**
 * User Onboarding Coordinator
 * 
 * Orchestrates the complex user onboarding workflow by coordinating
 * between different services through domain events.
 * 
 * Requirements: 5.2, 5.3, 10.4
 */
export class UserOnboardingCoordinator {
  private onboardingSessions = new Map<string, OnboardingSession>();
  private readonly ONBOARDING_TIMEOUT_MS = 30000; // 30 seconds

  constructor(private eventBus: EventBus) {
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Start onboarding when user joins room
    this.eventBus.subscribe(UserJoinedRoom, this.handleUserJoinedRoom.bind(this));
    
    // Track component readiness
    this.eventBus.subscribe(UserInstrumentsReady, this.handleUserInstrumentsReady.bind(this));
    this.eventBus.subscribe(UserAudioRoutingReady, this.handleUserAudioRoutingReady.bind(this));
    this.eventBus.subscribe(UserVoiceConnectionReady, this.handleUserVoiceConnectionReady.bind(this));
    
    // Handle failures
    this.eventBus.subscribe(UserOnboardingFailed, this.handleUserOnboardingFailed.bind(this));
  }

  private async handleUserJoinedRoom(event: UserJoinedRoom): Promise<void> {
    const sessionKey = this.getSessionKey(event.userId, event.aggregateId);
    
    // Create onboarding session
    const session = new OnboardingSession(
      event.userId,
      event.aggregateId,
      event.username,
      event.role
    );

    this.onboardingSessions.set(sessionKey, session);

    // Set timeout for onboarding
    setTimeout(() => {
      this.handleOnboardingTimeout(event.userId, event.aggregateId);
    }, this.ONBOARDING_TIMEOUT_MS);

    console.log(`Started onboarding for user ${event.username} in room ${event.aggregateId}`);
  }

  private async handleUserInstrumentsReady(event: UserInstrumentsReady): Promise<void> {
    const sessionKey = this.getSessionKey(event.userId, event.roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session || session.isCompleted || session.isFailed) {
      return;
    }

    session.markInstrumentsReady(event.instruments, event.synthParams);
    await this.checkOnboardingCompletion(session);
  }

  private async handleUserAudioRoutingReady(event: UserAudioRoutingReady): Promise<void> {
    const sessionKey = this.getSessionKey(event.userId, event.roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session || session.isCompleted || session.isFailed) {
      return;
    }

    session.markAudioRoutingReady(event.audioBusId, event.routingConfig);
    await this.checkOnboardingCompletion(session);
  }

  private async handleUserVoiceConnectionReady(event: UserVoiceConnectionReady): Promise<void> {
    const sessionKey = this.getSessionKey(event.userId, event.roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session || session.isCompleted || session.isFailed) {
      return;
    }

    session.markVoiceConnectionReady(event.connectionId, event.connectionType);
    await this.checkOnboardingCompletion(session);
  }

  private async handleUserOnboardingFailed(event: UserOnboardingFailed): Promise<void> {
    const sessionKey = this.getSessionKey(event.userId, event.roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session) {
      return;
    }

    session.markFailed(event.reason, event.failedComponent);
    console.error(`Onboarding failed for user ${event.userId}: ${event.reason}`);
    
    // Cleanup session
    this.onboardingSessions.delete(sessionKey);
  }

  private async handleOnboardingTimeout(userId: string, roomId: string): Promise<void> {
    const sessionKey = this.getSessionKey(userId, roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session || session.isCompleted || session.isFailed) {
      return;
    }

    const completedComponents = session.getCompletedComponents();
    
    await this.eventBus.publish(new UserOnboardingTimeout(
      userId,
      roomId,
      this.ONBOARDING_TIMEOUT_MS,
      completedComponents
    ));

    session.markFailed('Onboarding timeout', 'timeout');
    this.onboardingSessions.delete(sessionKey);
  }

  private async checkOnboardingCompletion(session: OnboardingSession): Promise<void> {
    if (session.isAllComponentsReady()) {
      session.markCompleted();

      // Publish user ready for playback event
      await this.eventBus.publish(new UserReadyForPlayback(
        session.userId,
        session.roomId,
        session.getCompletedComponents()
      ));

      console.log(`User ${session.username} is ready for playback in room ${session.roomId}`);
      
      // Cleanup session
      const sessionKey = this.getSessionKey(session.userId, session.roomId);
      this.onboardingSessions.delete(sessionKey);
    }
  }

  private getSessionKey(userId: string, roomId: string): string {
    return `${userId}:${roomId}`;
  }

  // Public methods for testing and monitoring
  public getActiveSessionCount(): number {
    return this.onboardingSessions.size;
  }

  public getSessionStatus(userId: string, roomId: string): OnboardingSessionStatus | null {
    const sessionKey = this.getSessionKey(userId, roomId);
    const session = this.onboardingSessions.get(sessionKey);
    
    if (!session) {
      return null;
    }

    return {
      userId: session.userId,
      roomId: session.roomId,
      username: session.username,
      isCompleted: session.isCompleted,
      isFailed: session.isFailed,
      completedComponents: session.getCompletedComponents(),
      startedAt: session.startedAt
    };
  }
}

/**
 * Onboarding session tracking individual user's onboarding progress
 */
class OnboardingSession {
  public readonly startedAt: Date = new Date();
  public isCompleted: boolean = false;
  public isFailed: boolean = false;
  public failureReason?: string;

  private instrumentsReady: boolean = false;
  private audioRoutingReady: boolean = false;
  private voiceConnectionReady: boolean = false;

  private instrumentsData?: { instruments: string[], synthParams: Record<string, any> };
  private audioRoutingData?: { audioBusId: string, routingConfig: Record<string, any> };
  private voiceConnectionData?: { connectionId: string, connectionType: 'mesh' | 'streaming' };

  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly username: string,
    public readonly role: string
  ) {}

  markInstrumentsReady(instruments: string[], synthParams: Record<string, any>): void {
    this.instrumentsReady = true;
    this.instrumentsData = { instruments, synthParams };
  }

  markAudioRoutingReady(audioBusId: string, routingConfig: Record<string, any>): void {
    this.audioRoutingReady = true;
    this.audioRoutingData = { audioBusId, routingConfig };
  }

  markVoiceConnectionReady(connectionId: string, connectionType: 'mesh' | 'streaming'): void {
    this.voiceConnectionReady = true;
    this.voiceConnectionData = { connectionId, connectionType };
  }

  markCompleted(): void {
    this.isCompleted = true;
  }

  markFailed(reason: string, component: string): void {
    this.isFailed = true;
    this.failureReason = `${component}: ${reason}`;
  }

  isAllComponentsReady(): boolean {
    return this.instrumentsReady && this.audioRoutingReady && this.voiceConnectionReady;
  }

  getCompletedComponents(): string[] {
    const completed: string[] = [];
    
    if (this.instrumentsReady) completed.push('instruments');
    if (this.audioRoutingReady) completed.push('audioRouting');
    if (this.voiceConnectionReady) completed.push('voiceConnection');
    
    return completed;
  }
}

export interface OnboardingSessionStatus {
  userId: string;
  roomId: string;
  username: string;
  isCompleted: boolean;
  isFailed: boolean;
  completedComponents: string[];
  startedAt: Date;
}