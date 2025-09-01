/**
 * EventSystemInitializer - Initializes and configures the event-driven architecture
 * 
 * This service sets up the event bus, event handlers, and bridges domain events
 * to WebSocket broadcasting for real-time client updates.
 * 
 * Requirements: 5.1, 5.4
 */

import { Server } from 'socket.io';
import { EventBus } from '../../domain/events/EventBus';
import { InMemoryEventBus } from '../../domain/events/InMemoryEventBus';
import { EventWebSocketBridge } from './EventWebSocketBridge';
import { NamespaceManager } from '../../../services/NamespaceManager';
import { UserOnboardingCoordinator } from './UserOnboardingCoordinator';

export class EventSystemInitializer {
  private eventBus: EventBus;
  private webSocketBridge: EventWebSocketBridge;
  private onboardingCoordinator: UserOnboardingCoordinator;

  constructor(
    private io: Server,
    private namespaceManager: NamespaceManager
  ) {
    this.eventBus = new InMemoryEventBus();
    this.webSocketBridge = new EventWebSocketBridge(this.eventBus, this.io, this.namespaceManager);
    this.onboardingCoordinator = new UserOnboardingCoordinator(this.eventBus);
  }

  /**
   * Initialize the complete event system
   */
  initialize(): EventBus {
    console.log('🚀 Initializing event-driven architecture...');

    // Initialize user onboarding coordination
    this.onboardingCoordinator.initialize();

    console.log('✅ Event system initialized successfully');
    console.log('📡 WebSocket bridge active for real-time updates');
    console.log('🎯 User onboarding coordination active');

    return this.eventBus;
  }

  /**
   * Get the event bus instance
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Get the WebSocket bridge instance
   */
  getWebSocketBridge(): EventWebSocketBridge {
    return this.webSocketBridge;
  }

  /**
   * Get the onboarding coordinator instance
   */
  getOnboardingCoordinator(): UserOnboardingCoordinator {
    return this.onboardingCoordinator;
  }

  /**
   * Cleanup the event system
   */
  cleanup(): void {
    console.log('🧹 Cleaning up event system...');
    
    this.webSocketBridge.cleanup();
    this.onboardingCoordinator.cleanup();
    
    // Clear all event handlers
    if (this.eventBus instanceof InMemoryEventBus) {
      this.eventBus.clear();
    }
    
    console.log('✅ Event system cleanup complete');
  }
}