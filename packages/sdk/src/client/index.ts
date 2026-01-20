/**
 * Client module - main SDK client for offline-first operations
 * @module client
 */

import type { RxDatabase } from 'rxdb';
import { getDatabase, type DatabaseType } from '../storage/index.js';
import { getNetworkManager, NetworkManager } from '../network/index.js';
import { OutboxManager } from '../outbox/index.js';
import { SyncManager } from '../sync/index.js';

/**
 * SDK client configuration
 */
export interface ClientConfig {
  database?: {
    name?: string;
    password?: string;
  };
  network?: {
    pingUrl?: string;
    pingInterval?: number;
  };
  sync?: {
    enabled?: boolean;
    url?: string;
    interval?: number;
  };
  outbox?: {
    maxRetries?: number;
    retryDelay?: number;
  };
}

/**
 * SDK client - main entry point for the offline sync engine
 */
export class OfflineClient {
  private db: DatabaseType | null = null;
  private network: NetworkManager;
  private outbox: OutboxManager | null = null;
  private sync: SyncManager | null = null;
  private initialized = false;

  private config: Required<ClientConfig> = {
    database: {
      name: 'offline-sync-engine',
      password: undefined,
    },
    network: {
      pingUrl: 'https://www.google.com/favicon.ico',
      pingInterval: 30000,
    },
    sync: {
      enabled: true,
      url: '',
      interval: 60000,
    },
    outbox: {
      maxRetries: 5,
      retryDelay: 1000,
    },
  };

  constructor(config: ClientConfig = {}) {
    // Deep merge config
    this.config = this.mergeConfig(this.config, config);
    this.network = getNetworkManager(this.config.network);
  }

  /**
   * Initialize the client
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize database
    this.db = await getDatabase(this.config.database);

    // Initialize outbox manager
    this.outbox = new OutboxManager(
      this.db.outbox_actions,
      this.config.outbox
    );

    // Initialize sync manager if enabled
    if (this.config.sync.enabled && this.config.sync.url) {
      this.sync = new SyncManager(this.db, this.outbox, {
        url: this.config.sync.url,
        interval: this.config.sync.interval,
      });
    }

    this.initialized = true;
  }

  /**
   * Get the database instance
   */
  getDatabase(): DatabaseType {
    if (!this.db) {
      throw new Error('Client not initialized. Call init() first.');
    }
    return this.db;
  }

  /**
   * Get the network manager
   */
  getNetworkManager(): NetworkManager {
    return this.network;
  }

  /**
   * Get the outbox manager
   */
  getOutboxManager(): OutboxManager {
    if (!this.outbox) {
      throw new Error('Client not initialized. Call init() first.');
    }
    return this.outbox;
  }

  /**
   * Get the sync manager
   */
  getSyncManager(): SyncManager | null {
    return this.sync;
  }

  /**
   * Check if currently online
   */
  isOnline(): boolean {
    return this.network.isOnline;
  }

  /**
   * Destroy the client and cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.sync) {
      await this.sync.destroy();
    }

    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }

    this.initialized = false;
  }

  /**
   * Deep merge configuration objects
   */
  private mergeConfig<T>(base: T, override: Partial<T>): T {
    const result = { ...base };

    for (const key in override) {
      const value = override[key];
      const baseValue = result[key];

      if (
        value &&
        baseValue &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        result[key] = this.mergeConfig(
          baseValue as any,
          value as any
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = value as T[Extract<keyof T, string>];
      }
    }

    return result;
  }
}

/**
 * Global client instance
 */
let globalClient: OfflineClient | null = null;

/**
 * Get or create the global SDK client instance
 */
export async function getClient(
  config?: ClientConfig
): Promise<OfflineClient> {
  if (!globalClient) {
    globalClient = new OfflineClient(config);
    await globalClient.init();
  }
  return globalClient;
}

/**
 * Reset the global client instance
 */
export async function resetClient(): Promise<void> {
  if (globalClient) {
    await globalClient.destroy();
    globalClient = null;
  }
}
