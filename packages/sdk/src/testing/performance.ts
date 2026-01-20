/**
 * Performance testing utilities for the offline sync engine
 * @module testing/performance
 */

import type { RxCollection } from 'rxdb';

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  operation: string;
  count: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  opsPerSecond: number;
}

/**
 * Capacity test result
 */
export interface CapacityTestResult {
  targetSizeMB: number;
  actualSizeMB: number;
  documentCount: number;
  success: boolean;
  error?: string;
}

/**
 * Measure execution time of an async function
 */
async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; time: number }> {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  return { result, time: end - start };
}

/**
 * Benchmark write operations
 *
 * @param collection - The RxDB collection to test
 * @param count - Number of documents to write
 * @param dataFactory - Function to generate test data
 * @returns Benchmark result
 */
export async function benchmarkWrite<T>(
  collection: RxCollection,
  count: number,
  dataFactory: () => T
): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < count; i++) {
    const { time } = await measure(async () => {
      await collection.insert({ ...dataFactory(), id: `bench_${i}_${Date.now()}` } as any);
    });
    times.push(time);
  }

  // Cleanup test data
  for (let i = 0; i < count; i++) {
    // Note: We use a prefix search by finding all and filtering
    // This is less efficient but works for cleanup
    const allDocs = await collection.find().exec();
    for (const doc of allDocs as any[]) {
      if (doc.id && doc.id.startsWith(`bench_${i}_`)) {
        await doc.remove();
      }
    }
  }

  const totalTime = times.reduce((sum, t) => sum + t, 0);
  const avgTime = totalTime / count;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const opsPerSecond = (count / totalTime) * 1000;

  return {
    operation: 'write',
    count,
    totalTime,
    avgTime,
    minTime,
    maxTime,
    opsPerSecond,
  };
}

/**
 * Benchmark read operations
 *
 * @param collection - The RxDB collection to test
 * @param count - Number of reads to perform
 * @returns Benchmark result
 */
export async function benchmarkRead(collection: RxCollection, count: number): Promise<BenchmarkResult> {
  // First, add some test data if collection is empty
  const existing = await collection.find().exec();
  if (existing.length === 0) {
    for (let i = 0; i < Math.max(count, 100); i++) {
      await collection.insert({
        id: `test_${i}`,
        name: `Test ${i}`,
        createdAt: new Date().toISOString(),
      } as any);
    }
  }

  const docs = await collection.find().limit(count).exec();
  const docIds = docs.map((d: any) => d.id);

  const times: number[] = [];

  for (let i = 0; i < count; i++) {
    const id = docIds[i % docIds.length];
    const { time } = await measure(async () => {
      await collection.findOne().where('id').equals(id).exec();
    });
    times.push(time);
  }

  const totalTime = times.reduce((sum, t) => sum + t, 0);
  const avgTime = totalTime / count;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const opsPerSecond = (count / totalTime) * 1000;

  return {
    operation: 'read',
    count,
    totalTime,
    avgTime,
    minTime,
    maxTime,
    opsPerSecond,
  };
}

/**
 * Benchmark query operations
 *
 * @param collection - The RxDB collection to test
 * @param count - Number of queries to perform
 * @returns Benchmark result
 */
export async function benchmarkQuery(collection: RxCollection, count: number): Promise<BenchmarkResult> {
  // First, add test data if collection is empty
  const existing = await collection.find().exec();
  if (existing.length < 1000) {
    for (let i = existing.length; i < 1000; i++) {
      await collection.insert({
        id: `query_test_${i}`,
        name: `Query Test ${i}`,
        category: i % 5,
        createdAt: new Date().toISOString(),
      } as any);
    }
  }

  const times: number[] = [];

  for (let i = 0; i < count; i++) {
    const { time } = await measure(async () => {
      await collection.find().where('category').equals(i % 5).exec();
    });
    times.push(time);
  }

  const totalTime = times.reduce((sum, t) => sum + t, 0);
  const avgTime = totalTime / count;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const opsPerSecond = (count / totalTime) * 1000;

  return {
    operation: 'query',
    count,
    totalTime,
    avgTime,
    minTime,
    maxTime,
    opsPerSecond,
  };
}

/**
 * Test storage capacity
 *
 * @param collection - The RxDB collection to test
 * @param targetMB - Target size in MB
 * @param dataFactory - Function to generate test data
 * @returns Capacity test result
 */
export async function testCapacity<T>(
  collection: RxCollection,
  targetMB: number,
  dataFactory: () => T
): Promise<CapacityTestResult> {
  const targetBytes = targetMB * 1024 * 1024;
  const avgDocSize = JSON.stringify(dataFactory()).length * 2; // Rough estimate
  const docsNeeded = Math.ceil(targetBytes / avgDocSize);

  let totalBytes = 0;
  let documentCount = 0;

  try {
    // Calculate initial storage usage
    if (typeof navigator !== 'undefined' && 'storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      totalBytes = estimate.usage || 0;
    }

    const startBytes = totalBytes;

    // Write documents until we reach target size
    for (let i = 0; i < docsNeeded; i++) {
      await collection.insert({
        ...dataFactory(),
        id: `capacity_test_${Date.now()}_${i}`,
      } as any);
      documentCount++;

      // Check progress every 100 documents
      if (i % 100 === 0 && typeof navigator !== 'undefined' && 'storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        totalBytes = estimate.usage || 0;
        if (totalBytes - startBytes >= targetBytes) {
          break;
        }
      }
    }

    // Get final storage usage
    if (typeof navigator !== 'undefined' && 'storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      totalBytes = estimate.usage || 0;
    }

    const actualSizeMB = (totalBytes - startBytes) / (1024 * 1024);

    // Cleanup test data
    const allDocs = await collection.find().exec();
    for (const doc of allDocs as any[]) {
      if (doc.id && doc.id.startsWith('capacity_test_')) {
        await doc.remove();
      }
    }

    return {
      targetSizeMB: targetMB,
      actualSizeMB,
      documentCount,
      success: actualSizeMB >= targetMB * 0.9, // Allow 10% margin
    };
  } catch (error) {
    return {
      targetSizeMB: targetMB,
      actualSizeMB: totalBytes / (1024 * 1024),
      documentCount,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run all performance benchmarks
 *
 * @param collection - The RxDB collection to test
 * @param dataFactory - Function to generate test data
 * @returns Array of benchmark results
 */
export async function runAllBenchmarks<T>(
  collection: RxCollection,
  dataFactory: () => T
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Warm up
  await benchmarkWrite(collection, 10, dataFactory);

  // Run benchmarks
  results.push(await benchmarkWrite(collection, 100, dataFactory));
  results.push(await benchmarkRead(collection, 100));
  results.push(await benchmarkQuery(collection, 100));

  return results;
}

/**
 * Format benchmark result for display
 */
export function formatBenchmarkResult(result: BenchmarkResult): string {
  return `${result.operation.toUpperCase()} (${result.count} ops):
  Total: ${result.totalTime.toFixed(2)}ms
  Average: ${result.avgTime.toFixed(2)}ms
  Min: ${result.minTime.toFixed(2)}ms
  Max: ${result.maxTime.toFixed(2)}ms
  Throughput: ${result.opsPerSecond.toFixed(0)} ops/sec`;
}
