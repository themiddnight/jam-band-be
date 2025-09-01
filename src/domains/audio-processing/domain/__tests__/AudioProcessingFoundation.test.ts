import { describe, it, expect, beforeEach } from 'bun:test';
import { 
  AudioBus, 
  AudioEffect, 
  EffectChain, 
  AudioRouting, 
  MixerChannel,
  EQSettings,
  InstrumentSwapSession,
  SwapStatus
} from '../index';
import { AudioProcessingCoordinationService } from '../services/AudioProcessingCoordinationService';
import { 
  AudioBusId, 
  UserId, 
  EffectType, 
  AudioInput, 
  AudioOutput,
  MixerChannelId,
  SwapSessionId
} from '../value-objects/AudioValueObjects';

/**
 * Audio Processing Foundation Tests
 * 
 * Validates the core audio processing domain models and their interactions.
 * Tests the foundation for future instrument swapping and mixer functionality.
 * 
 * Requirements: 10.2, 10.3
 */
describe('Audio Processing Foundation', () => {
  let userId: UserId;
  let roomId: string;
  let coordinationService: AudioProcessingCoordinationService;

  beforeEach(() => {
    userId = UserId.generate();
    roomId = 'test-room-123';
    coordinationService = new AudioProcessingCoordinationService();
  });

  describe('AudioBus', () => {
    it('should create audio bus with default settings', () => {
      const audioBus = AudioBus.create(userId, roomId);

      expect(audioBus.getUserId()).toEqual(userId);
      expect(audioBus.getEffectChain().isEmpty()).toBe(true);
      expect(audioBus.getRouting().isValid()).toBe(true);
      expect(audioBus.domainEvents).toHaveLength(1);
    });

    it('should add effects to the chain', () => {
      const audioBus = AudioBus.create(userId, roomId);
      const reverbEffect = AudioEffect.create(EffectType.reverb());

      audioBus.addEffect(reverbEffect);

      const effectChain = audioBus.getEffectChain();
      expect(effectChain.getEffectCount()).toBe(1);
      expect(effectChain.hasEffectType(EffectType.reverb())).toBe(true);
      expect(audioBus.domainEvents).toHaveLength(2); // Creation + EffectAdded
    });

    it('should validate effect addition rules', () => {
      const audioBus = AudioBus.create(userId, roomId);

      expect(audioBus.canAddEffect(EffectType.reverb())).toBe(true);
      expect(audioBus.canAddEffect(EffectType.compressor())).toBe(true);
    });

    it('should update audio routing', () => {
      const audioBus = AudioBus.create(userId, roomId);
      const newRouting = AudioRouting.create(
        AudioInput.instrument(),
        AudioOutput.headphones(),
        0.8
      );

      audioBus.setRouting(newRouting);

      expect(audioBus.getRouting()).toEqual(newRouting);
      expect(audioBus.domainEvents).toHaveLength(2); // Creation + AudioRoutingChanged
    });
  });

  describe('EffectChain', () => {
    it('should create empty effect chain', () => {
      const chain = EffectChain.empty();

      expect(chain.isEmpty()).toBe(true);
      expect(chain.getEffectCount()).toBe(0);
      expect(chain.getTotalLatency()).toBe(0);
    });

    it('should add effects and calculate latency', () => {
      const chain = EffectChain.empty();
      const reverb = AudioEffect.create(EffectType.reverb());
      const delay = AudioEffect.create(EffectType.delay());

      const chainWithReverb = chain.addEffect(reverb);
      const chainWithBoth = chainWithReverb.addEffect(delay);

      expect(chainWithBoth.getEffectCount()).toBe(2);
      expect(chainWithBoth.getTotalLatency()).toBeGreaterThan(0);
    });

    it('should enforce maximum effects limit', () => {
      let chain = EffectChain.empty();

      // Add 8 effects (maximum)
      for (let i = 0; i < 8; i++) {
        const effect = AudioEffect.create(EffectType.filter());
        chain = chain.addEffect(effect);
      }

      expect(chain.getEffectCount()).toBe(8);

      // Adding 9th effect should fail
      const ninthEffect = AudioEffect.create(EffectType.reverb());
      expect(() => chain.addEffect(ninthEffect)).toThrow();
    });

    it('should optimize effect order', () => {
      let chain = EffectChain.empty();
      
      // Add effects in suboptimal order
      chain = chain.addEffect(AudioEffect.create(EffectType.reverb()));
      chain = chain.addEffect(AudioEffect.create(EffectType.compressor()));
      chain = chain.addEffect(AudioEffect.create(EffectType.filter()));

      const optimized = chain.getOptimalOrder();
      const effects = optimized.getEffects();

      // Compressor should come first, then filter, then reverb
      expect(effects[0].getType().toString()).toBe('compressor');
      expect(effects[1].getType().toString()).toBe('filter');
      expect(effects[2].getType().toString()).toBe('reverb');
    });

    it('should validate effect combinations', () => {
      let chain = EffectChain.empty();
      chain = chain.addEffect(AudioEffect.create(EffectType.compressor()));

      // Should not allow second compressor
      expect(chain.canAddEffect(EffectType.compressor())).toBe(false);
      expect(chain.canAddEffect(EffectType.reverb())).toBe(true);
    });
  });

  describe('AudioRouting', () => {
    it('should create default routing', () => {
      const routing = AudioRouting.default();

      expect(routing.getInput().getType()).toBe('microphone');
      expect(routing.getOutput().getType()).toBe('speakers');
      expect(routing.getGain()).toBe(1.0);
      expect(routing.isMutedState()).toBe(false);
    });

    it('should validate gain values', () => {
      const routing = AudioRouting.default();

      expect(() => routing.withGain(-0.1)).toThrow();
      expect(() => routing.withGain(2.1)).toThrow();
      expect(() => routing.withGain(1.5)).not.toThrow();
    });

    it('should handle muting and unmuting', () => {
      const routing = AudioRouting.default();

      const muted = routing.mute();
      expect(muted.isMutedState()).toBe(true);
      expect(muted.getEffectiveGain()).toBe(0);

      const unmuted = muted.unmute();
      expect(unmuted.isMutedState()).toBe(false);
      expect(unmuted.getEffectiveGain()).toBe(1.0);
    });

    it('should validate input/output compatibility', () => {
      const routing = AudioRouting.create(
        AudioInput.instrument(), // 1 channel
        AudioOutput.speakers()   // 2 channels
      );

      expect(routing.canRouteToOutput(AudioOutput.speakers())).toBe(true);
      expect(routing.isValid()).toBe(true);
    });
  });

  describe('MixerChannel', () => {
    it('should create mixer channel with default settings', () => {
      const audioBusId = AudioBusId.generate();
      const channel = MixerChannel.create(userId, audioBusId, 1);

      expect(channel.getUserId()).toEqual(userId);
      expect(channel.getAudioBusId()).toEqual(audioBusId);
      expect(channel.getChannelNumber()).toBe(1);
      expect(channel.getLevel()).toBe(0.75);
      expect(channel.isMutedState()).toBe(false);
      expect(channel.isSoloedState()).toBe(false);
    });

    it('should handle level changes', () => {
      const audioBusId = AudioBusId.generate();
      const channel = MixerChannel.create(userId, audioBusId, 1);

      channel.setLevel(0.5);

      expect(channel.getLevel()).toBe(0.5);
      expect(channel.domainEvents).toHaveLength(2); // Creation + LevelChanged
    });

    it('should validate level bounds', () => {
      const audioBusId = AudioBusId.generate();
      const channel = MixerChannel.create(userId, audioBusId, 1);

      expect(() => channel.setLevel(-0.1)).toThrow();
      expect(() => channel.setLevel(1.1)).toThrow();
      expect(() => channel.setLevel(0.5)).not.toThrow();
    });

    it('should handle mute and solo operations', () => {
      const audioBusId = AudioBusId.generate();
      const channel = MixerChannel.create(userId, audioBusId, 1);

      channel.mute();
      expect(channel.isMutedState()).toBe(true);
      expect(channel.getEffectiveLevel()).toBe(0);

      channel.unmute();
      expect(channel.isMutedState()).toBe(false);

      channel.solo();
      expect(channel.isSoloedState()).toBe(true);
    });

    it('should calculate pan gains correctly', () => {
      const audioBusId = AudioBusId.generate();
      const channel = MixerChannel.create(userId, audioBusId, 1);

      // Center position
      channel.setPanPosition(0);
      expect(channel.getLeftChannelGain()).toBeCloseTo(0.75, 2);
      expect(channel.getRightChannelGain()).toBeCloseTo(0.75, 2);

      // Full left
      channel.setPanPosition(-1);
      expect(channel.getLeftChannelGain()).toBeCloseTo(0.75, 2);
      expect(channel.getRightChannelGain()).toBeCloseTo(0, 2);

      // Full right
      channel.setPanPosition(1);
      expect(channel.getLeftChannelGain()).toBeCloseTo(0, 2);
      expect(channel.getRightChannelGain()).toBeCloseTo(0.75, 2);
    });
  });

  describe('EQSettings', () => {
    it('should create flat EQ settings', () => {
      const eq = EQSettings.flat();

      expect(eq.getLowGain()).toBe(0);
      expect(eq.getMidGain()).toBe(0);
      expect(eq.getHighGain()).toBe(0);
      expect(eq.isFlat()).toBe(true);
    });

    it('should create preset EQ settings', () => {
      const vocalEQ = EQSettings.preset('vocal');

      expect(vocalEQ.isFlat()).toBe(false);
      expect(vocalEQ.getMidGain()).toBeGreaterThan(0);
    });

    it('should validate gain ranges', () => {
      expect(() => new EQSettings(-15, 0, 0)).toThrow();
      expect(() => new EQSettings(0, 15, 0)).toThrow();
      expect(() => new EQSettings(0, 0, -10)).not.toThrow();
    });

    it('should update individual bands', () => {
      const eq = EQSettings.flat();
      const boostedLow = eq.withLowGain(3);

      expect(boostedLow.getLowGain()).toBe(3);
      expect(boostedLow.getMidGain()).toBe(0);
      expect(boostedLow.getHighGain()).toBe(0);
    });
  });

  describe('InstrumentSwapSession', () => {
    it('should create swap session in pending state', () => {
      const requester = UserId.generate();
      const target = UserId.generate();
      const session = InstrumentSwapSession.create(requester, target, roomId);

      expect(session.getRequester()).toEqual(requester);
      expect(session.getTarget()).toEqual(target);
      expect(session.getStatus()).toBe(SwapStatus.PENDING);
      expect(session.canBeAccepted()).toBe(true);
    });

    it('should handle swap acceptance workflow', () => {
      const requester = UserId.generate();
      const target = UserId.generate();
      const session = InstrumentSwapSession.create(requester, target, roomId);

      session.accept();

      expect(session.getStatus()).toBe(SwapStatus.ACCEPTED);
      expect(session.canBeAccepted()).toBe(false);
      expect(session.domainEvents).toHaveLength(2); // SwapRequested + SwapAccepted
    });

    it('should handle swap rejection', () => {
      const requester = UserId.generate();
      const target = UserId.generate();
      const session = InstrumentSwapSession.create(requester, target, roomId);

      session.reject();

      expect(session.getStatus()).toBe(SwapStatus.REJECTED);
      expect(session.isFinal()).toBe(true);
    });

    it('should prevent invalid state transitions', () => {
      const requester = UserId.generate();
      const target = UserId.generate();
      const session = InstrumentSwapSession.create(requester, target, roomId);

      session.accept();

      // Cannot accept again
      expect(() => session.accept()).toThrow();
      // Cannot reject after acceptance
      expect(() => session.reject()).toThrow();
    });

    it('should handle timeout', () => {
      const requester = UserId.generate();
      const target = UserId.generate();
      const session = InstrumentSwapSession.create(requester, target, roomId);

      session.timeout();

      expect(session.getStatus()).toBe(SwapStatus.TIMEOUT);
      expect(session.isFinal()).toBe(true);
    });
  });

  describe('AudioProcessingCoordinationService', () => {
    it('should prepare complete user audio setup', async () => {
      const result = await coordinationService.prepareUserAudioSetup(
        userId,
        roomId,
        1,
        'guitar'
      );

      expect(result.isReady).toBe(true);
      expect(result.audioBus.getUserId()).toEqual(userId);
      expect(result.mixerChannel.getChannelNumber()).toBe(1);
      expect(result.setupLatency).toBeGreaterThanOrEqual(0);
    });

    it('should validate instrument swap compatibility', () => {
      const requesterState = {
        instrument: 'guitar',
        category: 'string',
        timestamp: new Date()
      };

      const targetState = {
        instrument: 'bass',
        category: 'string',
        timestamp: new Date()
      };

      const validation = coordinationService.canUsersSwapInstruments(
        requesterState,
        targetState
      );

      expect(validation.canSwap).toBe(true);
      expect(validation.issues).toHaveLength(0);
      expect(validation.estimatedSwapTime).toBeGreaterThan(0);
    });

    it('should detect incompatible instrument categories', () => {
      const requesterState = {
        instrument: 'guitar',
        category: 'string',
        timestamp: new Date()
      };

      const targetState = {
        instrument: 'drums',
        category: 'percussion',
        timestamp: new Date()
      };

      const validation = coordinationService.canUsersSwapInstruments(
        requesterState,
        targetState
      );

      expect(validation.canSwap).toBe(false);
      expect(validation.issues.length).toBeGreaterThan(0);
    });

    it('should suggest effects for different instruments', () => {
      const guitarEffects = coordinationService.suggestEffectsForInstrument('guitar');
      const vocalEffects = coordinationService.suggestEffectsForInstrument('vocals');
      const bassEffects = coordinationService.suggestEffectsForInstrument('bass');

      expect(guitarEffects.map(e => e.toString())).toContain('compressor');
      expect(vocalEffects.map(e => e.toString())).toContain('reverb');
      expect(bassEffects.map(e => e.toString())).toContain('filter');
    });

    it('should calculate processing load', () => {
      const audioBus = AudioBus.create(userId, roomId);
      const mixerChannel = MixerChannel.create(userId, audioBus.getId(), 1);

      // Add some effects
      audioBus.addEffect(AudioEffect.create(EffectType.compressor()));
      audioBus.addEffect(AudioEffect.create(EffectType.reverb()));

      const loadResult = coordinationService.calculateProcessingLoad(audioBus, mixerChannel);

      expect(loadResult.totalCost).toBeGreaterThan(0);
      expect(loadResult.latency).toBeGreaterThan(0);
      expect(loadResult.effectCount).toBe(2);
      expect(loadResult.recommendations).toBeDefined();
    });

    it('should optimize effect chains', () => {
      let chain = EffectChain.empty();
      chain = chain.addEffect(AudioEffect.create(EffectType.reverb()));
      chain = chain.addEffect(AudioEffect.create(EffectType.compressor()));

      const optimized = coordinationService.optimizeEffectChain(chain);
      const effects = optimized.getEffects();

      // Compressor should come before reverb
      expect(effects[0].getType().toString()).toBe('compressor');
      expect(effects[1].getType().toString()).toBe('reverb');
    });
  });

  describe('Value Objects', () => {
    it('should create and validate AudioBusId', () => {
      const id1 = AudioBusId.generate();
      const id2 = AudioBusId.generate();

      expect(id1.toString()).toBeDefined();
      expect(id1.equals(id2)).toBe(false);
      expect(id1.equals(id1)).toBe(true);
    });

    it('should create and validate EffectType', () => {
      const reverb = EffectType.reverb();
      const delay = EffectType.delay();

      expect(reverb.toString()).toBe('reverb');
      expect(reverb.isTimeBasedEffect()).toBe(true);
      expect(reverb.isDynamicsEffect()).toBe(false);

      const compressor = EffectType.compressor();
      expect(compressor.isDynamicsEffect()).toBe(true);
      expect(compressor.isTimeBasedEffect()).toBe(false);
    });

    it('should validate effect type categories', () => {
      expect(EffectType.reverb().getCategory()).toBe('time-based');
      expect(EffectType.compressor().getCategory()).toBe('dynamics');
      expect(EffectType.filter().getCategory()).toBe('frequency');
      expect(EffectType.distortion().getCategory()).toBe('distortion');
    });

    it('should create and validate AudioInput/Output', () => {
      const micInput = AudioInput.microphone();
      const speakerOutput = AudioOutput.speakers();

      expect(micInput.getType()).toBe('microphone');
      expect(micInput.getChannelCount()).toBe(2);
      expect(micInput.isValid()).toBe(true);

      expect(speakerOutput.getType()).toBe('speakers');
      expect(speakerOutput.isValid()).toBe(true);

      expect(micInput.isCompatibleWith(speakerOutput)).toBe(true);
    });
  });
});