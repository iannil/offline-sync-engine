/**
 * Applier module unit tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyBatchActions, Action, BatchApplyResult } from '../index.js';

// Mock database module
vi.mock('../../database/index.js', () => ({
  getDocument: vi.fn(),
  insertDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  bulkInsert: vi.fn(),
  getDatabaseInfo: vi.fn(),
}));

import {
  getDocument,
  insertDocument,
  updateDocument,
  bulkInsert,
} from '../../database/index.js';

describe('Applier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('applyBatchActions', () => {
    it('should handle CREATE actions', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Test todo' },
          timestamp: Date.now(),
        },
      ];

      vi.mocked(getDocument).mockResolvedValue(null);
      vi.mocked(bulkInsert).mockResolvedValue([{ ok: true, id: 'doc-1', rev: '1-abc' }]);

      const result = await applyBatchActions(actions);

      expect(result.succeeded).toContain('action-1');
      expect(result.failed).toHaveLength(0);
    });

    it('should fail CREATE when document exists', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Test todo' },
          timestamp: Date.now(),
        },
      ];

      vi.mocked(getDocument).mockResolvedValue({ _id: 'doc-1', _rev: '1-abc', text: 'Existing' });

      const result = await applyBatchActions(actions);

      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('Document already exists');
    });

    it('should handle UPDATE actions', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'UPDATE',
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Updated todo' },
          timestamp: Date.now(),
        },
      ];

      vi.mocked(getDocument).mockResolvedValue({ _id: 'doc-1', _rev: '1-abc', text: 'Original' });
      vi.mocked(bulkInsert).mockResolvedValue([{ ok: true, id: 'doc-1', rev: '2-def' }]);

      const result = await applyBatchActions(actions);

      expect(result.succeeded).toContain('action-1');
      expect(result.failed).toHaveLength(0);
    });

    it('should fail UPDATE when document not found', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'UPDATE',
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Updated todo' },
          timestamp: Date.now(),
        },
      ];

      vi.mocked(getDocument).mockResolvedValue(null);

      const result = await applyBatchActions(actions);

      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('Document not found');
    });

    it('should handle DELETE actions (soft delete)', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'DELETE',
          collection: 'todos',
          documentId: 'doc-1',
          data: {},
          timestamp: Date.now(),
        },
      ];

      vi.mocked(getDocument).mockResolvedValue({ _id: 'doc-1', _rev: '1-abc', text: 'To delete' });
      vi.mocked(bulkInsert).mockResolvedValue([{ ok: true, id: 'doc-1', rev: '2-def' }]);

      const result = await applyBatchActions(actions);

      expect(result.succeeded).toContain('action-1');
      expect(result.failed).toHaveLength(0);
    });

    it('should fail DELETE when document not found', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'DELETE',
          collection: 'todos',
          documentId: 'doc-1',
          data: {},
          timestamp: Date.now(),
        },
      ];

      vi.mocked(getDocument).mockResolvedValue(null);

      const result = await applyBatchActions(actions);

      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('Document not found');
    });

    it('should process multiple actions in batch', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Todo 1' },
          timestamp: Date.now(),
        },
        {
          id: 'action-2',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'doc-2',
          data: { text: 'Todo 2' },
          timestamp: Date.now(),
        },
      ];

      vi.mocked(getDocument).mockResolvedValue(null);
      vi.mocked(bulkInsert).mockResolvedValue([
        { ok: true, id: 'doc-1', rev: '1-abc' },
        { ok: true, id: 'doc-2', rev: '1-def' },
      ]);

      const result = await applyBatchActions(actions);

      expect(result.succeeded).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it('should group actions by collection', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Todo 1' },
          timestamp: Date.now(),
        },
        {
          id: 'action-2',
          type: 'CREATE',
          collection: 'products',
          documentId: 'doc-2',
          data: { name: 'Product 1' },
          timestamp: Date.now(),
        },
      ];

      vi.mocked(getDocument).mockResolvedValue(null);
      vi.mocked(bulkInsert)
        .mockResolvedValueOnce([{ ok: true, id: 'doc-1', rev: '1-abc' }])
        .mockResolvedValueOnce([{ ok: true, id: 'doc-2', rev: '1-def' }]);

      const result = await applyBatchActions(actions);

      expect(bulkInsert).toHaveBeenCalledTimes(2);
      expect(result.succeeded).toHaveLength(2);
    });

    it('should handle bulk operation failures', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Todo 1' },
          timestamp: Date.now(),
        },
      ];

      vi.mocked(getDocument).mockResolvedValue(null);
      vi.mocked(bulkInsert).mockResolvedValue([
        { ok: false, id: 'doc-1', error: 'Conflict' },
      ]);

      const result = await applyBatchActions(actions);

      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('Conflict');
    });

    it('should return empty results for empty actions', async () => {
      const result = await applyBatchActions([]);

      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should handle mixed success and failure', async () => {
      const actions: Action[] = [
        {
          id: 'action-1',
          type: 'CREATE',
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Todo 1' },
          timestamp: Date.now(),
        },
        {
          id: 'action-2',
          type: 'UPDATE',
          collection: 'todos',
          documentId: 'doc-2',
          data: { text: 'Updated' },
          timestamp: Date.now(),
        },
      ];

      // First call for CREATE check - not exists
      // Second call for UPDATE check - not exists (will fail)
      vi.mocked(getDocument)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      vi.mocked(bulkInsert).mockResolvedValue([{ ok: true, id: 'doc-1', rev: '1-abc' }]);

      const result = await applyBatchActions(actions);

      expect(result.succeeded).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].actionId).toBe('action-2');
    });
  });

  describe('Action interface', () => {
    it('should have correct structure', () => {
      const action: Action = {
        id: 'action-1',
        type: 'CREATE',
        collection: 'todos',
        documentId: 'doc-1',
        data: { text: 'Test' },
        timestamp: Date.now(),
      };

      expect(action).toHaveProperty('id');
      expect(action).toHaveProperty('type');
      expect(action).toHaveProperty('collection');
      expect(action).toHaveProperty('documentId');
      expect(action).toHaveProperty('data');
      expect(action).toHaveProperty('timestamp');
    });

    it('should support all action types', () => {
      const types: Array<'CREATE' | 'UPDATE' | 'DELETE'> = ['CREATE', 'UPDATE', 'DELETE'];

      types.forEach((type) => {
        const action: Action = {
          id: 'action-1',
          type,
          collection: 'todos',
          documentId: 'doc-1',
          data: {},
          timestamp: Date.now(),
        };
        expect(action.type).toBe(type);
      });
    });
  });

  describe('BatchApplyResult interface', () => {
    it('should have correct structure', () => {
      const result: BatchApplyResult = {
        succeeded: ['action-1', 'action-2'],
        failed: [{ actionId: 'action-3', error: 'Test error' }],
      };

      expect(result).toHaveProperty('succeeded');
      expect(result).toHaveProperty('failed');
      expect(Array.isArray(result.succeeded)).toBe(true);
      expect(Array.isArray(result.failed)).toBe(true);
    });
  });
});
