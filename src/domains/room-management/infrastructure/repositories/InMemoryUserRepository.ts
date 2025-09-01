/**
 * In-Memory User Repository Implementation
 * 
 * Provides in-memory storage for User aggregates using Map-based storage.
 * This implementation maintains data consistency and supports all repository operations
 * without requiring external database dependencies.
 * 
 * Requirements: 1.3, 1.4
 */

import { UserRepository } from '../../domain/repositories/UserRepository';
import { User } from '../../domain/models/User';
import { UserId } from '../../../../shared/domain/models/ValueObjects';

export class InMemoryUserRepository implements UserRepository {
  private users = new Map<string, User>();
  private usernameIndex = new Map<string, string>(); // username -> userId mapping

  async save(user: User): Promise<void> {
    const userId = user.id.toString();
    const existingUser = this.users.get(userId);
    
    // Update username index if username changed
    if (existingUser && existingUser.username !== user.username) {
      this.usernameIndex.delete(existingUser.username.toLowerCase());
    }
    
    this.users.set(userId, user);
    this.usernameIndex.set(user.username.toLowerCase(), userId);
  }

  async findById(id: UserId): Promise<User | null> {
    return this.users.get(id.toString()) || null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const userId = this.usernameIndex.get(username.toLowerCase());
    if (!userId) {
      return null;
    }
    return this.users.get(userId) || null;
  }

  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async delete(id: UserId): Promise<void> {
    const user = this.users.get(id.toString());
    if (user) {
      this.usernameIndex.delete(user.username.toLowerCase());
      this.users.delete(id.toString());
    }
  }

  // Additional utility methods for testing and debugging
  clear(): void {
    this.users.clear();
    this.usernameIndex.clear();
  }

  size(): number {
    return this.users.size;
  }

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  hasUsername(username: string): boolean {
    return this.usernameIndex.has(username.toLowerCase());
  }
}