import { Room } from '../../domain/models/Room';
import { MemberRole } from '../../domain/models/Member';
import { UserOnboardingCoordinator } from '../UserOnboardingCoordinator';
import { InMemoryEventBus } from '../../../../shared/domain/events/InMemoryEventBus';
import { UserId } from '../../../../shared/domain/models/ValueObjects';
import { MemberJoined } from '../../../../shared/domain/events/RoomEvents';
import { 
  UserJoinedRoom,
  UserReadyForPlayback
} from '../../../../shared/domain/events/UserOnboardingEvents';
import { 
  MockInstrumentService,
  MockAudioBusService,
  MockVoiceConnectionService
} from './MockOnboardingServices';

describe('Complete Room and Onboarding Workflow Integration', () => {
  let eventBus: InMemoryEventBus;
  let coordinator: UserOnboardingCoordinator;
  let instrumentService: MockInstrumentService;
  let audioBusService: MockAudioBusService;
  let voiceConnectionService: MockVoiceConnectionService;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    coordinator = new UserOnboardingCoordinator(eventBus);
    
    // Setup mock services
    instrumentService = new MockInstrumentService(eventBus);
    audioBusService = new MockAudioBusService(eventBus);
    voiceConnectionService = new MockVoiceConnectionService(eventBus);
  });

  it('should demonstrate complete room creation and user onboarding workflow', async () => {
    const ownerId = UserId.generate();
    const user1Id = UserId.generate();
    const user2Id = UserId.generate();

    const memberJoinedEvents: MemberJoined[] = [];
    const userJoinedRoomEvents: UserJoinedRoom[] = [];
    const userReadyEvents: UserReadyForPlayback[] = [];

    // Subscribe to events to track the workflow
    eventBus.subscribe(MemberJoined, (event) => {
      memberJoinedEvents.push(event);
    });

    eventBus.subscribe(UserJoinedRoom, (event) => {
      userJoinedRoomEvents.push(event);
    });

    eventBus.subscribe(UserReadyForPlayback, (event) => {
      userReadyEvents.push(event);
    });

    // Setup automatic onboarding trigger when members join
    eventBus.subscribe(MemberJoined, async (event) => {
      // Simulate triggering user onboarding when member joins room
      await eventBus.publish(new UserJoinedRoom(
        event.aggregateId,
        event.userId,
        event.username,
        event.role
      ));
    });

    // Step 1: Create room
    const room = Room.create('Integration Test Room', ownerId);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Step 2: Add first user to room
    room.addMember(user1Id, 'User1', MemberRole.BAND_MEMBER);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Step 3: Add second user to room
    room.addMember(user2Id, 'User2', MemberRole.BAND_MEMBER);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Wait for all onboarding to complete
    await new Promise(resolve => setTimeout(resolve, 600));

    // Verify the complete workflow
    expect(memberJoinedEvents).toHaveLength(2);
    expect(memberJoinedEvents[0].userId).toBe(user1Id.toString());
    expect(memberJoinedEvents[1].userId).toBe(user2Id.toString());

    expect(userJoinedRoomEvents).toHaveLength(2);
    expect(userJoinedRoomEvents[0].userId).toBe(user1Id.toString());
    expect(userJoinedRoomEvents[1].userId).toBe(user2Id.toString());

    expect(userReadyEvents).toHaveLength(2);
    expect(userReadyEvents.map(e => e.userId)).toEqual(
      expect.arrayContaining([user1Id.toString(), user2Id.toString()])
    );

    // Verify room state
    expect(room.memberCount).toBe(3); // Owner + 2 members
    expect(room.hasMember(user1Id)).toBe(true);
    expect(room.hasMember(user2Id)).toBe(true);

    // Verify all onboarding sessions are cleaned up
    expect(coordinator.getActiveSessionCount()).toBe(0);
  });

  it('should handle complex scenario with ownership transfer during onboarding', async () => {
    const ownerId = UserId.generate();
    const user1Id = UserId.generate();

    const ownershipTransferredEvents: any[] = [];
    const userReadyEvents: UserReadyForPlayback[] = [];

    eventBus.subscribe('OwnershipTransferred', (event) => {
      ownershipTransferredEvents.push(event);
    });

    eventBus.subscribe(UserReadyForPlayback, (event) => {
      userReadyEvents.push(event);
    });

    // Auto-trigger onboarding for new members
    eventBus.subscribe(MemberJoined, async (event) => {
      await eventBus.publish(new UserJoinedRoom(
        event.aggregateId,
        event.userId,
        event.username,
        event.role
      ));
    });

    // Create room and add member
    const room = Room.create('Ownership Transfer Room', ownerId);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    room.addMember(user1Id, 'User1', MemberRole.BAND_MEMBER);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Transfer ownership while onboarding is happening
    room.transferOwnership(user1Id);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Wait for onboarding to complete
    await new Promise(resolve => setTimeout(resolve, 600));

    // Verify ownership was transferred
    expect(room.owner.equals(user1Id)).toBe(true);
    expect(room.getMember(user1Id)?.role).toBe(MemberRole.OWNER);

    // Verify onboarding still completed successfully
    expect(userReadyEvents).toHaveLength(1);
    expect(userReadyEvents[0].userId).toBe(user1Id.toString());
  });

  it('should demonstrate event-driven coordination across multiple bounded contexts', async () => {
    const ownerId = UserId.generate();
    const user1Id = UserId.generate();

    const coordinationLog: string[] = [];

    // Simulate different bounded contexts responding to events
    eventBus.subscribe(MemberJoined, async (event) => {
      coordinationLog.push(`RoomManagement: Member ${event.username} joined room ${event.aggregateId}`);
    });

    eventBus.subscribe(UserJoinedRoom, async (event) => {
      coordinationLog.push(`OnboardingCoordinator: Starting onboarding for ${event.username}`);
    });

    // Import the specific event classes
    const { UserInstrumentsReady, UserAudioRoutingReady, UserVoiceConnectionReady } = require('../../../../shared/domain/events/UserOnboardingEvents');

    eventBus.subscribe(UserInstrumentsReady, async (event: any) => {
      coordinationLog.push(`AudioProcessing: Instruments ready for user ${event.userId}`);
    });

    eventBus.subscribe(UserAudioRoutingReady, async (event: any) => {
      coordinationLog.push(`AudioProcessing: Audio routing ready for user ${event.userId}`);
    });

    eventBus.subscribe(UserVoiceConnectionReady, async (event: any) => {
      coordinationLog.push(`RealTimeCommunication: Voice connection ready for user ${event.userId}`);
    });

    eventBus.subscribe(UserReadyForPlayback, async (event) => {
      coordinationLog.push(`SyncService: User ${event.userId} is ready for playback`);
    });

    // Auto-trigger onboarding
    eventBus.subscribe(MemberJoined, async (event) => {
      await eventBus.publish(new UserJoinedRoom(
        event.aggregateId,
        event.userId,
        event.username,
        event.role
      ));
    });

    // Execute workflow
    const room = Room.create('Coordination Demo Room', ownerId);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    room.addMember(user1Id, 'DemoUser', MemberRole.BAND_MEMBER);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Wait for all coordination to complete
    await new Promise(resolve => setTimeout(resolve, 600));

    // Verify coordination occurred across all contexts
    expect(coordinationLog).toHaveLength(6);
    
    // Check that all expected coordination messages are present (order may vary)
    expect(coordinationLog.some(log => log.includes('RoomManagement: Member DemoUser joined'))).toBe(true);
    expect(coordinationLog.some(log => log.includes('OnboardingCoordinator: Starting onboarding for DemoUser'))).toBe(true);
    expect(coordinationLog.some(log => log.includes('AudioProcessing: Instruments ready'))).toBe(true);
    expect(coordinationLog.some(log => log.includes('AudioProcessing: Audio routing ready'))).toBe(true);
    expect(coordinationLog.some(log => log.includes('RealTimeCommunication: Voice connection ready'))).toBe(true);
    expect(coordinationLog.some(log => log.includes('SyncService: User') && log.includes('is ready for playback'))).toBe(true);
  });
});