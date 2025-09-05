/**
 * Load testing harness for refactored backend
 * Requirements: 8.4, 8.5
 */

import { Server } from 'socket.io';
import { createServer } from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { performanceMetrics } from '../shared/infrastructure/monitoring';
import { boundedContextMonitor } from '../shared/infrastructure/monitoring';

export interface LoadTestConfig {
  concurrentUsers: number;
  testDurationMs: number;
  rampUpTimeMs: number;
  roomsPerTest: number;
  messagesPerUser: number;
  webrtcEnabled: boolean;
  httpsEnabled: boolean;
}

export interface LoadTestMetrics {
  totalUsers: number;
  totalRooms: number;
  totalMessages: number;
  averageLatency: number;
  maxLatency: number;
  minLatency: number;
  errorRate: number;
  throughput: number;
  memoryUsage: number;
  cpuUsage: number;
  webrtcConnections: number;
  webrtcFailures: number;
}

export interface UserSimulation {
  userId: string;
  socket: ClientSocket;
  roomId: string;
  connected: boolean;
  messagesSent: number;
  messagesReceived: number;
  latencies: number[];
  errors: string[];
  webrtcConnected: boolean;
}

export class LoadTestHarness {
  private server: Server | null = null;
  private httpServer: any = null;
  private users: Map<string, UserSimulation> = new Map();
  private rooms: Set<string> = new Set();
  private testStartTime: number = 0;
  private testEndTime: number = 0;
  private isRunning: boolean = false;
  private config: LoadTestConfig;

  constructor(config: LoadTestConfig) {
    this.config = config;
  }

  /**
   * Run comprehensive load test
   */
  async runLoadTest(): Promise<LoadTestMetrics> {
    console.log(`🚀 Starting load test with ${this.config.concurrentUsers} concurrent users`);
    
    this.testStartTime = Bun.nanoseconds();
    this.isRunning = true;

    try {
      // Setup test server
      await this.setupTestServer();

      // Create rooms
      await this.createTestRooms();

      // Simulate users joining
      await this.simulateUserJoining();

      // Run test scenarios
      await this.runTestScenarios();

      // Collect metrics
      const metrics = await this.collectMetrics();

      console.log('✅ Load test completed successfully');
      return metrics;

    } catch (error) {
      console.error('❌ Load test failed:', error);
      throw error;
    } finally {
      await this.cleanup();
      this.isRunning = false;
      this.testEndTime = Bun.nanoseconds();
    }
  }

  /**
   * Test WebRTC mesh performance under load
   */
  async testWebRTCMeshPerformance(): Promise<{
    connectionEstablishmentTime: number;
    meshTopologyStability: number;
    audioLatency: number;
    packetLoss: number;
    bandwidthUtilization: number;
  }> {
    console.log('🔊 Testing WebRTC mesh performance');

    const webrtcMetrics = {
      connectionEstablishmentTime: 0,
      meshTopologyStability: 1, // Default to 100% if no WebRTC
      audioLatency: 0,
      packetLoss: 0,
      bandwidthUtilization: 0
    };

    if (!this.config.webrtcEnabled) {
      console.log('⚠️ WebRTC testing disabled');
      return webrtcMetrics;
    }

    const startTime = Bun.nanoseconds();
    const webrtcConnections: Promise<void>[] = [];

    // Simulate WebRTC connections for each user
    for (const [userId, user] of this.users) {
      if (user.connected) {
        webrtcConnections.push(this.simulateWebRTCConnection(user));
      }
    }

    if (webrtcConnections.length === 0) {
      return webrtcMetrics;
    }

    // Wait for all WebRTC connections
    const results = await Promise.allSettled(webrtcConnections);
    const successfulConnections = results.filter(r => r.status === 'fulfilled').length;
    const failedConnections = results.filter(r => r.status === 'rejected').length;
    const totalConnections = successfulConnections + failedConnections;

    const connectionTime = (Bun.nanoseconds() - startTime) / 1_000_000;

    webrtcMetrics.connectionEstablishmentTime = connectionTime;
    webrtcMetrics.meshTopologyStability = totalConnections > 0 ? successfulConnections / totalConnections : 1;
    webrtcMetrics.audioLatency = this.calculateAverageWebRTCLatency();
    webrtcMetrics.packetLoss = this.calculatePacketLoss();
    webrtcMetrics.bandwidthUtilization = this.calculateBandwidthUtilization();

    console.log(`📊 WebRTC Results: ${successfulConnections}/${webrtcConnections.length} connections successful`);
    
    return webrtcMetrics;
  }

  /**
   * Test event processing performance
   */
  async testEventProcessingPerformance(): Promise<{
    eventsPerSecond: number;
    averageProcessingTime: number;
    eventBacklog: number;
    bottlenecks: string[];
  }> {
    console.log('⚡ Testing event processing performance');

    const eventMetrics = {
      eventsPerSecond: 0,
      averageProcessingTime: 0,
      eventBacklog: 0,
      bottlenecks: [] as string[]
    };

    const startTime = Date.now();
    const eventPromises: Promise<void>[] = [];
    let totalEvents = 0;

    // Generate high-frequency events
    for (const [userId, user] of this.users) {
      if (user.connected) {
        // Simulate rapid message sending
        for (let i = 0; i < this.config.messagesPerUser; i++) {
          eventPromises.push(this.sendTestMessage(user, `Load test message ${i}`));
          totalEvents++;
        }

        // Simulate WebRTC events
        if (this.config.webrtcEnabled) {
          eventPromises.push(this.simulateWebRTCEvents(user));
          totalEvents += 5; // Approximate WebRTC events per user
        }
      }
    }

    if (totalEvents === 0) {
      return eventMetrics;
    }

    // Process all events
    await Promise.allSettled(eventPromises);

    const endTime = Date.now();
    const duration = Math.max(1, (endTime - startTime) / 1000); // seconds, minimum 1

    eventMetrics.eventsPerSecond = totalEvents / duration;
    eventMetrics.averageProcessingTime = this.calculateAverageEventProcessingTime();
    eventMetrics.eventBacklog = this.getEventBacklog();
    eventMetrics.bottlenecks = this.identifyBottlenecks();

    console.log(`📈 Event Processing: ${eventMetrics.eventsPerSecond.toFixed(2)} events/sec`);

    return eventMetrics;
  }

  /**
   * Get real-time test progress
   */
  getTestProgress(): {
    elapsedTime: number;
    connectedUsers: number;
    totalMessages: number;
    currentThroughput: number;
    memoryUsage: number;
  } {
    const elapsedTime = this.isRunning 
      ? (Bun.nanoseconds() - this.testStartTime) / 1_000_000_000 // seconds
      : 0;

    const connectedUsers = Array.from(this.users.values()).filter(u => u.connected).length;
    const totalMessages = Array.from(this.users.values()).reduce((sum, u) => sum + u.messagesSent, 0);
    const currentThroughput = elapsedTime > 0 ? totalMessages / elapsedTime : 0;
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB

    return {
      elapsedTime,
      connectedUsers,
      totalMessages,
      currentThroughput,
      memoryUsage
    };
  }

  private async setupTestServer(): Promise<void> {
    // Create HTTP server
    this.httpServer = createServer();
    
    // Create Socket.IO server
    this.server = new Server(this.httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    // Setup basic event handlers for testing
    this.server.on('connection', (socket) => {
      socket.on('join-room', (data) => {
        socket.join(data.roomId);
        socket.emit('room-joined', { roomId: data.roomId });
      });

      socket.on('send-message', (data) => {
        socket.to(data.roomId).emit('message-received', data);
      });

      socket.on('webrtc-offer', (data) => {
        socket.to(data.roomId).emit('webrtc-offer', data);
      });

      socket.on('webrtc-answer', (data) => {
        socket.to(data.roomId).emit('webrtc-answer', data);
      });

      socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.roomId).emit('webrtc-ice-candidate', data);
      });
    });

    // Start server
    return new Promise((resolve) => {
      this.httpServer.listen(0, () => {
        const port = this.httpServer.address()?.port;
        console.log(`🔧 Test server started on port ${port}`);
        resolve();
      });
    });
  }

  private async createTestRooms(): Promise<void> {
    console.log(`🏠 Creating ${this.config.roomsPerTest} test rooms`);
    
    for (let i = 0; i < this.config.roomsPerTest; i++) {
      const roomId = `load-test-room-${i}`;
      this.rooms.add(roomId);
    }
  }

  private async simulateUserJoining(): Promise<void> {
    console.log(`👥 Simulating ${this.config.concurrentUsers} users joining`);
    
    const rampUpDelay = this.config.rampUpTimeMs / this.config.concurrentUsers;
    const rooms = Array.from(this.rooms);

    for (let i = 0; i < this.config.concurrentUsers; i++) {
      const userId = `load-test-user-${i}`;
      const roomId = rooms[i % rooms.length]; // Distribute users across rooms
      
      // Create user simulation
      const user = await this.createUserSimulation(userId, roomId);
      this.users.set(userId, user);

      // Ramp up gradually
      if (i < this.config.concurrentUsers - 1) {
        await new Promise(resolve => setTimeout(resolve, rampUpDelay));
      }
    }

    console.log(`✅ ${this.users.size} users connected`);
  }

  private async createUserSimulation(userId: string, roomId: string): Promise<UserSimulation> {
    const port = this.httpServer.address()?.port;
    const serverUrl = this.config.httpsEnabled 
      ? `https://localhost:${port}`
      : `http://localhost:${port}`;

    const socket = Client(serverUrl, {
      transports: ['websocket'],
      forceNew: true
    });

    const user: UserSimulation = {
      userId,
      socket,
      roomId,
      connected: false,
      messagesSent: 0,
      messagesReceived: 0,
      latencies: [],
      errors: [],
      webrtcConnected: false
    };

    // Setup socket event handlers
    socket.on('connect', () => {
      user.connected = true;
      socket.emit('join-room', { roomId, userId });
    });

    socket.on('disconnect', () => {
      user.connected = false;
    });

    socket.on('message-received', (data) => {
      user.messagesReceived++;
      
      // Calculate latency if timestamp is available
      if (data.timestamp) {
        const latency = Date.now() - data.timestamp;
        user.latencies.push(latency);
      }
    });

    socket.on('error', (error) => {
      user.errors.push(error.toString());
    });

    // Wait for connection
    return new Promise((resolve, reject) => {
      socket.on('room-joined', () => {
        resolve(user);
      });

      socket.on('connect_error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        reject(new Error(`Connection timeout for user ${userId}`));
      }, 5000);
    });
  }

  private async runTestScenarios(): Promise<void> {
    console.log('🎯 Running test scenarios');

    const scenarios = [
      this.testBasicMessaging(),
      this.testWebRTCMeshPerformance(),
      this.testEventProcessingPerformance()
    ];

    await Promise.allSettled(scenarios);
  }

  private async testBasicMessaging(): Promise<void> {
    console.log('💬 Testing basic messaging');

    const messagingPromises: Promise<void>[] = [];

    for (const [userId, user] of this.users) {
      if (user.connected) {
        messagingPromises.push(this.simulateUserMessaging(user));
      }
    }

    await Promise.allSettled(messagingPromises);
  }

  private async simulateUserMessaging(user: UserSimulation): Promise<void> {
    const messageInterval = this.config.testDurationMs / this.config.messagesPerUser;

    for (let i = 0; i < this.config.messagesPerUser; i++) {
      await this.sendTestMessage(user, `Test message ${i} from ${user.userId}`);
      
      if (i < this.config.messagesPerUser - 1) {
        await new Promise(resolve => setTimeout(resolve, messageInterval));
      }
    }
  }

  private async sendTestMessage(user: UserSimulation, message: string): Promise<void> {
    return new Promise((resolve) => {
      const timestamp = Date.now();
      
      user.socket.emit('send-message', {
        roomId: user.roomId,
        userId: user.userId,
        message,
        timestamp
      });

      user.messagesSent++;
      resolve();
    });
  }

  private async simulateWebRTCConnection(user: UserSimulation): Promise<void> {
    if (!this.config.webrtcEnabled) return;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`WebRTC connection timeout for ${user.userId}`));
      }, 10000);

      // Simulate WebRTC offer/answer exchange
      user.socket.emit('webrtc-offer', {
        roomId: user.roomId,
        userId: user.userId,
        offer: 'mock-offer-data'
      });

      user.socket.on('webrtc-answer', () => {
        user.webrtcConnected = true;
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private async simulateWebRTCEvents(user: UserSimulation): Promise<void> {
    if (!this.config.webrtcEnabled) return;

    // Simulate ICE candidates
    for (let i = 0; i < 3; i++) {
      user.socket.emit('webrtc-ice-candidate', {
        roomId: user.roomId,
        userId: user.userId,
        candidate: `mock-ice-candidate-${i}`
      });
    }
  }

  private async collectMetrics(): Promise<LoadTestMetrics> {
    const users = Array.from(this.users.values());
    const connectedUsers = users.filter(u => u.connected);
    const totalMessages = users.reduce((sum, u) => sum + u.messagesSent, 0);
    const totalReceived = users.reduce((sum, u) => sum + u.messagesReceived, 0);
    const allLatencies = users.flatMap(u => u.latencies);
    const totalErrors = users.reduce((sum, u) => sum + u.errors.length, 0);
    const webrtcConnections = users.filter(u => u.webrtcConnected).length;
    const webrtcFailures = users.filter(u => !u.webrtcConnected && this.config.webrtcEnabled).length;

    const testDuration = Math.max(1, (this.testEndTime - this.testStartTime) / 1_000_000_000); // seconds, minimum 1
    const throughput = totalMessages / testDuration;
    const errorRate = totalErrors / Math.max(totalMessages, 1);

    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      totalUsers: this.config.concurrentUsers,
      totalRooms: this.rooms.size,
      totalMessages,
      averageLatency: allLatencies.length > 0 
        ? allLatencies.reduce((sum, l) => sum + l, 0) / allLatencies.length 
        : 0,
      maxLatency: allLatencies.length > 0 ? Math.max(...allLatencies) : 0,
      minLatency: allLatencies.length > 0 ? Math.min(...allLatencies) : 0,
      errorRate,
      throughput: Math.max(0, throughput), // Ensure non-negative
      memoryUsage: memoryUsage.heapUsed / 1024 / 1024, // MB
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000, // ms
      webrtcConnections,
      webrtcFailures
    };
  }

  private calculateAverageWebRTCLatency(): number {
    // Mock implementation - in real scenario, measure actual WebRTC latency
    return Math.random() * 50 + 20; // 20-70ms
  }

  private calculatePacketLoss(): number {
    // Mock implementation - in real scenario, measure actual packet loss
    return Math.random() * 0.05; // 0-5%
  }

  private calculateBandwidthUtilization(): number {
    // Mock implementation - in real scenario, measure actual bandwidth
    return Math.random() * 100; // 0-100%
  }

  private calculateAverageEventProcessingTime(): number {
    const contextMetrics = boundedContextMonitor.getAllContextMetrics();
    const processingTimes = Array.from(contextMetrics.values())
      .map(m => m.averageResponseTime)
      .filter(t => t > 0);

    return processingTimes.length > 0
      ? processingTimes.reduce((sum, t) => sum + t, 0) / processingTimes.length
      : 0;
  }

  private getEventBacklog(): number {
    // Mock implementation - in real scenario, check actual event queue sizes
    return Math.floor(Math.random() * 100);
  }

  private identifyBottlenecks(): string[] {
    const bottlenecks: string[] = [];
    const analysis = boundedContextMonitor.analyzePerformance();

    if (analysis.criticalContexts > 0) {
      bottlenecks.push(`${analysis.criticalContexts} contexts in critical state`);
    }

    if (analysis.slowestContext) {
      bottlenecks.push(`Slowest context: ${analysis.slowestContext}`);
    }

    if (analysis.mostErrorProneContext) {
      bottlenecks.push(`Most error-prone context: ${analysis.mostErrorProneContext}`);
    }

    return bottlenecks;
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up test resources');

    // Disconnect all users
    for (const [userId, user] of this.users) {
      if (user.socket.connected) {
        user.socket.disconnect();
      }
    }

    // Close server
    if (this.server) {
      this.server.close();
    }

    if (this.httpServer) {
      this.httpServer.close();
    }

    // Clear data
    this.users.clear();
    this.rooms.clear();
  }
}