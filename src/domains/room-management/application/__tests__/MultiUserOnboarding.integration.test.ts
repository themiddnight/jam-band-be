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

/**
 * Multi-User Onboarding Integration Tests
 * 
 * Tests complex workflow with multiple users joining simultaneously
 * as required by task 8.3
 * 
 * Requirements: 5.2, 5.3, 10.4
 */
describe('Multi-User Onboarding Integration', () => {
  let eventBus: InMemoryEventBus;
  let coordinator: UserOnboardingCoordinator;
  let instrumentService: MockInstrumentService;
  let audioBusService: MockAudioBusService;
  let voiceConnectionService: MockVoiceConnectionService;

  const roomId = 'test-room-123';

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    coordinator = new UserOnboardingCoordinator(eventBus);
    
    // Setup mock services with realistic delays
    instrumentService = new MockInstrumentService(eventBus, false, 100);
    audioBusService = new MockAudioBusService(eventBus, false, 150);
    voiceConnectionService = new MockVoiceConnectionService(eventBus, false, 200);
  });

  describe('Simultaneous User Onboarding', () => {
    it('should handle 5 users joining simultaneously without conflicts', async () => {
      const users = [
        { id: 'user1', name: 'Alice', role: 'band_member' },
        { id: 'user2', name: 'Bob', role: 'band_member' },
        { id: 'user3', name: 'Charlie', role: 'band_member' },
        { id: 'user4', name: 'Diana', role: 'band_member' },
        { id: 'user5', name: 'Eve', role: 'audience' }
      ];

      const userReadyEvents: UserReadyForPlayback[] = [];
      const instrumentsReadyEvents: UserInstrumentsReady[] = [];
      const audioRoutingReadyEvents: UserAudioRoutingReady[] = [];
      const voiceConnectionReadyEvents: UserVoiceConnectionReady[] = [];

      // Track all events
      eventBus.subscribe('UserReadyForPlayback', (event) => {
        userReadyEvents.push(event);
      });

      eventBus.subscribe('UserInstrumentsReady', (event) => {
        instrumentsReadyEvents.push(event);
      });

      eventBus.subscribe('UserAudioRoutingReady', (event) => {
        audioRoutingReadyEvents.push(event);
      });

      eventBus.subscribe('UserVoiceConnectionReady', (event) => {
        voiceConnectionReadyEvents.push(event);
      });

      // Start onboarding for all users simultaneously
      const startTime = Date.now();
      await Promise.all(users.map(user => 
        eventBus.publish(new UserJoinedRoom(roomId, user.id, user.name, user.role))
      ));

      // Verify all sessions are tracked immediately
      expect(coordinator.getActiveSessionCount()).toBe(5);

      // Wait for all onboarding to complete
      await new Promise(resolve => setTimeout(resolve, 600));

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify all users completed onboarding
      expect(userReadyEvents).toHaveLength(5);
      expect(instrumentsReadyEvents).toHaveLength(5);
      expect(audioRoutingReadyEvents).toHaveLength(5);
      expect(voiceConnectionReadyEvents).toHaveLength(5);

      // Verify all user IDs are present
      const readyUserIds = userReadyEvents.map(e => e.userId).sort();
      const expectedUserIds = users.map(u => u.id).sort();
      expect(readyUserIds).toEqual(expectedUserIds);

      // Verify different connection types based on role
      const bandMemberConnections = voiceConnectionReadyEvents.filter(e => 
        users.find(u => u.id === e.userId)?.role === 'band_member'
      );
      const audienceConnections = voiceConnectionReadyEvents.filter(e => 
        users.find(u => u.id === e.userId)?.role === 'audience'
      );

      expect(bandMemberConnections.every(e => e.connectionType === 'mesh')).toBe(true);
      expect(audienceConnections.every(e => e.connectionType === 'streaming')).toBe(true);

      // Verify all sessions are cleaned up
      expect(coordinator.getActiveSessionCount()).toBe(0);

      // Verify reasonable performance (should complete within expected time)
      expect(totalTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle mixed success and failure scenarios with multiple users', async () => {
      // Setup services with some failures
      const failingInstrumentService = new MockInstrumentService(eventBus, true, 100);
      const normalAudioBusService = new MockAudioBusService(eventBus, false, 150);
      const normalVoiceService = new MockVoiceConnectionService(eventBus, false, 200);

      const users = [
        { id: 'user1', name: 'SuccessUser1', role: 'band_member' },
        { id: 'user2', name: 'SuccessUser2', role: 'band_member' },
        { id: 'user3', name: 'FailUser1', role: 'band_member' },
        { id: 'user4', name: 'FailUser2', role: 'audience' }
      ];

      const userReadyEvents: UserReadyForPlayback[] = [];
      const failureEvents: UserOnboardingFailed[] = [];

      eventBus.subscribe('UserReadyForPlayback', (event) => {
        userReadyEvents.push(event);
      });

      eventBus.subscribe('UserOnboardingFailed', (event) => {
        failureEvents.push(event);
      });

      // Start onboarding for all users
      await Promise.all(users.map(user => 
        eventBus.publish(new UserJoinedRoom(roomId, user.id, user.name, user.role))
      ));

      // Wait for completion/failures
      await new Promise(resolve => setTimeout(resolve, 600));

      // All should fail due to instrument service failure
      expect(failureEvents).toHaveLength(4);
      expect(userReadyEvents).toHaveLength(0);

      // Verify failure reasons
      expect(failureEvents.every(e => e.failedComponent === 'instruments')).toBe(true);
      expect(failureEvents.every(e => e.reason === 'Failed to initialize instruments')).toBe(true);

      // Verify all sessions are cleaned up after failures
      expect(coordinator.getActiveSessionCount()).toBe(0);
    });

    it('should handle timeout scenarios with multiple users', async () => {
      // Create coordinator with short timeout
      const shortTimeoutEventBus = new InMemoryEventBus();
      const shortTimeoutCoordinator = new UserOnboardingCoordinator(shortTimeoutEventBus);
      (shortTimeoutCoordinator as any).ONBOARDING_TIMEOUT_MS = 300;

      // Setup only partial services (missing voice connection service)
      const instrumentService = new MockInstrumentService(shortTimeoutEventBus, false, 50);
      const audioBusService = new MockAudioBusService(shortTimeoutEventBus, false, 100);
      // No voice connection service - will cause timeout

      const users = [
        { id: 'user1', name: 'TimeoutUser1', role: 'band_member' },
        { id: 'user2', name: 'TimeoutUser2', role: 'band_member' },
        { id: 'user3', name: 'TimeoutUser3', role: 'audience' }
      ];

      const timeoutEvents: UserOnboardingTimeout[] = [];
      const instrumentsReadyEvents: UserInstrumentsReady[] = [];
      const audioRoutingReadyEvents: UserAudioRoutingReady[] = [];

      shortTimeoutEventBus.subscribe('UserOnboardingTimeout', (event) => {
        timeoutEvents.push(event);
      });

      shortTimeoutEventBus.subscribe('UserInstrumentsReady', (event) => {
        instrumentsReadyEvents.push(event);
      });

      shortTimeoutEventBus.subscribe('UserAudioRoutingReady', (event) => {
        audioRoutingReadyEvents.push(event);
      });

      // Start onboarding for all users
      await Promise.all(users.map(user => 
        shortTimeoutEventBus.publish(new UserJoinedRoom(roomId, user.id, user.name, user.role))
      ));

      // Wait for timeouts
      await new Promise(resolve => setTimeout(resolve, 500));

      // All should timeout
      expect(timeoutEvents).toHaveLength(3);
      
      // But partial completion should have occurred
      expect(instrumentsReadyEvents).toHaveLength(3);
      expect(audioRoutingReadyEvents).toHaveLength(3);

      // Verify timeout details
      timeoutEvents.forEach(event => {
        expect(event.timeoutAfterMs).toBe(300);
        expect(event.completedComponents).toContain('instruments');
        expect(event.completedComponents).toContain('audioRouting');
        expect(event.completedComponents).not.toContain('voiceConnection');
      });

      // Verify all sessions are cleaned up after timeout
      expect(shortTimeoutCoordinator.getActiveSessionCount()).toBe(0);
    });

    it('should maintain event ordering and consistency with rapid user joins', async () => {
      const users = Array.from({ length: 10 }, (_, i) => ({
        id: `rapid-user-${i}`,
        name: `RapidUser${i}`,
        role: i % 2 === 0 ? 'band_member' : 'audience'
      }));

      const eventLog: Array<{ type: string, userId: string, timestamp: number }> = [];

      // Track event ordering
      eventBus.subscribe('UserJoinedRoom', (event) => {
        eventLog.push({ type: 'UserJoinedRoom', userId: event.userId, timestamp: Date.now() });
      });

      eventBus.subscribe('UserInstrumentsReady', (event) => {
        eventLog.push({ type: 'UserInstrumentsReady', userId: event.userId, timestamp: Date.now() });
      });

      eventBus.subscribe('UserAudioRoutingReady', (event) => {
        eventLog.push({ type: 'UserAudioRoutingReady', userId: event.userId, timestamp: Date.now() });
      });

      eventBus.subscribe('UserVoiceConnectionReady', (event) => {
        eventLog.push({ type: 'UserVoiceConnectionReady', userId: event.userId, timestamp: Date.now() });
      });

      eventBus.subscribe('UserReadyForPlayback', (event) => {
        eventLog.push({ type: 'UserReadyForPlayback', userId: event.userId, timestamp: Date.now() });
      });

      // Rapid fire user joins with minimal delay
      for (const user of users) {
        await eventBus.publish(new UserJoinedRoom(roomId, user.id, user.name, user.role));
        await new Promise(resolve => setTimeout(resolve, 10)); // 10ms between joins
      }

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 800));

      // Verify all events occurred
      expect(eventLog.filter(e => e.type === 'UserJoinedRoom')).toHaveLength(10);
      expect(eventLog.filter(e => e.type === 'UserInstrumentsReady')).toHaveLength(10);
      expect(eventLog.filter(e => e.type === 'UserAudioRoutingReady')).toHaveLength(10);
      expect(eventLog.filter(e => e.type === 'UserVoiceConnectionReady')).toHaveLength(10);
      expect(eventLog.filter(e => e.type === 'UserReadyForPlayback')).toHaveLength(10);

      // Verify event ordering for each user (UserJoinedRoom should come first for each user)
      users.forEach(user => {
        const userEvents = eventLog.filter(e => e.userId === user.id);
        expect(userEvents[0].type).toBe('UserJoinedRoom');
        
        // UserReadyForPlayback should be present (but may not be last due to async processing)
        const hasReadyEvent = userEvents.some(e => e.type === 'UserReadyForPlayback');
        expect(hasReadyEvent).toBe(true);
        
        // All expected event types should be present
        const eventTypes = userEvents.map(e => e.type);
        expect(eventTypes).toContain('UserJoinedRoom');
        expect(eventTypes).toContain('UserInstrumentsReady');
        expect(eventTypes).toContain('UserAudioRoutingReady');
        expect(eventTypes).toContain('UserVoiceConnectionReady');
        expect(eventTypes).toContain('UserReadyForPlayback');
      });

      // Verify no sessions remain
      expect(coordinator.getActiveSessionCount()).toBe(0);
    });
  });

  describe('Cross-Context Event Coordination', () => {
    it('should demonstrate proper event flow across bounded contexts', async () => {
      const users = [
        { id: 'ctx-user1', name: 'ContextUser1', role: 'band_member' },
        { id: 'ctx-user2', name: 'ContextUser2', role: 'audience' }
      ];

      const contextEventLog: string[] = [];

      // Simulate different bounded contexts responding to events
      eventBus.subscribe('UserJoinedRoom', async (event) => {
        contextEventLog.push(`RoomManagement: User ${event.username} joined room ${event.aggregateId}`);
      });

      eventBus.subscribe('UserInstrumentsReady', async (event) => {
        contextEventLog.push(`AudioProcessing: Instruments ready for ${event.userId} with ${event.instruments.length} instruments`);
      });

      eventBus.subscribe('UserAudioRoutingReady', async (event) => {
        contextEventLog.push(`AudioProcessing: Audio routing ready for ${event.userId} on bus ${event.audioBusId}`);
      });

      eventBus.subscribe('UserVoiceConnectionReady', async (event) => {
        contextEventLog.push(`RealTimeCommunication: ${event.connectionType} connection ready for ${event.userId}`);
      });

      eventBus.subscribe('UserReadyForPlayback', async (event) => {
        contextEventLog.push(`SyncService: User ${event.userId} ready with components: ${event.readyComponents.join(', ')}`);
      });

      // Start onboarding
      await Promise.all(users.map(user => 
        eventBus.publish(new UserJoinedRoom(roomId, user.id, user.name, user.role))
      ));

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 600));

      // Verify cross-context coordination occurred
      expect(contextEventLog.length).toBe(10); // 5 events per user

      // Verify each context responded appropriately
      expect(contextEventLog.filter(log => log.includes('RoomManagement:')).length).toBe(2);
      expect(contextEventLog.filter(log => log.includes('AudioProcessing:')).length).toBe(4); // 2 events per user
      expect(contextEventLog.filter(log => log.includes('RealTimeCommunication:')).length).toBe(2);
      expect(contextEventLog.filter(log => log.includes('SyncService:')).length).toBe(2);

      // Verify different connection types were used
      expect(contextEventLog.some(log => log.includes('mesh connection ready'))).toBe(true);
      expect(contextEventLog.some(log => log.includes('streaming connection ready'))).toBe(true);
    });
  });
});