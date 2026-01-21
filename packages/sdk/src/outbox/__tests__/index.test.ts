/**
 * Outbox module unit tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OutboxManager,
  ActionType,
  ActionStatus,
} from '../index.js';

// Create a mock RxCollection
const createMockCollection = () => {
  const documents: Map<string, any> = new Map();

  const createDocument = (data: any) => ({
    toJSON: () => data,
    get: (key: string) => data[key],
    patch: vi.fn().mockImplementation(async (updates: any) => {
      const existing = documents.get(data.id);
      if (existing) {
        Object.assign(existing, updates);
        documents.set(data.id, existing);
      }
    }),
    remove: vi.fn().mockImplementation(async () => {
      documents.delete(data.id);
    }),
  });

  return {
    insert: vi.fn().mockImplementation(async (data: any) => {
      documents.set(data.id, data);
      return createDocument(data);
    }),
    find: vi.fn().mockImplementation((query?: any) => ({
      where: (field: string) => ({
        equals: (value: any) => ({
          exec: vi.fn().mockImplementation(async () => {
            return Array.from(documents.values())
              .filter((doc) => doc[field] === value)
              .map(createDocument);
          }),
        }),
      }),
      limit: (n: number) => ({
        exec: vi.fn().mockImplementation(async () => {
          let results = Array.from(documents.values());
          if (query?.selector) {
            results = results.filter((doc) => {
              for (const [key, val] of Object.entries(query.selector)) {
                if (typeof val === 'object' && val !== null) {
                  // Handle $lt operator
                  if ('$lt' in val && doc[key] >= (val as any).$lt) {
                    return false;
                  }
                } else if (doc[key] !== val) {
                  return false;
                }
              }
              return true;
            });
          }
          if (query?.sort) {
            const sortField = Object.keys(query.sort[0])[0];
            const sortDir = query.sort[0][sortField];
            results.sort((a, b) => {
              if (sortDir === 'asc') return a[sortField] - b[sortField];
              return b[sortField] - a[sortField];
            });
          }
          return results.slice(0, n).map(createDocument);
        }),
      }),
      exec: vi.fn().mockImplementation(async () => {
        let results = Array.from(documents.values());
        if (query?.selector) {
          results = results.filter((doc) => {
            for (const [key, val] of Object.entries(query.selector)) {
              if (typeof val === 'object' && val !== null) {
                if ('$lt' in val && doc[key] >= (val as any).$lt) {
                  return false;
                }
              } else if (doc[key] !== val) {
                return false;
              }
            }
            return true;
          });
        }
        if (query?.sort) {
          const sortField = Object.keys(query.sort[0])[0];
          const sortDir = query.sort[0][sortField];
          results.sort((a, b) => {
            if (sortDir === 'asc') return a[sortField] - b[sortField];
            return b[sortField] - a[sortField];
          });
        }
        return results.map(createDocument);
      }),
    })),
    findOne: vi.fn().mockImplementation(() => ({
      where: (field: string) => ({
        equals: (value: any) => ({
          exec: vi.fn().mockImplementation(async () => {
            const doc = Array.from(documents.values()).find(
              (d) => d[field] === value
            );
            return doc ? createDocument(doc) : null;
          }),
        }),
      }),
    })),
    remove: vi.fn().mockImplementation(async () => {
      documents.clear();
    }),
    $: {
      pipe: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
    },
    _documents: documents,
  };
};

describe('OutboxManager', () => {
  let mockCollection: ReturnType<typeof createMockCollection>;
  let outboxManager: OutboxManager;

  beforeEach(() => {
    mockCollection = createMockCollection();
    outboxManager = new OutboxManager(mockCollection as any);
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(outboxManager).toBeDefined();
    });

    it('should accept custom config', () => {
      const customManager = new OutboxManager(mockCollection as any, {
        maxRetries: 10,
        retryDelay: 2000,
      });
      expect(customManager).toBeDefined();
    });
  });

  describe('enqueue', () => {
    it('should enqueue a CREATE action', async () => {
      const result = await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        'todo-1',
        { text: 'Test todo' }
      );

      expect(result.actionId).toBeDefined();
      expect(result.enqueuedAt).toBeDefined();
      expect(mockCollection.insert).toHaveBeenCalledTimes(1);
    });

    it('should enqueue an UPDATE action', async () => {
      const result = await outboxManager.enqueue(
        ActionType.UPDATE,
        'todos',
        'todo-1',
        { text: 'Updated todo' }
      );

      expect(result.actionId).toBeDefined();
      expect(mockCollection.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ActionType.UPDATE,
          collection: 'todos',
          documentId: 'todo-1',
          status: ActionStatus.PENDING,
        })
      );
    });

    it('should enqueue a DELETE action', async () => {
      const result = await outboxManager.enqueue(
        ActionType.DELETE,
        'todos',
        'todo-1'
      );

      expect(result.actionId).toBeDefined();
      expect(mockCollection.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ActionType.DELETE,
          collection: 'todos',
          documentId: 'todo-1',
        })
      );
    });

    it('should generate unique action IDs', async () => {
      const result1 = await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        'todo-1',
        { text: 'Test 1' }
      );
      const result2 = await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        'todo-2',
        { text: 'Test 2' }
      );

      expect(result1.actionId).not.toBe(result2.actionId);
    });

    it('should set initial retryCount to 0', async () => {
      await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        'todo-1',
        { text: 'Test' }
      );

      expect(mockCollection.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          retryCount: 0,
        })
      );
    });
  });

  describe('getPending', () => {
    it('should return pending actions', async () => {
      await outboxManager.enqueue(ActionType.CREATE, 'todos', 'todo-1', { text: 'Test' });

      const pending = await outboxManager.getPending();

      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe(ActionStatus.PENDING);
    });

    it('should respect limit parameter', async () => {
      await outboxManager.enqueue(ActionType.CREATE, 'todos', 'todo-1', {});
      await outboxManager.enqueue(ActionType.CREATE, 'todos', 'todo-2', {});
      await outboxManager.enqueue(ActionType.CREATE, 'todos', 'todo-3', {});

      const pending = await outboxManager.getPending(2);

      expect(pending.length).toBe(2);
    });
  });

  describe('getByStatus', () => {
    it('should return actions with specific status', async () => {
      await outboxManager.enqueue(ActionType.CREATE, 'todos', 'todo-1', {});

      const pending = await outboxManager.getByStatus(ActionStatus.PENDING);

      expect(pending.length).toBe(1);
    });
  });

  describe('updateStatus', () => {
    it('should update action status', async () => {
      const result = await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        'todo-1',
        {}
      );

      await outboxManager.updateStatus(result.actionId, ActionStatus.SYNCING);

      const doc = mockCollection._documents.get(result.actionId);
      expect(doc.status).toBe(ActionStatus.SYNCING);
    });

    it('should increment retryCount on FAILED status', async () => {
      const result = await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        'todo-1',
        {}
      );

      await outboxManager.updateStatus(result.actionId, ActionStatus.FAILED, 'Network error');

      const doc = mockCollection._documents.get(result.actionId);
      expect(doc.retryCount).toBe(1);
    });
  });

  describe('markSyncing', () => {
    it('should mark action as syncing', async () => {
      const result = await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        'todo-1',
        {}
      );

      await outboxManager.markSyncing(result.actionId);

      const doc = mockCollection._documents.get(result.actionId);
      expect(doc.status).toBe(ActionStatus.SYNCING);
    });
  });

  describe('markDone', () => {
    it('should mark action as done', async () => {
      const result = await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        'todo-1',
        {}
      );

      await outboxManager.markDone(result.actionId);

      const doc = mockCollection._documents.get(result.actionId);
      expect(doc.status).toBe(ActionStatus.DONE);
    });
  });

  describe('markFailed', () => {
    it('should mark action as failed with error', async () => {
      const result = await outboxManager.enqueue(
        ActionType.CREATE,
        'todos',
        'todo-1',
        {}
      );

      await outboxManager.markFailed(result.actionId, 'Connection timeout');

      const doc = mockCollection._documents.get(result.actionId);
      expect(doc.status).toBe(ActionStatus.FAILED);
      expect(doc.error).toBe('Connection timeout');
    });
  });

  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff', () => {
      const delay0 = outboxManager.calculateRetryDelay(0);
      const delay1 = outboxManager.calculateRetryDelay(1);
      const delay2 = outboxManager.calculateRetryDelay(2);

      expect(delay0).toBe(1000); // 1000 * 2^0
      expect(delay1).toBe(2000); // 1000 * 2^1
      expect(delay2).toBe(4000); // 1000 * 2^2
    });

    it('should cap delay at maxRetryDelay', () => {
      const delay10 = outboxManager.calculateRetryDelay(10);

      expect(delay10).toBe(60000); // maxRetryDelay
    });

    it('should respect custom config', () => {
      const customManager = new OutboxManager(mockCollection as any, {
        retryDelay: 500,
        retryBackoffMultiplier: 3,
        maxRetryDelay: 10000,
      });

      const delay0 = customManager.calculateRetryDelay(0);
      const delay1 = customManager.calculateRetryDelay(1);

      expect(delay0).toBe(500);  // 500 * 3^0
      expect(delay1).toBe(1500); // 500 * 3^1
    });
  });

  describe('getCountByStatus', () => {
    it('should return count for each status', async () => {
      await outboxManager.enqueue(ActionType.CREATE, 'todos', 'todo-1', {});
      await outboxManager.enqueue(ActionType.CREATE, 'todos', 'todo-2', {});

      const counts = await outboxManager.getCountByStatus();

      expect(counts[ActionStatus.PENDING]).toBe(2);
      expect(counts[ActionStatus.SYNCING]).toBe(0);
      expect(counts[ActionStatus.DONE]).toBe(0);
      expect(counts[ActionStatus.FAILED]).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all actions', async () => {
      await outboxManager.enqueue(ActionType.CREATE, 'todos', 'todo-1', {});
      await outboxManager.enqueue(ActionType.CREATE, 'todos', 'todo-2', {});

      await outboxManager.clear();

      expect(mockCollection.remove).toHaveBeenCalled();
      expect(mockCollection._documents.size).toBe(0);
    });
  });
});

describe('ActionType', () => {
  it('should have correct values', () => {
    expect(ActionType.CREATE).toBe('CREATE');
    expect(ActionType.UPDATE).toBe('UPDATE');
    expect(ActionType.DELETE).toBe('DELETE');
  });
});

describe('ActionStatus', () => {
  it('should have correct values', () => {
    expect(ActionStatus.PENDING).toBe('pending');
    expect(ActionStatus.SYNCING).toBe('syncing');
    expect(ActionStatus.DONE).toBe('done');
    expect(ActionStatus.FAILED).toBe('failed');
  });
});
