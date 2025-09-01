import { UserOnboardingCoordinator } from '../UserOnboardingCoordinator';
import { InMemoryEventBus } from '../../../../shared/domain/events/InMemoryEventBus';
import { 
  UserJoinedRoom,
  UserInstrumentsReady,
  UserAudioRoutingReady,
  UserVoiceConnectionReady,
  UserReadyForPlayback,
  UserOnboardingFailed,
  UserOnboardingTimeout
} from '../../../../shared/domain/events/UserOnboardingEvents';
import { 
  MockInstrumentService,
  MockAudioBusService,
  MockVoiceConnectionService
} from './MockOnboardingServices';

describe('UserOnboardingCoordinator', () => {
  let eventBus: InMemoryEventBus;
  let coordinator: UserOnboardingCoordinator;
  let instrumentService: MockInstrumentService;
  let audioBusService: MockAudioBusService;
  let voiceConnectionService: MockVoiceConnectionService;

  const userId = 'user123';
  const roomId = 'room456';
  const username = 'TestUser';
  const role = 'band_member';

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    coordinator = new UserOnboardingCoordinator(eventBus);
    
    // Setup mock services
    instrumentService = new MockInstrumentService(eventBus);
    audioBusService = new MockAudioBusService(eventBus);
    voiceConnectionService = new MockVoiceConnectionService(eventBus);
  });

  describe('Successful Onboarding Workflow', () => {
    it('should coordinate complete user onboarding workflow', async () => {
      const userReadyEvents: UserReadyForPlayback[] = [];
      
      eventBus.subscribe('UserReadyForPlayback', (event) => {
        userReadyEvents.push(event);
      });

      // Start onboarding process
      const userJoinedEvent = new UserJoinedRoom(roomId, userId, username, role);
      await eventBus.publish(userJoinedEvent);

      // Wait for all services to complete (mock services have delays)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify user is ready for playback
      expect(userReadyEvents).toHaveLength(1);
      expect(userReadyEvents[0].userId).toBe(userId);
      expect(userReadyEvents[0].roomId).toBe(roomId);
      expect(userReadyEvents[0].readyComponents).toEqual(['instruments', 'audioRouting', 'voiceConnection']);

      // Verify session is cleaned up
      expect(coordinator.getActiveSessionCount()).toBe(0);
    });

    it('should track onboarding session status during workflow', async () => {
      // Start onboarding
      const userJoinedEvent = new UserJoinedRoom(roomId, userId, username, role);
      await eventBus.publish(userJoinedEvent);

      // Check initial session status
      let status = coordinator.getSessionStatus(userId, roomId);
      expect(status).not.toBeNull();
      expect(status!.userId).toBe(userId);
      expect(status!.roomId).toBe(roomId);
      expect(status!.username).toBe(username);
      expect(status!.isCompleted).toBe(false);
      expect(status!.isFailed).toBe(false);
      expect(status!.completedComponents).toEqual([]);

      // Wait for partial completion
      await new Promise(resolve => setTimeout(resolve, 120));

      status = coordinator.getSessionStatus(userId, roomId);
      if (status) {
        expect(status.completedComponents.length).toBeGreaterThan(0);
        expect(status.isCompleted).toBe(false);
      }

      // Wait for full completion
      await new Promise(resolve => setTimeout(resolve, 400));

      // Session should be cleaned up after completion
      status = coordinator.getSessionStatus(userId, roomId);
      expect(status).toBeNull();
    });
  });

  describe('Multiple Users Onboarding', () => {
    it('should handle multiple users joining simultaneously', async () => {
      const user1Id = 'user1';
      const user2Id = 'user2';
      const user3Id = 'user3';
      const userReadyEvents: UserReadyForPlayback[] = [];

      eventBus.subscribe('UserReadyForPlayback', (event) => {
        userReadyEvents.push(event);
      });

      // Start onboarding for multiple users
      await eventBus.publish(new UserJoinedRoom(roomId, user1Id, 'User1', role));
      await eventBus.publish(new UserJoinedRoom(roomId, user2Id, 'User2', role));
      await eventBus.publish(new UserJoinedRoom(roomId, user3Id, 'User3', role));

      // Verify all sessions are tracked
      expect(coordinator.getActiveSessionCount()).toBe(3);

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify all users are ready
      expect(userReadyEvents).toHaveLength(3);
      expect(userReadyEvents.map(e => e.userId)).toEqual(
        expect.arrayContaining([user1Id, user2Id, user3Id])
      );

      // Verify all sessions are cleaned up
      expect(coordinator.getActiveSessionCount()).toBe(0);
    });

    it('should handle users in different rooms independently', async () => {
      const room1Id = 'room1';
      const room2Id = 'room2';
      const user1Id = 'user1';
      const user2Id = 'user2';

      // Start onboarding in different rooms
      await eventBus.publish(new UserJoinedRoom(room1Id, user1Id, 'User1', role));
      await eventBus.publish(new UserJoinedRoom(room2Id, user2Id, 'User2', role));

      expect(coordinator.getActiveSessionCount()).toBe(2);

      const status1 = coordinator.getSessionStatus(user1Id, room1Id);
      const status2 = coordinator.getSessionStatus(user2Id, room2Id);

      expect(status1).not.toBeNull();
      expect(status2).not.toBeNull();
      expect(status1!.roomId).toBe(room1Id);
      expect(status2!.roomId).toBe(room2Id);
    });
  });

  describe('Failure Handling', () => {
    it('should handle instrument service failure', async () => {
      // Setup failing instrument service
      const failingInstrumentService = new MockInstrumentService(eventBus, true);
      
      const failureEvents: UserOnboardingFailed[] = [];
      eventBus.subscribe('UserOnboardingFailed', (event) => {
        failureEvents.push(event);
      });

      // Start onboarding
      await eventBus.publish(new UserJoinedRoom(roomId, userId, username, role));

      // Wait for failure
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(failureEvents).toHaveLength(1);
      expect(failureEvents[0].userId).toBe(userId);
      expect(failureEvents[0].failedComponent).toBe('instruments');
      expect(failureEvents[0].reason).toBe('Failed to initialize instruments');

      // Session should be cleaned up
      expect(coordinator.getActiveSessionCount()).toBe(0);
    });

    it('should handle audio bus service failure', async () => {
      // Setup failing audio bus service
      const failingAudioBusService = new MockAudioBusService(eventBus, true);
      
      const failureEvents: UserOnboardingFailed[] = [];
      eventBus.subscribe('UserOnboardingFailed', (event) => {
        failureEvents.push(event);
      });

      await eventBus.publish(new UserJoinedRoom(roomId, userId, username, role));
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(failureEvents).toHaveLength(1);
      expect(failureEvents[0].failedComponent).toBe('audioRouting');
    });

    it('should handle voice connection service failure', async () => {
      // Setup failing voice connection service
      const failingVoiceService = new MockVoiceConnectionService(eventBus, true);
      
      const failureEvents: UserOnboardingFailed[] = [];
      eventBus.subscribe('UserOnboardingFailed', (event) => {
        failureEvents.push(event);
      });

      await eventBus.publish(new UserJoinedRoom(roomId, userId, username, role));
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(failureEvents).toHaveLength(1);
      expect(failureEvents[0].failedComponent).toBe('voiceConnection');
    });
  });

  describe('Timeout Handling', () => {
    it('should handle onboarding timeout', async () => {
      // Create fresh event bus without mock services for timeout test
      const timeoutEventBus = new InMemoryEventBus();
      const shortTimeoutCoordinator = new UserOnboardingCoordinator(timeoutEventBus);
      // Override timeout for testing
      (shortTimeoutCoordinator as any).ONBOARDING_TIMEOUT_MS = 100;

      const timeoutEvents: UserOnboardingTimeout[] = [];
      timeoutEventBus.subscribe('UserOnboardingTimeout', (event) => {
        timeoutEvents.push(event);
      });

      // Start onboarding but don't setup services (so it will timeout)
      await timeoutEventBus.publish(new UserJoinedRoom(roomId, userId, username, role));

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(timeoutEvents).toHaveLength(1);
      expect(timeoutEvents[0].userId).toBe(userId);
      expect(timeoutEvents[0].roomId).toBe(roomId);
      expect(timeoutEvents[0].timeoutAfterMs).toBe(100);
      expect(timeoutEvents[0].completedComponents).toEqual([]);
    });

    it('should handle partial completion before timeout', async () => {
      // Create fresh event bus for partial timeout test
      const partialEventBus = new InMemoryEventBus();
      const shortTimeoutCoordinator = new UserOnboardingCoordinator(partialEventBus);
      (shortTimeoutCoordinator as any).ONBOARDING_TIMEOUT_MS = 300;

      // Setup only instrument service (others will not complete)
      const instrumentService = new MockInstrumentService(partialEventBus, false, 50);

      const timeoutEvents: UserOnboardingTimeout[] = [];
      partialEventBus.subscribe('UserOnboardingTimeout', (event) => {
        timeoutEvents.push(event);
      });

      await partialEventBus.publish(new UserJoinedRoom(roomId, userId, username, role));
      await new Promise(resolve => setTimeout(resolve, 400));

      expect(timeoutEvents).toHaveLength(1);
      expect(timeoutEvents[0].completedComponents).toContain('instruments');
      expect(timeoutEvents[0].completedComponents).not.toContain('audioRouting');
      expect(timeoutEvents[0].completedComponents).not.toContain('voiceConnection');
    });
  });

  describe('Edge Cases', () => {
    it('should ignore events for non-existent sessions', async () => {
      // Publish ready events without starting onboarding
      await eventBus.publish(new UserInstrumentsReady(
        userId, roomId, ['synth'], {}
      ));
      await eventBus.publish(new UserAudioRoutingReady(
        userId, roomId, 'audiobus123', {}
      ));

      // Should not create any sessions
      expect(coordinator.getActiveSessionCount()).toBe(0);
    });

    it('should ignore events for already completed sessions', async () => {
      const userReadyEvents: UserReadyForPlayback[] = [];
      eventBus.subscribe('UserReadyForPlayback', (event) => {
        userReadyEvents.push(event);
      });

      // Complete normal onboarding
      await eventBus.publish(new UserJoinedRoom(roomId, userId, username, role));
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(userReadyEvents).toHaveLength(1);

      // Try to publish more ready events (should be ignored)
      await eventBus.publish(new UserInstrumentsReady(
        userId, roomId, ['piano'], {}
      ));

      // Should not trigger additional ready events
      expect(userReadyEvents).toHaveLength(1);
    });

    it('should ignore events for failed sessions', async () => {
      // Start onboarding and immediately fail it
      await eventBus.publish(new UserJoinedRoom(roomId, userId, username, role));
      await eventBus.publish(new UserOnboardingFailed(
        userId, roomId, 'Test failure', 'test'
      ));

      // Try to publish ready events (should be ignored)
      await eventBus.publish(new UserInstrumentsReady(
        userId, roomId, ['synth'], {}
      ));

      expect(coordinator.getActiveSessionCount()).toBe(0);
    });
  });
});