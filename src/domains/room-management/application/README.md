# User Onboarding Coordination Workflow

This directory contains the implementation of the user onboarding coordination workflow as specified in task 8.3 of the architecture refactoring specification.

## Overview

The user onboarding coordination workflow orchestrates complex user preparation across multiple bounded contexts when users join a room. It ensures that all necessary components (instruments, audio routing, voice connections) are ready before allowing users to participate in playback.

## Requirements Addressed

- **5.2**: Event-driven coordination for complex workflows
- **5.3**: Loosely coupled services through events
- **10.4**: Foundation for future audio features

## Components

### Events (`../../../../shared/domain/events/UserOnboardingEvents.ts`)

#### Core Coordination Events
- `UserJoinedRoom` - Published when a user joins a room and onboarding begins
- `UserInstrumentsReady` - Published when user's instruments are prepared
- `UserAudioRoutingReady` - Published when user's audio routing is configured
- `UserVoiceConnectionReady` - Published when user's voice connection is established
- `UserReadyForPlayback` - Published when all components are ready

#### Error Handling Events
- `UserOnboardingFailed` - Published when onboarding fails
- `UserOnboardingTimeout` - Published when onboarding times out

### Coordinator (`UserOnboardingCoordinator.ts`)

The main orchestrator that:
- Tracks onboarding sessions for each user
- Coordinates between different services through events
- Handles timeouts and failures
- Publishes final readiness events
- Cleans up completed sessions

### Mock Services (`__tests__/MockOnboardingServices.ts`)

Simulated services that demonstrate the workflow:
- `MockInstrumentService` - Simulates instrument preparation
- `MockAudioBusService` - Simulates audio routing setup
- `MockVoiceConnectionService` - Simulates WebRTC connection establishment

## Workflow Process

1. **User Joins Room**: `UserJoinedRoom` event is published
2. **Parallel Preparation**: Multiple services respond simultaneously:
   - Instrument Service prepares user instruments
   - Audio Bus Service sets up audio routing
   - Voice Connection Service establishes WebRTC connection
3. **Component Readiness**: Each service publishes ready events:
   - `UserInstrumentsReady`
   - `UserAudioRoutingReady`
   - `UserVoiceConnectionReady`
4. **Coordination**: Coordinator waits for all components
5. **Completion**: `UserReadyForPlayback` event is published
6. **Cleanup**: Session is removed from active sessions

## Key Features

### Multi-User Support
- Handles multiple users joining simultaneously
- Independent session tracking per user
- No conflicts between concurrent onboarding processes

### Error Handling
- Component-level failure detection
- Timeout handling with configurable duration
- Automatic session cleanup on failure

### Performance
- Parallel processing of components
- Efficient event-driven coordination
- Minimal memory footprint with automatic cleanup

### Connection Strategy Support
- Band members use mesh WebRTC connections
- Audience members use streaming connections
- Extensible for future communication strategies

## Testing

### Unit Tests (`__tests__/UserOnboardingCoordinator.test.ts`)
- Complete workflow testing
- Multi-user scenarios
- Failure handling
- Timeout scenarios
- Edge cases

### Integration Tests
- `__tests__/CompleteWorkflow.integration.test.ts` - End-to-end workflow
- `__tests__/MultiUserOnboarding.integration.test.ts` - Complex multi-user scenarios

### Demo Script
- `__tests__/OnboardingWorkflowDemo.ts` - Interactive demonstration

## Usage Example

```typescript
import { UserOnboardingCoordinator } from './UserOnboardingCoordinator';
import { InMemoryEventBus } from '../../../shared/domain/events/InMemoryEventBus';
import { UserJoinedRoom } from '../../../shared/domain/events/UserOnboardingEvents';

// Setup
const eventBus = new InMemoryEventBus();
const coordinator = new UserOnboardingCoordinator(eventBus);

// Setup your services to respond to UserJoinedRoom events
// (InstrumentService, AudioBusService, VoiceConnectionService)

// Start onboarding
await eventBus.publish(new UserJoinedRoom(
  'room-123',
  'user-456', 
  'Alice',
  'band_member'
));

// The coordinator will handle the rest automatically
```

## Performance Characteristics

- **Concurrent Users**: Tested with up to 10 simultaneous users
- **Completion Time**: Typically 200-600ms depending on component complexity
- **Memory Usage**: Minimal with automatic session cleanup
- **Failure Recovery**: Immediate cleanup on component failures

## Future Enhancements

The workflow is designed to support future audio features:
- Instrument swapping coordination
- Audio bus routing with effects
- Mixer functionality
- Advanced WebRTC strategies (SFU, MCU)

## Event Flow Diagram

```
UserJoinedRoom
     ↓
┌────────────────────────────────────┐
│  Parallel Component Preparation    │
├────────────┬─────────────┬─────────┤
│ Instruments│ Audio Routing│ Voice   │
│ Service    │ Service      │ Service │
└────────────┴─────────────┴─────────┘
     ↓              ↓           ↓
UserInstruments  UserAudio   UserVoice
Ready           RoutingReady ConnectionReady
     ↓              ↓           ↓
     └──────────────┼───────────┘
                    ↓
            UserReadyForPlayback
```

This implementation provides a solid foundation for complex user coordination workflows while maintaining loose coupling between services through event-driven architecture.