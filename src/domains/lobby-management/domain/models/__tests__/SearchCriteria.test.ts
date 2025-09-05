import { SearchCriteria, SortBy, SortOrder } from '../SearchCriteria';
import { RoomCapacityStatus, RoomActivityStatus } from '../RoomListing';

describe('SearchCriteria', () => {
  describe('validation', () => {
    it('should create valid search criteria', () => {
      expect(() => new SearchCriteria()).not.toThrow();
    });

    it('should throw error for invalid limit', () => {
      expect(() => new SearchCriteria(undefined, [], false, false, undefined, undefined, undefined, undefined, SortBy.NAME, SortOrder.ASC, 0))
        .toThrow('Limit must be between 1 and 100');
      
      expect(() => new SearchCriteria(undefined, [], false, false, undefined, undefined, undefined, undefined, SortBy.NAME, SortOrder.ASC, 101))
        .toThrow('Limit must be between 1 and 100');
    });

    it('should throw error for negative offset', () => {
      expect(() => new SearchCriteria(undefined, [], false, false, undefined, undefined, undefined, undefined, SortBy.NAME, SortOrder.ASC, 50, -1))
        .toThrow('Offset cannot be negative');
    });

    it('should throw error for invalid member count filters', () => {
      expect(() => new SearchCriteria(undefined, [], false, false, -1))
        .toThrow('Min members cannot be negative');
      
      expect(() => new SearchCriteria(undefined, [], false, false, undefined, 0))
        .toThrow('Max members must be at least 1');
      
      expect(() => new SearchCriteria(undefined, [], false, false, 10, 5))
        .toThrow('Min members cannot be greater than max members');
    });

    it('should throw error for too many genres', () => {
      const tooManyGenres = Array.from({ length: 11 }, (_, i) => `genre${i}`);
      expect(() => new SearchCriteria(undefined, tooManyGenres))
        .toThrow('Cannot filter by more than 10 genres');
    });

    it('should throw error for search term too long', () => {
      const longTerm = 'a'.repeat(101);
      expect(() => new SearchCriteria(longTerm))
        .toThrow('Search term cannot exceed 100 characters');
    });
  });

  describe('factory methods', () => {
    it('should create default criteria', () => {
      const criteria = SearchCriteria.default();
      
      expect(criteria.searchTerm).toBeUndefined();
      expect(criteria.genres).toEqual([]);
      expect(criteria.includePrivate).toBe(false);
      expect(criteria.includeFullRooms).toBe(false);
      expect(criteria.sortBy).toBe(SortBy.LAST_ACTIVITY);
      expect(criteria.sortOrder).toBe(SortOrder.DESC);
      expect(criteria.limit).toBe(50);
      expect(criteria.offset).toBe(0);
    });

    it('should create criteria from query', () => {
      const query = {
        searchTerm: 'rock',
        genres: ['rock', 'jazz'],
        includePrivate: true,
        sortBy: SortBy.NAME,
        limit: 20,
        offset: 10
      };

      const criteria = SearchCriteria.fromQuery(query);
      
      expect(criteria.searchTerm).toBe('rock');
      expect(criteria.genres).toEqual(['rock', 'jazz']);
      expect(criteria.includePrivate).toBe(true);
      expect(criteria.sortBy).toBe(SortBy.NAME);
      expect(criteria.limit).toBe(20);
      expect(criteria.offset).toBe(10);
    });

    it('should cap limit at 100 when creating from query', () => {
      const query = { limit: 200 };
      const criteria = SearchCriteria.fromQuery(query);
      
      expect(criteria.limit).toBe(100);
    });

    it('should create criteria for genres', () => {
      const criteria = SearchCriteria.forGenres(['rock', 'jazz']);
      
      expect(criteria.genres).toEqual(['rock', 'jazz']);
      expect(criteria.activityStatus).toEqual([RoomActivityStatus.ACTIVE, RoomActivityStatus.IDLE]);
      expect(criteria.sortBy).toBe(SortBy.MEMBER_COUNT);
      expect(criteria.sortOrder).toBe(SortOrder.DESC);
    });

    it('should create criteria for available rooms', () => {
      const criteria = SearchCriteria.forAvailableRooms();
      
      expect(criteria.includeFullRooms).toBe(false);
      expect(criteria.capacityStatus).toEqual([RoomCapacityStatus.AVAILABLE, RoomCapacityStatus.NEARLY_FULL]);
      expect(criteria.activityStatus).toEqual([RoomActivityStatus.ACTIVE, RoomActivityStatus.IDLE]);
      expect(criteria.sortBy).toBe(SortBy.LAST_ACTIVITY);
    });

    it('should create criteria for text search', () => {
      const criteria = SearchCriteria.forTextSearch('rock music');
      
      expect(criteria.searchTerm).toBe('rock music');
      expect(criteria.includePrivate).toBe(true);
      expect(criteria.sortBy).toBe(SortBy.RELEVANCE);
      expect(criteria.activityStatus).toEqual([RoomActivityStatus.ACTIVE, RoomActivityStatus.IDLE]);
    });
  });

  describe('immutable updates', () => {
    it('should create new instance with updated search term', () => {
      const original = SearchCriteria.default();
      const updated = original.withSearchTerm('rock');
      
      expect(original.searchTerm).toBeUndefined();
      expect(updated.searchTerm).toBe('rock');
      expect(updated).not.toBe(original);
    });

    it('should create new instance with updated genres', () => {
      const original = SearchCriteria.default();
      const updated = original.withGenres(['rock', 'jazz']);
      
      expect(original.genres).toEqual([]);
      expect(updated.genres).toEqual(['rock', 'jazz']);
      expect(updated).not.toBe(original);
    });

    it('should create new instance with updated sorting', () => {
      const original = SearchCriteria.default();
      const updated = original.withSorting(SortBy.NAME, SortOrder.ASC);
      
      expect(original.sortBy).toBe(SortBy.LAST_ACTIVITY);
      expect(original.sortOrder).toBe(SortOrder.DESC);
      expect(updated.sortBy).toBe(SortBy.NAME);
      expect(updated.sortOrder).toBe(SortOrder.ASC);
      expect(updated).not.toBe(original);
    });

    it('should create new instance with updated pagination', () => {
      const original = SearchCriteria.default();
      const updated = original.withPagination(20, 10);
      
      expect(original.limit).toBe(50);
      expect(original.offset).toBe(0);
      expect(updated.limit).toBe(20);
      expect(updated.offset).toBe(10);
      expect(updated).not.toBe(original);
    });
  });

  describe('query methods', () => {
    it('should detect if criteria has filters', () => {
      const noFilters = SearchCriteria.default();
      expect(noFilters.hasFilters()).toBe(false);

      const withFilters = new SearchCriteria('rock');
      expect(withFilters.hasFilters()).toBe(true);

      const withGenres = new SearchCriteria(undefined, ['rock']);
      expect(withGenres.hasFilters()).toBe(true);
    });

    it('should detect text search', () => {
      const noSearch = SearchCriteria.default();
      expect(noSearch.isTextSearch()).toBe(false);

      const emptySearch = new SearchCriteria('   ');
      expect(emptySearch.isTextSearch()).toBe(false);

      const withSearch = new SearchCriteria('rock');
      expect(withSearch.isTextSearch()).toBe(true);
    });

    it('should generate consistent cache keys', () => {
      const criteria1 = new SearchCriteria('rock', ['jazz'], true, false, 1, 10);
      const criteria2 = new SearchCriteria('rock', ['jazz'], true, false, 1, 10);
      
      expect(criteria1.getCacheKey()).toBe(criteria2.getCacheKey());
    });

    it('should generate different cache keys for different criteria', () => {
      const criteria1 = new SearchCriteria('rock');
      const criteria2 = new SearchCriteria('jazz');
      
      expect(criteria1.getCacheKey()).not.toBe(criteria2.getCacheKey());
    });
  });

  describe('equality', () => {
    it('should be equal for same criteria', () => {
      const criteria1 = new SearchCriteria('rock', ['jazz'], true, false, 1, 10);
      const criteria2 = new SearchCriteria('rock', ['jazz'], true, false, 1, 10);
      
      expect(criteria1.equals(criteria2)).toBe(true);
    });

    it('should not be equal for different criteria', () => {
      const criteria1 = new SearchCriteria('rock');
      const criteria2 = new SearchCriteria('jazz');
      
      expect(criteria1.equals(criteria2)).toBe(false);
    });
  });
});