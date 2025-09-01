/**
 * Performance monitoring for Real-time Communication bounded context
 * Requirements: 8.1, 8.2
 */

import { boundedContextMonitor } from '../../../../shared/infrastructure/monitoring';
import { performanceMetrics } from '../../../../shared/infrastructure/monitoring';

export class RealTimeCommunicationMonitor {
  private static readonly CONTEXT_NAME = 'real-time-communication';

  /**
   * Monitor WebRTC connection operations
   */
  static async monitorWebRTCConnection<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'webrtc.connection',
      operation
    );
  }

  /**
   * Monitor voice communication operations
   */
  static async monitorVoiceCommunication<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'voice.communication',
      operation
    );
  }

  /**
   * Monitor mesh network operations
   */
  static async monitorMeshNetwork<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'mesh.network',
      operation
    );
  }

  /**
   * Monitor streaming operations
   */
  static async monitorStreaming<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'streaming.operation',
      operation
    );
  }

  /**
   * Monitor WebSocket message handling
   */
  static async monitorWebSocketMessage<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'websocket.message',
      operation
    );
  }

  /**
   * Monitor ICE candidate processing
   */
  static async monitorICECandidate<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'ice.candidate',
      operation
    );
  }

  /**
   * Record WebRTC connection metrics
   */
  static recordWebRTCMetrics(
    connectionId: string,
    latency: number,
    packetLoss: number,
    bandwidth: number
  ): void {
    performanceMetrics.recordGauge(
      'webrtc.latency',
      latency,
      this.CONTEXT_NAME,
      { connectionId }
    );

    performanceMetrics.recordGauge(
      'webrtc.packet.loss',
      packetLoss,
      this.CONTEXT_NAME,
      { connectionId }
    );

    performanceMetrics.recordGauge(
      'webrtc.bandwidth',
      bandwidth,
      this.CONTEXT_NAME,
      { connectionId }
    );
  }

  /**
   * Record mesh network topology metrics
   */
  static recordMeshTopology(nodeCount: number, connectionCount: number): void {
    performanceMetrics.recordGauge(
      'mesh.nodes.count',
      nodeCount,
      this.CONTEXT_NAME
    );

    performanceMetrics.recordGauge(
      'mesh.connections.count',
      connectionCount,
      this.CONTEXT_NAME
    );
  }

  /**
   * Record WebSocket message metrics
   */
  static recordWebSocketMetrics(messageType: string, messageSize: number, processingTime: number): void {
    performanceMetrics.recordDuration(
      'websocket.message.processing',
      processingTime,
      this.CONTEXT_NAME,
      { messageType }
    );

    performanceMetrics.recordGauge(
      'websocket.message.size',
      messageSize,
      this.CONTEXT_NAME,
      { messageType }
    );

    performanceMetrics.recordCounter(
      'websocket.messages.processed',
      1,
      this.CONTEXT_NAME,
      { messageType }
    );
  }

  /**
   * Record connection establishment metrics
   */
  static recordConnectionEstablishment(duration: number, success: boolean, connectionType: string): void {
    performanceMetrics.recordDuration(
      'connection.establishment',
      duration,
      this.CONTEXT_NAME,
      { 
        connectionType,
        success: success ? 'true' : 'false'
      }
    );

    performanceMetrics.recordCounter(
      success ? 'connection.success' : 'connection.failure',
      1,
      this.CONTEXT_NAME,
      { connectionType }
    );
  }

  /**
   * Record audio streaming quality metrics
   */
  static recordStreamingQuality(
    streamId: string,
    bitrate: number,
    jitter: number,
    bufferHealth: number
  ): void {
    performanceMetrics.recordGauge(
      'streaming.bitrate',
      bitrate,
      this.CONTEXT_NAME,
      { streamId }
    );

    performanceMetrics.recordGauge(
      'streaming.jitter',
      jitter,
      this.CONTEXT_NAME,
      { streamId }
    );

    performanceMetrics.recordGauge(
      'streaming.buffer.health',
      bufferHealth,
      this.CONTEXT_NAME,
      { streamId }
    );
  }

  /**
   * Record real-time communication memory usage
   */
  static recordRTCMemoryUsage(memoryUsage: number): void {
    boundedContextMonitor.recordMemoryUsage(this.CONTEXT_NAME, memoryUsage);
  }

  /**
   * Get real-time communication specific metrics
   */
  static getMetrics() {
    return {
      contextMetrics: boundedContextMonitor.getContextMetrics(this.CONTEXT_NAME),
      operationHistory: boundedContextMonitor.getOperationHistory(this.CONTEXT_NAME),
      globalMetrics: performanceMetrics.getMetrics(this.CONTEXT_NAME)
    };
  }
}