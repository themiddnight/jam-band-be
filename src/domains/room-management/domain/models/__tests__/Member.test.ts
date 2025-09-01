/**
 * Member Value Object Tests
 */

import { Member, MemberRole } from '../Member';
import { UserId } from '../../../../../shared/domain/models/ValueObjects';

describe('Member Value Object', () => {
  let userId: UserId;
  let username: string;

  beforeEach(() => {
    userId = UserId.generate();
    username = 'TestUser';
  });

  describe('Member Creation', () => {
    it('should create member with basic properties', () => {
      const member = Member.create(userId, username, MemberRole.BAND_MEMBER);

      expect(member.userId.equals(userId)).toBe(true);
      expect(member.username).toBe(username);
      expect(member.role).toBe(MemberRole.BAND_MEMBER);
      expect(member.isReady).toBe(false); // Band members are not ready by default
      expect(member.joinedAt).toBeInstanceOf(Date);
    });

    it('should create audience member as ready by default', () => {
      const member = Member.create(userId, username, MemberRole.AUDIENCE);

      expect(member.role).toBe(MemberRole.AUDIENCE);
      expect(member.isReady).toBe(true); // Audience members are ready by default
    });

    it('should create room owner as not ready by default', () => {
      const member = Member.create(userId, username, MemberRole.ROOM_OWNER);

      expect(member.role).toBe(MemberRole.ROOM_OWNER);
      expect(member.isReady).toBe(false); // Room owners need to be ready manually
    });
  });

  describe('Member Methods', () => {
    let member: Member;

    beforeEach(() => {
      member = Member.create(userId, username, MemberRole.BAND_MEMBER);
    });

    it('should update ready status', () => {
      const readyMember = member.withReadyStatus(true);

      expect(readyMember.isReady).toBe(true);
      expect(readyMember.userId.equals(userId)).toBe(true);
      expect(readyMember.username).toBe(username);
      expect(readyMember.role).toBe(MemberRole.BAND_MEMBER);
    });

    it('should update instrument', () => {
      const memberWithInstrument = member.withInstrument('synth', 'lead');

      expect(memberWithInstrument.currentCategory).toBe('synth');
      expect(memberWithInstrument.currentInstrument).toBe('lead');
      expect(memberWithInstrument.userId.equals(userId)).toBe(true);
    });

    it('should check role types correctly', () => {
      const owner = Member.create(userId, username, MemberRole.ROOM_OWNER);
      const bandMember = Member.create(userId, username, MemberRole.BAND_MEMBER);
      const audience = Member.create(userId, username, MemberRole.AUDIENCE);

      expect(owner.isOwner()).toBe(true);
      expect(owner.isBandMember()).toBe(false);
      expect(owner.isAudience()).toBe(false);

      expect(bandMember.isOwner()).toBe(false);
      expect(bandMember.isBandMember()).toBe(true);
      expect(bandMember.isAudience()).toBe(false);

      expect(audience.isOwner()).toBe(false);
      expect(audience.isBandMember()).toBe(false);
      expect(audience.isAudience()).toBe(true);
    });

    it('should check permissions correctly', () => {
      const owner = Member.create(userId, username, MemberRole.ROOM_OWNER);
      const bandMember = Member.create(userId, username, MemberRole.BAND_MEMBER);
      const audience = Member.create(userId, username, MemberRole.AUDIENCE);

      expect(owner.canKickMembers()).toBe(true);
      expect(owner.canTransferOwnership()).toBe(true);
      expect(owner.canChangeRoomSettings()).toBe(true);

      expect(bandMember.canKickMembers()).toBe(false);
      expect(bandMember.canTransferOwnership()).toBe(false);
      expect(bandMember.canChangeRoomSettings()).toBe(false);

      expect(audience.canKickMembers()).toBe(false);
      expect(audience.canTransferOwnership()).toBe(false);
      expect(audience.canChangeRoomSettings()).toBe(false);
    });

    it('should check equality correctly', () => {
      const sameUserId = UserId.fromString(userId.toString());
      const differentUserId = UserId.generate();

      const member1 = Member.create(userId, username, MemberRole.BAND_MEMBER);
      const member2 = Member.create(sameUserId, 'DifferentName', MemberRole.AUDIENCE);
      const member3 = Member.create(differentUserId, username, MemberRole.BAND_MEMBER);

      expect(member1.equals(member2)).toBe(true); // Same user ID
      expect(member1.equals(member3)).toBe(false); // Different user ID
    });

    it('should have meaningful string representation', () => {
      const memberString = member.toString();

      expect(memberString).toContain(userId.toString());
      expect(memberString).toContain(username);
      expect(memberString).toContain(MemberRole.BAND_MEMBER);
    });
  });
});