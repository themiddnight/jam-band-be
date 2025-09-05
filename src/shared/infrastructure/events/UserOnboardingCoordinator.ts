/**
 * UserOnboardingCoordinator - Coordinates complex user onboarding workflows
 * 
 * This service listens to user onboarding events and coordinates the complex
 * workflow of preparing users for playback, including instruments, audio routing,
 * and voice connections.
 * 
 * Requirements: 5.2, 5.3, 10.4
 */

import { EventBus, EventHandler } from '../../domain/events/EventBus';
import {
  UserJoinedRoom,
  UserInstrumentsReady,
  UserAudioRoutingReady,
  UserVoiceConnectionReady,
  UserReadyForPlayback,
  UserOnboardingFailed,
  UserOnboardingTimeout
} from '../../domain/events/UserOnboardingEvents';

interface OnboardingSession {
  userId: string;
  roomId: string;
  username: string;
  role: string;
  startedAt: Date;
  instrumentsReady: boolean;
  audioRoutingReady: boolean;
  voiceConnectionReady: boolean;
  timeoutHandle?: NodeJS.Timeout;
}

export class UserOnboardingCoordinator {
  private onboardingSessions = new Map<string, OnboardingSession>();
  private readonly ONBOARDING_TIMEOUT_MS = 30000; // 30 seconds

  constructor(private eventBus: EventBus) {}

  /**
   * Initialize the onboarding coordinator by setting up event handlers
   */
  initialize(): void {
    console.log('🎯 Initializing user onboarding coordinator...');

    this.eventBus.subscribe('UserJoinedRoom', this.handleUserJoinedRoom.bind(this));
    this.eventBus.subscribe('UserInstrumentsReady', this.handleUserInstrumentsReady.bind(this));
    this.eventBus.subscribe('UserAudioRoutingReady', this.handleUserAudioRoutingReady.bind(this));
    this.eventBus.subscribe('UserVoiceConnectionReady', this.handleUserVoiceConnectionReady.bind(this));

    console.log('✅ User onboarding coordinator initialized');
  }

  /**
   * Handle UserJoinedRoom event - start onboarding session
   */
  private handleUserJoinedRoom: EventHandler<UserJoinedRoom> = async (event) => {
    console.log('🎯 Starting onboarding session for user:', event.userId, 'in room:', event.aggregateId);

    const sessionKey = this.getSessionKey(event.userId, event.aggregateId);
    
    // Create onboarding session
    const session: OnboardingSession = {
      userId: event.userId,
      roomId: event.aggregateId,
      username: event.username,
      role: event.role,
      startedAt: new Date(),
      instrumentsReady: false,
      audioRoutingReady: false,
      voiceConnectionReady: false
    };

    // Set timeout for onboarding
    session.timeoutHandle = setTimeout(() => {
      this.handleOnboardingTimeout(sessionKey);
    }, this.ONBOARDING_TIMEOUT_MS);

    this.onboardingSessions.set(sessionKey, session);

    // For audience members, they don't need full onboarding - mark them ready immediately
    if (event.role === 'audience') {
      console.log('👥 Audience member joined, skipping full onboarding:', event.userId);
      await this.completeOnboarding(sessionKey, session);
      return;
    }

    console.log('🎸 Band member joined, starting full onboarding process:', event.userId);
  };

  /**
   * Handle UserInstrumentsReady event - update onboarding progress
   */
  private handleUserInstrumentsReady: EventHandler<UserInstrumentsReady> = async (event) => {
    const sessionKey = this.getSessionKey(event.userId, event.roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session) {
      console.warn('⚠️ Received UserInstrumentsReady for unknown session:', event.userId);
      return;
    }

    console.log('🎸 Instruments ready for user:', event.userId, 'instruments:', event.instruments);
    session.instrumentsReady = true;

    await this.checkOnboardingComplete(sessionKey, session);
  };

  /**
   * Handle UserAudioRoutingReady event - update onboarding progress
   */
  private handleUserAudioRoutingReady: EventHandler<UserAudioRoutingReady> = async (event) => {
    const sessionKey = this.getSessionKey(event.userId, event.roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session) {
      console.warn('⚠️ Received UserAudioRoutingReady for unknown session:', event.userId);
      return;
    }

    console.log('🔊 Audio routing ready for user:', event.userId, 'audioBusId:', event.audioBusId);
    session.audioRoutingReady = true;

    await this.checkOnboardingComplete(sessionKey, session);
  };

  /**
   * Handle UserVoiceConnectionReady event - update onboarding progress
   */
  private handleUserVoiceConnectionReady: EventHandler<UserVoiceConnectionReady> = async (event) => {
    const sessionKey = this.getSessionKey(event.userId, event.roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session) {
      console.warn('⚠️ Received UserVoiceConnectionReady for unknown session:', event.userId);
      return;
    }

    console.log('🎤 Voice connection ready for user:', event.userId, 'connectionId:', event.connectionId);
    session.voiceConnectionReady = true;

    await this.checkOnboardingComplete(sessionKey, session);
  };

  /**
   * Check if onboarding is complete and publish UserReadyForPlayback event
   */
  private async checkOnboardingComplete(sessionKey: string, session: OnboardingSession): Promise<void> {
    // For band members, all three components must be ready
    const isComplete = session.role === 'band_member' 
      ? session.instrumentsReady && session.audioRoutingReady && session.voiceConnectionReady
      : true; // Audience members are always ready

    if (isComplete) {
      await this.completeOnboarding(sessionKey, session);
    } else {
      console.log('⏳ Onboarding in progress for user:', session.userId, {
        instrumentsReady: session.instrumentsReady,
        audioRoutingReady: session.audioRoutingReady,
        voiceConnectionReady: session.voiceConnectionReady
      });
    }
  }

  /**
   * Complete the onboarding process
   */
  private async completeOnboarding(sessionKey: string, session: OnboardingSession): Promise<void> {
    console.log('✅ Onboarding complete for user:', session.userId, 'in room:', session.roomId);

    // Clear timeout
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }

    // Publish UserReadyForPlayback event
    const readyEvent = new UserReadyForPlayback(
      session.userId,
      session.roomId,
      ['instruments', 'audio_routing', 'voice_connection']
    );

    await this.eventBus.publish(readyEvent);

    // Remove session
    this.onboardingSessions.delete(sessionKey);

    const duration = Date.now() - session.startedAt.getTime();
    console.log(`🎯 User ${session.userId} onboarding completed in ${duration}ms`);
  }

  /**
   * Handle onboarding timeout
   */
  private async handleOnboardingTimeout(sessionKey: string): Promise<void> {
    const session = this.onboardingSessions.get(sessionKey);
    if (!session) {
      return;
    }

    console.log('⏰ Onboarding timeout for user:', session.userId, 'in room:', session.roomId);

    // Determine what failed
    const failedSteps: string[] = [];
    if (!session.instrumentsReady) failedSteps.push('instruments');
    if (!session.audioRoutingReady) failedSteps.push('audio_routing');
    if (!session.voiceConnectionReady) failedSteps.push('voice_connection');

    // Publish timeout event
    const timeoutEvent = new UserOnboardingTimeout(
      session.userId,
      session.roomId,
      this.ONBOARDING_TIMEOUT_MS,
      []
    );

    await this.eventBus.publish(timeoutEvent);

    // Also publish failed event with details
    const failedEvent = new UserOnboardingFailed(
      session.userId,
      session.roomId,
      'timeout',
      failedSteps.join(', ')
    );

    await this.eventBus.publish(failedEvent);

    // Remove session
    this.onboardingSessions.delete(sessionKey);
  }

  /**
   * Generate session key for user in room
   */
  private getSessionKey(userId: string, roomId: string): string {
    return `${userId}:${roomId}`;
  }

  /**
   * Get active onboarding sessions (for monitoring/debugging)
   */
  getActiveSessions(): OnboardingSession[] {
    return Array.from(this.onboardingSessions.values());
  }

  /**
   * Force complete onboarding for a user (for testing or recovery)
   */
  async forceCompleteOnboarding(userId: string, roomId: string): Promise<boolean> {
    const sessionKey = this.getSessionKey(userId, roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session) {
      return false;
    }

    console.log('🔧 Force completing onboarding for user:', userId);
    await this.completeOnboarding(sessionKey, session);
    return true;
  }

  /**
   * Cancel onboarding for a user (when they leave)
   */
  cancelOnboarding(userId: string, roomId: string): boolean {
    const sessionKey = this.getSessionKey(userId, roomId);
    const session = this.onboardingSessions.get(sessionKey);

    if (!session) {
      return false;
    }

    console.log('❌ Cancelling onboarding for user:', userId);

    // Clear timeout
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }

    // Remove session
    this.onboardingSessions.delete(sessionKey);
    return true;
  }

  /**
   * Cleanup all onboarding sessions
   */
  cleanup(): void {
    console.log('🧹 Cleaning up onboarding coordinator...');

    // Clear all timeouts
    for (const session of this.onboardingSessions.values()) {
      if (session.timeoutHandle) {
        clearTimeout(session.timeoutHandle);
      }
    }

    // Clear all sessions
    this.onboardingSessions.clear();

    console.log('✅ Onboarding coordinator cleanup complete');
  }
}