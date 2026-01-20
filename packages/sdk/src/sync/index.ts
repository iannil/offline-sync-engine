/**
 * Sync module - handles background synchronization
 * @module sync
 */

import type { RxDatabase } from 'rxdb';
import type { OutboxManager } from '../outbox/index.js';
import type { NetworkManager } from '../network/index.js';
import type { CompressionOptions } from '../storage/compression.js';
import { getNetworkManager } from '../network/index.js';
import { ActionType, ActionStatus } from '../outbox/index.js';
import { compress, decompress, compressToBase64, decompressFromBase64 } from '../storage/compression.js';

/**
 * Sync configuration
 */
export interface SyncConfig {
  url: string;
  interval?: number;
  batchSize?: number;
  headers?: Record<string, string>;
  enableWebSocket?: boolean;
  websocketUrl?: string;
  /**
   * Enable data compression (MessagePack + DEFLATE)
   * @default true
   */
  enableCompression?: boolean;
  /**
   * Compression options (uses defaults if not specified)
   */
  compressionOptions?: CompressionOptions;
}

/**
 * WebSocket message from server
 */
interface WebSocketMessage {
  type: 'connected' | 'change' | 'error';
  data?: {
    collection: string;
    documentId: string;
    document: Record<string, unknown>;
    timestamp: number;
    seq: string;
  };
  timestamp?: number;
  error?: string;
}

/**
 * Sync state
 */
export interface SyncState {
  lastSyncAt: number;
  isSyncing: boolean;
  pendingCount: number;
  error: string | null;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  synced: number;
  failed: number;
  errors: Array<{ actionId: string; error: string }>;
}

/**
 * Push request payload
 */
interface PushRequest {
  actions: Array<{
    id: string;
    type: string;
    collection: string;
    documentId: string;
    data: Record<string, unknown>;
    timestamp: number;
  }>;
}

/**
 * Pull response payload
 */
interface PullResponse {
  items: Array<{
    collection: string;
    document: Record<string, unknown>;
    timestamp: number;
  }>;
  since?: number;
}

/**
 * Sync manager - coordinates background synchronization
 */
export class SyncManager {
  private db: RxDatabase;
  private outbox: OutboxManager;
  private network: NetworkManager;
  private config: {
    url: string;
    interval: number;
    batchSize: number;
    headers: Record<string, string>;
    enableWebSocket: boolean;
    websocketUrl: string;
    enableCompression: boolean;
    compressionOptions?: CompressionOptions;
  };

  private syncTimer?: ReturnType<typeof setInterval>;
  private syncPromise: Promise<SyncResult> | null = null;
  private isDestroyed = false;

  // WebSocket properties
  private ws: WebSocket | null = null;
  private wsReconnectTimer?: ReturnType<typeof setTimeout>;
  private wsReconnectDelay = 1000;
  private wsMaxReconnectDelay = 30000;
  private wsManualClose = false;

  private state: SyncState = {
    lastSyncAt: 0,
    isSyncing: false,
    pendingCount: 0,
    error: null,
  };

  private stateChangeCallbacks: Array<(state: SyncState) => void> = [];

  private defaultConfig: Omit<Required<SyncConfig>, 'url' | 'compressionOptions'> & {
    compressionOptions?: CompressionOptions;
  } = {
    interval: 60000,
    batchSize: 100,
    headers: {},
    enableWebSocket: true,
    websocketUrl: '',
    enableCompression: true,
    compressionOptions: undefined,
  };

  constructor(
    db: RxDatabase,
    outbox: OutboxManager,
    config: SyncConfig
  ) {
    this.db = db;
    this.outbox = outbox;
    this.config = { ...this.defaultConfig, ...config };
    this.network = getNetworkManager();

    this.init();
  }

  /**
   * Initialize sync manager
   */
  private init(): void {
    // Start periodic sync
    this.startPeriodicSync();

    // Start WebSocket if enabled
    if (this.config.enableWebSocket) {
      this.connectWebSocket();
    }

    // Listen for network changes
    this.network.status$.subscribe((status) => {
      if (status.isOnline) {
        // Trigger sync when coming back online
        this.sync().catch((err) => {
          console.error('Sync after online failed:', err);
        });

        // Reconnect WebSocket
        if (this.config.enableWebSocket) {
          this.connectWebSocket();
        }
      }
    });
  }

  /**
   * Start periodic sync
   */
  private startPeriodicSync(): void {
    this.stopPeriodicSync();

    this.syncTimer = setInterval(() => {
      if (this.network.isOnline && !this.syncPromise) {
        this.sync().catch((err) => {
          console.error('Periodic sync failed:', err);
        });
      }
    }, this.config.interval);
  }

  /**
   * Stop periodic sync
   */
  private stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  /**
   * Perform a full sync (push and pull)
   *
   * @returns Promise resolving to sync result
   */
  async sync(): Promise<SyncResult> {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    if (!this.network.isOnline) {
      return {
        synced: 0,
        failed: 0,
        errors: [],
      };
    }

    this.syncPromise = this.performSync();

    try {
      const result = await this.syncPromise;
      return result;
    } finally {
      this.syncPromise = null;
    }
  }

  /**
   * Internal sync implementation
   */
  private async performSync(): Promise<SyncResult> {
    this.updateState({ isSyncing: true, error: null });

    try {
      // First, process retryable failed actions
      const retryable = await this.outbox.getRetryable();
      for (const action of retryable) {
        await this.outbox.updateStatus(
          action.id,
          ActionStatus.PENDING
        );
      }

      // Push pending actions
      const pushResult = await this.push();

      // Pull remote changes
      await this.pull();

      // Cleanup completed actions
      await this.outbox.cleanup();

      this.updateState({
        isSyncing: false,
        lastSyncAt: Date.now(),
      });

      return pushResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.updateState({
        isSyncing: false,
        error: errorMessage,
      });

      return {
        synced: 0,
        failed: 0,
        errors: [],
      };
    }
  }

  /**
   * Push pending actions to server
   */
  private async push(): Promise<SyncResult> {
    const actions = await this.outbox.getPending(this.config.batchSize);

    if (actions.length === 0) {
      return { synced: 0, failed: 0, errors: [] };
    }

    this.updateState({ pendingCount: actions.length });

    // Mark actions as syncing
    for (const action of actions) {
      await this.outbox.markSyncing(action.id);
    }

    try {
      const requestData = {
        actions: actions.map((a) => ({
          id: a.id,
          type: a.type,
          collection: a.collection,
          documentId: a.documentId,
          data: a.data,
          timestamp: a.timestamp,
        })),
      } as PushRequest;

      // Prepare request
      const headers: HeadersInit = {
        ...this.config.headers,
      };

      let body: string | Uint8Array;

      if (this.config.enableCompression) {
        // Use MessagePack + DEFLATE compression, encoded as base64
        headers['Content-Type'] = 'application/msgpack+deflate';
        headers['X-Compression'] = 'msgpack-deflate';
        body = compressToBase64(requestData);
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(requestData);
      }

      const response = await fetch(`${this.config.url}/push`, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        throw new Error(`Push failed: ${response.status}`);
      }

      let result: { succeeded?: string[]; failed?: Array<{ actionId: string; error: string }> };

      // Check if response is compressed
      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('msgpack') || response.headers.get('X-Compression')) {
        // Decode compressed response
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        result = decompress<typeof result>(uint8Array);
      } else {
        result = await response.json();
      }

      // Mark successful actions as done
      const succeeded = result.succeeded ?? [];
      for (const actionId of succeeded) {
        await this.outbox.markDone(actionId);
      }

      // Mark failed actions
      const failed = result.failed ?? [];
      const errors: Array<{ actionId: string; error: string }> = [];

      for (const item of failed) {
        await this.outbox.markFailed(item.actionId, item.error);
        errors.push(item);
      }

      return {
        synced: succeeded.length,
        failed: failed.length,
        errors,
      };
    } catch (error) {
      // Mark all actions back to pending for retry
      for (const action of actions) {
        await this.outbox.markFailed(
          action.id,
          error instanceof Error ? error.message : String(error)
        );
      }

      throw error;
    }
  }

  /**
   * Pull remote changes from server
   */
  private async pull(): Promise<void> {
    // Get last sync timestamp
    const metadataDoc = await this.db.sync_metadata
      .findOne()
      .where('id')
      .equals('default')
      .exec();

    const lastSyncAt = metadataDoc?.lastSyncAt ?? 0;

    const headers: HeadersInit = {
      ...this.config.headers,
    };

    // Request compressed response if enabled
    if (this.config.enableCompression) {
      headers['Accept'] = 'application/msgpack+deflate, application/json';
    }

    const response = await fetch(
      `${this.config.url}/pull?since=${lastSyncAt}`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) {
      throw new Error(`Pull failed: ${response.status}`);
    }

    let result: PullResponse;

    // Check if response is compressed
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('msgpack') || response.headers.get('X-Compression') === 'msgpack-deflate') {
      // Decode compressed response
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      result = decompress<PullResponse>(uint8Array);
    } else {
      result = (await response.json()) as PullResponse;
    }

    // Apply remote changes
    for (const item of result.items) {
      const collection = this.db[item.collection] as any;
      if (collection) {
        // Check if document exists
        const exists = await collection
          .findOne()
          .where('id')
          .equals(item.document.id)
          .exec();

        if (exists) {
          // Update existing document
          await exists.patch({
            ...item.document,
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Insert new document
          await collection.insert({
            ...item.document,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    // Update sync metadata
    const now = Date.now();
    if (metadataDoc) {
      await metadataDoc.patch({ lastSyncAt: now });
    } else {
      await this.db.sync_metadata.insert({
        id: 'default',
        lastSyncAt: now,
        vectorClock: {},
      });
    }
  }

  /**
   * Update sync state
   */
  private updateState(updates: Partial<SyncState>): void {
    this.state = {
      ...this.state,
      ...updates,
    };

    // Notify listeners
    for (const callback of this.stateChangeCallbacks) {
      callback(this.state);
    }
  }

  /**
   * Subscribe to sync state changes
   */
  onStateChange(callback: (state: SyncState) => void): () => void {
    this.stateChangeCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this.stateChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get current sync state
   */
  getState(): SyncState {
    return { ...this.state };
  }

  /**
   * Manually trigger a sync
   */
  async triggerSync(): Promise<SyncResult> {
    return this.sync();
  }

  /**
   * Connect to WebSocket server for real-time updates
   */
  private connectWebSocket(): void {
    // Close existing connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Build WebSocket URL
    const wsUrl = this.buildWebSocketUrl();
    if (!wsUrl) {
      console.warn('WebSocket URL not available, skipping WebSocket connection');
      return;
    }

    try {
      this.wsManualClose = false;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.wsReconnectDelay = 1000; // Reset reconnect delay

        // Send subscription message
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'subscribe',
              collections: ['todos', 'products'],
            })
          );
        }
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        if (!this.wsManualClose && !this.isDestroyed) {
          // Schedule reconnection
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Build WebSocket URL from sync URL
   */
  private buildWebSocketUrl(): string | null {
    if (this.config.websocketUrl) {
      return this.config.websocketUrl;
    }

    // Convert HTTP URL to WebSocket URL
    const syncUrl = new URL(this.config.url);
    const protocol = syncUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = syncUrl.host;

    // Replace /api/sync with /api/stream
    return `${protocol}//${host}/api/stream`;
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }

    this.wsReconnectTimer = setTimeout(() => {
      if (this.network.isOnline && !this.isDestroyed) {
        console.log(`Reconnecting WebSocket (delay: ${this.wsReconnectDelay}ms)`);
        this.connectWebSocket();
      }

      // Increase delay for next attempt
      this.wsReconnectDelay = Math.min(
        this.wsReconnectDelay * 2,
        this.wsMaxReconnectDelay
      );
    }, this.wsReconnectDelay);
  }

  /**
   * Handle incoming WebSocket message from server
   */
  private handleWebSocketMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketMessage;

      switch (message.type) {
        case 'connected':
          console.log('WebSocket connection acknowledged');
          break;

        case 'change':
          // Server broadcasted a change - trigger pull to get latest data
          if (message.data) {
            console.log('Remote change detected:', message.data);
            this.pullSingleChange(message.data).catch((err) => {
              console.error('Failed to pull single change:', err);
            });
          }
          break;

        case 'error':
          console.error('WebSocket error from server:', message.error);
          break;
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Pull and apply a single change from server
   */
  private async pullSingleChange(change: {
    collection: string;
    documentId: string;
    document: Record<string, unknown>;
  }): Promise<void> {
    const collection = this.db[change.collection] as any;
    if (!collection) {
      return; // Collection not available locally
    }

    // Check if document exists
    const exists = await collection
      .findOne()
      .where('id')
      .equals(change.document.id)
      .exec();

    if (exists) {
      // Update existing document
      await exists.patch({
        ...change.document,
        updatedAt: new Date().toISOString(),
      });
    } else {
      // Insert new document
      await collection.insert({
        ...change.document,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Disconnect WebSocket
   */
  private disconnectWebSocket(): void {
    this.wsManualClose = true;

    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = undefined;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Destroy the sync manager
   */
  async destroy(): Promise<void> {
    this.isDestroyed = true;
    this.stopPeriodicSync();
    this.disconnectWebSocket();
    this.stateChangeCallbacks = [];
  }
}
