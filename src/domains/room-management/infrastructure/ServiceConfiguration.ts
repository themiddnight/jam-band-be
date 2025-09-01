/**
 * Service configuration for Room Management bounded context
 */

import { container, serviceRegistry } from '../../../shared/infrastructure/di';
import { RoomApplicationService } from '../application/RoomApplicationService';

/**
 * Configure all services for the Room Management context
 */
export function configureRoomServices(): void {
  // Repositories (lazy loaded to avoid circular dependencies)
  container.lazy('roomRepository', async () => {
    // This would be implemented based on your persistence layer
    const { MongoRoomRepository } = await import('./repositories/MongoRoomRepository');
    return new MongoRoomRepository();
  });

  container.lazy('userRepository', async () => {
    // This would be implemented based on your persistence layer
    const { MongoUserRepository } = await import('./repositories/MongoUserRepository');
    return new MongoUserRepository();
  });

  // Application services
  container.singleton('roomApplicationService', async () => {
    const roomRepository = await container.get('roomRepository');
    const userRepository = await container.get('userRepository');
    const eventBus = await container.get('eventBus'); // Shared event bus
    
    return new RoomApplicationService(roomRepository, userRepository, eventBus);
  }, ['roomRepository', 'userRepository', 'eventBus']);

  // Handlers (lazy loaded)
  container.lazy('roomLifecycleHandler', async () => {
    const { RoomLifecycleHandler } = await import('../../../handlers/RoomLifecycleHandler');
    const applicationService = await container.get('roomApplicationService');
    return new RoomLifecycleHandler(applicationService);
  }, ['roomApplicationService']);

  container.lazy('roomMembershipHandler', async () => {
    const { RoomMembershipHandler } = await import('../../../handlers/RoomMembershipHandler');
    const applicationService = await container.get('roomApplicationService');
    return new RoomMembershipHandler(applicationService);
  }, ['roomApplicationService']);

  // Register context with service registry
  serviceRegistry.registerContext('room-management', {
    applicationServices: ['roomApplicationService'],
    domainServices: [],
    repositories: ['roomRepository', 'userRepository'],
    handlers: ['roomLifecycleHandler', 'roomMembershipHandler']
  });
}

/**
 * Initialize room management context
 */
export async function initializeRoomContext(): Promise<void> {
  await serviceRegistry.initializeContext('room-management');
}