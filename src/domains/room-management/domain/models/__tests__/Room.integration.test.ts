import { Room } from '../Room';
import { MemberRole } from '../Member';
import { RoomSettings } from '../RoomSettings';
import { UserId } from '../../../../../shared/domain/models/ValueObjects';
import { InMemoryEventBus } from '../../../../../shared/domain/events/InMemoryEventBus';
import { 
  RoomCreated, 
  MemberJoined, 
  OwnershipTransferred 
} from '../../../../../shared/domain/events/RoomEvents';

describe('Room Integration with EventBus', () => {
  let eventBus: InMemoryEventBus;
  let ownerId: UserId;
  let userId1: UserId;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    ownerId = UserId.generate();
    userId1 = UserId.generate();
  });

  it('should publish events through event bus when room operations occur', async () => {
    const roomCreatedEvents: RoomCreated[] = [];
    const memberJoinedEvents: MemberJoined[] = [];
    const ownershipTransferredEvents: OwnershipTransferred[] = [];

    // Subscribe to events
    eventBus.subscribe(RoomCreated, (event) => {
      roomCreatedEvents.push(event);
    });

    eventBus.subscribe(MemberJoined, (event) => {
      memberJoinedEvents.push(event);
    });

    eventBus.subscribe(OwnershipTransferred, (event) => {
      ownershipTransferredEvents.push(event);
    });

    // Create room and publish events
    const room = Room.create('Integration Test Room', ownerId);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Add member and publish events
    room.addMember(userId1, 'User1', MemberRole.BAND_MEMBER);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Transfer ownership and publish events
    room.transferOwnership(userId1);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Verify events were published and handled
    expect(roomCreatedEvents).toHaveLength(1);
    expect(roomCreatedEvents[0].roomName).toBe('Integration Test Room');
    expect(roomCreatedEvents[0].ownerId).toBe(ownerId.toString());

    expect(memberJoinedEvents).toHaveLength(1);
    expect(memberJoinedEvents[0].userId).toBe(userId1.toString());
    expect(memberJoinedEvents[0].username).toBe('User1');
    expect(memberJoinedEvents[0].role).toBe(MemberRole.BAND_MEMBER);

    expect(ownershipTransferredEvents).toHaveLength(1);
    expect(ownershipTransferredEvents[0].previousOwnerId).toBe(ownerId.toString());
    expect(ownershipTransferredEvents[0].newOwnerId).toBe(userId1.toString());
  });

  it('should handle multiple rooms publishing events simultaneously', async () => {
    const allRoomCreatedEvents: RoomCreated[] = [];

    eventBus.subscribe(RoomCreated, (event) => {
      allRoomCreatedEvents.push(event);
    });

    // Create multiple rooms
    const room1 = Room.create('Room 1', ownerId);
    const room2 = Room.create('Room 2', userId1);
    const room3 = Room.create('Room 3', UserId.generate());

    // Publish all events
    const allEvents = [
      ...room1.domainEvents,
      ...room2.domainEvents,
      ...room3.domainEvents
    ];

    await eventBus.publishAll(allEvents);

    // Verify all room creation events were handled
    expect(allRoomCreatedEvents).toHaveLength(3);
    expect(allRoomCreatedEvents.map(e => e.roomName)).toEqual(['Room 1', 'Room 2', 'Room 3']);
  });

  it('should demonstrate event-driven coordination pattern', async () => {
    const coordinationLog: string[] = [];

    // Simulate different services subscribing to room events
    eventBus.subscribe(RoomCreated, async (event) => {
      coordinationLog.push(`RoomService: Room ${event.roomName} created by ${event.ownerId}`);
      // Simulate room service initialization
    });

    eventBus.subscribe(MemberJoined, async (event) => {
      coordinationLog.push(`UserService: User ${event.username} joined room ${event.aggregateId}`);
      // Simulate user service updating user state
    });

    eventBus.subscribe(MemberJoined, async (event) => {
      coordinationLog.push(`AudioService: Setting up audio for user ${event.username} in room ${event.aggregateId}`);
      // Simulate audio service preparing user audio setup
    });

    // Perform room operations
    const room = Room.create('Coordination Test Room', ownerId);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    room.addMember(userId1, 'TestUser', MemberRole.BAND_MEMBER);
    await eventBus.publishAll(room.domainEvents);
    room.markEventsAsCommitted();

    // Verify coordination occurred
    expect(coordinationLog).toHaveLength(3);
    expect(coordinationLog[0]).toContain('RoomService: Room Coordination Test Room created');
    expect(coordinationLog[1]).toContain('UserService: User TestUser joined room');
    expect(coordinationLog[2]).toContain('AudioService: Setting up audio for user TestUser');
  });
});