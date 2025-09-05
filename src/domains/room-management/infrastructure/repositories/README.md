# Room Management Repository Infrastructure

This directory contains the repository implementations for the Room Management domain, providing data persistence capabilities for Room and User aggregates.

## Overview

The repository infrastructure follows the Repository pattern, providing a clean abstraction layer between the domain models and data storage. Currently implemented with in-memory storage, but designed to be easily replaceable with database-backed implementations.

## Architecture

```
repositories/
├── InMemoryRoomRepository.ts     # In-memory Room repository implementation
├── InMemoryUserRepository.ts     # In-memory User repository implementation
├── RepositoryFactory.ts          # Factory for repository instances
├── index.ts                      # Exports
├── __tests__/                    # Test files
└── README.md                     # This file
```

## Repository Interfaces

### RoomRepository
- `save(room: Room): Promise<void>` - Save or update a room
- `findById(id: RoomId): Promise<Room | null>` - Find room by ID
- `findByOwner(ownerId: UserId): Promise<Room[]>` - Find rooms by owner
- `findPublicRooms(): Promise<Room[]>` - Find all public rooms
- `findByNamePattern(pattern: string): Promise<Room[]>` - Find rooms by name pattern
- `findWithPagination(offset: number, limit: number): Promise<Room[]>` - Paginated room retrieval
- `delete(id: RoomId): Promise<void>` - Delete a room

### UserRepository
- `save(user: User): Promise<void>` - Save or update a user
- `findById(id: UserId): Promise<User | null>` - Find user by ID
- `findByUsername(username: string): Promise<User | null>` - Find user by username
- `findAll(): Promise<User[]>` - Find all users
- `delete(id: UserId): Promise<void>` - Delete a user

## Implementation Details

### In-Memory Storage
The current implementations use `Map<string, T>` for primary storage:
- **RoomRepository**: Uses room ID as key
- **UserRepository**: Uses user ID as key + maintains username index for efficient lookups

### Key Features
- **Type Safety**: Full TypeScript support with proper value object handling
- **Performance**: O(1) lookups for primary keys, efficient filtering for queries
- **Memory Management**: Proper cleanup and indexing
- **Testing**: Comprehensive test coverage with unit and integration tests

## Usage

### Basic Usage
```typescript
import { RepositoryFactory } from './infrastructure/repositories';

// Get repository instances
const roomRepo = RepositoryFactory.getRoomRepository();
const userRepo = RepositoryFactory.getUserRepository();

// Create and save a user
const user = User.create('username');
await userRepo.save(user);

// Create and save a room
const room = Room.create('My Room', user.id);
await roomRepo.save(room);

// Query data
const foundUser = await userRepo.findByUsername('username');
const userRooms = await roomRepo.findByOwner(user.id);
```

### Testing
```typescript
import { RepositoryFactory } from './infrastructure/repositories';

beforeEach(() => {
  // Reset repositories for clean test state
  RepositoryFactory.reset();
});
```

## Requirements Satisfied

- **1.3**: Repository interfaces provide clean abstraction for data access
- **1.4**: In-memory implementations support all required operations without external dependencies

## Future Enhancements

When database integration is needed:
1. Implement `MongoRoomRepository` and `MongoUserRepository`
2. Update `RepositoryFactory` to use database implementations
3. Add database connection management
4. Implement data migration utilities

The current interface design supports easy migration to database-backed storage without changing client code.

## Testing

Run repository tests:
```bash
npm test -- --testPathPatterns="InMemoryRoomRepository|InMemoryUserRepository|RepositoryIntegration"
```

All tests include:
- Unit tests for individual repository operations
- Integration tests demonstrating cross-repository usage
- Edge case handling and error scenarios