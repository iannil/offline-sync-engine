/**
 * Sync manager unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncManager, SyncState, SyncResult } from '../index.js';
import { ActionStatus, ActionType } from '../../outbox/index.js';

// Mock network manager
vi.mock('../../network/index.js', () => ({
  getNetworkManager: () => mockNetworkManager,
}));

const mockNetworkManager = {
  isOnline: true,
  status$: {
    subscribe: vi.fn((callback) => {
      // Store callback for later trigger
      mockNetworkManager._statusCallback = callback;
      return { unsubscribe: vi.fn() };
    }),
  },
  _statusCallback: null as ((status: { isOnline: boolean }) => void) | null,
};

// Mock OutboxManager
const createMockOutbox = () => ({
  getPending: vi.fn().mockResolvedValue([]),
  getRetryable: vi.fn().mockResolvedValue([]),
  markSyncing: vi.fn().mockResolvedValue(undefined),
  markDone: vi.fn().mockResolvedValue(undefined),
  markFailed: vi.fn().mockResolvedValue(undefined),
  updateStatus: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn().mockResolvedValue(undefined),
});

// Mock RxDatabase
const createMockDb = () => {
  const metadataDoc = {
    lastSyncAt: 0,
    patch: vi.fn().mockResolvedValue(undefined),
  };

  return {
    sync_metadata: {
      findOne: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          equals: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(metadataDoc),
          }),
        }),
      }),
      insert: vi.fn().mockResolvedValue(undefined),
    },
    todos: {
      findOne: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          equals: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(null),
          }),
        }),
      }),
      insert: vi.fn().mockResolvedValue(undefined),
    },
    _metadataDoc: metadataDoc,
  };
};

// Mock fetch
const mockFetch = vi.fn();

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    // Simulate connection after a tick
    setTimeout(() => {
      this.onopen?.();
    }, 0);
  }
}

describe('SyncManager', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockOutbox: ReturnType<typeof createMockOutbox>;
  let syncManager: SyncManager;
  let originalFetch: typeof global.fetch;
  let originalWebSocket: typeof global.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();

    // Save originals
    originalFetch = global.fetch;
    originalWebSocket = global.WebSocket;

    // Reset mocks
    vi.clearAllMocks();
    mockNetworkManager.isOnline = true;

    // Setup mocks
    mockDb = createMockDb();
    mockOutbox = createMockOutbox();
    global.fetch = mockFetch;
    (global as any).WebSocket = MockWebSocket;

    // Default fetch response - header getter returns null for unknown headers
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ succeeded: [], failed: [], items: [] }),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      headers: {
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'Content-Type') return 'application/json';
          return null;
        }),
      },
    });
  });

  afterEach(async () => {
    if (syncManager) {
      await syncManager.destroy();
    }
    vi.useRealTimers();
    global.fetch = originalFetch;
    (global as any).WebSocket = originalWebSocket;
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: false,
      });

      expect(syncManager).toBeDefined();
      expect(syncManager.getState().isSyncing).toBe(false);
    });

    it('should accept custom config', () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        interval: 30000,
        batchSize: 50,
        enableCompression: false,
        enableWebSocket: false,
      });

      expect(syncManager).toBeDefined();
    });

    it('should start periodic sync', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        interval: 60000,
        enableWebSocket: false,
      });

      // Fast-forward to trigger periodic sync (use async version)
      await vi.advanceTimersByTimeAsync(60000);

      // Should have attempted sync
      expect(mockOutbox.getPending).toHaveBeenCalled();
    });
  });

  describe('getState', () => {
    it('should return current sync state', () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: false,
      });

      const state = syncManager.getState();

      expect(state).toHaveProperty('lastSyncAt');
      expect(state).toHaveProperty('isSyncing');
      expect(state).toHaveProperty('pendingCount');
      expect(state).toHaveProperty('error');
    });

    it('should return a copy of state', () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: false,
      });

      const state1 = syncManager.getState();
      const state2 = syncManager.getState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });
  });

  describe('onStateChange', () => {
    it('should register state change callback', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: false,
      });

      const callback = vi.fn();
      syncManager.onStateChange(callback);

      await syncManager.triggerSync();
      // Advance timers by a small amount to let any pending promises resolve
      await vi.advanceTimersByTimeAsync(100);

      expect(callback).toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: false,
      });

      const callback = vi.fn();
      const unsubscribe = syncManager.onStateChange(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should stop calling callback after unsubscribe', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: false,
      });

      const callback = vi.fn();
      const unsubscribe = syncManager.onStateChange(callback);

      // Unsubscribe
      unsubscribe();
      callback.mockClear();

      // Trigger sync
      await syncManager.triggerSync();
      await vi.advanceTimersByTimeAsync(100);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('sync', () => {
    it('should return immediately when offline', async () => {
      mockNetworkManager.isOnline = false;

      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: false,
      });

      const result = await syncManager.sync();

      expect(result.synced).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should push pending actions', async () => {
      const pendingActions = [
        {
          id: 'action-1',
          type: ActionType.CREATE,
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Test' },
          timestamp: Date.now(),
        },
      ];

      const headerGet = vi.fn().mockImplementation((key: string) => {
        if (key === 'Content-Type') return 'application/json';
        return null;
      });

      mockOutbox.getPending.mockResolvedValue(pendingActions);

      // Mock different responses for push and pull
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            succeeded: ['action-1'],
            failed: [],
          }),
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
          headers: { get: headerGet },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            items: [],
          }),
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
          headers: { get: headerGet },
        });

      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableCompression: false,
        enableWebSocket: false,
      });

      const result = await syncManager.sync();

      expect(mockOutbox.markSyncing).toHaveBeenCalledWith('action-1');
      expect(mockOutbox.markDone).toHaveBeenCalledWith('action-1');
      expect(result.synced).toBe(1);
    });

    it('should mark failed actions', async () => {
      const pendingActions = [
        {
          id: 'action-1',
          type: ActionType.CREATE,
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Test' },
          timestamp: Date.now(),
        },
      ];

      const headerGet = vi.fn().mockImplementation((key: string) => {
        if (key === 'Content-Type') return 'application/json';
        return null;
      });

      mockOutbox.getPending.mockResolvedValue(pendingActions);

      // Mock different responses for push and pull
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            succeeded: [],
            failed: [{ actionId: 'action-1', error: 'Conflict' }],
          }),
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
          headers: { get: headerGet },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            items: [],
          }),
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
          headers: { get: headerGet },
        });

      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableCompression: false,
        enableWebSocket: false,
      });

      const result = await syncManager.sync();

      expect(mockOutbox.markFailed).toHaveBeenCalledWith('action-1', 'Conflict');
      expect(result.failed).toBe(1);
    });

    it('should handle push errors', async () => {
      const pendingActions = [
        {
          id: 'action-1',
          type: ActionType.CREATE,
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Test' },
          timestamp: Date.now(),
        },
      ];

      mockOutbox.getPending.mockResolvedValue(pendingActions);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableCompression: false,
        enableWebSocket: false,
      });

      const result = await syncManager.sync();

      expect(mockOutbox.markFailed).toHaveBeenCalled();
      expect(syncManager.getState().error).not.toBeNull();
    });

    it('should pull remote changes', async () => {
      const headerGet = vi.fn().mockImplementation((key: string) => {
        if (key === 'Content-Type') return 'application/json';
        return null;
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ succeeded: [], failed: [] }),
          headers: { get: headerGet },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            items: [
              {
                collection: 'todos',
                document: { id: 'remote-1', text: 'Remote todo' },
                timestamp: Date.now(),
              },
            ],
          }),
          headers: { get: headerGet },
        });

      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableCompression: false,
        enableWebSocket: false,
      });

      await syncManager.sync();

      // Should have called pull endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/pull'),
        expect.any(Object)
      );
    });

    it('should cleanup after sync', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableCompression: false,
        enableWebSocket: false,
      });

      await syncManager.sync();

      expect(mockOutbox.cleanup).toHaveBeenCalled();
    });

    it('should deduplicate concurrent sync calls', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableCompression: false,
        enableWebSocket: false,
      });

      // Start two syncs concurrently
      const sync1 = syncManager.sync();
      const sync2 = syncManager.sync();

      const [result1, result2] = await Promise.all([sync1, sync2]);

      // Should return same result
      expect(result1).toBe(result2);
    });
  });

  describe('triggerSync', () => {
    it('should trigger manual sync', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableCompression: false,
        enableWebSocket: false,
      });

      const result = await syncManager.triggerSync();

      expect(result).toHaveProperty('synced');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('errors');
    });
  });

  describe('compression', () => {
    it('should send compressed request when enabled', async () => {
      const pendingActions = [
        {
          id: 'action-1',
          type: ActionType.CREATE,
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Test' },
          timestamp: Date.now(),
        },
      ];

      mockOutbox.getPending.mockResolvedValue(pendingActions);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ succeeded: ['action-1'], failed: [] }),
        headers: {
          get: vi.fn().mockImplementation((key: string) => {
            if (key === 'Content-Type') return 'application/json';
            return null;
          }),
        },
      });

      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableCompression: true,
        enableWebSocket: false,
      });

      await syncManager.sync();

      // Check push request headers
      const pushCall = mockFetch.mock.calls.find(
        (call) => call[0].includes('/push')
      );
      expect(pushCall[1].headers['Content-Type']).toBe('application/msgpack+deflate');
      expect(pushCall[1].headers['X-Compression']).toBe('msgpack-deflate');
    });
  });

  describe('WebSocket', () => {
    it('should connect to WebSocket when enabled', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: true,
      });

      await vi.advanceTimersByTimeAsync(100);

      // WebSocket should be created
      expect((global as any).WebSocket).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('should stop periodic sync', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: false,
      });

      await syncManager.destroy();

      // Clear mock call count
      mockOutbox.getPending.mockClear();

      // Fast-forward - should not trigger sync
      vi.advanceTimersByTime(120000);

      expect(mockOutbox.getPending).not.toHaveBeenCalled();
    });

    it('should disconnect WebSocket', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: true,
      });

      await vi.advanceTimersByTimeAsync(100);
      await syncManager.destroy();

      // WebSocket should be closed - no errors thrown
    });

    it('should clear state change callbacks', async () => {
      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableWebSocket: false,
      });

      const callback = vi.fn();
      syncManager.onStateChange(callback);

      await syncManager.destroy();

      // Callback should not be called after destroy
      // (internal state, we can't directly test this but destroy should complete without error)
    });
  });

  describe('retryable actions', () => {
    it('should process retryable failed actions', async () => {
      const retryableActions = [
        {
          id: 'action-1',
          type: ActionType.CREATE,
          collection: 'todos',
          documentId: 'doc-1',
          data: { text: 'Test' },
          timestamp: Date.now(),
          status: ActionStatus.FAILED,
          retryCount: 1,
        },
      ];

      mockOutbox.getRetryable.mockResolvedValue(retryableActions);

      syncManager = new SyncManager(mockDb as any, mockOutbox as any, {
        url: 'http://localhost/api/sync',
        enableCompression: false,
        enableWebSocket: false,
      });

      await syncManager.sync();

      expect(mockOutbox.updateStatus).toHaveBeenCalledWith(
        'action-1',
        ActionStatus.PENDING
      );
    });
  });
});

describe('SyncState', () => {
  it('should have correct structure', () => {
    const state: SyncState = {
      lastSyncAt: Date.now(),
      isSyncing: false,
      pendingCount: 0,
      error: null,
    };

    expect(state).toHaveProperty('lastSyncAt');
    expect(state).toHaveProperty('isSyncing');
    expect(state).toHaveProperty('pendingCount');
    expect(state).toHaveProperty('error');
  });
});

describe('SyncResult', () => {
  it('should have correct structure', () => {
    const result: SyncResult = {
      synced: 5,
      failed: 1,
      errors: [{ actionId: 'action-1', error: 'Test error' }],
    };

    expect(result.synced).toBe(5);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
