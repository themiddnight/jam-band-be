import { RoomListing } from '../../domain/models/RoomListing';
import { SearchCriteria, SearchResult } from '../../domain/models/SearchCriteria';
import { loggingService } from '../../../../services/LoggingService';

/**
 * RoomListingCache
 * 
 * High-performance cache for room listings to ensure efficient room discovery
 * without affecting room performance. Uses memory-based caching with TTL.
 * 
 * Requirements: 9.6
 */
export class RoomListingCache {
  private roomListingsCache: Map<string, CachedRoomListing> = new Map();
  private searchResultsCache: Map<string, CachedSearchResult> = new Map();
  private statisticsCache: CachedStatistics | null = null;
  
  private readonly ROOM_LISTING_TTL = 30 * 1000; // 30 seconds
  private readonly SEARCH_RESULTS_TTL = 60 * 1000; // 1 minute
  private readonly STATISTICS_TTL = 2 * 60 * 1000; // 2 minutes
  
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Start periodic cleanup of expired cache entries
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 30 * 1000); // Run every 30 seconds

    loggingService.logInfo('RoomListingCache initialized', {
      roomListingTTL: this.ROOM_LISTING_TTL,
      searchResultsTTL: this.SEARCH_RESULTS_TTL,
      statisticsTTL: this.STATISTICS_TTL
    });
  }

  /**
   * Get cached room listings
   */
  getRoomListings(): RoomListing[] | null {
    const cached = this.roomListingsCache.get('all');
    
    if (!cached || this.isExpired(cached.timestamp, this.ROOM_LISTING_TTL)) {
      return null;
    }

    return cached.listings;
  }

  /**
   * Cache room listings
   */
  setRoomListings(listings: RoomListing[]): void {
    this.roomListingsCache.set('all', {
      listings: [...listings], // Create a copy to avoid mutations
      timestamp: Date.now()
    });
  }

  /**
   * Get cached search results
   */
  getSearchResults(criteria: SearchCriteria): SearchResult<RoomListing> | null {
    const cacheKey = criteria.getCacheKey();
    const cached = this.searchResultsCache.get(cacheKey);
    
    if (!cached || this.isExpired(cached.timestamp, this.SEARCH_RESULTS_TTL)) {
      return null;
    }

    return cached.result;
  }

  /**
   * Cache search results
   */
  setSearchResults(criteria: SearchCriteria, result: SearchResult<RoomListing>): void {
    const cacheKey = criteria.getCacheKey();
    
    this.searchResultsCache.set(cacheKey, {
      result: {
        ...result,
        items: [...result.items] // Create a copy to avoid mutations
      },
      timestamp: Date.now()
    });

    // Limit search cache size to prevent memory issues
    if (this.searchResultsCache.size > 100) {
      this.evictOldestSearchResults(20); // Remove 20 oldest entries
    }
  }

  /**
   * Get cached statistics
   */
  getStatistics(): any | null {
    if (!this.statisticsCache || this.isExpired(this.statisticsCache.timestamp, this.STATISTICS_TTL)) {
      return null;
    }

    return this.statisticsCache.statistics;
  }

  /**
   * Cache statistics
   */
  setStatistics(statistics: any): void {
    this.statisticsCache = {
      statistics: { ...statistics }, // Create a copy
      timestamp: Date.now()
    };
  }

  /**
   * Invalidate room listings cache
   */
  invalidateRoomListings(): void {
    this.roomListingsCache.delete('all');
    loggingService.logInfo('RoomListingCache: Room listings cache invalidated');
  }

  /**
   * Invalidate search results cache
   */
  invalidateSearchResults(): void {
    this.searchResultsCache.clear();
    loggingService.logInfo('RoomListingCache: Search results cache invalidated');
  }

  /**
   * Invalidate statistics cache
   */
  invalidateStatistics(): void {
    this.statisticsCache = null;
    loggingService.logInfo('RoomListingCache: Statistics cache invalidated');
  }

  /**
   * Invalidate all caches
   */
  invalidateAll(): void {
    this.invalidateRoomListings();
    this.invalidateSearchResults();
    this.invalidateStatistics();
    loggingService.logInfo('RoomListingCache: All caches invalidated');
  }

  /**
   * Update a specific room in the cache
   */
  updateRoom(roomListing: RoomListing): void {
    const cached = this.roomListingsCache.get('all');
    
    if (cached && !this.isExpired(cached.timestamp, this.ROOM_LISTING_TTL)) {
      const index = cached.listings.findIndex(room => room.id.equals(roomListing.id));
      
      if (index !== -1) {
        cached.listings[index] = roomListing;
        loggingService.logInfo('RoomListingCache: Room updated in cache', {
          roomId: roomListing.id.toString()
        });
      } else {
        // Room not found, add it
        cached.listings.push(roomListing);
        loggingService.logInfo('RoomListingCache: Room added to cache', {
          roomId: roomListing.id.toString()
        });
      }
      
      // Invalidate search results since room data changed
      this.invalidateSearchResults();
      this.invalidateStatistics();
    }
  }

  /**
   * Remove a room from the cache
   */
  removeRoom(roomId: string): void {
    const cached = this.roomListingsCache.get('all');
    
    if (cached && !this.isExpired(cached.timestamp, this.ROOM_LISTING_TTL)) {
      const initialLength = cached.listings.length;
      cached.listings = cached.listings.filter(room => room.id.toString() !== roomId);
      
      if (cached.listings.length < initialLength) {
        loggingService.logInfo('RoomListingCache: Room removed from cache', {
          roomId
        });
        
        // Invalidate search results since room data changed
        this.invalidateSearchResults();
        this.invalidateStatistics();
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStatistics {
    const roomListingsValid = this.roomListingsCache.has('all') && 
      !this.isExpired(this.roomListingsCache.get('all')!.timestamp, this.ROOM_LISTING_TTL);
    
    const validSearchResults = Array.from(this.searchResultsCache.values())
      .filter(cached => !this.isExpired(cached.timestamp, this.SEARCH_RESULTS_TTL)).length;
    
    const statisticsValid = this.statisticsCache && 
      !this.isExpired(this.statisticsCache.timestamp, this.STATISTICS_TTL);

    return {
      roomListings: {
        cached: roomListingsValid,
        count: roomListingsValid ? this.roomListingsCache.get('all')!.listings.length : 0
      },
      searchResults: {
        totalCached: this.searchResultsCache.size,
        validCached: validSearchResults
      },
      statistics: {
        cached: !!statisticsValid
      },
      memory: {
        roomListingsCacheSize: this.roomListingsCache.size,
        searchResultsCacheSize: this.searchResultsCache.size
      }
    };
  }

  /**
   * Shutdown the cache and cleanup resources
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.invalidateAll();
    
    loggingService.logInfo('RoomListingCache shutdown complete');
  }

  /**
   * Check if a cached entry is expired
   */
  private isExpired(timestamp: number, ttl: number): boolean {
    return Date.now() - timestamp > ttl;
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredEntries(): void {
    let cleanedCount = 0;

    // Clean up room listings
    const roomListings = this.roomListingsCache.get('all');
    if (roomListings && this.isExpired(roomListings.timestamp, this.ROOM_LISTING_TTL)) {
      this.roomListingsCache.delete('all');
      cleanedCount++;
    }

    // Clean up search results
    const expiredSearchKeys: string[] = [];
    for (const [key, cached] of this.searchResultsCache.entries()) {
      if (this.isExpired(cached.timestamp, this.SEARCH_RESULTS_TTL)) {
        expiredSearchKeys.push(key);
      }
    }
    
    expiredSearchKeys.forEach(key => {
      this.searchResultsCache.delete(key);
      cleanedCount++;
    });

    // Clean up statistics
    if (this.statisticsCache && this.isExpired(this.statisticsCache.timestamp, this.STATISTICS_TTL)) {
      this.statisticsCache = null;
      cleanedCount++;
    }

    if (cleanedCount > 0) {
      loggingService.logInfo('RoomListingCache: Cleaned up expired entries', {
        cleanedCount
      });
    }
  }

  /**
   * Evict oldest search results to prevent memory issues
   */
  private evictOldestSearchResults(count: number): void {
    const entries = Array.from(this.searchResultsCache.entries())
      .sort(([, a], [, b]) => a.timestamp - b.timestamp)
      .slice(0, count);

    entries.forEach(([key]) => {
      this.searchResultsCache.delete(key);
    });

    loggingService.logInfo('RoomListingCache: Evicted oldest search results', {
      evictedCount: entries.length
    });
  }
}

interface CachedRoomListing {
  listings: RoomListing[];
  timestamp: number;
}

interface CachedSearchResult {
  result: SearchResult<RoomListing>;
  timestamp: number;
}

interface CachedStatistics {
  statistics: any;
  timestamp: number;
}

export interface CacheStatistics {
  roomListings: {
    cached: boolean;
    count: number;
  };
  searchResults: {
    totalCached: number;
    validCached: number;
  };
  statistics: {
    cached: boolean;
  };
  memory: {
    roomListingsCacheSize: number;
    searchResultsCacheSize: number;
  };
}