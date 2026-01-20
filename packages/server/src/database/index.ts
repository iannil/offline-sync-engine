/**
 * CouchDB connection and database management
 * @module database
 */

import nano, { type Nano } from 'nano';

/**
 * CouchDB configuration
 */
export interface CouchDBConfig {
  url?: string;
  username?: string;
  password?: string;
  databasePrefix?: string;
}

/**
 * Default CouchDB configuration
 */
const DEFAULT_CONFIG: Required<CouchDBConfig> = {
  url: process.env.COUCHDB_URL || 'http://localhost:5984',
  username: process.env.COUCHDB_USERNAME || 'admin',
  password: process.env.COUCHDB_PASSWORD || 'password',
  databasePrefix: process.env.COUCHDB_DB_PREFIX || 'offline-sync',
};

/**
 * CouchDB connection singleton
 */
let nanoInstance: Nano<Document> | null = null;
let databases: Map<string, Nano.DocumentScope<any>> = new Map();

/**
 * Initialize CouchDB connection
 *
 * @param config - CouchDB configuration
 * @returns Promise resolving to the nano instance
 */
export async function initCouchDB(config: CouchDBConfig = {}): Promise<Nano<Document>> {
  if (nanoInstance) {
    return nanoInstance;
  }

  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Build connection URL with auth if provided
  let url = finalConfig.url;
  if (finalConfig.username && finalConfig.password) {
    const urlObj = new URL(url);
    urlObj.username = finalConfig.username;
    urlObj.password = finalConfig.password;
    url = urlObj.toString();
  }

  // Create nano instance
  nanoInstance = nano(url);

  // Create databases if they don't exist
  await ensureDatabases(nanoInstance);

  return nanoInstance;
}

/**
 * Get the nano instance (initializes if needed)
 */
export async function getCouchDB(): Promise<Nano<Document>> {
  if (!nanoInstance) {
    return initCouchDB();
  }
  return nanoInstance;
}

/**
 * Ensure all required databases exist
 */
async function ensureDatabases(nano: Nano<Document>): Promise<void> {
  const dbNames = [
    `${DEFAULT_CONFIG.databasePrefix}-todos`,
    `${DEFAULT_CONFIG.databasePrefix}-products`,
    `${DEFAULT_CONFIG.databasePrefix}-customers`,
    `${DEFAULT_CONFIG.databasePrefix}-orders`,
  ];

  for (const dbName of dbNames) {
    try {
      await nano.db.create(dbName);
      console.log(`Created database: ${dbName}`);
    } catch (error: any) {
      if (error.statusCode !== 412) {
        // 412 means database already exists
        console.error(`Failed to create database ${dbName}:`, error.message);
      }
    }

    // Store database reference
    databases.set(dbName, nano.db.use(dbName));
  }
}

/**
 * Get a database by collection name
 *
 * @param collection - Collection name (todos, products, etc.)
 * @returns Promise resolving to the database scope
 */
export async function getDatabase(collection: string): Promise<Nano.DocumentScope<any>> {
  const nano = await getCouchDB();
  const dbName = `${DEFAULT_CONFIG.databasePrefix}-${collection}`;

  // Check if database exists in cache
  if (databases.has(dbName)) {
    return databases.get(dbName)!;
  }

  // Try to get database, create if not exists
  try {
    const db = nano.db.use(dbName);
    // Test connection
    await db.info();
    databases.set(dbName, db);
    return db;
  } catch (error) {
    // Database doesn't exist, create it
    await nano.db.create(dbName);
    const db = nano.db.use(dbName);
    databases.set(dbName, db);
    return db;
  }
}

/**
 * Generic document operations
 */

/**
 * Get a document by ID
 *
 * @param collection - Collection name
 * @param id - Document ID
 * @returns Promise resolving to the document or null
 */
export async function getDocument<T = any>(
  collection: string,
  id: string
): Promise<T | null> {
  const db = await getDatabase(collection);
  try {
    return await db.get(id) as T;
  } catch (error: any) {
    if (error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Insert a new document
 *
 * @param collection - Collection name
 * @param doc - Document to insert
 * @returns Promise resolving to the created document
 */
export async function insertDocument<T = any>(
  collection: string,
  doc: T
): Promise<T> {
  const db = await getDatabase(collection);
  const result = await db.insert(doc);
  return result as T;
}

/**
 * Update an existing document
 *
 * @param collection - Collection name
 * @param doc - Document with _id and _rev
 * @returns Promise resolving to the updated document
 */
export async function updateDocument<T = any>(
  collection: string,
  doc: T
): Promise<T> {
  const db = await getDatabase(collection);
  const result = await db.insert(doc);
  return result as T;
}

/**
 * Delete a document
 *
 * @param collection - Collection name
 * @param id - Document ID
 * @param rev - Document revision
 * @returns Promise resolving when deleted
 */
export async function deleteDocument(
  collection: string,
  id: string,
  rev: string
): Promise<void> {
  const db = await getDatabase(collection);
  await db.destroy(id, rev);
}

/**
 * Query documents with a Mango selector
 *
 * @param collection - Collection name
 * @param selector - Mango selector
 * @param options - Query options (limit, skip, sort, etc.)
 * @returns Promise resolving to the query result
 */
export async function queryDocuments<T = any>(
  collection: string,
  selector: Record<string, unknown>,
  options: {
    limit?: number;
    skip?: number;
    sort?: Record<string, 'asc' | 'desc'>;
    fields?: string[];
  } = {}
): Promise<T[]> {
  const db = await getDatabase(collection);

  const result = await db.find({
    selector,
    ...options,
  });

  return result.docs as T[];
}

/**
 * Get changes since a given sequence/revision
 *
 * @param collection - Collection name
 * @param since - Starting sequence (for _changes feed)
 * @param limit - Maximum number of changes to return
 * @returns Promise resolving to the changes
 */
export async function getChanges(
  collection: string,
  since?: string,
  limit = 100
): Promise<
  Array<{
    id: string;
    seq: string;
    deleted: boolean;
    doc: any;
  }>
> {
  const nano = await getCouchDB();
  const dbName = `${DEFAULT_CONFIG.databasePrefix}-${collection}`;

  // Use the _changes feed
  const changes = await nano.db.use(dbName).changes({
    since: since || 'now',
    limit,
    include_docs: true,
  });

  return changes.results.map((r) => ({
    id: r.id,
    seq: r.seq,
    deleted: r.deleted || false,
    doc: r.doc,
  }));
}

/**
 * Bulk insert documents
 *
 * @param collection - Collection name
 * @param docs - Documents to insert
 * @returns Promise resolving to the bulk result
 */
export async function bulkInsert<T = any>(
  collection: string,
  docs: T[]
): Promise<
  Array<{
    ok: boolean;
    id: string;
    rev: string;
    error?: string;
  }>
> {
  const db = await getDatabase(collection);
  const result = await db.bulk({ docs });
  return result as any;
}

/**
 * Reset all databases (for testing)
 */
export async function resetDatabases(): Promise<void> {
  const nano = await getCouchDB();
  const dbList = await nano.db.list();

  for (const dbName of dbList) {
    if (dbName.startsWith(DEFAULT_CONFIG.databasePrefix)) {
      await nano.db.destroy(dbName);
      console.log(`Destroyed database: ${dbName}`);
    }
  }

  databases.clear();
}

/**
 * Get database info
 */
export async function getDatabaseInfo(collection: string): Promise<{
  doc_count: number;
  update_seq: number;
  sizes: {
    file: number;
    active: number;
    external: number;
  };
}> {
  const db = await getDatabase(collection);
  return await db.info();
}
