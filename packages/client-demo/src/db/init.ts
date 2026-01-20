/**
 * Database initialization for the demo app
 * Uses RxDB with Dexie storage (IndexedDB)
 */

import { createRxDatabase, type RxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { todoSchema } from './schema';

export type Collections = {
  todos: {
    schema: typeof todoSchema;
  };
};

// Singleton instance
let db: RxDatabase<Collections> | null = null;

export async function createDatabase(): Promise<RxDatabase<Collections>> {
  if (db) {
    return db;
  }

  const database = await createRxDatabase<Collections>({
    name: 'offline-sync-demo',
    storage: getRxStorageDexie(),
  });

  await database.addCollections({
    todos: {
      schema: todoSchema,
    },
  });

  db = database;
  return db;
}

export async function getDatabase() {
  if (!db) {
    return createDatabase();
  }
  return db;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
