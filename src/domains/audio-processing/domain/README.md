# Audio Processing Domain Foundation

This document describes the audio processing foundation implemented for the jam-band application, providing the groundwork for future audio features including instrument swapping, audio bus routing, and mixer functionality.

## Overview

The audio processing domain implements Domain-Driven Design (DDD) principles to create a robust foundation for complex audio workflows. It includes:

- **AudioBus**: Aggregate root managing user audio processing pipelines
- **EffectChain**: Value object for managing audio effects in sequence
- **AudioRouting**: Value object for input/output routing configuration
- **MixerChannel**: Aggregate root for mixer channel functionality
- **InstrumentSwapSession**: Aggregate root for coordinating instrument swaps
- **AudioProcessingCoordinationService**: Domain service for complex workflows

## Key Features

### 1. AudioBus Management
- User-specific audio processing pipeline
- Effect chain management with validation
- Audio routing configuration
- Domain event publishing for state changes

### 2. Effect Chain Processing
- Support for 8 different effect types (reverb, delay, compressor, filter, etc.)
- Maximum 8 effects per chain with latency limits
- Automatic effect ordering optimization
- Business rules for effect combinations

### 3. Audio Routing
- Input/output device management
- Gain control with validation (0-2.0 range)
- Muting/unmuting capabilities
- Compatibility validation between inputs and outputs

### 4. Mixer Channel Control
- Individual channel level control
- Pan positioning (-1.0 to 1.0)
- Mute and solo functionality
- 3-band EQ with presets
- Proper gain calculation for stereo positioning

### 5. Instrument Swapping Foundation
- Complete swap session lifecycle management
- State validation and compatibility checking
- Audio state snapshots for preservation
- Timeout and cancellation handling

### 6. Coordination Services
- User audio setup preparation
- Swap validation and coordination
- Processing load calculation
- Effect suggestions based on instrument type

## Domain Models

### AudioBus (Aggregate Root)
```typescript
class AudioBus {
  - id: AudioBusId
  - userId: UserId
  - effectChain: EffectChain
  - routing: AudioRouting
  
  + addEffect(effect: AudioEffect): void
  + setRouting(routing: AudioRouting): void
  + canAddEffect(effectType: EffectType): boolean
}
```

### MixerChannel (Aggregate Root)
```typescript
class MixerChannel {
  - id: MixerChannelId
  - userId: UserId
  - level: number
  - panPosition: number
  - eqSettings: EQSettings
  
  + setLevel(level: number): void
  + mute(): void
  + solo(): void
  + setPanPosition(position: number): void
}
```

### InstrumentSwapSession (Aggregate Root)
```typescript
class InstrumentSwapSession {
  - id: SwapSessionId
  - requester: UserId
  - target: UserId
  - status: SwapStatus
  
  + accept(): void
  + reject(): void
  + complete(requesterState, targetState): void
}
```

## Value Objects

### EffectChain
- Immutable collection of audio effects
- Validates effect combinations and latency
- Provides optimal ordering suggestions

### AudioRouting
- Input/output configuration
- Gain and muting state
- Compatibility validation

### EQSettings
- 3-band equalizer configuration
- Preset support (vocal, bass, drums, guitar)
- Frequency and gain validation

## Business Rules

### Effect Chain Rules
1. Maximum 8 effects per chain
2. Total latency must not exceed 50ms
3. Only one compressor allowed per chain
4. Effects are automatically ordered for optimal processing

### Audio Routing Rules
1. Gain must be between 0.0 and 2.0
2. Input channel count must be compatible with output
3. Routing changes publish domain events

### Mixer Channel Rules
1. Level must be between 0.0 and 1.0
2. Pan position must be between -1.0 and 1.0
3. EQ gains must be between -12dB and +12dB
4. Channel numbers must be between 1 and 64

### Instrument Swap Rules
1. Only compatible instrument categories can swap
2. Latency difference must be less than 20ms
3. Sessions timeout after 5 minutes if not accepted
4. Complete audio state is preserved during swaps

## Future Extensions

This foundation is designed to support future audio features:

### Planned Features
- **Real-time Effect Processing**: WebAudio API integration
- **Advanced Mixer**: Multi-bus routing, sends/returns
- **Instrument Swapping**: Live instrument exchange between users
- **Audio Bus Routing**: Complex signal routing between users
- **Effect Presets**: Shareable effect configurations
- **Performance Monitoring**: Real-time latency and CPU monitoring

### Extension Points
- **AudioCommunicationStrategy**: For different audio transport methods
- **EffectProcessor**: For actual audio processing implementation
- **MixerBus**: For advanced mixing capabilities
- **AudioAnalyzer**: For real-time audio analysis

## Testing

The foundation includes comprehensive tests covering:
- All domain models and their business logic
- Value object validation and immutability
- Domain service coordination workflows
- Error handling and edge cases
- Performance characteristics

Run tests with:
```bash
bun test src/domains/audio-processing/domain/__tests__/AudioProcessingFoundation.test.ts
```

## Requirements Satisfied

This implementation satisfies the following requirements:
- **10.2**: Foundation for future audio features (instrument swapping, audio bus routing, mixer controls)
- **10.3**: Event coordination for complex audio workflows
- **1.1**: Domain models with clear business logic
- **1.3**: Strongly-typed value objects with validation

The foundation provides a solid base for implementing advanced audio features while maintaining clean domain boundaries and business rule enforcement.