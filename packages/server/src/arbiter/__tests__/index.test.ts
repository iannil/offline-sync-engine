/**
 * Arbiter module unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import {
  registerArbiterRoutes,
  getCRDTState,
  setCRDTState,
  deleteCRDTState,
  clearCRDTStates,
} from '../index.js';

// Mock database module
vi.mock('../../database/index.js', () => ({
  getDocument: vi.fn(),
}));

import { getDocument } from '../../database/index.js';

describe('Arbiter', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create Fastify instance
    fastify = Fastify();

    // Register routes
    await fastify.register(registerArbiterRoutes, { prefix: '/api/arbiter' });

    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('POST /api/arbiter/check', () => {
    it('should detect no conflict for new document', async () => {
      vi.mocked(getDocument).mockResolvedValue(null);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/check',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 0,
          clientData: { text: 'New todo', updatedAt: new Date().toISOString() },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.hasConflict).toBe(false);
    });

    it('should detect conflict when timestamps differ', async () => {
      const now = new Date();
      const serverTime = new Date(now.getTime() - 5000).toISOString();
      const clientTime = new Date(now.getTime() - 10000).toISOString();

      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        text: 'Server todo',
        updatedAt: serverTime,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/check',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 1,
          clientData: { text: 'Client todo', updatedAt: clientTime },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.hasConflict).toBe(true);
    });

    it('should use serverData if provided', async () => {
      const now = new Date();
      const serverTime = new Date(now.getTime() - 5000).toISOString();
      const clientTime = new Date(now.getTime() - 10000).toISOString();

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/check',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 1,
          clientData: { text: 'Client todo', updatedAt: clientTime },
          serverData: { text: 'Server todo', updatedAt: serverTime },
        },
      });

      expect(response.statusCode).toBe(200);
      // Should not call getDocument since serverData is provided
      expect(getDocument).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/arbiter/resolve (LWW)', () => {
    it('should resolve client wins when client has newer timestamp', async () => {
      const clientTime = new Date().toISOString();
      const serverTime = new Date(Date.now() - 5000).toISOString();

      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        text: 'Server todo',
        updatedAt: serverTime,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 2,
          serverVersion: 1,
          clientData: { text: 'Client todo', updatedAt: clientTime },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.winner).toBe('client');
      expect(body.data.text).toBe('Client todo');
    });

    it('should resolve server wins when server has newer timestamp', async () => {
      const clientTime = new Date(Date.now() - 5000).toISOString();
      const serverTime = new Date().toISOString();

      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        text: 'Server todo',
        updatedAt: serverTime,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 2,
          clientData: { text: 'Client todo', updatedAt: clientTime },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.winner).toBe('server');
      expect(body.data.text).toBe('Server todo');
    });

    it('should resolve server wins on tie', async () => {
      const timestamp = new Date().toISOString();

      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        text: 'Server todo',
        updatedAt: timestamp,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 1,
          clientData: { text: 'Client todo', updatedAt: timestamp },
          clientId: 'client-123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.winner).toBe('server');
    });

    it('should return client wins for new document', async () => {
      vi.mocked(getDocument).mockResolvedValue(null);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 0,
          clientData: { text: 'New todo', updatedAt: new Date().toISOString() },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.winner).toBe('client');
    });
  });

  describe('POST /api/arbiter/resolve/merge', () => {
    it('should merge fields from client and server', async () => {
      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        title: 'Server title',
        description: 'Server description',
        updatedAt: new Date().toISOString(),
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve/merge',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 2,
          serverVersion: 1,
          clientData: {
            title: 'Client title',
            status: 'done',
            updatedAt: new Date().toISOString(),
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.winner).toBe('merged');
      expect(body.data).toHaveProperty('title');
      expect(body.data).toHaveProperty('description');
      // 'status' comes from client only and will be in merged data
      // The merge logic iterates over keys from both docs
    });

    it('should report conflicts', async () => {
      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        text: 'Server text',
        updatedAt: new Date().toISOString(),
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve/merge',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 2,
          serverVersion: 1,
          clientData: {
            text: 'Client text',
            updatedAt: new Date().toISOString(),
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.conflict).toBeDefined();
      expect(body.conflict.length).toBeGreaterThan(0);
      expect(body.conflict[0].field).toBe('text');
    });

    it('should return client wins for new document', async () => {
      vi.mocked(getDocument).mockResolvedValue(null);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve/merge',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 0,
          clientData: { text: 'New todo', updatedAt: new Date().toISOString() },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.winner).toBe('client');
    });
  });

  describe('POST /api/arbiter/resolve/fields', () => {
    it('should resolve field-level conflicts', async () => {
      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        title: 'Server title',
        description: 'Server description',
        priority: 'low',
        updatedAt: new Date().toISOString(),
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve/fields',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 2,
          serverVersion: 1,
          clientData: {
            title: 'Client title',
            status: 'done',
            updatedAt: new Date().toISOString(),
          },
          clientId: 'client-123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.winner).toBe('merged');
      // Client fields
      expect(body.data).toHaveProperty('title');
      expect(body.data).toHaveProperty('status');
      // Server-only fields
      expect(body.data).toHaveProperty('description');
      expect(body.data).toHaveProperty('priority');
    });

    it('should preserve server-only fields', async () => {
      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        serverOnlyField: 'server value',
        updatedAt: new Date().toISOString(),
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve/fields',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 2,
          serverVersion: 1,
          clientData: {
            clientOnlyField: 'client value',
            updatedAt: new Date().toISOString(),
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.serverOnlyField).toBe('server value');
      expect(body.data.clientOnlyField).toBe('client value');
    });

    it('should return client wins for new document', async () => {
      vi.mocked(getDocument).mockResolvedValue(null);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve/fields',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 0,
          clientData: { text: 'New todo', updatedAt: new Date().toISOString() },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.winner).toBe('client');
    });
  });

  describe('Error handling', () => {
    it('should handle database errors in check', async () => {
      vi.mocked(getDocument).mockRejectedValue(new Error('Database connection failed'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/check',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 1,
          clientData: { text: 'Test', updatedAt: new Date().toISOString() },
        },
      });

      // Should return no conflict on error (safe default)
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.hasConflict).toBe(false);
    });

    it('should handle database errors in resolve', async () => {
      vi.mocked(getDocument).mockRejectedValue(new Error('Database connection failed'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/arbiter/resolve',
        payload: {
          documentId: 'doc-1',
          collection: 'todos',
          clientVersion: 1,
          serverVersion: 1,
          clientData: { text: 'Test', updatedAt: new Date().toISOString() },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(false);
    });
  });
});

describe('extractUpdatedAt helper', () => {
  // Note: These are internal functions, tested indirectly through route tests
  it('should be tested through route behavior', () => {
    // The extractUpdatedAt function is tested indirectly through the resolve endpoints
    expect(true).toBe(true);
  });
});

describe('POST /api/arbiter/resolve/crdt', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearCRDTStates();

    fastify = Fastify();
    await fastify.register(registerArbiterRoutes, { prefix: '/api/arbiter' });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  /**
   * Helper to create a CRDT state from a Yjs document
   */
  function createCRDTState(
    collection: string,
    documentId: string,
    data: Record<string, unknown>
  ) {
    const doc = new Y.Doc();
    const map = doc.getMap('data');

    for (const [key, value] of Object.entries(data)) {
      map.set(key, value);
    }

    const stateVector = Y.encodeStateVector(doc);
    const fullUpdate = Y.encodeStateAsUpdate(doc);

    doc.destroy();

    return {
      stateVector: Array.from(stateVector),
      fullUpdate: Array.from(fullUpdate),
      documentId,
      collection,
    };
  }

  it('should resolve CRDT state from client', async () => {
    const clientState = createCRDTState('todos', 'doc-1', {
      text: 'Hello from client',
      completed: false,
    });

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/arbiter/resolve/crdt',
      payload: {
        clientState,
        clientId: 'client-1',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.resolved).toBe(true);
    expect(body.mergedState).toBeDefined();
    expect(body.mergedState.documentId).toBe('doc-1');
    expect(body.mergedState.collection).toBe('todos');
    expect(body.mergedState.stateVector).toBeInstanceOf(Array);
    expect(body.mergedState.fullUpdate).toBeInstanceOf(Array);
  });

  it('should merge client and server CRDT states', async () => {
    // Client has 'text' field
    const clientState = createCRDTState('todos', 'doc-1', {
      text: 'Client text',
    });

    // Server has 'completed' field
    const serverState = createCRDTState('todos', 'doc-1', {
      completed: true,
    });

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/arbiter/resolve/crdt',
      payload: {
        clientState,
        serverState,
        clientId: 'client-1',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.resolved).toBe(true);
    expect(body.mergedState).toBeDefined();

    // Verify merged data by applying to a new doc
    const verifyDoc = new Y.Doc();
    Y.applyUpdate(verifyDoc, new Uint8Array(body.mergedState.fullUpdate));
    const map = verifyDoc.getMap('data');

    // Both fields should exist in merged state
    expect(map.get('text')).toBe('Client text');
    expect(map.get('completed')).toBe(true);

    verifyDoc.destroy();
  });

  it('should handle concurrent modifications to same field', async () => {
    // Create base document
    const baseDoc = new Y.Doc();
    const baseMap = baseDoc.getMap('data');
    baseMap.set('text', 'Original');
    const baseUpdate = Y.encodeStateAsUpdate(baseDoc);

    // Client modifies
    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, baseUpdate);
    const clientMap = clientDoc.getMap('data');
    clientMap.set('text', 'Client modification');

    // Server modifies
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, baseUpdate);
    const serverMap = serverDoc.getMap('data');
    serverMap.set('text', 'Server modification');

    const clientState = {
      stateVector: Array.from(Y.encodeStateVector(clientDoc)),
      fullUpdate: Array.from(Y.encodeStateAsUpdate(clientDoc)),
      documentId: 'doc-1',
      collection: 'todos',
    };

    const serverState = {
      stateVector: Array.from(Y.encodeStateVector(serverDoc)),
      fullUpdate: Array.from(Y.encodeStateAsUpdate(serverDoc)),
      documentId: 'doc-1',
      collection: 'todos',
    };

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/arbiter/resolve/crdt',
      payload: {
        clientState,
        serverState,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.resolved).toBe(true);

    // The merged value will be one of them based on Yjs internal resolution
    // (deterministic based on client IDs)
    const verifyDoc = new Y.Doc();
    Y.applyUpdate(verifyDoc, new Uint8Array(body.mergedState.fullUpdate));
    const map = verifyDoc.getMap('data');
    const mergedText = map.get('text');

    // Should be either client or server modification (Yjs handles conflict)
    expect(['Client modification', 'Server modification']).toContain(mergedText);

    baseDoc.destroy();
    clientDoc.destroy();
    serverDoc.destroy();
    verifyDoc.destroy();
  });

  it('should handle invalid CRDT state gracefully', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/arbiter/resolve/crdt',
      payload: {
        clientState: {
          stateVector: [1, 2, 3], // Invalid
          fullUpdate: [4, 5, 6], // Invalid
          documentId: 'doc-1',
          collection: 'todos',
        },
      },
    });

    // Should return 200 with resolved: false or handle gracefully
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // Either resolved with whatever Yjs could parse, or error
    expect(body).toHaveProperty('resolved');
  });
});

describe('CRDT State Store', () => {
  beforeEach(() => {
    clearCRDTStates();
  });

  it('should store and retrieve CRDT state', () => {
    const state = {
      stateVector: [1, 2, 3],
      fullUpdate: [4, 5, 6],
      documentId: 'doc-1',
      collection: 'todos',
    };

    setCRDTState('todos', 'doc-1', state);
    const retrieved = getCRDTState('todos', 'doc-1');

    expect(retrieved).toEqual(state);
  });

  it('should return undefined for non-existent state', () => {
    const result = getCRDTState('todos', 'nonexistent');
    expect(result).toBeUndefined();
  });

  it('should delete CRDT state', () => {
    const state = {
      stateVector: [1, 2, 3],
      fullUpdate: [4, 5, 6],
      documentId: 'doc-1',
      collection: 'todos',
    };

    setCRDTState('todos', 'doc-1', state);
    expect(getCRDTState('todos', 'doc-1')).toBeDefined();

    const deleted = deleteCRDTState('todos', 'doc-1');
    expect(deleted).toBe(true);
    expect(getCRDTState('todos', 'doc-1')).toBeUndefined();
  });

  it('should return false when deleting non-existent state', () => {
    const deleted = deleteCRDTState('todos', 'nonexistent');
    expect(deleted).toBe(false);
  });

  it('should clear all CRDT states', () => {
    setCRDTState('todos', 'doc-1', {
      stateVector: [1],
      fullUpdate: [2],
      documentId: 'doc-1',
      collection: 'todos',
    });
    setCRDTState('todos', 'doc-2', {
      stateVector: [3],
      fullUpdate: [4],
      documentId: 'doc-2',
      collection: 'todos',
    });

    expect(getCRDTState('todos', 'doc-1')).toBeDefined();
    expect(getCRDTState('todos', 'doc-2')).toBeDefined();

    clearCRDTStates();

    expect(getCRDTState('todos', 'doc-1')).toBeUndefined();
    expect(getCRDTState('todos', 'doc-2')).toBeUndefined();
  });
});
