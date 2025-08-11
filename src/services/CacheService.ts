import NodeCache from 'node-cache';

export class CacheService {
  private static instance: CacheService;
  private cache: NodeCache;

  private constructor() {
    this.cache = new NodeCache({
      stdTTL: 300, // 5 minutes default TTL
      checkperiod: 60, // Check for expired keys every minute
      maxKeys: 1000, // Maximum number of keys
      useClones: false, // Don't clone objects for better performance
    });
  }

  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key);
  }

  set<T>(key: string, value: T, ttl?: number): boolean {
    if (ttl) {
      return this.cache.set(key, value, ttl);
    }
    return this.cache.set(key, value);
  }

  del(key: string): number {
    return this.cache.del(key);
  }

  flush(): void {
    this.cache.flushAll();
  }

  getStats(): NodeCache.Stats {
    return this.cache.getStats();
  }

  // Cache room data with appropriate TTL
  cacheRoom(roomId: string, roomData: any, ttl: number = 300): boolean {
    return this.set(`room:${roomId}`, roomData, ttl);
  }

  // Cache user data with appropriate TTL
  cacheUser(userId: string, userData: any, ttl: number = 600): boolean {
    return this.set(`user:${userId}`, userData, ttl);
  }

  // Cache room list with shorter TTL
  cacheRoomList(key: string, roomList: any[], ttl: number = 60): boolean {
    return this.set(`rooms:${key}`, roomList, ttl);
  }

  // Get cached room data
  getCachedRoom(roomId: string): any | undefined {
    return this.get(`room:${roomId}`);
  }

  // Get cached user data
  getCachedUser(userId: string): any | undefined {
    return this.get(`user:${userId}`);
  }

  // Get cached room list
  getCachedRoomList(key: string): any[] | undefined {
    return this.get(`rooms:${key}`);
  }

  // Invalidate room cache when room changes
  invalidateRoom(roomId: string): number {
    return this.del(`room:${roomId}`);
  }

  // Invalidate user cache when user changes
  invalidateUser(userId: string): number {
    return this.del(`user:${userId}`);
  }

  // Invalidate all room-related caches
  invalidateRoomCaches(): void {
    const keys = this.cache.keys();
    keys.forEach((key: string) => {
      if (key.startsWith('room:') || key.startsWith('rooms:')) {
        this.cache.del(key);
      }
    });
  }
} 