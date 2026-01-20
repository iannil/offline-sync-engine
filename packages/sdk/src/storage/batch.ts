/**
 * Batch operation optimizations for improved performance
 * @module batch
 */

import type { RxCollection, RxDocument } from 'rxdb';

/**
 * Batch operation options
 */
export interface BatchOptions {
  /**
   * Number of operations per batch
   * @default 100
   */
  batchSize?: number;

  /**
   * Delay between batches (ms)
   * @default 0
   */
  delayMs?: number;

  /**
   * Progress callback
   */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Batch operation result
 */
export interface BatchResult<T> {
  succeeded: T[];
  failed: Array<{ item: T; error: string }>;
  totalProcessed: number;
}

/**
 * Generic batch processor
 */
export class BatchProcessor<T> {
  private options: Required<BatchOptions>;

  constructor(options: BatchOptions = {}) {
    this.options = {
      batchSize: options.batchSize || 100,
      delayMs: options.delayMs || 0,
      onProgress: options.onProgress || (() => {}),
    };
  }

  /**
   * Process items in batches
   */
  async process(
    items: T[],
    processor: (item: T, batch: T[]) => Promise<void>
  ): Promise<BatchResult<T>> {
    const succeeded: T[] = [];
    const failed: Array<{ item: T; error: string }> = [];
    let totalProcessed = 0;

    for (let i = 0; i < items.length; i += this.options.batchSize) {
      const batch = items.slice(i, i + this.options.batchSize);

      for (const item of batch) {
        try {
          await processor(item, batch);
          succeeded.push(item);
        } catch (error) {
          failed.push({
            item,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        totalProcessed++;
        this.options.onProgress(totalProcessed, items.length);
      }

      // Add delay between batches if specified
      if (this.options.delayMs > 0 && i + this.options.batchSize < items.length) {
        await this.delay(this.options.delayMs);
      }
    }

    return { succeeded, failed, totalProcessed };
  }

  /**
   * Process items with parallel batches
   */
  async processParallel(
    items: T[],
    processor: (item: T) => Promise<void>,
    concurrency: number = 3
  ): Promise<BatchResult<T>> {
    const succeeded: T[] = [];
    const failed: Array<{ item: T; error: string }> = [];
    let totalProcessed = 0;

    // Process items in parallel chunks
    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        chunk.map(async (item) => {
          await processor(item);
          return item;
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const item = chunk[j];

        if (result.status === 'fulfilled') {
          succeeded.push(item);
        } else {
          failed.push({
            item,
            error: result.reason?.message || String(result.reason),
          });
        }

        totalProcessed++;
        this.options.onProgress(totalProcessed, items.length);
      }
    }

    return { succeeded, failed, totalProcessed };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Optimized bulk insert for RxDB
 */
export async function bulkInsert<T extends RxDocument>(
  collection: RxCollection,
  items: T[],
  options: BatchOptions = {}
): Promise<BatchResult<T>> {
  const processor = new BatchProcessor<T>(options);

  return processor.process(items, async (item, batch) => {
    // Use RxDB's bulk insert for better performance
    try {
      // Check if collection supports bulk insert
      if ('bulkInsert' in collection && typeof collection.bulkInsert === 'function') {
        // For batch processing, only insert on first item of batch
        if (batch.indexOf(item) === 0) {
          await (collection as any).bulkInsert(
            batch.map((b) => ({
              ...b,
              // Ensure required timestamps
              createdAt: (b as any).createdAt || new Date().toISOString(),
              updatedAt: (b as any).updatedAt || new Date().toISOString(),
            }))
          );
        }
        // Skip subsequent items in batch
        return;
      }
    } catch {
      // Fall back to individual inserts
    }

    // Individual insert as fallback
    await collection.insert(item);
  });
}

/**
 * Optimized bulk update for RxDB
 */
export async function bulkUpdate<T extends RxDocument>(
  collection: RxCollection,
  items: Array<{ id: string; updates: Partial<T> }>,
  options: BatchOptions = {}
): Promise<BatchResult<{ id: string; updates: Partial<T> }>> {
  const processor = new BatchProcessor<{ id: string; updates: Partial<T> }>(options);

  return processor.process(items, async (item) => {
    const doc = await collection
      .findOne()
      .where('id')
      .equals(item.id)
      .exec();

    if (!doc) {
      throw new Error(`Document not found: ${item.id}`);
    }

    await doc.patch({
      ...item.updates,
      updatedAt: new Date().toISOString(),
    });
  });
}

/**
 * Optimized bulk delete (soft delete) for RxDB
 */
export async function bulkDelete(
  collection: RxCollection,
  ids: string[],
  options: BatchOptions = {}
): Promise<BatchResult<string>> {
  const processor = new BatchProcessor<string>(options);

  return processor.process(ids, async (id) => {
    const doc = await collection
      .findOne()
      .where('id')
      .equals(id)
      .exec();

    if (!doc) {
      throw new Error(`Document not found: ${id}`);
    }

    // Soft delete
    await doc.patch({
      deleted: true,
      updatedAt: new Date().toISOString(),
    });
  });
}

/**
 * Batch query optimization - fetch multiple documents by IDs
 */
export async function bulkFetch<T extends RxDocument>(
  collection: RxCollection,
  ids: string[],
  options: BatchOptions = {}
): Promise<Map<string, T>> {
  const result = new Map<string, T>();
  const batchSize = options.batchSize || 100;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIds = ids.slice(i, i + batchSize);

    try {
      // Use RxDB's findByIds if available
      if ('findByIds' in collection && typeof collection.findByIds === 'function') {
        const docs = await (collection as any).findByIds(batchIds);
        for (const doc of docs) {
          result.set(doc.id, doc);
        }
      } else {
        // Fallback to individual queries
        const docs = await Promise.all(
          batchIds.map((id) =>
            collection
              .findOne()
              .where('id')
              .equals(id)
              .exec()
          )
        );
        for (const doc of docs) {
          if (doc) {
            result.set(doc.id, doc as T);
          }
        }
      }
    } catch (error) {
      console.error('Batch fetch error:', error);
    }

    options.onProgress?.(Math.min(i + batchSize, ids.length), ids.length);
  }

  return result;
}

/**
 * Deferred write buffer - batches writes for better performance
 */
export class WriteBuffer<T> {
  private buffer: Map<string, T> = new Map();
  private collection: RxCollection;
  private flushTimer?: ReturnType<typeof setInterval>;
  private options: {
    maxSize: number;
    maxAge: number;
    autoFlush: boolean;
  };

  constructor(
    collection: RxCollection,
    options: {
      maxSize?: number;
      maxAge?: number;
      autoFlush?: boolean;
    } = {}
  ) {
    this.collection = collection;
    this.options = {
      maxSize: options.maxSize || 100,
      maxAge: options.maxAge || 5000,
      autoFlush: options.autoFlush !== false,
    };

    if (this.options.autoFlush) {
      this.startAutoFlush();
    }
  }

  /**
   * Add an item to the buffer
   */
  add(id: string, item: T): void {
    this.buffer.set(id, item);

    if (this.buffer.size >= this.options.maxSize) {
      this.flush().catch(console.error);
    }
  }

  /**
   * Update an item in the buffer
   */
  update(id: string, updates: Partial<T>): void {
    const existing = this.buffer.get(id);
    if (existing) {
      this.buffer.set(id, { ...existing, ...updates } as T);
    }
  }

  /**
   * Remove an item from the buffer
   */
  remove(id: string): void {
    this.buffer.delete(id);
  }

  /**
   * Flush all buffered items to the database
   */
  async flush(): Promise<void> {
    if (this.buffer.size === 0) {
      return;
    }

    const items = Array.from(this.buffer.entries());
    this.buffer.clear();

    try {
      if ('bulkInsert' in this.collection && typeof this.collection.bulkInsert === 'function') {
        const docs = items.map(([_, item]) => ({
          ...item,
          updatedAt: new Date().toISOString(),
        }));
        await (this.collection as any).bulkInsert(docs);
      } else {
        for (const [id, item] of items) {
          const existing = await this.collection
            .findOne()
            .where('id')
            .equals(id)
            .exec();

          if (existing) {
            await existing.patch({
              ...item,
              updatedAt: new Date().toISOString(),
            });
          } else {
            await this.collection.insert(item);
          }
        }
      }
    } catch (error) {
      console.error('Flush error:', error);
      // Put items back in buffer on error
      for (const [id, item] of items) {
        this.buffer.set(id, item);
      }
      throw error;
    }
  }

  /**
   * Get buffer size
   */
  get size(): number {
    return this.buffer.size;
  }

  /**
   * Check if buffer is empty
   */
  get isEmpty(): boolean {
    return this.buffer.size === 0;
  }

  /**
   * Clear buffer without flushing
   */
  clear(): void {
    this.buffer.clear();
  }

  /**
   * Destroy buffer and stop auto-flush
   */
  destroy(): void {
    this.stopAutoFlush();
    this.clear();
  }

  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => {
      if (this.buffer.size > 0) {
        this.flush().catch(console.error);
      }
    }, this.options.maxAge);
  }

  private stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}
