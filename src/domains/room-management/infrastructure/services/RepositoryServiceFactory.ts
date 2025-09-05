/**
 * RepositoryServiceFactory - Factory for creating repository-based services
 * 
 * This factory creates and configures repository implementations and bridge services
 * for integrating with the existing RoomService.
 * 
 * Requirements: 1.3, 1.4
 */

import { RoomService } from '../../../../services/RoomService';
import { RoomRepository } from '../../domain/repositories/RoomRepository';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { InMemoryRoomRepository } from '../repositories/InMemoryRoomRepository';
import { InMemoryUserRepository } from '../repositories/InMemoryUserRepository';
import { RoomApplicationService } from '../../application/RoomApplicationService';
import { RoomServiceBridge } from './RoomServiceBridge';
import { EventBus } from '../../../../shared/domain/events/EventBus';
import { InMemoryEventBus } from '../../../../shared/domain/events/InMemoryEventBus';

export class RepositoryServiceFactory {
  private static instance: RepositoryServiceFactory;
  private roomRepository: RoomRepository;
  private userRepository: UserRepository;
  private eventBus: EventBus;
  private roomApplicationService: RoomApplicationService;
  private roomServiceBridge?: RoomServiceBridge;

  private constructor() {
    // Initialize repositories
    this.roomRepository = new InMemoryRoomRepository();
    this.userRepository = new InMemoryUserRepository();
    
    // Initialize event bus
    this.eventBus = new InMemoryEventBus();
    
    // Initialize application service
    this.roomApplicationService = new RoomApplicationService(
      this.roomRepository,
      this.userRepository,
      this.eventBus
    );
  }

  static getInstance(): RepositoryServiceFactory {
    if (!RepositoryServiceFactory.instance) {
      RepositoryServiceFactory.instance = new RepositoryServiceFactory();
    }
    return RepositoryServiceFactory.instance;
  }

  getRoomRepository(): RoomRepository {
    return this.roomRepository;
  }

  getUserRepository(): UserRepository {
    return this.userRepository;
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  getRoomApplicationService(): RoomApplicationService {
    return this.roomApplicationService;
  }

  getRoomServiceBridge(roomService: RoomService): RoomServiceBridge {
    if (!this.roomServiceBridge) {
      this.roomServiceBridge = new RoomServiceBridge(
        roomService,
        this.roomRepository,
        this.userRepository
      );
    }
    return this.roomServiceBridge;
  }

  /**
   * Initialize repositories with existing data from RoomService
   */
  async initializeWithLegacyData(roomService: RoomService): Promise<void> {
    const bridge = this.getRoomServiceBridge(roomService);
    await bridge.syncAllLegacyRooms();
  }

  /**
   * Create a configured RoomApplicationService with all dependencies
   */
  createConfiguredRoomApplicationService(): RoomApplicationService {
    return this.roomApplicationService;
  }
}