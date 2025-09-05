# Real-time Communication Domain

This domain provides the foundation for hybrid audio communication strategies in the jam-band application, supporting both mesh WebRTC for band members and streaming for audience members.

## Overview

The hybrid communication strategy addresses different requirements for different user types:

- **Band Members**: Require ultra-low latency for real-time musical collaboration → **Mesh WebRTC**
- **Audience**: Require scalability to support many listeners → **Streaming Strategy**

## Architecture

### Domain Models

#### `Connection.ts`
- `ConnectionId`: Strongly-typed connection identifier
- `UserRole`: Enum defining user roles (BAND_MEMBER, AUDIENCE, ROOM_OWNER)
- `AudioConnection`: Represents an active audio connection with health monitoring
- `AudioBuffer`: Standard audio data format

#### `AudioCommunicationStrategy.ts`
- `AudioCommunicationStrategy`: Abstract interface for communication strategies
- `CommunicationStrategyFactory`: Factory for creating appropriate strategies
- Domain exceptions: `InvalidRoleError`, `ConnectionFailedError`, `UnsupportedOperationError`

### Infrastructure Strategies

#### `MeshWebRTCStrategy.ts`
- Implements peer-to-peer mesh networking for band members
- Each band member connects directly to every other band member
- Optimized for ultra-low latency (10-60ms)
- Supports up to 8 concurrent connections (practical mesh limit)
- Handles connection recovery and health monitoring

#### `StreamingStrategy.ts`
- Implements one-to-many streaming for audience members
- Band members stream to central hub, which broadcasts to audience
- Optimized for scalability (supports 1000+ audience members)
- Higher latency (100-300ms) but much more scalable
- Includes buffering and quality adaptation

### Application Services

#### `AudioCommunicationService.ts`
- Coordinates between different communication strategies
- Automatically selects appropriate strategy based on user role
- Provides unified interface for connection management
- Handles strategy lifecycle and resource cleanup

## Usage

### Basic Setup

```typescript
import { 
  AudioCommunicationService,
  DefaultCommunicationStrategyFactory,
  UserRole
} from './domains/real-time-communication';

// Initialize service
const strategyFactory = new DefaultCommunicationStrategyFactory(io, roomSessionManager);
const audioService = new AudioCommunicationService(strategyFactory, io, roomSessionManager);

// Connect band member (uses mesh WebRTC)
const bandConnectionId = await audioService.connectUser('user123', UserRole.BAND_MEMBER, 'room456');

// Connect audience member (uses streaming)
const audienceConnectionId = await audioService.connectUser('user789', UserRole.AUDIENCE, 'room456');
```

### Integration with Existing VoiceConnectionHandler

See `examples/HybridCommunicationExample.ts` for a complete example of how to integrate the hybrid communication strategies with the existing `VoiceConnectionHandler`.

### Strategy Selection Logic

The `DefaultCommunicationStrategyFactory` automatically selects strategies based on user role:

- **Band Members & Room Owners** → `MeshWebRTCStrategy`
  - Ultra-low latency for musical collaboration
  - Direct peer-to-peer connections
  - Limited to ~8 concurrent users

- **Audience Members** → `StreamingStrategy`
  - Scalable one-to-many streaming
  - Higher latency but supports 1000+ users
  - Centralized streaming hub

## Testing

Run the comprehensive test suite:

```bash
bun test jam-band-be/src/domains/real-time-communication/__tests__/AudioCommunicationStrategy.test.ts --run
```

Tests cover:
- Strategy selection and connection management
- Audio data transmission
- Connection health monitoring
- Error handling and recovery
- Domain model validation

## Future Enhancements

This foundation is designed to support future audio features:

### 1. Advanced Audio Routing
```typescript
// Future: Audio bus routing through strategies
await audioService.routeAudio(userId, {
  effects: ['reverb', 'delay'],
  mixerChannel: 'lead-guitar',
  outputBus: 'main-mix'
});
```

### 2. Adaptive Quality
```typescript
// Future: Dynamic quality adaptation
const strategy = audioService.getStrategy(roomId);
await strategy.adaptQuality({
  targetLatency: 50, // ms
  maxBandwidth: 128000, // bps
  connectionQuality: 'poor'
});
```

### 3. Hybrid Mesh-Streaming
```typescript
// Future: Hybrid approach for large bands
const hybridStrategy = new HybridMeshStreamingStrategy({
  meshLimit: 4, // First 4 band members use mesh
  streamingForRest: true // Additional members use streaming
});
```

## Requirements Fulfilled

- **Requirement 10.2**: Foundation for future audio features
  - ✅ Clear patterns for instrument swapping
  - ✅ Audio bus routing architecture
  - ✅ Mixer functionality preparation

- **Requirement 10.3**: Hybrid communication strategy
  - ✅ Abstract strategy interface
  - ✅ Mesh WebRTC for band members
  - ✅ Streaming strategy for audience
  - ✅ Automatic strategy selection

## Performance Characteristics

### Mesh WebRTC Strategy
- **Latency**: 10-60ms (excellent for music)
- **Scalability**: Up to 8 users (mesh network limit)
- **Bandwidth**: High (each user sends to all others)
- **Use Case**: Band members requiring tight synchronization

### Streaming Strategy
- **Latency**: 100-300ms (acceptable for listening)
- **Scalability**: 1000+ users (one-to-many)
- **Bandwidth**: Efficient (single stream per user)
- **Use Case**: Audience members listening to performance

## Integration Points

This domain integrates with:
- `VoiceConnectionHandler`: Enhanced with hybrid strategies
- `RoomSessionManager`: User session tracking
- `Socket.IO`: Real-time communication transport
- Future `AudioBusService`: Audio routing and effects
- Future `MixerService`: Audio mixing and levels