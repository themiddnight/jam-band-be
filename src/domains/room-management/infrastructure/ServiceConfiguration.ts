/**
 * Service configuration for Room Management bounded context
 */

import { container, serviceRegistry } from '../../../shared/infrastructure/di';
import { RoomApplicationService } from '../application/RoomApplicationService';
import { RoomRepository } from '../domain/repositories/RoomRepository';
import { UserRepository } from '../domain/repositories/UserRepository';
import { EventBus } from '../../../shared/domain/events/EventBus';
import { RoomService } from '../../../services/RoomService';
import { MetronomeService } from '../../../services/MetronomeService';
import { Server } from 'socket.io';
import { NamespaceManager } from '../../../services/NamespaceManager';
import { RoomSessionManager } from '../../../services/RoomSessionManager';

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
    const roomRepository = await container.get('roomRepository') as RoomRepository;
    const userRepository = await container.get('userRepository') as UserRepository;
    const eventBus = await container.get('eventBus') as EventBus;
    
    return new RoomApplicationService(roomRepository, userRepository, eventBus);
  }, ['roomRepository', 'userRepository', 'eventBus']);

  // Handlers (lazy loaded)
  container.lazy('roomLifecycleHandler', async () => {
    const { RoomLifecycleHandler } = await import('./handlers/RoomLifecycleHandler');
    const roomService = await container.get('roomService') as RoomService;
    const io = await container.get('io') as Server;
    const namespaceManager = await container.get('namespaceManager') as NamespaceManager;
    const roomSessionManager = await container.get('roomSessionManager') as RoomSessionManager;
    const metronomeService = await container.get('metronomeService') as MetronomeService;
    const eventBus = await container.get('eventBus') as EventBus;
    return new RoomLifecycleHandler(roomService, io, namespaceManager, roomSessionManager, metronomeService, undefined, eventBus);
  }, ['roomService', 'io', 'namespaceManager', 'roomSessionManager', 'metronomeService', 'eventBus']);

  container.lazy('roomMembershipHandler', async () => {
    const { RoomMembershipHandler } = await import('./handlers/RoomMembershipHandler');
    const roomService = await container.get('roomService') as RoomService;
    const io = await container.get('io') as Server;
    const namespaceManager = await container.get('namespaceManager') as NamespaceManager;
    const roomSessionManager = await container.get('roomSessionManager') as RoomSessionManager;
    return new RoomMembershipHandler(roomService, io, namespaceManager, roomSessionManager);
  }, ['roomService', 'io', 'namespaceManager', 'roomSessionManager']);

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