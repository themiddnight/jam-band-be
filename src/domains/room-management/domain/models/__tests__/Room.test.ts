import { Room, RoomCreationError, RoomFullError, UserNotInRoomError, MemberAlreadyInRoomError, InsufficientPermissionsError, CannotRemoveOwnerError, AudienceNotAllowedError } from '../Room';
import { Member, MemberRole } from '../Member';
import { RoomSettings } from '../RoomSettings';
import { RoomId, UserId } from '../../../../../shared/domain/models/ValueObjects';
import { 
  RoomCreated, 
  MemberJoined, 
  MemberLeft, 
  OwnershipTransferred, 
  RoomSettingsUpdated,
  RoomClosed 
} from '../../../../../shared/domain/events/RoomEvents';

describe('Room Aggregate', () => {
  let ownerId: UserId;
  let userId1: UserId;
  let userId2: UserId;

  beforeEach(() => {
    ownerId = UserId.generate();
    userId1 = UserId.generate();
    userId2 = UserId.generate();
  });

  describe('Room Creation', () => {
    it('should create room with owner as first member', () => {
      const room = Room.create('Test Room', ownerId);

      expect(room.name).toBe('Test Room');
      expect(room.owner.equals(ownerId)).toBe(true);
      expect(room.memberCount).toBe(1);
      expect(room.hasMember(ownerId)).toBe(true);
      expect(room.isOwner(ownerId)).toBe(true);
    });

    it('should publish RoomCreated event on creation', () => {
      const room = Room.create('Test Room', ownerId);

      const events = room.domainEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(RoomCreated);
      
      const roomCreatedEvent = events[0] as RoomCreated;
      expect(roomCreatedEvent.aggregateId).toBe(room.id.toString());
      expect(roomCreatedEvent.ownerId).toBe(ownerId.toString());
      expect(roomCreatedEvent.roomName).toBe('Test Room');
      expect(roomCreatedEvent.isPrivate).toBe(false);
    });

    it('should create private room when specified in settings', () => {
      const settings = RoomSettings.create({ isPrivate: true });
      const room = Room.create('Private Room', ownerId, settings);

      const events = room.domainEvents;
      const roomCreatedEvent = events[0] as RoomCreated;
      expect(roomCreatedEvent.isPrivate).toBe(true);
    });

    it('should throw error for empty room name', () => {
      expect(() => Room.create('', ownerId)).toThrow(RoomCreationError);
      expect(() => Room.create('   ', ownerId)).toThrow(RoomCreationError);
    });

    it('should throw error for room name too long', () => {
      const longName = 'a'.repeat(101);
      expect(() => Room.create(longName, ownerId)).toThrow(RoomCreationError);
    });
  });

  describe('Member Management', () => {
    let room: Room;

    beforeEach(() => {
      room = Room.create('Test Room', ownerId);
      room.clearDomainEvents(); // Clear creation event for cleaner tests
    });

    it('should add member and publish MemberJoined event', () => {
      room.addMember(userId1, 'User1', MemberRole.BAND_MEMBER);

      expect(room.memberCount).toBe(2);
      expect(room.hasMember(userId1)).toBe(true);

      const events = room.domainEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(MemberJoined);
      
      const memberJoinedEvent = events[0] as MemberJoined;
      expect(memberJoinedEvent.aggregateId).toBe(room.id.toString());
      expect(memberJoinedEvent.userId).toBe(userId1.toString());
      expect(memberJoinedEvent.username).toBe('User1');
      expect(memberJoinedEvent.role).toBe(MemberRole.BAND_MEMBER);
    });

    it('should not allow adding member when room is full', () => {
      const settings = RoomSettings.create({ maxMembers: 2 });
      const fullRoom = Room.create('Full Room', ownerId, settings);
      fullRoom.addMember(userId1, 'User1');

      expect(() => fullRoom.addMember(userId2, 'User2')).toThrow(RoomFullError);
    });

    it('should not allow adding same member twice', () => {
      room.addMember(userId1, 'User1');

      expect(() => room.addMember(userId1, 'User1 Again')).toThrow(MemberAlreadyInRoomError);
    });

    it('should not allow audience when not permitted', () => {
      const settings = RoomSettings.create({ allowAudience: false });
      const restrictedRoom = Room.create('No Audience Room', ownerId, settings);

      expect(() => restrictedRoom.addMember(userId1, 'User1', MemberRole.AUDIENCE))
        .toThrow(AudienceNotAllowedError);
    });

    it('should remove member and publish MemberLeft event', () => {
      room.addMember(userId1, 'User1');
      room.clearDomainEvents();

      room.removeMember(userId1);

      expect(room.memberCount).toBe(1);
      expect(room.hasMember(userId1)).toBe(false);

      const events = room.domainEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(MemberLeft);
      
      const memberLeftEvent = events[0] as MemberLeft;
      expect(memberLeftEvent.aggregateId).toBe(room.id.toString());
      expect(memberLeftEvent.userId).toBe(userId1.toString());
      expect(memberLeftEvent.username).toBe('User1');
    });

    it('should not allow removing non-existent member', () => {
      expect(() => room.removeMember(userId1)).toThrow(UserNotInRoomError);
    });

    it('should not allow removing owner directly', () => {
      expect(() => room.removeMember(ownerId)).toThrow(CannotRemoveOwnerError);
    });
  });

  describe('Ownership Transfer', () => {
    let room: Room;

    beforeEach(() => {
      room = Room.create('Test Room', ownerId);
      room.addMember(userId1, 'User1');
      room.clearDomainEvents();
    });

    it('should transfer ownership and publish OwnershipTransferred event', () => {
      room.transferOwnership(userId1);

      expect(room.owner.equals(userId1)).toBe(true);
      expect(room.isOwner(userId1)).toBe(true);
      expect(room.isOwner(ownerId)).toBe(false);

      // Check member roles updated
      const newOwner = room.getMember(userId1);
      const previousOwner = room.getMember(ownerId);
      expect(newOwner?.role).toBe(MemberRole.OWNER);
      expect(previousOwner?.role).toBe(MemberRole.BAND_MEMBER);

      const events = room.domainEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OwnershipTransferred);
      
      const ownershipEvent = events[0] as OwnershipTransferred;
      expect(ownershipEvent.aggregateId).toBe(room.id.toString());
      expect(ownershipEvent.previousOwnerId).toBe(ownerId.toString());
      expect(ownershipEvent.newOwnerId).toBe(userId1.toString());
    });

    it('should not allow transferring ownership to non-member', () => {
      expect(() => room.transferOwnership(userId2)).toThrow(UserNotInRoomError);
    });
  });

  describe('Settings Update', () => {
    let room: Room;

    beforeEach(() => {
      room = Room.create('Test Room', ownerId);
      room.clearDomainEvents();
    });

    it('should update settings and publish RoomSettingsUpdated event', () => {
      const newSettings = RoomSettings.create({ maxMembers: 10, isPrivate: true });
      
      room.updateSettings(newSettings, ownerId);

      expect(room.settings.maxMembers).toBe(10);
      expect(room.settings.isPrivate).toBe(true);

      const events = room.domainEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(RoomSettingsUpdated);
      
      const settingsEvent = events[0] as RoomSettingsUpdated;
      expect(settingsEvent.aggregateId).toBe(room.id.toString());
      expect(settingsEvent.updatedBy).toBe(ownerId.toString());
      expect(settingsEvent.changes).toHaveProperty('maxMembers');
      expect(settingsEvent.changes).toHaveProperty('isPrivate');
    });

    it('should not publish event when no changes made', () => {
      const currentSettings = room.settings;
      
      room.updateSettings(currentSettings, ownerId);

      expect(room.domainEvents).toHaveLength(0);
    });

    it('should not allow non-owner to update settings', () => {
      room.addMember(userId1, 'User1');
      const newSettings = RoomSettings.create({ maxMembers: 10 });

      expect(() => room.updateSettings(newSettings, userId1))
        .toThrow(InsufficientPermissionsError);
    });
  });

  describe('Room Closure', () => {
    let room: Room;

    beforeEach(() => {
      room = Room.create('Test Room', ownerId);
      room.clearDomainEvents();
    });

    it('should close room and publish RoomClosed event', () => {
      const reason = 'Session ended';
      
      room.closeRoom(ownerId, reason);

      const events = room.domainEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(RoomClosed);
      
      const closedEvent = events[0] as RoomClosed;
      expect(closedEvent.aggregateId).toBe(room.id.toString());
      expect(closedEvent.closedBy).toBe(ownerId.toString());
      expect(closedEvent.reason).toBe(reason);
    });

    it('should close room without reason', () => {
      room.closeRoom(ownerId);

      const events = room.domainEvents;
      const closedEvent = events[0] as RoomClosed;
      expect(closedEvent.reason).toBeUndefined();
    });

    it('should not allow non-owner to close room', () => {
      room.addMember(userId1, 'User1');

      expect(() => room.closeRoom(userId1)).toThrow(InsufficientPermissionsError);
    });
  });

  describe('Query Methods', () => {
    let room: Room;

    beforeEach(() => {
      room = Room.create('Test Room', ownerId);
      room.addMember(userId1, 'User1', MemberRole.BAND_MEMBER);
    });

    it('should check if user can join room', () => {
      expect(room.canUserJoin(userId2, MemberRole.BAND_MEMBER)).toBe(true);
      expect(room.canUserJoin(userId1, MemberRole.BAND_MEMBER)).toBe(false); // Already in room
    });

    it('should check user permissions', () => {
      expect(room.canUserChangeSettings(ownerId)).toBe(true);
      expect(room.canUserChangeSettings(userId1)).toBe(false);
      
      expect(room.canUserKickMember(ownerId, userId1)).toBe(true);
      expect(room.canUserKickMember(userId1, ownerId)).toBe(false); // Cannot kick owner
      expect(room.canUserKickMember(userId1, userId1)).toBe(false); // Cannot kick self
    });

    it('should get member information', () => {
      const member = room.getMember(userId1);
      expect(member).not.toBeNull();
      expect(member?.username).toBe('User1');
      expect(member?.role).toBe(MemberRole.BAND_MEMBER);

      const nonMember = room.getMember(userId2);
      expect(nonMember).toBeNull();
    });
  });
});