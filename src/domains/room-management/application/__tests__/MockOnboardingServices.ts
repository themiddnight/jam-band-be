import { EventBus } from '../../../../shared/domain/events/EventBus';
import { 
  UserJoinedRoom,
  UserInstrumentsReady,
  UserAudioRoutingReady,
  UserVoiceConnectionReady,
  UserOnboardingFailed
} from '../../../../shared/domain/events/UserOnboardingEvents';

/**
 * Mock Instrument Service
 * 
 * Simulates the instrument preparation service that responds to
 * user joining events by setting up user instruments.
 */
export class MockInstrumentService {
  constructor(
    private eventBus: EventBus,
    private shouldFail: boolean = false,
    private delayMs: number = 100
  ) {
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.eventBus.subscribe(UserJoinedRoom, this.handleUserJoinedRoom.bind(this));
  }

  private async handleUserJoinedRoom(event: UserJoinedRoom): Promise<void> {
    // Simulate async instrument preparation
    setTimeout(async () => {
      if (this.shouldFail) {
        await this.eventBus.publish(new UserOnboardingFailed(
          event.userId,
          event.aggregateId,
          'Failed to initialize instruments',
          'instruments'
        ));
        return;
      }

      // Simulate successful instrument preparation
      const instruments = ['synth', 'drums'];
      const synthParams = {
        oscillator: 'sawtooth',
        filter: { frequency: 1000, resonance: 0.5 },
        envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.5 }
      };

      await this.eventBus.publish(new UserInstrumentsReady(
        event.userId,
        event.aggregateId,
        instruments,
        synthParams
      ));
    }, this.delayMs);
  }
}

/**
 * Mock Audio Bus Service
 * 
 * Simulates the audio routing service that sets up user audio buses
 * and routing configuration.
 */
export class MockAudioBusService {
  constructor(
    private eventBus: EventBus,
    private shouldFail: boolean = false,
    private delayMs: number = 150
  ) {
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.eventBus.subscribe(UserJoinedRoom, this.handleUserJoinedRoom.bind(this));
  }

  private async handleUserJoinedRoom(event: UserJoinedRoom): Promise<void> {
    // Simulate async audio routing setup
    setTimeout(async () => {
      if (this.shouldFail) {
        await this.eventBus.publish(new UserOnboardingFailed(
          event.userId,
          event.aggregateId,
          'Failed to setup audio routing',
          'audioRouting'
        ));
        return;
      }

      // Simulate successful audio routing setup
      const audioBusId = `audiobus_${event.userId}_${Date.now()}`;
      const routingConfig = {
        inputGain: 0.8,
        outputGain: 0.9,
        effects: ['reverb', 'compressor'],
        routing: {
          input: 'microphone',
          output: 'speakers'
        }
      };

      await this.eventBus.publish(new UserAudioRoutingReady(
        event.userId,
        event.aggregateId,
        audioBusId,
        routingConfig
      ));
    }, this.delayMs);
  }
}

/**
 * Mock Voice Connection Service
 * 
 * Simulates the voice connection service that establishes
 * WebRTC connections for users.
 */
export class MockVoiceConnectionService {
  constructor(
    private eventBus: EventBus,
    private shouldFail: boolean = false,
    private delayMs: number = 200
  ) {
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.eventBus.subscribe(UserJoinedRoom, this.handleUserJoinedRoom.bind(this));
  }

  private async handleUserJoinedRoom(event: UserJoinedRoom): Promise<void> {
    // Simulate async voice connection setup
    setTimeout(async () => {
      if (this.shouldFail) {
        await this.eventBus.publish(new UserOnboardingFailed(
          event.userId,
          event.aggregateId,
          'Failed to establish voice connection',
          'voiceConnection'
        ));
        return;
      }

      // Simulate successful voice connection
      const connectionId = `conn_${event.userId}_${Date.now()}`;
      const connectionType = event.role === 'audience' ? 'streaming' : 'mesh';

      await this.eventBus.publish(new UserVoiceConnectionReady(
        event.userId,
        event.aggregateId,
        connectionId,
        connectionType as 'mesh' | 'streaming'
      ));
    }, this.delayMs);
  }
}