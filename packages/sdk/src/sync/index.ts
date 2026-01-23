/**
 * Sync module - handles background synchronization
 * @module sync
 */

import type { RxDatabase } from 'rxdb';
import type { OutboxManager } from '../outbox/index.js';
import type { NetworkManager } from '../network/index.js';
import type { CompressionOptions } from '../storage/compression.js';
import { getNetworkManager } from '../network/index.js';
import { ActionStatus } from '../outbox/index.js';
import { decompress, compressToBase64 } from '../storage/compression.js';
import { CRDTManager, type CRDTState } from '../crdt/index.js';
import { VectorClock, type VectorClockMap, type ClockComparison } from './vector-clock.js';

// Re-export VectorClock for external use
export { VectorClock, createVectorClock, type VectorClockMap, type ClockComparison } from './vector-clock.js';

/**
 * Conflict resolution strategy
 */
export type ConflictResolutionStrategy = 'lww' | 'crdt';

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
  /**
   * Conflict resolution strategy
   * - 'lww': Last-Write-Wins based on timestamp (default)
   * - 'crdt': Field-level merge using Yjs CRDT
   * @default 'lww'
   */
  conflictResolution?: ConflictResolutionStrategy;
  /**
   * Client ID for CRDT (auto-generated if not provided)
   */
  clientId?: string;
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
  /** Current vector clock state */
  vectorClock: VectorClockMap;
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
  serverVectorClock?: VectorClockMap;
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
    conflictResolution: ConflictResolutionStrategy;
    clientId?: string;
  };

  // CRDT manager for field-level conflict resolution
  private crdtManager: CRDTManager | null = null;

  // Vector clock for causal ordering
  private vectorClock: VectorClock;

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
    vectorClock: {},
  };

  private stateChangeCallbacks: Array<(state: SyncState) => void> = [];

  private defaultConfig: Omit<Required<SyncConfig>, 'url' | 'compressionOptions' | 'clientId'> & {
    compressionOptions?: CompressionOptions;
    clientId?: string;
  } = {
    interval: 60000,
    batchSize: 100,
    headers: {},
    enableWebSocket: true,
    websocketUrl: '',
    enableCompression: true,
    compressionOptions: undefined,
    conflictResolution: 'lww',
    clientId: undefined,
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

    // Initialize vector clock with client ID
    const clientId = this.config.clientId || `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.vectorClock = new VectorClock(clientId);
    this.state.vectorClock = this.vectorClock.getClock();

    this.init();
  }

  /**
   * Initialize sync manager
   */
  private init(): void {
    // Initialize CRDT manager if using CRDT conflict resolution
    if (this.config.conflictResolution === 'crdt') {
      this.crdtManager = new CRDTManager({
        clientId: this.config.clientId,
        onLocalChange: (update) => {
          // When local CRDT changes occur, trigger sync
          console.log('CRDT local change detected:', update.collection, update.documentId);
        },
      });
    }

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
      // Increment vector clock for this push
      this.vectorClock.increment();

      const requestData = {
        actions: actions.map((a) => ({
          id: a.id,
          type: a.type,
          collection: a.collection,
          documentId: a.documentId,
          data: a.data,
          timestamp: a.timestamp,
        })),
        vectorClock: this.vectorClock.getClock(),
        clientId: this.vectorClock.getClientId(),
      } as PushRequest & { vectorClock: VectorClockMap; clientId: string };

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

      // Save updated vector clock after successful push
      if (succeeded.length > 0) {
        const currentVectorClock = this.vectorClock.getClock();
        const metadataDoc = await this.db.sync_metadata
          .findOne()
          .where('id')
          .equals('default')
          .exec();

        if (metadataDoc) {
          await metadataDoc.patch({ vectorClock: currentVectorClock });
        } else {
          await this.db.sync_metadata.insert({
            id: 'default',
            lastSyncAt: Date.now(),
            vectorClock: currentVectorClock,
          });
        }

        this.updateState({ vectorClock: currentVectorClock });
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
    // Get last sync timestamp and vector clock
    const metadataDoc = await this.db.sync_metadata
      .findOne()
      .where('id')
      .equals('default')
      .exec();

    const lastSyncAt = metadataDoc?.lastSyncAt ?? 0;
    const savedVectorClock = metadataDoc?.vectorClock ?? {};

    // Restore vector clock from storage if available
    if (Object.keys(savedVectorClock).length > 0) {
      for (const [clientId, timestamp] of Object.entries(savedVectorClock)) {
        this.vectorClock.setTimestamp(clientId, timestamp as number);
      }
    }

    const headers: HeadersInit = {
      ...this.config.headers,
    };

    // Request compressed response if enabled
    if (this.config.enableCompression) {
      headers['Accept'] = 'application/msgpack+deflate, application/json';
    }

    // Include vector clock in request
    const vectorClockParam = encodeURIComponent(JSON.stringify(this.vectorClock.getClock()));

    const response = await fetch(
      `${this.config.url}/pull?since=${lastSyncAt}&vectorClock=${vectorClockParam}&clientId=${this.vectorClock.getClientId()}`,
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

    // Merge server's vector clock if provided
    if (result.serverVectorClock) {
      this.vectorClock.merge(result.serverVectorClock);
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

        if (this.crdtManager && this.config.conflictResolution === 'crdt') {
          // Use CRDT for conflict resolution
          const docId = item.document.id as string;

          // If the document has CRDT state from server, apply it
          if (item.document._crdtState) {
            const crdtState = CRDTManager.stateFromBase64(item.document._crdtState as string);
            this.crdtManager.merge(item.collection, docId, crdtState);
          } else {
            // No CRDT state, initialize from server data
            const { _crdtState: _, id: _id, ...fields } = item.document as Record<string, unknown>;
            this.crdtManager.setFields(item.collection, docId, fields);
          }

          // Get merged data from CRDT
          const mergedData = this.crdtManager.getData(item.collection, docId);

          if (exists) {
            await exists.patch({
              ...mergedData,
              id: docId,
              updatedAt: new Date().toISOString(),
            });
          } else {
            await collection.insert({
              ...mergedData,
              id: docId,
              updatedAt: new Date().toISOString(),
            });
          }
        } else {
          // LWW: Simple overwrite
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
    }

    // Update sync metadata with vector clock
    const now = Date.now();
    const currentVectorClock = this.vectorClock.getClock();
    if (metadataDoc) {
      await metadataDoc.patch({
        lastSyncAt: now,
        vectorClock: currentVectorClock,
      });
    } else {
      await this.db.sync_metadata.insert({
        id: 'default',
        lastSyncAt: now,
        vectorClock: currentVectorClock,
      });
    }

    // Update state with current vector clock
    this.updateState({ vectorClock: currentVectorClock });
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

    if (this.crdtManager && this.config.conflictResolution === 'crdt') {
      // Use CRDT for conflict resolution
      const docId = change.document.id as string;

      // If the document has CRDT state from server, apply it
      if (change.document._crdtState) {
        const crdtState = CRDTManager.stateFromBase64(change.document._crdtState as string);
        this.crdtManager.merge(change.collection, docId, crdtState);
      } else {
        // No CRDT state, initialize from server data
        const { _crdtState: _, id: _id, ...fields } = change.document;
        this.crdtManager.setFields(change.collection, docId, fields);
      }

      // Get merged data from CRDT
      const mergedData = this.crdtManager.getData(change.collection, docId);

      if (exists) {
        await exists.patch({
          ...mergedData,
          id: docId,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await collection.insert({
          ...mergedData,
          id: docId,
          updatedAt: new Date().toISOString(),
        });
      }
    } else {
      // LWW: Simple overwrite
      if (exists) {
        await exists.patch({
          ...change.document,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await collection.insert({
          ...change.document,
          updatedAt: new Date().toISOString(),
        });
      }
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
   * Get the CRDT manager (if using CRDT conflict resolution)
   */
  getCRDTManager(): CRDTManager | null {
    return this.crdtManager;
  }

  /**
   * Get CRDT state for a specific document (for sync with server)
   * Returns null if CRDT is not enabled
   */
  getCRDTState(collection: string, documentId: string): CRDTState | null {
    if (!this.crdtManager) {
      return null;
    }
    return this.crdtManager.getState(collection, documentId);
  }

  /**
   * Get CRDT state as base64 string for transport
   * Returns null if CRDT is not enabled
   */
  getCRDTStateBase64(collection: string, documentId: string): string | null {
    const state = this.getCRDTState(collection, documentId);
    if (!state) {
      return null;
    }
    return CRDTManager.stateToBase64(state);
  }

  /**
   * Update a field in the local CRDT document
   * This is useful for tracking local changes before sync
   */
  updateCRDTField(
    collection: string,
    documentId: string,
    field: string,
    value: unknown
  ): void {
    if (!this.crdtManager) {
      console.warn('CRDT is not enabled. Use conflictResolution: "crdt" in config.');
      return;
    }
    this.crdtManager.setField(collection, documentId, field, value);
  }

  /**
   * Update multiple fields in the local CRDT document
   */
  updateCRDTFields(
    collection: string,
    documentId: string,
    fields: Record<string, unknown>
  ): void {
    if (!this.crdtManager) {
      console.warn('CRDT is not enabled. Use conflictResolution: "crdt" in config.');
      return;
    }
    this.crdtManager.setFields(collection, documentId, fields);
  }

  /**
   * Get the current vector clock instance
   */
  getVectorClock(): VectorClock {
    return this.vectorClock;
  }

  /**
   * Get the current vector clock state as a plain object
   */
  getVectorClockState(): VectorClockMap {
    return this.vectorClock.getClock();
  }

  /**
   * Compare local vector clock with a remote clock
   * Returns: 'equal', 'before', 'after', or 'concurrent'
   */
  compareVectorClock(remoteClock: VectorClockMap): ClockComparison {
    return this.vectorClock.compare(remoteClock);
  }

  /**
   * Check if there are potential conflicts with a remote clock
   * Returns true if clocks are concurrent (neither dominates)
   */
  hasConflictWith(remoteClock: VectorClockMap): boolean {
    return this.vectorClock.isConcurrentWith(remoteClock);
  }

  /**
   * Get the current conflict resolution strategy
   */
  getConflictResolutionStrategy(): ConflictResolutionStrategy {
    return this.config.conflictResolution;
  }

  /**
   * Destroy the sync manager
   */
  async destroy(): Promise<void> {
    this.isDestroyed = true;
    this.stopPeriodicSync();
    this.disconnectWebSocket();
    this.stateChangeCallbacks = [];

    // Destroy CRDT manager
    if (this.crdtManager) {
      this.crdtManager.destroy();
      this.crdtManager = null;
    }
  }
}
