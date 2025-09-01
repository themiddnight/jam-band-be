/**
 * Service configuration for Lobby Management bounded context
 */

import { container, serviceRegistry } from '../../../shared/infrastructure/di';
import { LobbyApplicationService } from '../application/LobbyApplicationService';
import { RoomDiscoveryService } from '../domain/services/RoomDiscoveryService';
import { CachedRoomListingRepository } from './repositories/CachedRoomListingRepository';
import { RoomServiceRoomListingRepository } from './repositories/RoomServiceRoomListingRepository';
import { RoomListingCache } from './cache/RoomListingCache';
import { LobbyEventHandlers } from './handlers/LobbyEventHandlers';
import { LobbyNamespaceHandlers } from './handlers/LobbyNamespaceHandlers';
import { LobbyIntegrationService } from './LobbyIntegrationService';

/**
 * Configure all services for the Lobby Management context
 */
export function configureLobbyServices(): void {
  // Infrastructure services (lazy loaded)
  container.lazy('roomListingCache', () => new RoomListingCache());
  
  container.lazy('roomServiceRepository', () => {
    // This would typically get RoomService from room-management context
    // For now, we'll create a mock or get it from the container
    return new RoomServiceRoomListingRepository();
  });

  // Repositories
  container.singleton('roomListingRepository', async () => {
    const cache = await container.get<RoomListingCache>('roomListingCache');
    const roomServiceRepo = await container.get<RoomServiceRoomListingRepository>('roomServiceRepository');
    return new CachedRoomListingRepository(roomServiceRepo, cache);
  }, ['roomListingCache', 'roomServiceRepository']);

  // Domain services
  container.singleton('roomDiscoveryService', () => {
    return new RoomDiscoveryService();
  });

  // Application services
  container.singleton('lobbyApplicationService', async () => {
    const repository = await container.get('roomListingRepository');
    const discoveryService = await container.get('roomDiscoveryService');
    const eventBus = await container.get('eventBus'); // Shared event bus
    
    return new LobbyApplicationService(repository, discoveryService, eventBus);
  }, ['roomListingRepository', 'roomDiscoveryService', 'eventBus']);

  // Integration services
  container.singleton('lobbyIntegrationService', async () => {
    const applicationService = await container.get('lobbyApplicationService');
    return new LobbyIntegrationService(applicationService);
  }, ['lobbyApplicationService']);

  // Event handlers
  container.singleton('lobbyEventHandlers', async () => {
    const integrationService = await container.get('lobbyIntegrationService');
    const eventBus = await container.get('eventBus');
    return new LobbyEventHandlers(integrationService, eventBus);
  }, ['lobbyIntegrationService', 'eventBus']);

  // WebSocket handlers
  container.singleton('lobbyNamespaceHandlers', async () => {
    const applicationService = await container.get('lobbyApplicationService');
    return new LobbyNamespaceHandlers(applicationService);
  }, ['lobbyApplicationService']);

  // Register context with service registry
  serviceRegistry.registerContext('lobby-management', {
    applicationServices: ['lobbyApplicationService'],
    domainServices: ['roomDiscoveryService'],
    repositories: ['roomListingRepository'],
    handlers: ['lobbyEventHandlers', 'lobbyNamespaceHandlers']
  });
}

/**
 * Initialize lobby management context
 */
export async function initializeLobbyContext(): Promise<void> {
  await serviceRegistry.initializeContext('lobby-management');
}