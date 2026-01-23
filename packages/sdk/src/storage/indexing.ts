/**
 * Indexing and query optimization utilities
 * @module indexing
 */

import type { RxCollection, RxDocument } from 'rxdb';

/**
 * Index definition
 */
export interface IndexDefinition {
  name: string;
  fields: string[];
  unique?: boolean;
  sparse?: boolean;
}

/**
 * Query plan information
 */
export interface QueryPlan {
  indexUsed: string | null;
  isIndexed: boolean;
  estimatedDocs: number;
  sortOptimized: boolean;
}

/**
 * Index manager for RxDB collections
 */
export class IndexManager {
  private indexes: Map<string, IndexDefinition[]> = new Map();

  /**
   * Create indexes on a collection
   */
  async createIndexes(
    collection: RxCollection,
    indexes: IndexDefinition[]
  ): Promise<void> {
    const collectionName = collection.name;
    const existingIndexes = this.indexes.get(collectionName) || [];

    for (const index of indexes) {
      // Check if index already exists
      const exists = existingIndexes.some(
        (existing) =>
          existing.name === index.name ||
          this.fieldsMatch(existing.fields, index.fields)
      );

      if (!exists) {
        try {
          // RxDB indexes are defined in schema
          // This method tracks what indexes should be available
          await this.ensureIndex(collection, index);
          existingIndexes.push(index);
        } catch (error) {
          console.warn(`Failed to create index ${index.name}:`, error);
        }
      }
    }

    this.indexes.set(collectionName, existingIndexes);
  }

  /**
   * Get indexes for a collection
   */
  getIndexes(collectionName: string): IndexDefinition[] {
    return this.indexes.get(collectionName) || [];
  }

  /**
   * Check if a query uses an index
   */
  analyzeQuery(
    collectionName: string,
    query: {
      selector?: Record<string, unknown>;
      sort?: Record<string, 1 | -1>;
    }
  ): QueryPlan {
    const indexes = this.getIndexes(collectionName);
    const indexUsed = this.findMatchingIndex(indexes, query);

    return {
      indexUsed: indexUsed?.name || null,
      isIndexed: !!indexUsed,
      estimatedDocs: indexUsed ? 100 : 10000,
      sortOptimized: this.isSortOptimized(query.sort, indexUsed),
    };
  }

  /**
   * Suggest indexes for a query
   */
  suggestIndexes(
    collectionName: string,
    query: {
      selector?: Record<string, unknown>;
      sort?: Record<string, 1 | -1>;
    }
  ): IndexDefinition[] {
    const suggestions: IndexDefinition[] = [];
    const existingIndexes = this.getIndexes(collectionName);

    // Analyze selector fields
    if (query.selector) {
      const selectorFields = this.extractSelectorFields(query.selector);

      for (const field of selectorFields) {
        const hasIndex = existingIndexes.some((index) =>
          index.fields.includes(field)
        );

        if (!hasIndex) {
          suggestions.push({
            name: `idx_${field.replace(/\./g, '_')}`,
            fields: [field],
          });
        }
      }
    }

    // Analyze sort fields
    if (query.sort) {
      const sortFields = Object.keys(query.sort);

      for (const field of sortFields) {
        const hasIndex = existingIndexes.some(
          (index) => index.fields.length === 1 && index.fields[0] === field
        );

        if (!hasIndex) {
          suggestions.push({
            name: `idx_${field}_sort`,
            fields: [field],
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Ensure index exists on collection
   */
  private async ensureIndex(
    collection: RxCollection,
    index: IndexDefinition
  ): Promise<void> {
    // RxDB indexes are created via schema
    // This is a placeholder for validation
    const schema = collection.schema as any;
    if (schema && schema.indexes) {
      const indexKey = index.fields.join('_');
      if (!schema.indexes.includes(indexKey)) {
        console.warn(
          `Index ${index.name} not found in schema. Add to schema indexes.`
        );
      }
    }
  }

  /**
   * Find matching index for query
   */
  private findMatchingIndex(
    indexes: IndexDefinition[],
    query: {
      selector?: Record<string, unknown>;
      sort?: Record<string, 1 | -1>;
    }
  ): IndexDefinition | undefined {
    if (!query.selector && !query.sort) {
      return undefined;
    }

    // Find index that covers selector fields
    const selectorFields = query.selector
      ? this.extractSelectorFields(query.selector)
      : [];

    // Sort by specificity (more fields = better)
    const sortedIndexes = [...indexes].sort(
      (a, b) => b.fields.length - a.fields.length
    );

    for (const index of sortedIndexes) {
      // Check if index covers selector
      const coversSelector =
        selectorFields.length === 0 ||
        selectorFields.every((field) => index.fields.includes(field));

      // Check if index supports sort
      const supportsSort =
        !query.sort ||
        (index.fields.length === 1 && index.fields[0] in query.sort);

      if (coversSelector && supportsSort) {
        return index;
      }
    }

    return undefined;
  }

  /**
   * Check if sort is optimized by index
   */
  private isSortOptimized(
    sort: Record<string, 1 | -1> | undefined,
    index: IndexDefinition | undefined
  ): boolean {
    if (!sort || !index) {
      return false;
    }

    const sortFields = Object.keys(sort);
    return (
      index.fields.length === 1 && index.fields[0] === sortFields[0]
    );
  }

  /**
   * Extract field names from selector
   */
  private extractSelectorFields(
    selector: Record<string, unknown>,
    prefix = ''
  ): string[] {
    const fields: string[] = [];

    for (const [key, value] of Object.entries(selector)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;

      if (key === '$and' || key === '$or' || key === '$not') {
        // Recursively extract from logical operators
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'object') {
              fields.push(...this.extractSelectorFields(item as Record<string, unknown>));
            }
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        const keys = Object.keys(value);
        const hasOperator = keys.some((k) => k.startsWith('$'));

        if (hasOperator) {
          fields.push(fieldPath);
        } else {
          fields.push(...this.extractSelectorFields(value as Record<string, unknown>, fieldPath));
        }
      } else {
        fields.push(fieldPath);
      }
    }

    return fields;
  }

  /**
   * Check if two field arrays match
   */
  private fieldsMatch(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((field, i) => field === b[i]);
  }
}

/**
 * Global index manager instance
 */
const globalIndexManager = new IndexManager();

/**
 * Get the global index manager
 */
export function getIndexManager(): IndexManager {
  return globalIndexManager;
}

/**
 * Query optimizer hint types
 */
export type QueryHint =
  | 'use_index'
  | 'no_index'
  | 'sequential_scan'
  | 'fast_count';

/**
 * Optimized query builder
 */
export class OptimizedQueryBuilder<_T extends RxDocument> {
  private collection: RxCollection;
  private indexManager: IndexManager;
  private hints: Set<QueryHint> = new Set();
  private forceIndex?: string;

  constructor(collection: RxCollection) {
    this.collection = collection;
    this.indexManager = getIndexManager();
  }

  /**
   * Use specific index
   */
  useIndex(indexName: string): this {
    this.forceIndex = indexName;
    this.hints.add('use_index');
    return this;
  }

  /**
   * Skip index usage
   */
  skipIndex(): this {
    this.hints.add('no_index');
    return this;
  }

  /**
   * Force sequential scan
   */
  sequentialScan(): this {
    this.hints.add('sequential_scan');
    return this;
  }

  /**
   * Build optimized query
   */
  async build(): Promise<RxCollection> {
    // Apply query hints
    if (this.hints.has('no_index') || this.hints.add('sequential_scan')) {
      // Return collection without index optimization
      return this.collection;
    }

    return this.collection;
  }

  /**
   * Get query execution plan
   */
  explain(query: {
    selector?: Record<string, unknown>;
    sort?: Record<string, 1 | -1>;
  }): QueryPlan {
    return this.indexManager.analyzeQuery(this.collection.name, query);
  }

  /**
   * Suggest indexes for the current query
   */
  suggestIndexes(query: {
    selector?: Record<string, unknown>;
    sort?: Record<string, 1 | -1>;
  }): IndexDefinition[] {
    return this.indexManager.suggestIndexes(this.collection.name, query);
  }
}

/**
 * Create optimized query builder
 */
export function createOptimizedQuery<T extends RxDocument>(
  collection: RxCollection
): OptimizedQueryBuilder<T> {
  return new OptimizedQueryBuilder<T>(collection);
}

/**
 * Cache for query results
 */
export class QueryCache<T = unknown> {
  private cache: Map<string, { data: T; timestamp: number; ttl: number }> =
    new Map();
  private defaultTTL: number;

  constructor(defaultTTL: number = 60000) {
    this.defaultTTL = defaultTTL;
  }

  /**
   * Generate cache key from query
   */
  generateKey(collection: string, query: Record<string, unknown>): string {
    return `${collection}:${JSON.stringify(query)}`;
  }

  /**
   * Get cached result
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cache entry
   */
  set(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
  }

  /**
   * Invalidate cache entries
   */
  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Clean expired entries
   */
  clean(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Global query cache instance
 */
let globalQueryCache: QueryCache | null = null;

/**
 * Get the global query cache
 */
export function getQueryCache(): QueryCache {
  if (!globalQueryCache) {
    globalQueryCache = new QueryCache();

    // Clean expired entries every 5 minutes
    setInterval(() => {
      globalQueryCache?.clean();
    }, 5 * 60 * 1000);
  }

  return globalQueryCache;
}

/**
 * Decorator for cached queries
 */
export function cachedQuery<T>(
  collection: string,
  query: Record<string, unknown>,
  fn: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cache = getQueryCache();
  const key = cache.generateKey(collection, query);

  const cached = cache.get(key) as T | null;
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  return fn().then((result) => {
    cache.set(key, result, ttl);
    return result;
  });
}
