/**
 * User repository interface
 */

import { User } from '../models/User';
import { UserId } from '../../../../shared/domain/models/ValueObjects';

export interface UserRepository {
  save(user: User): Promise<void>;
  findById(id: UserId): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  delete(id: UserId): Promise<void>;
}