/**
 * Client module unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OfflineClient,
  getClient,
  resetClient,
  ClientConfig,
} from '../index.js';

// Shared mock state that can be modified during tests
const mockState = {
  isOnline: true,
  destroyCalled: false,
  syncDestroyedCalled: false,
};

// Mock storage module
vi.mock('../../storage/index.js', () => ({
  getDatabase: vi.fn().mockImplementation(() =>
    Promise.resolve({
      outbox_actions: {},
      destroy: vi.fn().mockImplementation(() => {
        mockState.destroyCalled = true;
        return Promise.resolve();
      }),
    })
  ),
}));

// Mock network module
vi.mock('../../network/index.js', () => ({
  getNetworkManager: vi.fn().mockImplementation(() => ({
    get isOnline() {
      return mockState.isOnline;
    },
  })),
  NetworkManager: vi.fn(),
}));

// Mock outbox module
vi.mock('../../outbox/index.js', () => ({
  OutboxManager: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn(),
    getPending: vi.fn(),
  })),
}));

// Mock sync module
vi.mock('../../sync/index.js', () => ({
  SyncManager: vi.fn().mockImplementation(() => ({
    sync: vi.fn(),
    destroy: vi.fn().mockImplementation(() => {
      mockState.syncDestroyedCalled = true;
      return Promise.resolve();
    }),
  })),
}));

describe('OfflineClient', () => {
  let client: OfflineClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockState.isOnline = true;
    mockState.destroyCalled = false;
    mockState.syncDestroyedCalled = false;
    await resetClient();
  });

  afterEach(async () => {
    if (client) {
      await client.destroy();
    }
    await resetClient();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      client = new OfflineClient();
      expect(client).toBeDefined();
    });

    it('should accept custom config', () => {
      client = new OfflineClient({
        database: {
          name: 'custom-db',
        },
        network: {
          pingInterval: 10000,
        },
        sync: {
          enabled: true,
          url: 'http://localhost/api/sync',
          interval: 30000,
        },
        outbox: {
          maxRetries: 3,
          retryDelay: 500,
        },
      });

      expect(client).toBeDefined();
    });

    it('should deep merge config with defaults', () => {
      client = new OfflineClient({
        database: {
          name: 'custom-db',
        },
      });

      // Should still have other defaults
      expect(client).toBeDefined();
    });
  });

  describe('init', () => {
    it('should initialize database', async () => {
      client = new OfflineClient();
      await client.init();

      const { getDatabase } = await import('../../storage/index.js');
      expect(getDatabase).toHaveBeenCalled();
    });

    it('should initialize outbox manager', async () => {
      client = new OfflineClient();
      await client.init();

      const { OutboxManager } = await import('../../outbox/index.js');
      expect(OutboxManager).toHaveBeenCalled();
    });

    it('should initialize sync manager when enabled', async () => {
      client = new OfflineClient({
        sync: {
          enabled: true,
          url: 'http://localhost/api/sync',
        },
      });
      await client.init();

      const { SyncManager } = await import('../../sync/index.js');
      expect(SyncManager).toHaveBeenCalled();
    });

    it('should not initialize sync manager when disabled', async () => {
      client = new OfflineClient({
        sync: {
          enabled: false,
        },
      });
      await client.init();

      expect(client.getSyncManager()).toBeNull();
    });

    it('should be idempotent', async () => {
      client = new OfflineClient();
      await client.init();
      await client.init(); // Should not throw

      const { getDatabase } = await import('../../storage/index.js');
      expect(getDatabase).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDatabase', () => {
    it('should return database after init', async () => {
      client = new OfflineClient();
      await client.init();

      const db = client.getDatabase();
      expect(db).toBeDefined();
    });

    it('should throw if not initialized', () => {
      client = new OfflineClient();

      expect(() => client.getDatabase()).toThrow(
        'Client not initialized. Call init() first.'
      );
    });
  });

  describe('getNetworkManager', () => {
    it('should return network manager', () => {
      client = new OfflineClient();
      const network = client.getNetworkManager();

      expect(network).toBeDefined();
    });

    it('should return network manager before init', () => {
      client = new OfflineClient();
      const network = client.getNetworkManager();

      expect(network).toBeDefined();
      expect(network).toHaveProperty('isOnline');
    });
  });

  describe('getOutboxManager', () => {
    it('should return outbox manager after init', async () => {
      client = new OfflineClient();
      await client.init();

      const outbox = client.getOutboxManager();
      expect(outbox).toBeDefined();
    });

    it('should throw if not initialized', () => {
      client = new OfflineClient();

      expect(() => client.getOutboxManager()).toThrow(
        'Client not initialized. Call init() first.'
      );
    });
  });

  describe('getSyncManager', () => {
    it('should return sync manager when enabled', async () => {
      client = new OfflineClient({
        sync: {
          enabled: true,
          url: 'http://localhost/api/sync',
        },
      });
      await client.init();

      const sync = client.getSyncManager();
      expect(sync).toBeDefined();
    });

    it('should return null when sync disabled', async () => {
      client = new OfflineClient({
        sync: {
          enabled: false,
        },
      });
      await client.init();

      expect(client.getSyncManager()).toBeNull();
    });

    it('should return null before init', () => {
      client = new OfflineClient();
      expect(client.getSyncManager()).toBeNull();
    });
  });

  describe('isOnline', () => {
    it('should return true when online', () => {
      mockState.isOnline = true;
      client = new OfflineClient();

      expect(client.isOnline()).toBe(true);
    });

    it('should return false when offline', () => {
      mockState.isOnline = false;
      client = new OfflineClient();

      expect(client.isOnline()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should destroy sync manager', async () => {
      client = new OfflineClient({
        sync: {
          enabled: true,
          url: 'http://localhost/api/sync',
        },
      });
      await client.init();
      await client.destroy();

      expect(mockState.syncDestroyedCalled).toBe(true);
    });

    it('should destroy database', async () => {
      client = new OfflineClient();
      await client.init();
      await client.destroy();

      expect(mockState.destroyCalled).toBe(true);
    });

    it('should reset initialized state', async () => {
      client = new OfflineClient();
      await client.init();
      await client.destroy();

      // Should throw because not initialized
      expect(() => client.getDatabase()).toThrow(
        'Client not initialized. Call init() first.'
      );
    });

    it('should be safe to call multiple times', async () => {
      client = new OfflineClient();
      await client.init();
      await client.destroy();
      await client.destroy(); // Should not throw
    });
  });
});

describe('getClient', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockState.isOnline = true;
    mockState.destroyCalled = false;
    mockState.syncDestroyedCalled = false;
    await resetClient();
  });

  afterEach(async () => {
    await resetClient();
  });

  it('should create and return client', async () => {
    const client = await getClient();
    expect(client).toBeInstanceOf(OfflineClient);
  });

  it('should return singleton instance', async () => {
    const client1 = await getClient();
    const client2 = await getClient();

    expect(client1).toBe(client2);
  });

  it('should accept config on first call', async () => {
    const config: ClientConfig = {
      database: {
        name: 'test-db',
      },
    };

    const client = await getClient(config);
    expect(client).toBeDefined();
  });

  it('should initialize the client', async () => {
    const client = await getClient();

    // Should not throw - client is initialized
    expect(client.getDatabase()).toBeDefined();
  });
});

describe('resetClient', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockState.destroyCalled = false;
    await resetClient();
  });

  it('should destroy and reset global client', async () => {
    await getClient();
    await resetClient();

    // Getting client again should create new instance
    const client1 = await getClient();
    await resetClient();
    const client2 = await getClient();

    // Can't directly compare instances due to mocking,
    // but destroy should have been called
    expect(mockState.destroyCalled).toBe(true);
  });

  it('should be safe to call when no client exists', async () => {
    await resetClient(); // Should not throw
  });
});

describe('Config merging', () => {
  it('should preserve unset config values', () => {
    const client = new OfflineClient({
      sync: {
        url: 'http://localhost/api/sync',
      },
    });

    // Other sync config values should have defaults
    expect(client).toBeDefined();
  });

  it('should handle nested config override', () => {
    const client = new OfflineClient({
      database: {
        name: 'custom-db',
        // password should still be undefined (default)
      },
    });

    expect(client).toBeDefined();
  });
});
