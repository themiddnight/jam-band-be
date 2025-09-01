/**
 * RoomSettings Value Object Tests
 */

import { RoomSettings, MetronomeSettings, TimeSignature } from '../RoomSettings';

describe('RoomSettings Value Object', () => {
  describe('RoomSettings Creation', () => {
    it('should create default settings', () => {
      const settings = RoomSettings.default();

      expect(settings.maxMembers).toBe(50);
      expect(settings.isPrivate).toBe(false);
      expect(settings.isHidden).toBe(false);
      expect(settings.allowAudienceChat).toBe(true);
      expect(settings.requireApprovalForBandMembers).toBe(false);
      expect(settings.metronomeSettings).toBeInstanceOf(MetronomeSettings);
    });

    it('should create private room settings', () => {
      const settings = RoomSettings.forPrivateRoom();

      expect(settings.isPrivate).toBe(true);
      expect(settings.requireApprovalForBandMembers).toBe(true);
      expect(settings.isHidden).toBe(false);
    });

    it('should create public room settings', () => {
      const settings = RoomSettings.forPublicRoom();

      expect(settings.isPrivate).toBe(false);
      expect(settings.requireApprovalForBandMembers).toBe(false);
      expect(settings.isHidden).toBe(false);
    });

    it('should validate max members range', () => {
      expect(() => new RoomSettings(0)).toThrow('Max members must be between 1 and 100');
      expect(() => new RoomSettings(101)).toThrow('Max members must be between 1 and 100');
      expect(() => new RoomSettings(50)).not.toThrow();
    });
  });

  describe('RoomSettings Methods', () => {
    let settings: RoomSettings;

    beforeEach(() => {
      settings = RoomSettings.default();
    });

    it('should update max members', () => {
      const newSettings = settings.withMaxMembers(25);

      expect(newSettings.maxMembers).toBe(25);
      expect(newSettings.isPrivate).toBe(settings.isPrivate);
      expect(newSettings.isHidden).toBe(settings.isHidden);
    });

    it('should update privacy settings', () => {
      const privateSettings = settings.withPrivacy(true, true);

      expect(privateSettings.isPrivate).toBe(true);
      expect(privateSettings.isHidden).toBe(true);
      expect(privateSettings.requireApprovalForBandMembers).toBe(true); // Auto-enabled for private rooms
    });

    it('should update metronome settings', () => {
      const newMetronomeSettings = MetronomeSettings.default().withBpm(140);
      const newSettings = settings.withMetronomeSettings(newMetronomeSettings);

      expect(newSettings.metronomeSettings.bpm).toBe(140);
    });

    it('should check if approval is required', () => {
      const publicSettings = RoomSettings.forPublicRoom();
      const privateSettings = RoomSettings.forPrivateRoom();

      expect(publicSettings.requiresApproval()).toBe(false);
      expect(privateSettings.requiresApproval()).toBe(true);
    });

    it('should check if publicly visible', () => {
      const visibleSettings = settings.withPrivacy(false, false);
      const hiddenSettings = settings.withPrivacy(false, true);

      expect(visibleSettings.isPubliclyVisible()).toBe(true);
      expect(hiddenSettings.isPubliclyVisible()).toBe(false);
    });

    it('should check equality correctly', () => {
      const settings1 = RoomSettings.default();
      const settings2 = RoomSettings.default();
      const settings3 = RoomSettings.default().withMaxMembers(25);

      expect(settings1.equals(settings2)).toBe(true);
      expect(settings1.equals(settings3)).toBe(false);
    });
  });
});

describe('MetronomeSettings Value Object', () => {
  describe('MetronomeSettings Creation', () => {
    it('should create default metronome settings', () => {
      const settings = MetronomeSettings.default();

      expect(settings.bpm).toBe(120);
      expect(settings.timeSignature).toBe(TimeSignature.FOUR_FOUR);
      expect(settings.isEnabled).toBe(true);
      expect(settings.volume).toBe(0.5);
    });

    it('should validate BPM range', () => {
      expect(() => new MetronomeSettings(59)).toThrow('BPM must be between 60 and 200');
      expect(() => new MetronomeSettings(201)).toThrow('BPM must be between 60 and 200');
      expect(() => new MetronomeSettings(120)).not.toThrow();
    });

    it('should validate volume range', () => {
      expect(() => new MetronomeSettings(120, TimeSignature.FOUR_FOUR, true, -0.1)).toThrow('Volume must be between 0 and 1');
      expect(() => new MetronomeSettings(120, TimeSignature.FOUR_FOUR, true, 1.1)).toThrow('Volume must be between 0 and 1');
      expect(() => new MetronomeSettings(120, TimeSignature.FOUR_FOUR, true, 0.5)).not.toThrow();
    });
  });

  describe('MetronomeSettings Methods', () => {
    let settings: MetronomeSettings;

    beforeEach(() => {
      settings = MetronomeSettings.default();
    });

    it('should update BPM', () => {
      const newSettings = settings.withBpm(140);

      expect(newSettings.bpm).toBe(140);
      expect(newSettings.timeSignature).toBe(settings.timeSignature);
      expect(newSettings.isEnabled).toBe(settings.isEnabled);
      expect(newSettings.volume).toBe(settings.volume);
    });

    it('should update time signature', () => {
      const newSettings = settings.withTimeSignature(TimeSignature.THREE_FOUR);

      expect(newSettings.timeSignature).toBe(TimeSignature.THREE_FOUR);
      expect(newSettings.bpm).toBe(settings.bpm);
    });

    it('should update volume', () => {
      const newSettings = settings.withVolume(0.8);

      expect(newSettings.volume).toBe(0.8);
      expect(newSettings.bpm).toBe(settings.bpm);
    });

    it('should enable and disable', () => {
      const enabledSettings = settings.enable();
      const disabledSettings = settings.disable();

      expect(enabledSettings.isEnabled).toBe(true);
      expect(disabledSettings.isEnabled).toBe(false);
    });

    it('should check equality correctly', () => {
      const settings1 = MetronomeSettings.default();
      const settings2 = MetronomeSettings.default();
      const settings3 = MetronomeSettings.default().withBpm(140);

      expect(settings1.equals(settings2)).toBe(true);
      expect(settings1.equals(settings3)).toBe(false);
    });
  });

  describe('TimeSignature Enum', () => {
    it('should have correct time signature values', () => {
      expect(TimeSignature.FOUR_FOUR).toBe('4/4');
      expect(TimeSignature.THREE_FOUR).toBe('3/4');
      expect(TimeSignature.TWO_FOUR).toBe('2/4');
      expect(TimeSignature.SIX_EIGHT).toBe('6/8');
    });
  });
});