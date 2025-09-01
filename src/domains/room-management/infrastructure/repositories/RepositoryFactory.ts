/**
 * Repository Factory
 * 
 * Provides centralized access to repository implementations.
 * This factory pattern allows for easy switching between different
 * repository implementations (in-memory, database, etc.) without
 * changing client code.
 * 
 * Requirements: 1.3, 1.4
 */

import { RoomRepository } from '../../domain/repositories/RoomRepository';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { InMemoryRoomRepository } from './InMemoryRoomRepository';
import { InMemoryUserRepository } from './InMemoryUserRepository';

export class RepositoryFactory {
  private static roomRepository: RoomRepository;
  private static userRepository: UserRepository;

  /**
   * Get Room Repository instance
   */
  static getRoomRepository(): RoomRepository {
    if (!this.roomRepository) {
      this.roomRepository = new InMemoryRoomRepository();
    }
    return this.roomRepository;
  }

  /**
   * Get User Repository instance
   */
  static getUserRepository(): UserRepository {
    if (!this.userRepository) {
      this.userRepository = new InMemoryUserRepository();
    }
    return this.userRepository;
  }

  /**
   * Reset repositories (useful for testing)
   */
  static reset(): void {
    this.roomRepository = new InMemoryRoomRepository();
    this.userRepository = new InMemoryUserRepository();
  }

  /**
   * Set custom repository implementations (useful for testing or different environments)
   */
  static setRoomRepository(repository: RoomRepository): void {
    this.roomRepository = repository;
  }

  static setUserRepository(repository: UserRepository): void {
    this.userRepository = repository;
  }
}