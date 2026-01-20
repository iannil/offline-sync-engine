/**
 * Data schema definitions for the offline sync engine
 * @module storage/schema
 */

import type { RxJsonSchema } from 'rxdb';
import { productSchema } from './schemas/product.js';
export { productSchema, type Product } from './schemas/product.js';

/**
 * Todo item schema - example model for demo
 */
export const todoSchema: RxJsonSchema<Todo> = {
  title: 'todo',
  version: 0,
  description: 'A todo item for demonstration',
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
    },
    text: {
      type: 'string',
      minLength: 1,
    },
    completed: {
      type: 'boolean',
      default: false,
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
    },
    deleted: {
      type: 'boolean',
      default: false,
    },
  },
  required: ['id', 'text', 'createdAt', 'updatedAt'],
  indexes: ['createdAt', 'completed', 'deleted'],
};

/**
 * Outbox action schema - stores pending write operations
 */
export const outboxActionSchema: RxJsonSchema<OutboxAction> = {
  title: 'outbox_action',
  version: 0,
  description: 'Pending write operation to be synchronized',
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
    },
    type: {
      type: 'string',
      enum: ['CREATE', 'UPDATE', 'DELETE'],
    },
    collection: {
      type: 'string',
    },
    documentId: {
      type: 'string',
    },
    data: {
      type: 'object',
      additionalProperties: true,
    },
    timestamp: {
      type: 'number',
      minimum: 0,
    },
    status: {
      type: 'string',
      enum: ['pending', 'syncing', 'done', 'failed'],
      default: 'pending',
    },
    retryCount: {
      type: 'number',
      minimum: 0,
      default: 0,
    },
    error: {
      type: 'string',
    },
  },
  required: ['id', 'type', 'collection', 'documentId', 'timestamp'],
  indexes: ['status', 'timestamp', 'collection'],
};

/**
 * Sync metadata schema - tracks synchronization state
 */
export const syncMetadataSchema: RxJsonSchema<SyncMetadata> = {
  title: 'sync_metadata',
  version: 0,
  description: 'Synchronization checkpoint metadata',
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
    },
    lastSyncAt: {
      type: 'number',
      minimum: 0,
    },
    vectorClock: {
      type: 'object',
      additionalProperties: {
        type: 'number',
      },
    },
  },
  required: ['id', 'lastSyncAt'],
};

/**
 * Collection definitions for RxDB
 */
export const collections = {
  todos: { schema: todoSchema },
  products: { schema: productSchema },
  outbox_actions: { schema: outboxActionSchema },
  sync_metadata: { schema: syncMetadataSchema },
};

/**
 * Type definitions
 */
export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface OutboxAction {
  id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  collection: string;
  documentId: string;
  data: Record<string, unknown>;
  timestamp: number;
  status: 'pending' | 'syncing' | 'done' | 'failed';
  retryCount?: number;
  error?: string;
}

export interface SyncMetadata {
  id: string;
  lastSyncAt: number;
  vectorClock: Record<string, number>;
}
