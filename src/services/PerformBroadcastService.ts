import * as fs from 'fs';
import * as path from 'path';
import { loggingService } from './LoggingService';

/**
 * Service for managing HLS broadcast streams for audience members
 * Handles audio chunk buffering and HLS playlist generation
 */
export class PerformBroadcastService {
  private static instance: PerformBroadcastService;
  private readonly BUFFER_DIR = process.env.RECORD_AUDIO_PATH || './record-audio';
  private readonly PERFORM_BUFFER_DIR = 'perform-buffer';
  private readonly SEGMENT_DURATION = 2; // seconds per HLS segment
  private readonly MAX_SEGMENTS = 10; // Keep last 10 segments for live streaming
  private readonly SAMPLE_RATE = 44100;
  
  // Track active broadcasts
  private activeBroadcasts = new Map<string, {
    sequenceNumber: number;
    startTime: number;
    lastChunkTime: number;
    audioBuffer: Buffer[];
    segmentIndex: number;
  }>();

  private constructor() {
    this.ensureBufferDirectory();
  }

  static getInstance(): PerformBroadcastService {
    if (!PerformBroadcastService.instance) {
      PerformBroadcastService.instance = new PerformBroadcastService();
    }
    return PerformBroadcastService.instance;
  }

  private ensureBufferDirectory(): void {
    const bufferPath = path.join(this.BUFFER_DIR, this.PERFORM_BUFFER_DIR);
    if (!fs.existsSync(bufferPath)) {
      fs.mkdirSync(bufferPath, { recursive: true });
    }
  }

  private getRoomBufferPath(roomId: string): string {
    return path.join(this.BUFFER_DIR, this.PERFORM_BUFFER_DIR, roomId);
  }

  /**
   * Start a broadcast for a room
   */
  startBroadcast(roomId: string): boolean {
    if (this.activeBroadcasts.has(roomId)) {
      loggingService.logInfo(`Broadcast already active for room ${roomId}`);
      return true;
    }

    const roomBufferPath = this.getRoomBufferPath(roomId);
    
    // Create room buffer directory
    if (!fs.existsSync(roomBufferPath)) {
      fs.mkdirSync(roomBufferPath, { recursive: true });
    }

    // Initialize broadcast state
    this.activeBroadcasts.set(roomId, {
      sequenceNumber: 0,
      startTime: Date.now(),
      lastChunkTime: Date.now(),
      audioBuffer: [],
      segmentIndex: 0,
    });

    // Create initial HLS playlist
    this.createInitialPlaylist(roomId);

    loggingService.logInfo(`Started broadcast for room ${roomId}`);
    return true;
  }

  /**
   * Stop a broadcast for a room
   */
  stopBroadcast(roomId: string): boolean {
    const broadcast = this.activeBroadcasts.get(roomId);
    if (!broadcast) {
      return false;
    }

    // Clean up broadcast files
    this.cleanupBroadcastFiles(roomId);
    this.activeBroadcasts.delete(roomId);

    loggingService.logInfo(`Stopped broadcast for room ${roomId}`);
    return true;
  }

  /**
   * Process incoming audio chunk from room owner
   */
  processAudioChunk(roomId: string, chunk: string, timestamp: number, sequenceNumber: number): boolean {
    const broadcast = this.activeBroadcasts.get(roomId);
    if (!broadcast) {
      loggingService.logInfo(`No active broadcast for room ${roomId}`, { level: 'warning' });
      return false;
    }

    try {
      // Decode base64 audio chunk
      const audioData = Buffer.from(chunk, 'base64');
      broadcast.audioBuffer.push(audioData);
      broadcast.lastChunkTime = Date.now();
      broadcast.sequenceNumber = sequenceNumber;

      // Check if we have enough data for a segment
      const totalBufferSize = broadcast.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
      const segmentSize = this.SAMPLE_RATE * 2 * 2 * this.SEGMENT_DURATION; // stereo 16-bit

      if (totalBufferSize >= segmentSize) {
        this.createSegment(roomId, broadcast);
      }

      return true;
    } catch (error) {
      loggingService.logError(error as Error, { context: 'processAudioChunk', roomId });
      return false;
    }
  }

  /**
   * Create an HLS segment from buffered audio
   */
  private createSegment(roomId: string, broadcast: {
    sequenceNumber: number;
    startTime: number;
    lastChunkTime: number;
    audioBuffer: Buffer[];
    segmentIndex: number;
  }): void {
    const roomBufferPath = this.getRoomBufferPath(roomId);
    const segmentIndex = broadcast.segmentIndex;
    
    // Combine audio buffers
    const combinedBuffer = Buffer.concat(broadcast.audioBuffer);
    
    // Write segment file (as raw PCM for now, could be converted to AAC/MP3)
    const segmentPath = path.join(roomBufferPath, `segment_${segmentIndex}.ts`);
    
    // Create a simple MPEG-TS container with PCM audio
    // For production, this should use ffmpeg or similar to create proper AAC segments
    const tsSegment = this.createTSSegment(combinedBuffer);
    fs.writeFileSync(segmentPath, tsSegment);

    // Clear buffer and increment segment index
    broadcast.audioBuffer = [];
    broadcast.segmentIndex++;

    // Update playlist
    this.updatePlaylist(roomId, segmentIndex);

    // Clean up old segments
    this.cleanupOldSegments(roomId, segmentIndex);
  }

  /**
   * Create a simple TS segment (placeholder - in production use ffmpeg)
   */
  private createTSSegment(audioData: Buffer): Buffer {
    // For simplicity, we'll just wrap the raw audio in a minimal container
    // In production, this should use ffmpeg to create proper MPEG-TS with AAC
    return audioData;
  }

  /**
   * Create initial HLS playlist
   */
  private createInitialPlaylist(roomId: string): void {
    const roomBufferPath = this.getRoomBufferPath(roomId);
    const playlistPath = path.join(roomBufferPath, 'playlist.m3u8');

    const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${this.SEGMENT_DURATION}
#EXT-X-MEDIA-SEQUENCE:0
`;

    fs.writeFileSync(playlistPath, playlist);
  }

  /**
   * Update HLS playlist with new segment
   */
  private updatePlaylist(roomId: string, latestSegmentIndex: number): void {
    const roomBufferPath = this.getRoomBufferPath(roomId);
    const playlistPath = path.join(roomBufferPath, 'playlist.m3u8');

    const startIndex = Math.max(0, latestSegmentIndex - this.MAX_SEGMENTS + 1);
    
    let playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${this.SEGMENT_DURATION}
#EXT-X-MEDIA-SEQUENCE:${startIndex}
`;

    for (let i = startIndex; i <= latestSegmentIndex; i++) {
      playlist += `#EXTINF:${this.SEGMENT_DURATION},\nsegment_${i}.ts\n`;
    }

    fs.writeFileSync(playlistPath, playlist);
  }

  /**
   * Clean up old segments beyond MAX_SEGMENTS
   */
  private cleanupOldSegments(roomId: string, latestSegmentIndex: number): void {
    const roomBufferPath = this.getRoomBufferPath(roomId);
    const oldestToKeep = latestSegmentIndex - this.MAX_SEGMENTS;

    if (oldestToKeep < 0) return;

    for (let i = 0; i < oldestToKeep; i++) {
      const segmentPath = path.join(roomBufferPath, `segment_${i}.ts`);
      if (fs.existsSync(segmentPath)) {
        fs.unlinkSync(segmentPath);
      }
    }
  }

  /**
   * Clean up all broadcast files for a room
   */
  private cleanupBroadcastFiles(roomId: string): void {
    const roomBufferPath = this.getRoomBufferPath(roomId);
    
    if (fs.existsSync(roomBufferPath)) {
      const files = fs.readdirSync(roomBufferPath);
      for (const file of files) {
        fs.unlinkSync(path.join(roomBufferPath, file));
      }
      fs.rmdirSync(roomBufferPath);
    }
  }

  /**
   * Check if a room has an active broadcast
   */
  isBroadcasting(roomId: string): boolean {
    return this.activeBroadcasts.has(roomId);
  }

  /**
   * Get the HLS playlist URL for a room
   */
  getPlaylistUrl(roomId: string): string | null {
    if (!this.activeBroadcasts.has(roomId)) {
      return null;
    }
    return `/api/broadcast/${roomId}/playlist.m3u8`;
  }

  /**
   * Get playlist content for a room
   */
  getPlaylistContent(roomId: string): string | null {
    const roomBufferPath = this.getRoomBufferPath(roomId);
    const playlistPath = path.join(roomBufferPath, 'playlist.m3u8');

    if (!fs.existsSync(playlistPath)) {
      return null;
    }

    return fs.readFileSync(playlistPath, 'utf-8');
  }

  /**
   * Get segment content for a room
   */
  getSegmentContent(roomId: string, segmentName: string): Buffer | null {
    const roomBufferPath = this.getRoomBufferPath(roomId);
    const segmentPath = path.join(roomBufferPath, segmentName);

    if (!fs.existsSync(segmentPath)) {
      return null;
    }

    return fs.readFileSync(segmentPath);
  }

  /**
   * Clean up stale broadcasts (no activity for 30 seconds)
   */
  cleanupStaleBroadcasts(): string[] {
    const staleRooms: string[] = [];
    const now = Date.now();
    const STALE_THRESHOLD = 30000; // 30 seconds

    for (const [roomId, broadcast] of this.activeBroadcasts.entries()) {
      if (now - broadcast.lastChunkTime > STALE_THRESHOLD) {
        this.stopBroadcast(roomId);
        staleRooms.push(roomId);
      }
    }

    return staleRooms;
  }
}

export const performBroadcastService = PerformBroadcastService.getInstance();
