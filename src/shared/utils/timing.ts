/**
 * Cross-platform high-resolution timing utilities
 */

/**
 * Get high-resolution time in nanoseconds (cross-platform)
 * Works with both Bun and Node.js
 */
export function getHighResolutionTime(): number {
  if (typeof Bun !== 'undefined' && Bun.nanoseconds) {
    return Bun.nanoseconds();
  }
  // Node.js fallback using process.hrtime.bigint()
  return Number(process.hrtime.bigint());
}

/**
 * Calculate processing time in milliseconds from start time
 */
export function calculateProcessingTime(startTime: number): number {
  const endTime = getHighResolutionTime();
  return (endTime - startTime) / 1_000_000;
}

/**
 * Measure execution time of a function in milliseconds
 */
export async function measureExecutionTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const startTime = getHighResolutionTime();
  const result = await fn();
  const duration = calculateProcessingTime(startTime);
  return { result, duration };
}

/**
 * Measure execution time of a synchronous function in milliseconds
 */
export function measureSyncExecutionTime<T>(fn: () => T): { result: T; duration: number } {
  const startTime = getHighResolutionTime();
  const result = fn();
  const duration = calculateProcessingTime(startTime);
  return { result, duration };
}