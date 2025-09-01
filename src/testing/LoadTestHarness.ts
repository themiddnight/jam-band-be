/**
 * Load testing harness for the refactored backend
 */

import { performanceMetrics } from '../shared/infrastructure/monitoring';

export interface LoadTestConfig {
  concurrentUsers: number;
  testDurationMs: number;
  rampUpTimeMs: number;
  operations: LoadTestOperation[];
}

export interface LoadTestOperation {
  name: string;
  weight: number; // Relative frequency (1-100)
  execute: () => Promise<void>;
}

export interface LoadTestResults {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  requestsPerSecond: number;
  errorRate: number;
  operationStats: Array<{
    operation: string;
    count: number;
    averageTime: number;
    errorCount: number;
  }>;
  memoryUsage: {
    initial: NodeJS.MemoryUsage;
    peak: NodeJS.MemoryUsage;
    final: NodeJS.MemoryUsage;
  };
}

export class LoadTestHarness {
  private results: LoadTestResults = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    minResponseTime: Infinity,
    maxResponseTime: 0,
    requestsPerSecond: 0,
    errorRate: 0,
    operationStats: [],
    memoryUsage: {
      initial: process.memoryUsage(),
      peak: process.memoryUsage(),
      final: process.memoryUsage()
    }
  };

  private operationCounts = new Map<string, { count: number; totalTime: number; errors: number }>();
  private responseTimes: number[] = [];

  /**
   * Run load test with specified configuration
   */
  async runLoadTest(config: LoadTestConfig): Promise<LoadTestResults> {
    console.log(`🚀 Starting load test with ${config.concurrentUsers} concurrent users`);
    
    this.results.memoryUsage.initial = process.memoryUsage();
    const startTime = Date.now();
    
    // Clear previous metrics
    performanceMetrics.clearMetrics('load-test');
    
    // Create user simulation promises
    const userPromises: Promise<void>[] = [];
    
    for (let i = 0; i < config.concurrentUsers; i++) {
      const userDelay = (config.rampUpTimeMs / config.concurrentUsers) * i;
      userPromises.push(this.simulateUser(config, userDelay));
    }
    
    // Wait for all users to complete
    await Promise.all(userPromises);
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    // Calculate final results
    this.calculateFinalResults(totalDuration);
    
    console.log(`✅ Load test completed in ${totalDuration}ms`);
    this.printResults();
    
    return this.results;
  }

  /**
   * Simulate a single user's behavior
   */
  private async simulateUser(config: LoadTestConfig, initialDelay: number): Promise<void> {
    // Wait for ramp-up delay
    if (initialDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, initialDelay));
    }
    
    const userStartTime = Date.now();
    const userEndTime = userStartTime + config.testDurationMs;
    
    while (Date.now() < userEndTime) {
      try {
        const operation = this.selectOperation(config.operations);
        await this.executeOperation(operation);
        
        // Small delay between operations to simulate realistic user behavior
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
        
      } catch (error) {
        console.error('User simulation error:', error);
      }
    }
  }

  /**
   * Select operation based on weights
   */
  private selectOperation(operations: LoadTestOperation[]): LoadTestOperation {
    const totalWeight = operations.reduce((sum, op) => sum + op.weight, 0);
    const random = Math.random() * totalWeight;
    
    let currentWeight = 0;
    for (const operation of operations) {
      currentWeight += operation.weight;
      if (random <= currentWeight) {
        return operation;
      }
    }
    
    return operations[0]; // Fallback
  }

  /**
   * Execute a single operation and record metrics
   */
  private async executeOperation(operation: LoadTestOperation): Promise<void> {
    const startTime = Bun.nanoseconds();
    
    try {
      await operation.execute();
      
      const duration = (Bun.nanoseconds() - startTime) / 1_000_000; // Convert to milliseconds
      this.recordSuccess(operation.name, duration);
      
    } catch (error) {
      const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
      this.recordFailure(operation.name, duration);
      throw error;
    }
  }

  /**
   * Record successful operation
   */
  private recordSuccess(operationName: string, duration: number): void {
    this.results.totalRequests++;
    this.results.successfulRequests++;
    this.responseTimes.push(duration);
    
    this.updateOperationStats(operationName, duration, false);
    this.updateMemoryPeak();
    
    // Record to performance metrics
    performanceMetrics.recordDuration(operationName, duration, 'load-test', { status: 'success' });
    performanceMetrics.recordCounter(`${operationName}.requests`, 1, 'load-test', { status: 'success' });
  }

  /**
   * Record failed operation
   */
  private recordFailure(operationName: string, duration: number): void {
    this.results.totalRequests++;
    this.results.failedRequests++;
    this.responseTimes.push(duration);
    
    this.updateOperationStats(operationName, duration, true);
    this.updateMemoryPeak();
    
    // Record to performance metrics
    performanceMetrics.recordDuration(operationName, duration, 'load-test', { status: 'error' });
    performanceMetrics.recordCounter(`${operationName}.requests`, 1, 'load-test', { status: 'error' });
    performanceMetrics.recordCounter(`${operationName}.errors`, 1, 'load-test');
  }

  /**
   * Update operation statistics
   */
  private updateOperationStats(operationName: string, duration: number, isError: boolean): void {
    if (!this.operationCounts.has(operationName)) {
      this.operationCounts.set(operationName, { count: 0, totalTime: 0, errors: 0 });
    }
    
    const stats = this.operationCounts.get(operationName)!;
    stats.count++;
    stats.totalTime += duration;
    
    if (isError) {
      stats.errors++;
    }
  }

  /**
   * Update peak memory usage
   */
  private updateMemoryPeak(): void {
    const current = process.memoryUsage();
    if (current.heapUsed > this.results.memoryUsage.peak.heapUsed) {
      this.results.memoryUsage.peak = current;
    }
  }

  /**
   * Calculate final results
   */
  private calculateFinalResults(totalDurationMs: number): void {
    this.results.memoryUsage.final = process.memoryUsage();
    
    if (this.responseTimes.length > 0) {
      this.results.averageResponseTime = this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;
      this.results.minResponseTime = Math.min(...this.responseTimes);
      this.results.maxResponseTime = Math.max(...this.responseTimes);
    }
    
    this.results.requestsPerSecond = (this.results.totalRequests / totalDurationMs) * 1000;
    this.results.errorRate = this.results.totalRequests > 0 
      ? this.results.failedRequests / this.results.totalRequests 
      : 0;
    
    // Calculate operation stats
    this.results.operationStats = Array.from(this.operationCounts.entries()).map(([operation, stats]) => ({
      operation,
      count: stats.count,
      averageTime: stats.count > 0 ? stats.totalTime / stats.count : 0,
      errorCount: stats.errors
    }));
  }

  /**
   * Print test results
   */
  private printResults(): void {
    console.log('\n📊 Load Test Results:');
    console.log(`Total Requests: ${this.results.totalRequests}`);
    console.log(`Successful: ${this.results.successfulRequests}`);
    console.log(`Failed: ${this.results.failedRequests}`);
    console.log(`Error Rate: ${(this.results.errorRate * 100).toFixed(2)}%`);
    console.log(`Average Response Time: ${this.results.averageResponseTime.toFixed(2)}ms`);
    console.log(`Min Response Time: ${this.results.minResponseTime.toFixed(2)}ms`);
    console.log(`Max Response Time: ${this.results.maxResponseTime.toFixed(2)}ms`);
    console.log(`Requests/Second: ${this.results.requestsPerSecond.toFixed(2)}`);
    
    console.log('\n🧠 Memory Usage:');
    console.log(`Initial: ${(this.results.memoryUsage.initial.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Peak: ${(this.results.memoryUsage.peak.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Final: ${(this.results.memoryUsage.final.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    
    console.log('\n⚡ Operation Breakdown:');
    this.results.operationStats.forEach(stat => {
      console.log(`${stat.operation}: ${stat.count} requests, ${stat.averageTime.toFixed(2)}ms avg, ${stat.errorCount} errors`);
    });
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const report = {
      summary: {
        totalRequests: this.results.totalRequests,
        successRate: ((this.results.successfulRequests / this.results.totalRequests) * 100).toFixed(2) + '%',
        averageResponseTime: this.results.averageResponseTime.toFixed(2) + 'ms',
        requestsPerSecond: this.results.requestsPerSecond.toFixed(2),
        memoryIncrease: ((this.results.memoryUsage.final.heapUsed - this.results.memoryUsage.initial.heapUsed) / 1024 / 1024).toFixed(2) + 'MB'
      },
      operations: this.results.operationStats,
      recommendations: this.generateRecommendations()
    };
    
    return JSON.stringify(report, null, 2);
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    
    if (this.results.errorRate > 0.05) {
      recommendations.push(`High error rate (${(this.results.errorRate * 100).toFixed(2)}%) - investigate failing operations`);
    }
    
    if (this.results.averageResponseTime > 200) {
      recommendations.push(`High average response time (${this.results.averageResponseTime.toFixed(2)}ms) - optimize slow operations`);
    }
    
    if (this.results.requestsPerSecond < 100) {
      recommendations.push(`Low throughput (${this.results.requestsPerSecond.toFixed(2)} req/s) - consider performance optimizations`);
    }
    
    const memoryIncrease = this.results.memoryUsage.final.heapUsed - this.results.memoryUsage.initial.heapUsed;
    if (memoryIncrease > 100 * 1024 * 1024) { // 100MB
      recommendations.push(`High memory usage increase (${(memoryIncrease / 1024 / 1024).toFixed(2)}MB) - check for memory leaks`);
    }
    
    // Check individual operations
    this.results.operationStats.forEach(stat => {
      if (stat.averageTime > 500) {
        recommendations.push(`Operation '${stat.operation}' is slow (${stat.averageTime.toFixed(2)}ms average)`);
      }
      
      const errorRate = stat.count > 0 ? stat.errorCount / stat.count : 0;
      if (errorRate > 0.1) {
        recommendations.push(`Operation '${stat.operation}' has high error rate (${(errorRate * 100).toFixed(2)}%)`);
      }
    });
    
    return recommendations;
  }
}