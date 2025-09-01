#!/usr/bin/env bun

/**
 * User Onboarding Coordination Workflow Demo
 * 
 * This script demonstrates the complete user onboarding workflow
 * with multiple users joining simultaneously.
 * 
 * Requirements: 5.2, 5.3, 10.4
 */

import { UserOnboardingCoordinator } from '../UserOnboardingCoordinator';
import { InMemoryEventBus } from '../../../../shared/domain/events/InMemoryEventBus';
import { 
  UserJoinedRoom,
  UserInstrumentsReady,
  UserAudioRoutingReady,
  UserVoiceConnectionReady,
  UserReadyForPlayback,
  UserOnboardingFailed,
  UserOnboardingTimeout
} from '../../../../shared/domain/events/UserOnboardingEvents';
import { 
  MockInstrumentService,
  MockAudioBusService,
  MockVoiceConnectionService
} from './MockOnboardingServices';

async function demonstrateOnboardingWorkflow() {
  console.log('🎵 User Onboarding Coordination Workflow Demo\n');

  // Setup event bus and coordinator
  const eventBus = new InMemoryEventBus();
  const coordinator = new UserOnboardingCoordinator(eventBus);

  // Setup mock services
  const instrumentService = new MockInstrumentService(eventBus, false, 100);
  const audioBusService = new MockAudioBusService(eventBus, false, 150);
  const voiceConnectionService = new MockVoiceConnectionService(eventBus, false, 200);

  // Track events for demonstration
  const eventLog: Array<{ timestamp: number, event: string, details: string }> = [];

  function logEvent(event: string, details: string) {
    const timestamp = Date.now();
    eventLog.push({ timestamp, event, details });
    console.log(`[${new Date(timestamp).toISOString().substr(11, 12)}] ${event}: ${details}`);
  }

  // Subscribe to all events for logging
  eventBus.subscribe('UserJoinedRoom', (event) => {
    logEvent('🚪 USER_JOINED', `${event.username} (${event.role}) joined room ${event.aggregateId}`);
  });

  eventBus.subscribe('UserInstrumentsReady', (event) => {
    logEvent('🎹 INSTRUMENTS_READY', `${event.userId} has ${event.instruments.length} instruments ready`);
  });

  eventBus.subscribe('UserAudioRoutingReady', (event) => {
    logEvent('🔊 AUDIO_ROUTING_READY', `${event.userId} audio bus ${event.audioBusId} configured`);
  });

  eventBus.subscribe('UserVoiceConnectionReady', (event) => {
    logEvent('🎤 VOICE_CONNECTION_READY', `${event.userId} ${event.connectionType} connection established`);
  });

  eventBus.subscribe('UserReadyForPlayback', (event) => {
    logEvent('✅ USER_READY', `${event.userId} ready for playback with components: ${event.readyComponents.join(', ')}`);
  });

  eventBus.subscribe('UserOnboardingFailed', (event) => {
    logEvent('❌ ONBOARDING_FAILED', `${event.userId} failed: ${event.reason} (${event.failedComponent})`);
  });

  eventBus.subscribe('UserOnboardingTimeout', (event) => {
    logEvent('⏰ ONBOARDING_TIMEOUT', `${event.userId} timed out after ${event.timeoutAfterMs}ms`);
  });

  const roomId = 'demo-room-123';
  const users = [
    { id: 'alice', name: 'Alice', role: 'band_member' },
    { id: 'bob', name: 'Bob', role: 'band_member' },
    { id: 'charlie', name: 'Charlie', role: 'audience' },
    { id: 'diana', name: 'Diana', role: 'band_member' }
  ];

  console.log('📋 Scenario: 4 users joining simultaneously');
  console.log('   - 3 band members (mesh WebRTC)');
  console.log('   - 1 audience member (streaming)\n');

  console.log('🚀 Starting simultaneous user onboarding...\n');

  const startTime = Date.now();

  // Start onboarding for all users simultaneously
  await Promise.all(users.map(user => 
    eventBus.publish(new UserJoinedRoom(roomId, user.id, user.name, user.role))
  ));

  console.log(`\n📊 Active onboarding sessions: ${coordinator.getActiveSessionCount()}\n`);

  // Wait for all onboarding to complete
  await new Promise(resolve => setTimeout(resolve, 600));

  const endTime = Date.now();
  const totalTime = endTime - startTime;

  console.log(`\n🏁 Onboarding completed in ${totalTime}ms`);
  console.log(`📊 Final active sessions: ${coordinator.getActiveSessionCount()}`);

  // Show session status for each user
  console.log('\n📈 Final Session Status:');
  users.forEach(user => {
    const status = coordinator.getSessionStatus(user.id, roomId);
    if (status) {
      console.log(`   ${user.name}: Still active (unexpected)`);
    } else {
      console.log(`   ${user.name}: ✅ Completed and cleaned up`);
    }
  });

  // Analyze event flow
  console.log('\n📊 Event Flow Analysis:');
  const eventTypes = eventLog.reduce((acc, log) => {
    acc[log.event] = (acc[log.event] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  Object.entries(eventTypes).forEach(([event, count]) => {
    console.log(`   ${event}: ${count} events`);
  });

  console.log('\n🎯 Workflow Verification:');
  console.log(`   ✅ All users joined: ${eventTypes['🚪 USER_JOINED'] === 4}`);
  console.log(`   ✅ All instruments ready: ${eventTypes['🎹 INSTRUMENTS_READY'] === 4}`);
  console.log(`   ✅ All audio routing ready: ${eventTypes['🔊 AUDIO_ROUTING_READY'] === 4}`);
  console.log(`   ✅ All voice connections ready: ${eventTypes['🎤 VOICE_CONNECTION_READY'] === 4}`);
  console.log(`   ✅ All users ready for playback: ${eventTypes['✅ USER_READY'] === 4}`);
  console.log(`   ✅ No failures: ${!eventTypes['❌ ONBOARDING_FAILED']}`);
  console.log(`   ✅ No timeouts: ${!eventTypes['⏰ ONBOARDING_TIMEOUT']}`);

  console.log('\n🎵 Demo completed successfully!');
}

// Run the demo if this file is executed directly
if (import.meta.main) {
  demonstrateOnboardingWorkflow().catch(console.error);
}

export { demonstrateOnboardingWorkflow };