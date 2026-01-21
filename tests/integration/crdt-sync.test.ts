/**
 * Integration tests for CRDT synchronization between SDK and Server
 *
 * Tests the complete CRDT sync flow:
 * 1. SDK creates/modifies documents using CRDTManager
 * 2. Server receives and merges CRDT states via arbiter endpoint
 * 3. Merged states are applied back to SDK
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as Y from 'yjs';

// Import SDK CRDT module
import { CRDTManager, createCRDTManager } from '../../packages/sdk/src/crdt/index.js';

// Import server arbiter module
import {
  registerArbiterRoutes,
  clearCRDTStates,
} from '../../packages/server/src/arbiter/index.js';

describe('CRDT Sync Integration', () => {
  let server: FastifyInstance;
  let client1: CRDTManager;
  let client2: CRDTManager;

  beforeEach(async () => {
    // Setup server
    server = Fastify();
    await server.register(registerArbiterRoutes, { prefix: '/api/arbiter' });
    await server.ready();

    // Setup clients
    client1 = createCRDTManager({ clientId: 'client-1' });
    client2 = createCRDTManager({ clientId: 'client-2' });

    // Clear server CRDT state store
    clearCRDTStates();
  });

  afterEach(async () => {
    await server.close();
    client1.destroy();
    client2.destroy();
  });

  /**
   * Helper to sync client state to server and get merged state
   */
  async function syncToServer(
    client: CRDTManager,
    collection: string,
    documentId: string,
    serverState?: ReturnType<typeof client.getState>
  ) {
    const clientState = client.getState(collection, documentId);

    const response = await server.inject({
      method: 'POST',
      url: '/api/arbiter/resolve/crdt',
      payload: {
        clientState: {
          stateVector: Array.from(clientState.stateVector),
          fullUpdate: Array.from(clientState.fullUpdate),
          documentId: clientState.documentId,
          collection: clientState.collection,
        },
        serverState: serverState
          ? {
              stateVector: Array.from(serverState.stateVector),
              fullUpdate: Array.from(serverState.fullUpdate),
              documentId: serverState.documentId,
              collection: serverState.collection,
            }
          : undefined,
        clientId: client.getClientId(),
      },
    });

    const body = JSON.parse(response.body);
    return body;
  }

  describe('Single Client Sync', () => {
    it('should sync document from client to server', async () => {
      // Client creates a document
      client1.setFields('todos', 'todo-1', {
        text: 'Buy groceries',
        completed: false,
        priority: 'high',
      });

      // Sync to server
      const result = await syncToServer(client1, 'todos', 'todo-1');

      expect(result.resolved).toBe(true);
      expect(result.mergedState).toBeDefined();

      // Verify merged state contains the data
      const verifyDoc = new Y.Doc();
      Y.applyUpdate(verifyDoc, new Uint8Array(result.mergedState.fullUpdate));
      const map = verifyDoc.getMap('data');

      expect(map.get('text')).toBe('Buy groceries');
      expect(map.get('completed')).toBe(false);
      expect(map.get('priority')).toBe('high');

      verifyDoc.destroy();
    });

    it('should handle multiple syncs from same client', async () => {
      // First sync
      client1.setField('todos', 'todo-1', 'text', 'Initial text');
      const result1 = await syncToServer(client1, 'todos', 'todo-1');
      expect(result1.resolved).toBe(true);

      // Client updates
      client1.setField('todos', 'todo-1', 'text', 'Updated text');
      client1.setField('todos', 'todo-1', 'completed', true);

      // Second sync
      const result2 = await syncToServer(client1, 'todos', 'todo-1');
      expect(result2.resolved).toBe(true);

      // Verify final state
      const verifyDoc = new Y.Doc();
      Y.applyUpdate(verifyDoc, new Uint8Array(result2.mergedState.fullUpdate));
      const map = verifyDoc.getMap('data');

      expect(map.get('text')).toBe('Updated text');
      expect(map.get('completed')).toBe(true);

      verifyDoc.destroy();
    });
  });

  describe('Multi-Client Sync', () => {
    it('should merge changes from two clients modifying different fields', async () => {
      // Both clients start with same document
      client1.setField('todos', 'todo-1', 'text', 'Shared todo');
      client2.applyState(client1.getState('todos', 'todo-1'));

      // Client 1 modifies 'priority'
      client1.setField('todos', 'todo-1', 'priority', 'high');

      // Client 2 modifies 'completed'
      client2.setField('todos', 'todo-1', 'completed', true);

      // Sync client 1 first
      const result1 = await syncToServer(client1, 'todos', 'todo-1');
      expect(result1.resolved).toBe(true);

      // Sync client 2 with server state from client 1
      const serverState = {
        stateVector: new Uint8Array(result1.mergedState.stateVector),
        fullUpdate: new Uint8Array(result1.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      };

      const result2 = await syncToServer(client2, 'todos', 'todo-1', serverState);
      expect(result2.resolved).toBe(true);

      // Verify merged state has both changes
      const verifyDoc = new Y.Doc();
      Y.applyUpdate(verifyDoc, new Uint8Array(result2.mergedState.fullUpdate));
      const map = verifyDoc.getMap('data');

      expect(map.get('text')).toBe('Shared todo');
      expect(map.get('priority')).toBe('high');
      expect(map.get('completed')).toBe(true);

      verifyDoc.destroy();
    });

    it('should handle concurrent modifications to same field', async () => {
      // Both clients start with same document
      client1.setField('todos', 'todo-1', 'text', 'Original text');
      client2.applyState(client1.getState('todos', 'todo-1'));

      // Both clients modify 'text' concurrently
      client1.setField('todos', 'todo-1', 'text', 'Client 1 version');
      client2.setField('todos', 'todo-1', 'text', 'Client 2 version');

      // Sync client 1
      const result1 = await syncToServer(client1, 'todos', 'todo-1');

      // Sync client 2 with server state
      const serverState = {
        stateVector: new Uint8Array(result1.mergedState.stateVector),
        fullUpdate: new Uint8Array(result1.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      };

      const result2 = await syncToServer(client2, 'todos', 'todo-1', serverState);
      expect(result2.resolved).toBe(true);

      // Verify Yjs resolved the conflict (result is deterministic)
      const verifyDoc = new Y.Doc();
      Y.applyUpdate(verifyDoc, new Uint8Array(result2.mergedState.fullUpdate));
      const map = verifyDoc.getMap('data');

      // One of the values should win (Yjs deterministic resolution)
      const finalText = map.get('text');
      expect(['Client 1 version', 'Client 2 version']).toContain(finalText);

      verifyDoc.destroy();
    });

    it('should sync merged state back to all clients', async () => {
      // Client 1 creates document
      client1.setFields('todos', 'todo-1', {
        text: 'Original',
        count: 1,
      });

      // Sync client 1 to server
      const result1 = await syncToServer(client1, 'todos', 'todo-1');

      // Client 2 applies server state (simulating pull)
      client2.applyState({
        stateVector: new Uint8Array(result1.mergedState.stateVector),
        fullUpdate: new Uint8Array(result1.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });

      // Verify client 2 has the data
      expect(client2.getField('todos', 'todo-1', 'text')).toBe('Original');
      expect(client2.getField('todos', 'todo-1', 'count')).toBe(1);

      // Client 2 modifies
      client2.setField('todos', 'todo-1', 'count', 2);

      // Sync client 2 to server
      const result2 = await syncToServer(client2, 'todos', 'todo-1', {
        stateVector: new Uint8Array(result1.mergedState.stateVector),
        fullUpdate: new Uint8Array(result1.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });

      // Client 1 applies merged state (simulating pull)
      client1.applyState({
        stateVector: new Uint8Array(result2.mergedState.stateVector),
        fullUpdate: new Uint8Array(result2.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });

      // Both clients should now have the same data
      expect(client1.getData('todos', 'todo-1')).toEqual(
        client2.getData('todos', 'todo-1')
      );
      expect(client1.getField('todos', 'todo-1', 'count')).toBe(2);
    });
  });

  describe('Complex Data Types', () => {
    it('should sync nested objects', async () => {
      client1.setField('todos', 'todo-1', 'metadata', {
        author: 'John',
        tags: ['work', 'urgent'],
        settings: {
          notify: true,
          color: 'red',
        },
      });

      const result = await syncToServer(client1, 'todos', 'todo-1');
      expect(result.resolved).toBe(true);

      // Apply to client 2 and verify
      client2.applyState({
        stateVector: new Uint8Array(result.mergedState.stateVector),
        fullUpdate: new Uint8Array(result.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });

      const metadata = client2.getField('todos', 'todo-1', 'metadata') as Record<
        string,
        unknown
      >;
      expect(metadata).toBeDefined();
      expect(metadata.author).toBe('John');
    });

    it('should sync arrays', async () => {
      client1.setField('todos', 'todo-1', 'items', [
        { name: 'Item 1', done: false },
        { name: 'Item 2', done: true },
      ]);

      const result = await syncToServer(client1, 'todos', 'todo-1');
      expect(result.resolved).toBe(true);

      // Apply to client 2
      client2.applyState({
        stateVector: new Uint8Array(result.mergedState.stateVector),
        fullUpdate: new Uint8Array(result.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });

      const items = client2.getField('todos', 'todo-1', 'items') as Array<unknown>;
      expect(items).toBeDefined();
      expect(Array.isArray(items)).toBe(true);
    });
  });

  describe('Offline to Online Sync Simulation', () => {
    it('should handle offline edits and sync when back online', async () => {
      // Initial sync
      client1.setField('todos', 'todo-1', 'text', 'Initial');
      let serverResult = await syncToServer(client1, 'todos', 'todo-1');

      // Simulate offline period - client makes multiple changes
      client1.setField('todos', 'todo-1', 'text', 'Edit 1');
      client1.setField('todos', 'todo-1', 'text', 'Edit 2');
      client1.setField('todos', 'todo-1', 'completed', true);
      client1.setField('todos', 'todo-1', 'text', 'Final edit');

      // Sync when back online
      const finalResult = await syncToServer(client1, 'todos', 'todo-1', {
        stateVector: new Uint8Array(serverResult.mergedState.stateVector),
        fullUpdate: new Uint8Array(serverResult.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });

      expect(finalResult.resolved).toBe(true);

      // Verify final state
      const verifyDoc = new Y.Doc();
      Y.applyUpdate(verifyDoc, new Uint8Array(finalResult.mergedState.fullUpdate));
      const map = verifyDoc.getMap('data');

      expect(map.get('text')).toBe('Final edit');
      expect(map.get('completed')).toBe(true);

      verifyDoc.destroy();
    });

    it('should merge offline changes from multiple clients', async () => {
      // Initial state
      client1.setFields('todos', 'todo-1', {
        text: 'Shared todo',
        status: 'pending',
        priority: 'low',
      });

      // Initial sync
      let serverResult = await syncToServer(client1, 'todos', 'todo-1');

      // Both clients get initial state
      client2.applyState({
        stateVector: new Uint8Array(serverResult.mergedState.stateVector),
        fullUpdate: new Uint8Array(serverResult.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });

      // Both clients go offline and make changes
      // Client 1 changes status
      client1.setField('todos', 'todo-1', 'status', 'in-progress');

      // Client 2 changes priority
      client2.setField('todos', 'todo-1', 'priority', 'high');

      // Client 1 comes online first
      const result1 = await syncToServer(client1, 'todos', 'todo-1', {
        stateVector: new Uint8Array(serverResult.mergedState.stateVector),
        fullUpdate: new Uint8Array(serverResult.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });

      // Client 2 comes online and syncs
      const result2 = await syncToServer(client2, 'todos', 'todo-1', {
        stateVector: new Uint8Array(result1.mergedState.stateVector),
        fullUpdate: new Uint8Array(result1.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });

      // Verify all changes are merged
      const verifyDoc = new Y.Doc();
      Y.applyUpdate(verifyDoc, new Uint8Array(result2.mergedState.fullUpdate));
      const map = verifyDoc.getMap('data');

      expect(map.get('text')).toBe('Shared todo');
      expect(map.get('status')).toBe('in-progress');
      expect(map.get('priority')).toBe('high');

      verifyDoc.destroy();
    });
  });

  describe('Multiple Documents', () => {
    it('should sync multiple documents independently', async () => {
      // Create multiple documents
      client1.setField('todos', 'todo-1', 'text', 'Todo 1');
      client1.setField('todos', 'todo-2', 'text', 'Todo 2');
      client1.setField('products', 'prod-1', 'name', 'Product 1');

      // Sync all documents
      const result1 = await syncToServer(client1, 'todos', 'todo-1');
      const result2 = await syncToServer(client1, 'todos', 'todo-2');
      const result3 = await syncToServer(client1, 'products', 'prod-1');

      expect(result1.resolved).toBe(true);
      expect(result2.resolved).toBe(true);
      expect(result3.resolved).toBe(true);

      // Apply to client 2
      client2.applyState({
        stateVector: new Uint8Array(result1.mergedState.stateVector),
        fullUpdate: new Uint8Array(result1.mergedState.fullUpdate),
        documentId: 'todo-1',
        collection: 'todos',
      });
      client2.applyState({
        stateVector: new Uint8Array(result2.mergedState.stateVector),
        fullUpdate: new Uint8Array(result2.mergedState.fullUpdate),
        documentId: 'todo-2',
        collection: 'todos',
      });
      client2.applyState({
        stateVector: new Uint8Array(result3.mergedState.stateVector),
        fullUpdate: new Uint8Array(result3.mergedState.fullUpdate),
        documentId: 'prod-1',
        collection: 'products',
      });

      // Verify client 2 has all documents
      expect(client2.getField('todos', 'todo-1', 'text')).toBe('Todo 1');
      expect(client2.getField('todos', 'todo-2', 'text')).toBe('Todo 2');
      expect(client2.getField('products', 'prod-1', 'name')).toBe('Product 1');
    });
  });
});
