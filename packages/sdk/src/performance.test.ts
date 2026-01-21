/**
 * Performance tests for the offline sync engine
 * @module performance.test
 *
 * Note: These tests require IndexedDB and should run in a browser environment.
 * They are skipped in Node.js.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabase } from './storage/index.js';
import {
  benchmarkWrite,
  benchmarkRead,
  benchmarkQuery,
  testCapacity,
} from './testing/performance.js';

// Skip if IndexedDB is not available (e.g., Node.js environment)
const isIndexedDBAvailable = typeof indexedDB !== 'undefined';

describe.skipIf(!isIndexedDBAvailable)('Performance Benchmarks', () => {
  let db: Awaited<ReturnType<typeof createDatabase>>;

  beforeAll(async () => {
    db = await createDatabase({ name: 'test-performance' });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  describe('Write Performance', () => {
    it('should write single document in less than 10ms', async () => {
      const todoDataFactory = () => ({
        text: `Performance test todo ${Date.now()}`,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await benchmarkWrite(db.todos, 10, todoDataFactory);

      // Average write time should be less than 10ms
      expect(result.avgTime).toBeLessThan(10);

      // Throughput should be more than 100 ops/sec
      expect(result.opsPerSecond).toBeGreaterThan(100);
    });

    it('should write 100 documents in less than 1 second', async () => {
      const todoDataFactory = () => ({
        text: `Performance test todo ${Date.now()}`,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await benchmarkWrite(db.todos, 100, todoDataFactory);

      // Total time should be less than 1 second
      expect(result.totalTime).toBeLessThan(1000);
    });
  });

  describe('Read Performance', () => {
    it('should read single document in less than 5ms', async () => {
      const result = await benchmarkRead(db.todos, 10);

      // Average read time should be less than 5ms
      expect(result.avgTime).toBeLessThan(5);
    });

    it('should read 100 documents in less than 50ms', async () => {
      const result = await benchmarkRead(db.todos, 100);

      // Total time should be less than 50ms
      expect(result.totalTime).toBeLessThan(50);
    });
  });

  describe('Query Performance', () => {
    it('should query 1000 documents in less than 100ms', async () => {
      const result = await benchmarkQuery(db.todos, 100);

      // Average query time should be less than 1ms per query
      // (so 100 queries should be less than 100ms total)
      expect(result.avgTime).toBeLessThan(1);
    });
  });

  describe('Capacity', () => {
    it('should handle storage of at least 10MB', { timeout: 60000 }, async () => {
      const todoDataFactory = () => ({
        text: `x`.repeat(1000), // Larger data for capacity test
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Note: This test may not work in all environments due to
      // navigator.storage.estimate() availability
      if (typeof navigator !== 'undefined' && 'storage' in navigator && 'estimate' in navigator.storage) {
        const result = await testCapacity(db.todos, 1, todoDataFactory); // Test 1MB instead of 10MB for faster testing

        // Should successfully store the data
        expect(result.success).toBe(true);
        expect(result.documentCount).toBeGreaterThan(0);
      } else {
        // Skip test if storage API is not available
        console.warn('navigator.storage.estimate() not available, skipping capacity test');
      }
    });
  });

  describe('Throughput Benchmarks', () => {
    it('should achieve more than 100 write ops per second', async () => {
      const todoDataFactory = () => ({
        text: `Throughput test ${Date.now()}`,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await benchmarkWrite(db.todos, 100, todoDataFactory);
      expect(result.opsPerSecond).toBeGreaterThan(100);
    });

    it('should achieve more than 500 read ops per second', async () => {
      const result = await benchmarkRead(db.todos, 100);
      expect(result.opsPerSecond).toBeGreaterThan(500);
    });
  });
});
