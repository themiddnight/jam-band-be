import { AudioBus } from '../models/AudioBus';
import { MixerChannel } from '../models/MixerChannel';
import { InstrumentSwapSession, UserAudioState } from '../models/InstrumentSwapSession';
import { EffectChain } from '../models/EffectChain';
import { AudioRouting } from '../models/AudioRouting';
import { AudioEffect } from '../models/AudioEffect';
import { UserId, AudioBusId, EffectType } from '../value-objects/AudioValueObjects';
import { 
  UserAudioSetupResult, 
  SwapValidationResult, 
  SwapCoordinationResult, 
  ProcessingLoadResult 
} from '../types/AudioProcessingTypes';

// Domain Exception
export class SwapValidationError extends Error {
  constructor(issues: string[]) {
    super(`Instrument swap validation failed: ${issues.join(', ')}`);
    this.name = 'SwapValidationError';
  }
}

/**
 * AudioProcessingCoordinationService - Domain service for complex audio processing workflows
 * 
 * Coordinates between AudioBus, MixerChannel, and InstrumentSwapSession aggregates
 * to handle complex business logic that spans multiple aggregates.
 * 
 * Requirements: 10.2, 10.3
 */
export class AudioProcessingCoordinationService {
  
  /**
   * Prepares a user's complete audio setup when joining a room
   */
  async prepareUserAudioSetup(
    userId: UserId,
    roomId: string,
    channelNumber: number,
    preferredInstrument?: string
  ): Promise<UserAudioSetupResult> {
    // Create audio bus for the user
    const audioBus = AudioBus.create(userId, roomId);
    
    // Create mixer channel linked to the audio bus
    const mixerChannel = MixerChannel.create(userId, audioBus.getId(), channelNumber);
    
    // Apply default effects based on instrument type
    if (preferredInstrument) {
      const defaultEffects = this.getDefaultEffectsForInstrument(preferredInstrument);
      for (const effectType of defaultEffects) {
        const effect = AudioEffect.create(effectType);
        audioBus.addEffect(effect);
      }
    }
    
    return {
      audioBus,
      mixerChannel,
      isReady: true,
      setupLatency: audioBus.getProcessingLatency()
    };
  }

  /**
   * Validates if two users can swap instruments based on their audio configurations
   */
  canUsersSwapInstruments(
    requesterState: UserAudioState,
    targetState: UserAudioState
  ): SwapValidationResult {
    const issues: string[] = [];
    
    // Check if instrument categories are compatible
    if (!this.areInstrumentCategoriesCompatible(requesterState.category, targetState.category)) {
      issues.push(`Incompatible instrument categories: ${requesterState.category} and ${targetState.category}`);
    }
    
    // Check effect chain compatibility
    if (requesterState.effectChain && targetState.effectChain) {
      const requesterLatency = requesterState.effectChain.totalLatency;
      const targetLatency = targetState.effectChain.totalLatency;
      
      if (Math.abs(requesterLatency - targetLatency) > 20) {
        issues.push(`Significant latency difference: ${requesterLatency}ms vs ${targetLatency}ms`);
      }
    }
    
    // Check audio routing compatibility
    if (requesterState.audioRouting && targetState.audioRouting) {
      if (!this.areRoutingsCompatible(requesterState.audioRouting, targetState.audioRouting)) {
        issues.push('Incompatible audio routing configurations');
      }
    }
    
    return {
      canSwap: issues.length === 0,
      issues,
      estimatedSwapTime: this.calculateSwapTime(requesterState, targetState)
    };
  }

  /**
   * Coordinates the actual instrument swap between two users
   */
  async coordinateInstrumentSwap(
    swapSession: InstrumentSwapSession,
    requesterAudioBus: AudioBus,
    targetAudioBus: AudioBus,
    requesterMixerChannel: MixerChannel,
    targetMixerChannel: MixerChannel
  ): Promise<SwapCoordinationResult> {
    // Capture current states
    const requesterState = this.captureUserAudioState(
      requesterAudioBus,
      requesterMixerChannel,
      'requester_instrument'
    );
    
    const targetState = this.captureUserAudioState(
      targetAudioBus,
      targetMixerChannel,
      'target_instrument'
    );
    
    // Validate swap is still possible
    const validation = this.canUsersSwapInstruments(requesterState, targetState);
    if (!validation.canSwap) {
      throw new SwapValidationError(validation.issues);
    }
    
    // Perform the swap by applying each other's configurations
    await this.applyAudioStateToUser(targetState, requesterAudioBus, requesterMixerChannel);
    await this.applyAudioStateToUser(requesterState, targetAudioBus, targetMixerChannel);
    
    // Complete the swap session
    swapSession.complete(requesterState, targetState);
    
    return {
      success: true,
      requesterNewState: targetState,
      targetNewState: requesterState,
      swapDuration: Date.now() - swapSession.getCreatedAt().getTime()
    };
  }

  /**
   * Optimizes effect chain order for minimal latency and best sound quality
   */
  optimizeEffectChain(effectChain: EffectChain): EffectChain {
    return effectChain.getOptimalOrder();
  }

  /**
   * Calculates the total processing load for a user's audio setup
   */
  calculateProcessingLoad(audioBus: AudioBus, mixerChannel: MixerChannel): ProcessingLoadResult {
    const effectChain = audioBus.getEffectChain();
    const effects = effectChain.getEffects();
    
    const totalCost = effects.reduce((sum, effect) => sum + effect.getProcessingCost(), 0);
    const latency = effectChain.getTotalLatency();
    
    // Factor in mixer processing
    const mixerCost = mixerChannel.getEQSettings().isFlat() ? 1 : 3;
    
    return {
      totalCost: totalCost + mixerCost,
      latency,
      effectCount: effects.length,
      isOptimal: latency <= 50 && totalCost <= 50, // Thresholds for good performance
      recommendations: this.generateOptimizationRecommendations(totalCost, latency, effects.length)
    };
  }

  /**
   * Suggests effect combinations based on instrument type and musical context
   */
  suggestEffectsForInstrument(instrumentType: string, musicalContext?: string): EffectType[] {
    const suggestions: EffectType[] = [];
    
    switch (instrumentType.toLowerCase()) {
      case 'guitar':
        suggestions.push(EffectType.compressor(), EffectType.distortion());
        if (musicalContext === 'ambient') {
          suggestions.push(EffectType.delay(), EffectType.reverb());
        }
        break;
        
      case 'vocals':
        suggestions.push(EffectType.compressor(), EffectType.reverb());
        break;
        
      case 'bass':
        suggestions.push(EffectType.compressor(), EffectType.filter());
        break;
        
      case 'drums':
        suggestions.push(EffectType.compressor());
        if (musicalContext === 'rock') {
          suggestions.push(EffectType.distortion());
        }
        break;
        
      case 'synth':
        suggestions.push(EffectType.filter(), EffectType.delay());
        break;
    }
    
    return suggestions;
  }

  private getDefaultEffectsForInstrument(instrument: string): EffectType[] {
    return this.suggestEffectsForInstrument(instrument);
  }

  private areInstrumentCategoriesCompatible(category1: string, category2: string): boolean {
    // Define compatible instrument categories
    const compatibilityMap: Record<string, string[]> = {
      'string': ['string', 'plucked'],
      'wind': ['wind', 'brass'],
      'percussion': ['percussion', 'drums'],
      'electronic': ['electronic', 'synth', 'digital'],
      'vocal': ['vocal', 'voice']
    };
    
    const compatible1 = compatibilityMap[category1.toLowerCase()] || [category1.toLowerCase()];
    return compatible1.includes(category2.toLowerCase());
  }

  private areRoutingsCompatible(routing1: any, routing2: any): boolean {
    // Check if audio routings are compatible for swapping
    return routing1.input.channelCount === routing2.input.channelCount &&
           routing1.output.channelCount === routing2.output.channelCount;
  }

  private calculateSwapTime(requesterState: UserAudioState, targetState: UserAudioState): number {
    // Base swap time
    let swapTime = 2000; // 2 seconds base
    
    // Add time for effect chain complexity
    const requesterEffects = requesterState.effectChain?.effects.length || 0;
    const targetEffects = targetState.effectChain?.effects.length || 0;
    swapTime += (requesterEffects + targetEffects) * 200; // 200ms per effect
    
    // Add time for routing changes
    if (requesterState.audioRouting && targetState.audioRouting) {
      swapTime += 500; // 500ms for routing changes
    }
    
    return swapTime;
  }

  private captureUserAudioState(
    audioBus: AudioBus,
    mixerChannel: MixerChannel,
    instrument: string
  ): UserAudioState {
    const effectChain = audioBus.getEffectChain();
    const routing = audioBus.getRouting();
    
    return {
      instrument,
      category: 'unknown', // Would be determined by actual instrument
      effectChain: {
        effects: effectChain.getEffects().map(effect => ({
          id: effect.getId(),
          type: effect.getType().toString(),
          parameters: effect.getParameters(),
          isEnabled: effect.isEffectEnabled()
        })),
        totalLatency: effectChain.getTotalLatency()
      },
      audioRouting: {
        input: (() => {
          const inputDevice = routing.getInput();
          const deviceId = inputDevice.getDeviceId();
          return {
            type: inputDevice.getType(),
            channelCount: inputDevice.getChannelCount(),
            ...(deviceId ? { deviceId } : {})
          };
        })(),
        output: (() => {
          const outputDevice = routing.getOutput();
          const deviceId = outputDevice.getDeviceId();
          return {
            type: outputDevice.getType(),
            channelCount: outputDevice.getChannelCount(),
            ...(deviceId ? { deviceId } : {})
          };
        })(),
        gain: routing.getGain(),
        isMuted: routing.isMutedState()
      },
      mixerSettings: {
        level: mixerChannel.getLevel(),
        isMuted: mixerChannel.isMutedState(),
        isSoloed: mixerChannel.isSoloedState(),
        panPosition: mixerChannel.getPanPosition(),
        eqSettings: {
          lowGain: mixerChannel.getEQSettings().getLowGain(),
          midGain: mixerChannel.getEQSettings().getMidGain(),
          highGain: mixerChannel.getEQSettings().getHighGain(),
          lowFreq: mixerChannel.getEQSettings().getLowFreq(),
          midFreq: mixerChannel.getEQSettings().getMidFreq(),
          highFreq: mixerChannel.getEQSettings().getHighFreq()
        }
      },
      timestamp: new Date()
    };
  }

  private async applyAudioStateToUser(
    state: UserAudioState,
    audioBus: AudioBus,
    mixerChannel: MixerChannel
  ): Promise<void> {
    // Apply effect chain
    if (state.effectChain) {
      // Clear existing effects and apply new ones
      // Note: This would require additional methods on AudioBus to clear effects
      for (const effectSnapshot of state.effectChain.effects) {
        const effectType = EffectType.fromString(effectSnapshot.type);
        const effect = AudioEffect.create(effectType, effectSnapshot.parameters);
        if (audioBus.canAddEffect(effectType)) {
          audioBus.addEffect(effect);
        }
      }
    }
    
    // Apply mixer settings
    if (state.mixerSettings) {
      mixerChannel.setLevel(state.mixerSettings.level);
      mixerChannel.setPanPosition(state.mixerSettings.panPosition);
      
      if (state.mixerSettings.isMuted) {
        mixerChannel.mute();
      } else {
        mixerChannel.unmute();
      }
      
      if (state.mixerSettings.isSoloed) {
        mixerChannel.solo();
      } else {
        mixerChannel.unsolo();
      }
    }
  }

  private generateOptimizationRecommendations(
    totalCost: number,
    latency: number,
    effectCount: number
  ): string[] {
    const recommendations: string[] = [];
    
    if (latency > 50) {
      recommendations.push('Consider reducing reverb/delay times to decrease latency');
    }
    
    if (totalCost > 50) {
      recommendations.push('High processing load - consider removing some effects');
    }
    
    if (effectCount > 6) {
      recommendations.push('Many effects active - consider consolidating similar effects');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Audio setup is optimized');
    }
    
    return recommendations;
  }
}