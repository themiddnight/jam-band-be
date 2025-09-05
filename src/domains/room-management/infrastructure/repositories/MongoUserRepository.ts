/**
 * Mock MongoDB user repository for testing
 */

import { User } from '../../domain/models/User';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { UserId } from '../../../../shared/domain/models/ValueObjects';

export class MongoUserRepository implements UserRepository {
  private users = new Map<string, User>();

  async save(user: User): Promise<void> {
    this.users.set(user.id.toString(), user);
  }

  async findById(id: UserId): Promise<User | null> {
    return this.users.get(id.toString()) || null;
  }

  async findByUsername(username: string): Promise<User | null> {
    return Array.from(this.users.values()).find(user => 
      user.username === username
    ) || null;
  }

  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async delete(id: UserId): Promise<void> {
    this.users.delete(id.toString());
  }
}