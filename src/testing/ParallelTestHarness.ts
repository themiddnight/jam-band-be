import { EventEmitter } from 'events';
import { Socket } from 'socket.io';
import { RoomHandlers } from '../handlers/RoomHandlers';

export interface TestResult {
  testId: string;
  timestamp: number;
  oldResult: any;
  newResult: any;
  isEqual: boolean;
  executionTimeOld: number;
  executionTimeNew: number;
  memoryUsageOld: number;
  memoryUsageNew: number;
  error?: string | undefined;
}

export interface TestComparison {
  passed: boolean;
  differences: string[];
  performanceRatio: number;
  memoryRatio: number;
}

/**
 * Parallel testing harness for comparing old vs new implementations
 * Supports side-by-side execution and result validation
 */
export class ParallelTestHarness extends EventEmitter {
  private testResults: Map<string, TestResult> = new Map();
  private oldImplementation: any;
  private newImplementation: any;

  constructor() {
    super();
  }

  /**
   * Register old and new implementations for comparison
   */
  registerImplementations(oldImpl: any, newImpl: any): void {
    this.oldImplementation = oldImpl;
    this.newImplementation = newImpl;
  }

  /**
   * Execute a method on both implementations and compare results
   */
  async executeParallel(
    methodName: string,
    args: any[],
    testId: string = `test_${Date.now()}`
  ): Promise<TestResult> {
    const startTime = Date.now();
    
    // Measure memory before execution
    const memoryBefore = process.memoryUsage();

    let oldResult: any;
    let newResult: any;
    let oldExecutionTime: number;
    let newExecutionTime: number;
    let oldMemoryUsage: number;
    let newMemoryUsage: number;
    let error: string | undefined;

    try {
      // Execute old implementation
      const oldStart = process.hrtime.bigint();
      const oldMemStart = process.memoryUsage();
      
      if (this.oldImplementation && typeof this.oldImplementation[methodName] === 'function') {
        oldResult = await this.oldImplementation[methodName](...args);
      } else {
        throw new Error(`Method ${methodName} not found in old implementation`);
      }
      
      const oldEnd = process.hrtime.bigint();
      const oldMemEnd = process.memoryUsage();
      oldExecutionTime = Number(oldEnd - oldStart) / 1000000; // Convert to milliseconds
      oldMemoryUsage = oldMemEnd.heapUsed - oldMemStart.heapUsed;

      // Execute new implementation
      const newStart = process.hrtime.bigint();
      const newMemStart = process.memoryUsage();
      
      if (this.newImplementation && typeof this.newImplementation[methodName] === 'function') {
        newResult = await this.newImplementation[methodName](...args);
      } else {
        throw new Error(`Method ${methodName} not found in new implementation`);
      }
      
      const newEnd = process.hrtime.bigint();
      const newMemEnd = process.memoryUsage();
      newExecutionTime = Number(newEnd - newStart) / 1000000; // Convert to milliseconds
      newMemoryUsage = newMemEnd.heapUsed - newMemStart.heapUsed;

    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      oldExecutionTime = 0;
      newExecutionTime = 0;
      oldMemoryUsage = 0;
      newMemoryUsage = 0;
    }

    // Compare results (if there was an error, results are not equal)
    const isEqual = error ? false : this.deepEqual(oldResult, newResult);

    const testResult: TestResult = {
      testId,
      timestamp: startTime,
      oldResult,
      newResult,
      isEqual,
      executionTimeOld: oldExecutionTime,
      executionTimeNew: newExecutionTime,
      memoryUsageOld: oldMemoryUsage,
      memoryUsageNew: newMemoryUsage,
      error
    };

    this.testResults.set(testId, testResult);
    this.emit('testCompleted', testResult);

    return testResult;
  }

  /**
   * Compare two test results for equality
   */
  private deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;
    
    if (obj1 == null || obj2 == null) return obj1 === obj2;
    
    if (typeof obj1 !== typeof obj2) return false;
    
    if (typeof obj1 !== 'object') return obj1 === obj2;
    
    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!this.deepEqual(obj1[key], obj2[key])) return false;
    }
    
    return true;
  }

  /**
   * Analyze test results and provide comparison metrics
   */
  analyzeResults(testId: string): TestComparison | null {
    const result = this.testResults.get(testId);
    if (!result) return null;

    const differences: string[] = [];
    
    if (!result.isEqual) {
      differences.push('Results are not equal');
      differences.push(`Old result: ${JSON.stringify(result.oldResult)}`);
      differences.push(`New result: ${JSON.stringify(result.newResult)}`);
    }

    const performanceRatio = result.executionTimeOld > 0 
      ? result.executionTimeNew / result.executionTimeOld 
      : 1;

    const memoryRatio = result.memoryUsageOld > 0 
      ? result.memoryUsageNew / result.memoryUsageOld 
      : 1;

    if (performanceRatio > 1.1) {
      differences.push(`Performance degradation: ${((performanceRatio - 1) * 100).toFixed(2)}% slower`);
    } else if (performanceRatio < 0.9) {
      differences.push(`Performance improvement: ${((1 - performanceRatio) * 100).toFixed(2)}% faster`);
    }

    if (memoryRatio > 1.1) {
      differences.push(`Memory usage increase: ${((memoryRatio - 1) * 100).toFixed(2)}% more memory`);
    } else if (memoryRatio < 0.9) {
      differences.push(`Memory usage decrease: ${((1 - memoryRatio) * 100).toFixed(2)}% less memory`);
    }

    return {
      passed: result.isEqual && !result.error && performanceRatio <= 1.1 && memoryRatio <= 1.1,
      differences,
      performanceRatio,
      memoryRatio
    };
  }

  /**
   * Get all test results
   */
  getAllResults(): TestResult[] {
    return Array.from(this.testResults.values());
  }

  /**
   * Clear all test results
   */
  clearResults(): void {
    this.testResults.clear();
  }

  /**
   * Generate test report
   */
  generateReport(): {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    averagePerformanceRatio: number;
    averageMemoryRatio: number;
    results: TestResult[];
  } {
    const results = this.getAllResults();
    const totalTests = results.length;
    let passedTests = 0;
    let totalPerformanceRatio = 0;
    let totalMemoryRatio = 0;

    for (const result of results) {
      const analysis = this.analyzeResults(result.testId);
      if (analysis?.passed) {
        passedTests++;
      }
      
      totalPerformanceRatio += result.executionTimeOld > 0 
        ? result.executionTimeNew / result.executionTimeOld 
        : 1;
      
      totalMemoryRatio += result.memoryUsageOld > 0 
        ? result.memoryUsageNew / result.memoryUsageOld 
        : 1;
    }

    return {
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      averagePerformanceRatio: totalTests > 0 ? totalPerformanceRatio / totalTests : 1,
      averageMemoryRatio: totalTests > 0 ? totalMemoryRatio / totalTests : 1,
      results
    };
  }
}