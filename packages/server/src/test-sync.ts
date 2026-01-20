/**
 * End-to-end sync flow test script
 * Tests the complete sync pipeline: client push -> server applier -> server pull
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../index.js';
import {
  initCouchDB,
  resetDatabases,
  getDocument,
  queryDocuments,
} from '../database/index.js';

describe('End-to-End Sync Flow', () => {
  const serverUrl = 'http://localhost:3001';

  beforeAll(async () => {
    // Initialize CouchDB with test config
    await initCouchDB({
      url: process.env.COUCHDB_URL || 'http://localhost:5984',
      username: process.env.COUCHDB_USERNAME || 'admin',
      password: process.env.COUCHDB_PASSWORD || 'password',
      databasePrefix: 'test-sync',
    });

    // Reset test databases
    await resetDatabases();
  });

  it('should push a create action to server', async () => {
    const action = {
      id: 'test-action-1',
      type: 'CREATE',
      collection: 'todos',
      documentId: 'todo-1',
      data: {
        id: 'todo-1',
        text: 'Test todo',
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      timestamp: Date.now(),
    };

    const response = await fetch(`${serverUrl}/api/applier/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });

    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.documentId).toBe('todo-1');
  });

  it('should retrieve the created document', async () => {
    const doc = await getDocument('todos', 'todo-1');

    expect(doc).toBeDefined();
    expect(doc?.id).toBe('todo-1');
    expect(doc?.text).toBe('Test todo');
  });

  it('should update a document', async () => {
    const action = {
      id: 'test-action-2',
      type: 'UPDATE',
      collection: 'todos',
      documentId: 'todo-1',
      data: {
        completed: true,
      },
      timestamp: Date.now(),
    };

    const response = await fetch(`${serverUrl}/api/applier/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });

    expect(response.ok).toBe(true);

    // Verify update
    const doc = await getDocument('todos', 'todo-1');
    expect(doc?.completed).toBe(true);
  });

  it('should pull changes via sync endpoint', async () => {
    const response = await fetch(`${serverUrl}/api/sync/pull?since=0&limit=10`, {
      method: 'GET',
    });

    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.items).toBeDefined();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.since).toBeDefined();
  });

  it('should detect conflicts via arbiter', async () => {
    const checkRequest = {
      documentId: 'todo-1',
      collection: 'todos',
      clientVersion: 1,
      serverVersion: 2,
      clientData: {
        id: 'todo-1',
        text: 'Client version',
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      },
      serverData: {
        id: 'todo-1',
        text: 'Server version',
        updatedAt: new Date().toISOString(),
      },
      clientId: 'test-client',
    };

    const response = await fetch(`${serverUrl}/api/arbiter/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkRequest),
    });

    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.hasConflict).toBeDefined();
  });

  it('should resolve conflict with LWW', async () => {
    const resolveRequest = {
      documentId: 'todo-1',
      collection: 'todos',
      clientVersion: 1,
      serverVersion: 2,
      clientData: {
        id: 'todo-1',
        text: 'Client wins',
        updatedAt: new Date(Date.now() + 2000).toISOString(),
      },
      serverData: {
        id: 'todo-1',
        text: 'Server wins',
        updatedAt: new Date().toISOString(),
      },
      clientId: 'test-client',
    };

    const response = await fetch(`${serverUrl}/api/arbiter/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resolveRequest),
    });

    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.resolved).toBe(true);
    expect(result.winner).toBe('client');
  });

  it('should query documents from collection', async () => {
    const docs = await queryDocuments('todos', {
      deleted: { $ne: true },
    });

    expect(docs).toBeDefined();
    expect(docs.length).toBeGreaterThan(0);
  });

  it('should soft delete a document', async () => {
    const action = {
      id: 'test-action-3',
      type: 'DELETE',
      collection: 'todos',
      documentId: 'todo-1',
      data: {},
      timestamp: Date.now(),
    };

    const response = await fetch(`${serverUrl}/api/applier/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });

    expect(response.ok).toBe(true);

    // Document should still exist but be marked as deleted
    const doc = await getDocument('todos', 'todo-1');
    expect(doc).toBeDefined();
    expect(doc?.deleted).toBe(true);
  });

  it('should not return deleted documents in query', async () => {
    const docs = await queryDocuments('todos', {
      deleted: { $ne: true },
    });

    expect(docs).toBeDefined();
    // Should not contain the deleted todo
    const deletedTodo = docs.find((d: any) => d.id === 'todo-1');
    expect(deletedTodo).toBeUndefined();
  });
});
