/**
 * Performance monitoring for Audio Processing bounded context
 * Requirements: 8.1, 8.2
 */

import { boundedContextMonitor } from '../../../../shared/infrastructure/monitoring';
import { performanceMetrics } from '../../../../shared/infrastructure/monitoring';

export class AudioProcessingMonitor {
  private static readonly CONTEXT_NAME = 'audio-processing';

  /**
   * Monitor audio bus operations
   */
  static async monitorAudioBus<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'audio.bus',
      operation
    );
  }

  /**
   * Monitor effect processing operations
   */
  static async monitorEffectProcessing<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'effect.processing',
      operation
    );
  }

  /**
   * Monitor instrument swap operations
   */
  static async monitorInstrumentSwap<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'instrument.swap',
      operation
    );
  }

  /**
   * Monitor audio routing operations
   */
  static async monitorAudioRouting<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'audio.routing',
      operation
    );
  }

  /**
   * Monitor mixer operations
   */
  static async monitorMixer<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'mixer.operation',
      operation
    );
  }

  /**
   * Monitor synth parameter updates
   */
  static async monitorSynthParams<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'synth.params',
      operation
    );
  }

  /**
   * Record audio processing latency
   */
  static recordAudioLatency(latency: number, processingType: string): void {
    performanceMetrics.recordDuration(
      'audio.latency',
      latency,
      this.CONTEXT_NAME,
      { processingType }
    );
  }

  /**
   * Record active audio buses
   */
  static recordActiveAudioBuses(count: number): void {
    performanceMetrics.recordGauge(
      'audio.buses.active.count',
      count,
      this.CONTEXT_NAME
    );
  }

  /**
   * Record effect chain complexity
   */
  static recordEffectChainComplexity(userId: string, effectCount: number): void {
    performanceMetrics.recordGauge(
      'effect.chain.complexity',
      effectCount,
      this.CONTEXT_NAME,
      { userId }
    );
  }

  /**
   * Record instrument swap performance
   */
  static recordInstrumentSwapMetrics(swapId: string, duration: number, success: boolean): void {
    performanceMetrics.recordDuration(
      'instrument.swap.duration',
      duration,
      this.CONTEXT_NAME,
      { 
        swapId,
        success: success ? 'true' : 'false'
      }
    );

    performanceMetrics.recordCounter(
      success ? 'instrument.swap.success' : 'instrument.swap.failure',
      1,
      this.CONTEXT_NAME
    );
  }

  /**
   * Record audio processing memory usage
   */
  static recordAudioMemoryUsage(memoryUsage: number): void {
    boundedContextMonitor.recordMemoryUsage(this.CONTEXT_NAME, memoryUsage);
  }

  /**
   * Record audio buffer performance
   */
  static recordAudioBufferMetrics(bufferSize: number, underruns: number): void {
    performanceMetrics.recordGauge(
      'audio.buffer.size',
      bufferSize,
      this.CONTEXT_NAME
    );

    performanceMetrics.recordCounter(
      'audio.buffer.underruns',
      underruns,
      this.CONTEXT_NAME
    );
  }

  /**
   * Get audio processing specific metrics
   */
  static getMetrics() {
    return {
      contextMetrics: boundedContextMonitor.getContextMetrics(this.CONTEXT_NAME),
      operationHistory: boundedContextMonitor.getOperationHistory(this.CONTEXT_NAME),
      globalMetrics: performanceMetrics.getMetrics(this.CONTEXT_NAME)
    };
  }
}