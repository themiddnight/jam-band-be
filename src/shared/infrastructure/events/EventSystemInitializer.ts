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
import { loggingService } from '../../../services/LoggingService';

export class EventSystemInitializer {
  private eventBus: EventBus;
  private webSocketBridge: EventWebSocketBridge;

  constructor(
    private io: Server,
    private namespaceManager: NamespaceManager
  ) {
    this.eventBus = new InMemoryEventBus();
    this.webSocketBridge = new EventWebSocketBridge(this.eventBus, this.io, this.namespaceManager);
  }

  /**
   * Initialize the complete event system
   */
  initialize(): EventBus {
    loggingService.logInfo('Initializing event-driven architecture');

    loggingService.logInfo('Event system initialized successfully', {
      features: ['WebSocket bridge']
    });

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
   * Cleanup the event system
   */
  cleanup(): void {
    loggingService.logInfo('Cleaning up event system');
    
    this.webSocketBridge.cleanup();
    
    // Clear all event handlers
    if (this.eventBus instanceof InMemoryEventBus) {
      this.eventBus.clear();
    }
    
    loggingService.logInfo('Event system cleanup complete');
  }
}