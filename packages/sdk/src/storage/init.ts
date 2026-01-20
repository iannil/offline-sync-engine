/**
 * Database initialization and configuration
 * @module storage/init
 */

import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { collections } from './schema.js';
import type { RxDatabase } from 'rxdb';

export type Collections = typeof collections;

// RxDatabase type after addCollections is called
// We use 'any' for collection access since RxDB types are complex
export type DatabaseType = RxDatabase<any> & {
  todos: any;
  products: any;
  outbox_actions: any;
  sync_metadata: any;
};

/**
 * Database configuration options
 */
export interface DatabaseConfig {
  name?: string;
  password?: string;
  multiTab?: boolean;
}

/**
 * Creates and initializes the RxDB database
 *
 * @param config - Database configuration options
 * @returns Promise resolving to the initialized database instance
 */
export async function createDatabase(
  config: DatabaseConfig = {}
): Promise<DatabaseType> {
  const {
    name = 'offline-sync-engine',
    password,
    multiTab = true,
  } = config;

  const db = await createRxDatabase<any>({
    name,
    storage: getRxStorageDexie(),
    password,
    ignoreDuplicate: true,
  });

  // Add collections
  await db.addCollections(collections);

  return db;
}

/**
 * Default database instance singleton
 */
let defaultDb: DatabaseType | null = null;

/**
 * Get or create the default database instance
 *
 * @param config - Database configuration options (only used on first call)
 * @returns Promise resolving to the database instance
 */
export async function getDatabase(
  config?: DatabaseConfig
): Promise<DatabaseType> {
  if (!defaultDb) {
    defaultDb = await createDatabase(config);
  }
  return defaultDb;
}

/**
 * Close the default database instance
 */
export async function closeDatabase(): Promise<void> {
  if (defaultDb) {
    await defaultDb.destroy();
    defaultDb = null;
  }
}

/**
 * Remove all data from the database
 */
export async function clearDatabase(): Promise<void> {
  const db = await getDatabase();
  const collectionNames = Object.keys(collections);

  await Promise.all(
    collectionNames.map((name) => db[name].removeAllDocuments())
  );
}
