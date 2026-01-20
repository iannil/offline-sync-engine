/**
 * Query service - generic query API for collections
 * @module storage/query
 */

import type { RxCollection, RxDocument } from 'rxdb';

/**
 * Sort option for queries
 */
export type SortOption = { [key: string]: 'asc' | 'desc' };

/**
 * Query options for findAll
 */
export interface QueryOptions {
  sort?: SortOption[];
  limit?: number;
  skip?: number;
}

/**
 * Pagination options
 */
export interface PaginationOptions extends QueryOptions {
  page: number;
  pageSize: number;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Find all documents in a collection
 *
 * @param collection - The RxDB collection to query
 * @param options - Query options (sort, limit, skip)
 * @returns Promise resolving to array of documents
 */
export async function findAll<T extends RxDocument>(
  collection: RxCollection,
  options: QueryOptions = {}
): Promise<T[]> {
  const queryBuilder = collection.find();

  // Apply sort if specified
  if (options.sort && options.sort.length > 0) {
    queryBuilder.sort(options.sort as any);
  }

  // Apply skip if specified
  if (options.skip) {
    queryBuilder.skip(options.skip);
  }

  // Apply limit if specified
  if (options.limit) {
    queryBuilder.limit(options.limit);
  }

  const result = await queryBuilder.exec();
  return result.map((doc: any) => doc.toJSON()) as T[];
}

/**
 * Find a document by ID
 *
 * @param collection - The RxDB collection to query
 * @param id - The document ID
 * @returns Promise resolving to the document or null if not found
 */
export async function findById<T extends RxDocument>(
  collection: RxCollection,
  id: string
): Promise<T | null> {
  const doc = await collection
    .findOne()
    .where('id')
    .equals(id)
    .exec();

  return doc ? (doc.toJSON() as T) : null;
}

/**
 * Find documents matching a selector
 *
 * @param collection - The RxDB collection to query
 * @param selector - The MongoDB-style selector
 * @param options - Query options (sort, limit, skip)
 * @returns Promise resolving to array of matching documents
 */
export async function findWhere<T extends RxDocument>(
  collection: RxCollection,
  selector: Record<string, unknown>,
  options: QueryOptions = {}
): Promise<T[]> {
  const queryBuilder = collection.find({
    selector,
  });

  // Apply sort if specified
  if (options.sort && options.sort.length > 0) {
    queryBuilder.sort(options.sort as any);
  }

  // Apply skip if specified
  if (options.skip) {
    queryBuilder.skip(options.skip);
  }

  // Apply limit if specified
  if (options.limit) {
    queryBuilder.limit(options.limit);
  }

  const result = await queryBuilder.exec();
  return result.map((doc: any) => doc.toJSON()) as T[];
}

/**
 * Paginate through a collection
 *
 * @param collection - The RxDB collection to query
 * @param options - Pagination options
 * @returns Promise resolving to paginated result
 */
export async function paginate<T extends RxDocument>(
  collection: RxCollection,
  options: PaginationOptions
): Promise<PaginatedResult<T>> {
  const { page, pageSize, ...queryOptions } = options;
  const skip = (page - 1) * pageSize;

  // Get total count
  const totalQuery = collection.find();
  const totalResult = await totalQuery.exec();
  const total = totalResult.length;

  // Get paginated items
  const items = await findAll<T>(collection, {
    ...queryOptions,
    skip,
    limit: pageSize,
  });

  const totalPages = Math.ceil(total / pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Count documents in a collection
 *
 * @param collection - The RxDB collection
 * @param selector - Optional selector to filter documents
 * @returns Promise resolving to the count
 */
export async function count(
  collection: RxCollection,
  selector?: Record<string, unknown>
): Promise<number> {
  if (selector) {
    const result = await collection.find({ selector }).exec();
    return result.length;
  }

  const result = await collection.find().exec();
  return result.length;
}

/**
 * Query builder for fluent query construction
 */
export class QueryBuilder<T extends RxDocument> {
  private collection: RxCollection;
  private selector: Record<string, unknown> = {};
  private sortOptions: SortOption[] = [];
  private limitValue?: number;
  private skipValue?: number;

  constructor(collection: RxCollection) {
    this.collection = collection;
  }

  /**
   * Add a where clause
   */
  where(field: string, value: unknown): this {
    this.selector[field] = value;
    return this;
  }

  /**
   * Add sort option
   */
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.sortOptions.push({ [field]: direction });
    return this;
  }

  /**
   * Set limit
   */
  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  /**
   * Set skip
   */
  skip(n: number): this {
    this.skipValue = n;
    return this;
  }

  /**
   * Execute the query
   */
  async exec(): Promise<T[]> {
    return findWhere<T>(this.collection, this.selector, {
      sort: this.sortOptions,
      limit: this.limitValue,
      skip: this.skipValue,
    });
  }

  /**
   * Get first result
   */
  async first(): Promise<T | null> {
    const results = await this.limit(1).exec();
    return results[0] || null;
  }

  /**
   * Count matching documents
   */
  async count(): Promise<number> {
    return count(this.collection, Object.keys(this.selector).length > 0 ? this.selector : undefined);
  }

  /**
   * Paginate results
   */
  async paginate(page: number, pageSize: number): Promise<PaginatedResult<T>> {
    return paginate(this.collection, {
      page,
      pageSize,
      sort: this.sortOptions,
    });
  }
}

/**
 * Create a query builder for a collection
 */
export function query<T extends RxDocument>(collection: RxCollection): QueryBuilder<T> {
  return new QueryBuilder<T>(collection);
}
