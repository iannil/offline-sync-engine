/**
 * Integration tests for Gateway sync endpoints (push/pull)
 *
 * Tests the complete HTTP sync flow:
 * 1. Client pushes actions to /api/sync/push
 * 2. Client pulls changes via /api/sync/pull
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Import server gateway module
import { registerGatewayRoutes } from '../../packages/server/src/gateway/index.js';

// Mock database module
vi.mock('../../packages/server/src/database/index.js', () => ({
  getDocument: vi.fn(),
  insertDocument: vi.fn(),
  updateDocument: vi.fn(),
  bulkInsert: vi.fn(),
  getDatabaseInfo: vi.fn(),
  queryDocuments: vi.fn(),
  getChanges: vi.fn(),
  initCouchDB: vi.fn().mockResolvedValue(undefined),
}));

import * as db from '../../packages/server/src/database/index.js';

describe('Gateway Sync Integration', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup server
    server = Fastify();
    await server.register(registerGatewayRoutes, { prefix: '/api/sync' });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('Push Endpoint', () => {
    it('should accept and process actions via /push', async () => {
      // Mock database operations
      vi.mocked(db.getDocument).mockResolvedValue(null);
      vi.mocked(db.insertDocument).mockResolvedValue({ id: 'todo-1', rev: '1-abc' });

      const actions = [
        {
          id: 'action-1',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'todo-1',
          data: { text: 'Buy groceries', completed: false },
          timestamp: Date.now(),
        },
      ];

      const response = await server.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: { actions },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.succeeded).toContain('action-1');
      expect(body.failed).toEqual([]);
    });

    it('should handle UPDATE actions', async () => {
      // Mock existing document
      vi.mocked(db.getDocument).mockResolvedValue({
        _id: 'todo-1',
        _rev: '1-abc',
        text: 'Old text',
        completed: false,
      });
      vi.mocked(db.updateDocument).mockResolvedValue({ id: 'todo-1', rev: '2-def' });

      const actions = [
        {
          id: 'action-2',
          type: 'UPDATE',
          collection: 'todos',
          documentId: 'todo-1',
          data: { text: 'Updated text', completed: true },
          timestamp: Date.now(),
        },
      ];

      const response = await server.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: { actions },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.succeeded).toContain('action-2');
    });

    it('should handle DELETE actions', async () => {
      // Mock existing document
      vi.mocked(db.getDocument).mockResolvedValue({
        _id: 'todo-1',
        _rev: '1-abc',
        text: 'To delete',
      });
      vi.mocked(db.updateDocument).mockResolvedValue({ id: 'todo-1', rev: '2-deleted' });

      const actions = [
        {
          id: 'action-3',
          type: 'DELETE',
          collection: 'todos',
          documentId: 'todo-1',
          data: {},
          timestamp: Date.now(),
        },
      ];

      const response = await server.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: { actions },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.succeeded).toContain('action-3');
    });

    it('should handle batch actions', async () => {
      vi.mocked(db.getDocument).mockResolvedValue(null);
      vi.mocked(db.insertDocument).mockImplementation(async (_coll, doc) => ({
        id: doc._id,
        rev: '1-new',
      }));

      const actions = [
        {
          id: 'batch-1',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'todo-batch-1',
          data: { text: 'Batch todo 1' },
          timestamp: Date.now(),
        },
        {
          id: 'batch-2',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'todo-batch-2',
          data: { text: 'Batch todo 2' },
          timestamp: Date.now(),
        },
        {
          id: 'batch-3',
          type: 'CREATE',
          collection: 'products',
          documentId: 'prod-1',
          data: { name: 'Product 1' },
          timestamp: Date.now(),
        },
      ];

      const response = await server.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: { actions },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.succeeded.length).toBeGreaterThanOrEqual(3);
    });

    it('should fail action when document already exists for CREATE', async () => {
      // Mock existing document
      vi.mocked(db.getDocument).mockResolvedValue({
        _id: 'existing-1',
        _rev: '1-abc',
        text: 'Existing',
      });

      const actions = [
        {
          id: 'action-fail',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'existing-1',
          data: { text: 'New' },
          timestamp: Date.now(),
        },
      ];

      const response = await server.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: { actions },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.failed.length).toBeGreaterThan(0);
      expect(body.failed[0].error).toContain('already exists');
    });
  });

  describe('Pull Endpoint', () => {
    it('should return changes since timestamp via /pull', async () => {
      const since = Date.now() - 60000; // 1 minute ago

      // Mock getChanges response (CouchDB _changes format)
      vi.mocked(db.getChanges).mockResolvedValue([
        {
          seq: '1-abc',
          id: 'todo-1',
          changes: [{ rev: '1-abc' }],
          deleted: false,
          doc: {
            _id: 'todo-1',
            _rev: '1-abc',
            text: 'Recent todo',
            updatedAt: new Date().toISOString(),
          },
        },
      ]);

      const response = await server.inject({
        method: 'GET',
        url: `/api/sync/pull?since=${since}&collection=todos`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBe(1);
      expect(body.items[0].document.text).toBe('Recent todo');
    });

    it('should return empty array when no changes', async () => {
      vi.mocked(db.getChanges).mockResolvedValue([]);

      const response = await server.inject({
        method: 'GET',
        url: `/api/sync/pull?since=${Date.now()}&collection=todos`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toEqual([]);
    });
  });

  describe('Compression Support', () => {
    it('should accept JSON content type', async () => {
      vi.mocked(db.getDocument).mockResolvedValue(null);
      vi.mocked(db.insertDocument).mockResolvedValue({ id: 'json-1', rev: '1-abc' });

      const payload = {
        actions: [
          {
            id: 'json-action-1',
            type: 'CREATE',
            collection: 'todos',
            documentId: 'json-1',
            data: { text: 'JSON todo' },
            timestamp: Date.now(),
          },
        ],
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.succeeded).toContain('json-action-1');
    });

    it('should return JSON response by default', async () => {
      vi.mocked(db.getChanges).mockResolvedValue([
        {
          seq: '1-abc',
          id: 'todo-json',
          changes: [{ rev: '1-abc' }],
          deleted: false,
          doc: {
            _id: 'todo-json',
            _rev: '1-abc',
            text: 'Response todo',
            updatedAt: new Date().toISOString(),
          },
        },
      ]);

      const response = await server.inject({
        method: 'GET',
        url: `/api/sync/pull?since=0&collection=todos`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle empty actions array', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: { actions: [] },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.succeeded).toEqual([]);
      expect(body.failed).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(db.getDocument).mockRejectedValue(new Error('Database connection failed'));

      const actions = [
        {
          id: 'action-db-error',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'todo-error',
          data: { text: 'Will fail' },
          timestamp: Date.now(),
        },
      ];

      const response = await server.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: { actions },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.failed.length).toBeGreaterThan(0);
    });
  });

  describe('Sync Flow Simulation', () => {
    it('should simulate complete sync cycle: push then pull', async () => {
      // Step 1: Client pushes new action
      vi.mocked(db.getDocument).mockResolvedValue(null);
      vi.mocked(db.insertDocument).mockResolvedValue({ id: 'sync-todo-1', rev: '1-abc' });

      const pushResponse = await server.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          actions: [
            {
              id: 'sync-action-1',
              type: 'CREATE',
              collection: 'todos',
              documentId: 'sync-todo-1',
              data: { text: 'Synced todo', completed: false },
              timestamp: Date.now(),
            },
          ],
        },
      });

      expect(pushResponse.statusCode).toBe(200);
      const pushBody = JSON.parse(pushResponse.body);
      expect(pushBody.succeeded).toContain('sync-action-1');

      // Step 2: Another client pulls changes
      vi.mocked(db.getChanges).mockResolvedValue([
        {
          seq: '1-abc',
          id: 'sync-todo-1',
          changes: [{ rev: '1-abc' }],
          deleted: false,
          doc: {
            _id: 'sync-todo-1',
            _rev: '1-abc',
            text: 'Synced todo',
            completed: false,
            updatedAt: new Date().toISOString(),
          },
        },
      ]);

      const pullResponse = await server.inject({
        method: 'GET',
        url: '/api/sync/pull?since=0&collection=todos',
      });

      expect(pullResponse.statusCode).toBe(200);
      const pullBody = JSON.parse(pullResponse.body);
      expect(pullBody.items.length).toBeGreaterThan(0);
      expect(pullBody.items[0].document.text).toBe('Synced todo');
    });
  });
});
