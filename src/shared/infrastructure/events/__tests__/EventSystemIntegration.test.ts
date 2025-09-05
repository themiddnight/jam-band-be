/**
 * Event System Integration Test
 * 
 * Tests the complete event-driven architecture implementation
 * including event bus, WebSocket bridge, and onboarding coordination.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { InMemoryEventBus } from '../../../domain/events/InMemoryEventBus';
import { RoomCreated, MemberJoined } from '../../../domain/events/RoomEvents';
import { UserJoinedRoom, UserReadyForPlayback } from '../../../domain/events/UserOnboardingEvents';
import { UserOnboardingCoordinator } from '../UserOnboardingCoordinator';

describe('Event System Integration', () => {
  let eventBus: InMemoryEventBus;
  let onboardingCoordinator: UserOnboardingCoordinator;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    onboardingCoordinator = new UserOnboardingCoordinator(eventBus);
    onboardingCoordinator.initialize();
  });

  afterEach(() => {
    onboardingCoordinator.cleanup();
  });

  it('should publish and handle room created events', async () => {
    const handler = jest.fn();
    eventBus.subscribe('RoomCreated', handler);

    const event = new RoomCreated('room-123', 'user-456', 'Test Room', false);
    await eventBus.publish(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should publish and handle member joined events', async () => {
    const handler = jest.fn();
    eventBus.subscribe('MemberJoined', handler);

    const event = new MemberJoined('room-123', 'user-456', 'testuser', 'band_member');
    await eventBus.publish(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should coordinate user onboarding workflow', async () => {
    const readyHandler = jest.fn();
    eventBus.subscribe('UserReadyForPlayback', readyHandler);

    // Start onboarding for audience member (should complete immediately)
    const userJoinedEvent = new UserJoinedRoom('room-123', 'user-456', 'testuser', 'audience');
    await eventBus.publish(userJoinedEvent);

    // Wait a bit for async processing
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(readyHandler).toHaveBeenCalled();
    const readyEvent = readyHandler.mock.calls[0][0] as UserReadyForPlayback;
    expect(readyEvent.userId).toBe('user-456');
    expect(readyEvent.roomId).toBe('room-123');
  });

  it('should handle multiple events in sequence', async () => {
    const roomHandler = jest.fn();
    const memberHandler = jest.fn();
    
    eventBus.subscribe('RoomCreated', roomHandler);
    eventBus.subscribe('MemberJoined', memberHandler);

    const roomEvent = new RoomCreated('room-123', 'user-456', 'Test Room', false);
    const memberEvent = new MemberJoined('room-123', 'user-789', 'member', 'band_member');

    await eventBus.publishAll([roomEvent, memberEvent]);

    expect(roomHandler).toHaveBeenCalledWith(roomEvent);
    expect(memberHandler).toHaveBeenCalledWith(memberEvent);
  });

  it('should track active onboarding sessions', async () => {
    // Start onboarding for band member
    const userJoinedEvent = new UserJoinedRoom('room-123', 'user-456', 'testuser', 'band_member');
    await eventBus.publish(userJoinedEvent);

    const activeSessions = onboardingCoordinator.getActiveSessions();
    expect(activeSessions).toHaveLength(1);
    expect(activeSessions[0].userId).toBe('user-456');
    expect(activeSessions[0].roomId).toBe('room-123');
    expect(activeSessions[0].role).toBe('band_member');
  });
});