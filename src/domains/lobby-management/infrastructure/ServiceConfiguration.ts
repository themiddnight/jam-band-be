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
import { RoomService } from '../../../services/RoomService';
import { Server } from 'socket.io';
import { EventBus } from '../../../shared/domain/events/EventBus';

/**
 * Configure all services for the Lobby Management context
 */
export function configureLobbyServices(): void {
  // Infrastructure services (lazy loaded)
  container.lazy('roomListingCache', () => new RoomListingCache());
  
  container.lazy('roomServiceRepository', async () => {
    // Get RoomService from the container (it should be registered by the main app)
    const roomService = await container.get('roomService') as RoomService;
    return new RoomServiceRoomListingRepository(roomService);
  }, ['roomService']);

  // Repositories
  container.singleton('roomListingRepository', async () => {
    const roomServiceRepo = await container.get<RoomServiceRoomListingRepository>('roomServiceRepository');
    return new CachedRoomListingRepository(roomServiceRepo);
  }, ['roomServiceRepository']);

  // Domain services
  container.singleton('roomDiscoveryService', () => {
    return new RoomDiscoveryService();
  });

  // Application services
  container.singleton('lobbyApplicationService', async () => {
    const repository = await container.get('roomListingRepository') as CachedRoomListingRepository;
    const discoveryService = await container.get('roomDiscoveryService') as RoomDiscoveryService;
    const eventBus = await container.get('eventBus') as EventBus;
    
    return new LobbyApplicationService(repository, discoveryService, eventBus);
  }, ['roomListingRepository', 'roomDiscoveryService', 'eventBus']);

  // Integration services
  container.singleton('lobbyIntegrationService', async () => {
    const io = await container.get('io') as Server;
    const roomService = await container.get('roomService') as RoomService;
    const eventBus = await container.get('eventBus') as EventBus;
    return new LobbyIntegrationService(io, roomService, eventBus);
  }, ['io', 'roomService', 'eventBus']);

  // Event handlers
  container.singleton('lobbyEventHandlers', async () => {
    const integrationService = await container.get('lobbyIntegrationService') as LobbyIntegrationService;
    const eventBus = await container.get('eventBus') as EventBus;
    return new LobbyEventHandlers(eventBus, integrationService);
  }, ['lobbyIntegrationService', 'eventBus']);

  // WebSocket handlers
  container.singleton('lobbyNamespaceHandlers', async () => {
    const applicationService = await container.get('lobbyApplicationService') as LobbyApplicationService;
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