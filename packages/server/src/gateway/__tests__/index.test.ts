/**
 * Gateway module unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerGatewayRoutes, broadcastChange } from '../index.js';

// Mock applier module
vi.mock('../../applier/index.js', () => ({
  applyBatchActions: vi.fn(),
}));

// Mock database module
vi.mock('../../database/index.js', () => ({
  getDocument: vi.fn(),
  getChanges: vi.fn(),
  queryDocuments: vi.fn(),
}));

import { applyBatchActions } from '../../applier/index.js';
import { getDocument, getChanges, queryDocuments } from '../../database/index.js';

describe('Gateway', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create Fastify instance
    fastify = Fastify();

    // Register routes
    await fastify.register(registerGatewayRoutes, { prefix: '/api/sync' });

    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('POST /api/sync/push', () => {
    it('should accept and apply actions', async () => {
      vi.mocked(applyBatchActions).mockResolvedValue({
        succeeded: ['action-1'],
        failed: [],
      });
      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        text: 'Test todo',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          actions: [
            {
              id: 'action-1',
              type: 'CREATE',
              collection: 'todos',
              documentId: 'doc-1',
              data: { text: 'Test todo' },
              timestamp: Date.now(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.succeeded).toContain('action-1');
      expect(body.failed).toHaveLength(0);
    });

    it('should return failed actions', async () => {
      vi.mocked(applyBatchActions).mockResolvedValue({
        succeeded: [],
        failed: [{ actionId: 'action-1', error: 'Document already exists' }],
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          actions: [
            {
              id: 'action-1',
              type: 'CREATE',
              collection: 'todos',
              documentId: 'doc-1',
              data: { text: 'Test todo' },
              timestamp: Date.now(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.succeeded).toHaveLength(0);
      expect(body.failed).toHaveLength(1);
      expect(body.failed[0].error).toBe('Document already exists');
    });

    it('should handle empty actions', async () => {
      vi.mocked(applyBatchActions).mockResolvedValue({
        succeeded: [],
        failed: [],
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          actions: [],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.succeeded).toHaveLength(0);
      expect(body.failed).toHaveLength(0);
    });

    it('should handle applyBatchActions errors', async () => {
      vi.mocked(applyBatchActions).mockRejectedValue(new Error('Database error'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          actions: [
            {
              id: 'action-1',
              type: 'CREATE',
              collection: 'todos',
              documentId: 'doc-1',
              data: { text: 'Test' },
              timestamp: Date.now(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.failed).toHaveLength(1);
      expect(body.failed[0].error).toBe('Database error');
    });
  });

  describe('GET /api/sync/pull', () => {
    it('should return changes since timestamp', async () => {
      vi.mocked(getChanges).mockResolvedValue([
        {
          seq: '1-abc',
          id: 'doc-1',
          deleted: false,
          doc: {
            _id: 'doc-1',
            _rev: '1-abc',
            text: 'Test todo',
            updatedAt: new Date().toISOString(),
          },
        },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/pull?since=0',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].document.text).toBe('Test todo');
      expect(body.since).toBe('1-abc');
    });

    it('should respect limit parameter', async () => {
      vi.mocked(getChanges).mockResolvedValue([
        {
          seq: '1-abc',
          id: 'doc-1',
          deleted: false,
          doc: {
            _id: 'doc-1',
            _rev: '1-abc',
            text: 'Test 1',
            updatedAt: new Date().toISOString(),
          },
        },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/pull?since=0&limit=10',
      });

      expect(response.statusCode).toBe(200);
      expect(getChanges).toHaveBeenCalledWith('todos', '0', 10);
    });

    it('should filter deleted documents', async () => {
      vi.mocked(getChanges).mockResolvedValue([
        {
          seq: '1-abc',
          id: 'doc-1',
          deleted: true,
          doc: null,
        },
        {
          seq: '2-def',
          id: 'doc-2',
          deleted: false,
          doc: {
            _id: 'doc-2',
            _rev: '1-ghi',
            text: 'Active todo',
            updatedAt: new Date().toISOString(),
          },
        },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/pull?since=0',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].document.text).toBe('Active todo');
    });

    it('should indicate hasMore when limit is reached', async () => {
      const changes = Array.from({ length: 100 }, (_, i) => ({
        seq: `${i + 1}-abc`,
        id: `doc-${i}`,
        deleted: false,
        doc: {
          _id: `doc-${i}`,
          _rev: '1-abc',
          text: `Todo ${i}`,
          updatedAt: new Date().toISOString(),
        },
      }));

      vi.mocked(getChanges).mockResolvedValue(changes);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/pull?since=0&limit=100',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.hasMore).toBe(true);
    });

    it('should handle database errors', async () => {
      vi.mocked(getChanges).mockRejectedValue(new Error('Database error'));

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/pull?since=0',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database error');
      expect(body.items).toHaveLength(0);
    });
  });

  describe('GET /api/sync/status', () => {
    it('should return sync status', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body).toHaveProperty('pendingChanges');
      expect(body).toHaveProperty('connectedClients');
    });
  });

  describe('GET /api/sync/:collection', () => {
    it('should return all documents in collection', async () => {
      vi.mocked(queryDocuments).mockResolvedValue([
        { _id: 'doc-1', _rev: '1-abc', text: 'Todo 1' },
        { _id: 'doc-2', _rev: '1-def', text: 'Todo 2' },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/todos',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.collection).toBe('todos');
      expect(body.documents).toHaveLength(2);
      expect(body.count).toBe(2);
    });

    it('should filter out deleted documents', async () => {
      vi.mocked(queryDocuments).mockResolvedValue([
        { _id: 'doc-1', _rev: '1-abc', text: 'Active todo' },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/todos',
      });

      expect(response.statusCode).toBe(200);
      expect(queryDocuments).toHaveBeenCalledWith('todos', {
        deleted: { $ne: true },
      });
    });

    it('should handle database errors', async () => {
      vi.mocked(queryDocuments).mockRejectedValue(new Error('Database error'));

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/todos',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database error');
      expect(body.documents).toHaveLength(0);
      expect(body.count).toBe(0);
    });
  });

  describe('GET /api/sync/:collection/:id', () => {
    it('should return specific document', async () => {
      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        text: 'Test todo',
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/todos/doc-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body._id).toBe('doc-1');
      expect(body.text).toBe('Test todo');
    });

    it('should return 404 for non-existent document', async () => {
      vi.mocked(getDocument).mockResolvedValue(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/todos/non-existent',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Document not found');
    });

    it('should return 404 for soft-deleted document', async () => {
      vi.mocked(getDocument).mockResolvedValue({
        _id: 'doc-1',
        _rev: '1-abc',
        text: 'Deleted todo',
        deleted: true,
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/todos/doc-1',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Document not found');
    });

    it('should handle database errors', async () => {
      vi.mocked(getDocument).mockRejectedValue(new Error('Database error'));

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sync/todos/doc-1',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database error');
    });
  });
});

describe('broadcastChange', () => {
  it('should not throw when no subscribers', async () => {
    await expect(
      broadcastChange({
        collection: 'todos',
        documentId: 'doc-1',
        document: { text: 'Test' },
        timestamp: Date.now(),
        seq: '1-abc',
      })
    ).resolves.not.toThrow();
  });
});
