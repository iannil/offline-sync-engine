/**
 * CRDT module - Conflict-free Replicated Data Types using Yjs
 * @module crdt
 *
 * Provides field-level conflict resolution for collaborative editing scenarios.
 * Uses Yjs under the hood for automatic conflict resolution.
 */

import * as Y from 'yjs';

/**
 * CRDT document state for synchronization
 */
export interface CRDTState {
  /** State vector for incremental sync */
  stateVector: Uint8Array;
  /** Full document update (for initial sync) */
  fullUpdate: Uint8Array;
  /** Document ID */
  documentId: string;
  /** Collection name */
  collection: string;
}

/**
 * CRDT sync update
 */
export interface CRDTUpdate {
  /** Incremental update data */
  update: Uint8Array;
  /** Document ID */
  documentId: string;
  /** Collection name */
  collection: string;
  /** Origin client ID */
  origin?: string;
}

/**
 * CRDT document metadata
 */
interface CRDTDocumentMeta {
  doc: Y.Doc;
  collection: string;
  documentId: string;
  lastSyncedStateVector: Uint8Array | null;
}

/**
 * Options for CRDTManager
 */
export interface CRDTManagerOptions {
  /** Client ID for this instance */
  clientId?: string;
  /** Enable garbage collection */
  gc?: boolean;
  /** Callback when local changes occur */
  onLocalChange?: (update: CRDTUpdate) => void;
}

/**
 * CRDT Manager - manages Yjs documents for conflict-free synchronization
 *
 * @example
 * ```typescript
 * const crdt = new CRDTManager({ clientId: 'user-123' });
 *
 * // Get or create a CRDT document
 * const doc = crdt.getDocument('todos', 'todo-1');
 *
 * // Update a field
 * crdt.setField('todos', 'todo-1', 'text', 'Updated text');
 *
 * // Get current value
 * const text = crdt.getField('todos', 'todo-1', 'text');
 *
 * // Get state for sync
 * const state = crdt.getState('todos', 'todo-1');
 *
 * // Apply remote update
 * crdt.applyUpdate(remoteUpdate);
 * ```
 */
export class CRDTManager {
  private documents: Map<string, CRDTDocumentMeta> = new Map();
  private clientId: string;
  private gc: boolean;
  private onLocalChange?: (update: CRDTUpdate) => void;
  private isDestroyed = false;

  constructor(options: CRDTManagerOptions = {}) {
    this.clientId = options.clientId || this.generateClientId();
    this.gc = options.gc ?? true;
    this.onLocalChange = options.onLocalChange;
  }

  /**
   * Generate a unique client ID
   */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Get document key for internal storage
   */
  private getDocKey(collection: string, documentId: string): string {
    return `${collection}:${documentId}`;
  }

  /**
   * Get or create a Yjs document for a given collection/document
   */
  getDocument(collection: string, documentId: string): Y.Doc {
    const key = this.getDocKey(collection, documentId);
    let meta = this.documents.get(key);

    if (!meta) {
      const doc = new Y.Doc({
        gc: this.gc,
      });

      // Listen for updates
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        // Only propagate local changes (not from remote apply)
        if (origin !== 'remote' && this.onLocalChange) {
          this.onLocalChange({
            update,
            documentId,
            collection,
            origin: this.clientId,
          });
        }
      });

      meta = {
        doc,
        collection,
        documentId,
        lastSyncedStateVector: null,
      };

      this.documents.set(key, meta);
    }

    return meta.doc;
  }

  /**
   * Check if a document exists
   */
  hasDocument(collection: string, documentId: string): boolean {
    const key = this.getDocKey(collection, documentId);
    return this.documents.has(key);
  }

  /**
   * Get all field names in a document
   */
  getFields(collection: string, documentId: string): string[] {
    const doc = this.getDocument(collection, documentId);
    const map = doc.getMap('data');
    return Array.from(map.keys());
  }

  /**
   * Set a field value in a document
   */
  setField(
    collection: string,
    documentId: string,
    field: string,
    value: unknown
  ): void {
    const doc = this.getDocument(collection, documentId);
    const map = doc.getMap('data');

    doc.transact(() => {
      if (value === undefined || value === null) {
        map.delete(field);
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        // For objects, use Y.Map
        const yMap = new Y.Map();
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          yMap.set(k, v);
        }
        map.set(field, yMap);
      } else if (Array.isArray(value)) {
        // For arrays, use Y.Array
        const yArray = new Y.Array();
        yArray.push(value);
        map.set(field, yArray);
      } else {
        // Primitives
        map.set(field, value);
      }
    }, this.clientId);
  }

  /**
   * Get a field value from a document
   */
  getField(collection: string, documentId: string, field: string): unknown {
    const doc = this.getDocument(collection, documentId);
    const map = doc.getMap('data');
    const value = map.get(field);

    // Convert Y types back to plain JS objects
    if (value instanceof Y.Map) {
      return this.yMapToObject(value);
    } else if (value instanceof Y.Array) {
      return value.toArray();
    }

    return value;
  }

  /**
   * Convert Y.Map to plain object
   */
  private yMapToObject(yMap: Y.Map<unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    yMap.forEach((value, key) => {
      if (value instanceof Y.Map) {
        result[key] = this.yMapToObject(value);
      } else if (value instanceof Y.Array) {
        result[key] = value.toArray();
      } else {
        result[key] = value;
      }
    });
    return result;
  }

  /**
   * Set multiple fields at once
   */
  setFields(
    collection: string,
    documentId: string,
    fields: Record<string, unknown>
  ): void {
    const doc = this.getDocument(collection, documentId);
    const map = doc.getMap('data');

    doc.transact(() => {
      for (const [field, value] of Object.entries(fields)) {
        if (value === undefined || value === null) {
          map.delete(field);
        } else if (typeof value === 'object' && !Array.isArray(value)) {
          const yMap = new Y.Map();
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            yMap.set(k, v);
          }
          map.set(field, yMap);
        } else if (Array.isArray(value)) {
          const yArray = new Y.Array();
          yArray.push(value);
          map.set(field, yArray);
        } else {
          map.set(field, value);
        }
      }
    }, this.clientId);
  }

  /**
   * Get all fields as a plain object
   */
  getData(collection: string, documentId: string): Record<string, unknown> {
    const fields = this.getFields(collection, documentId);
    const result: Record<string, unknown> = {};

    for (const field of fields) {
      result[field] = this.getField(collection, documentId, field);
    }

    return result;
  }

  /**
   * Get the CRDT state for synchronization
   */
  getState(collection: string, documentId: string): CRDTState {
    const doc = this.getDocument(collection, documentId);

    return {
      stateVector: Y.encodeStateVector(doc),
      fullUpdate: Y.encodeStateAsUpdate(doc),
      documentId,
      collection,
    };
  }

  /**
   * Get incremental update since last sync
   */
  getIncrementalUpdate(
    collection: string,
    documentId: string,
    sinceStateVector?: Uint8Array
  ): Uint8Array {
    const doc = this.getDocument(collection, documentId);
    const key = this.getDocKey(collection, documentId);
    const meta = this.documents.get(key);

    const stateVector = sinceStateVector || meta?.lastSyncedStateVector;

    if (stateVector) {
      return Y.encodeStateAsUpdate(doc, stateVector);
    }

    return Y.encodeStateAsUpdate(doc);
  }

  /**
   * Apply a remote update to a document
   */
  applyUpdate(update: CRDTUpdate): void {
    const doc = this.getDocument(update.collection, update.documentId);

    // Apply with 'remote' origin to prevent re-broadcasting
    Y.applyUpdate(doc, update.update, 'remote');
  }

  /**
   * Apply a full state update (for initial sync)
   */
  applyState(state: CRDTState): void {
    const doc = this.getDocument(state.collection, state.documentId);

    // Apply full update
    Y.applyUpdate(doc, state.fullUpdate, 'remote');

    // Update last synced state vector
    const key = this.getDocKey(state.collection, state.documentId);
    const meta = this.documents.get(key);
    if (meta) {
      meta.lastSyncedStateVector = state.stateVector;
    }
  }

  /**
   * Merge two documents and return the merged state
   */
  merge(
    collection: string,
    documentId: string,
    remoteState: CRDTState
  ): CRDTState {
    // Apply remote state
    this.applyState(remoteState);

    // Return merged state
    return this.getState(collection, documentId);
  }

  /**
   * Mark a document as synced with given state vector
   */
  markSynced(
    collection: string,
    documentId: string,
    stateVector: Uint8Array
  ): void {
    const key = this.getDocKey(collection, documentId);
    const meta = this.documents.get(key);
    if (meta) {
      meta.lastSyncedStateVector = stateVector;
    }
  }

  /**
   * Delete a document from memory
   */
  deleteDocument(collection: string, documentId: string): void {
    const key = this.getDocKey(collection, documentId);
    const meta = this.documents.get(key);

    if (meta) {
      meta.doc.destroy();
      this.documents.delete(key);
    }
  }

  /**
   * Get all document keys
   */
  getDocumentKeys(): Array<{ collection: string; documentId: string }> {
    return Array.from(this.documents.values()).map((meta) => ({
      collection: meta.collection,
      documentId: meta.documentId,
    }));
  }

  /**
   * Get the client ID
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * Serialize state to base64 for transport
   */
  static stateToBase64(state: CRDTState): string {
    const data = {
      stateVector: Array.from(state.stateVector),
      fullUpdate: Array.from(state.fullUpdate),
      documentId: state.documentId,
      collection: state.collection,
    };
    return btoa(JSON.stringify(data));
  }

  /**
   * Deserialize state from base64
   */
  static stateFromBase64(base64: string): CRDTState {
    const data = JSON.parse(atob(base64));
    return {
      stateVector: new Uint8Array(data.stateVector),
      fullUpdate: new Uint8Array(data.fullUpdate),
      documentId: data.documentId,
      collection: data.collection,
    };
  }

  /**
   * Serialize update to base64 for transport
   */
  static updateToBase64(update: CRDTUpdate): string {
    const data = {
      update: Array.from(update.update),
      documentId: update.documentId,
      collection: update.collection,
      origin: update.origin,
    };
    return btoa(JSON.stringify(data));
  }

  /**
   * Deserialize update from base64
   */
  static updateFromBase64(base64: string): CRDTUpdate {
    const data = JSON.parse(atob(base64));
    return {
      update: new Uint8Array(data.update),
      documentId: data.documentId,
      collection: data.collection,
      origin: data.origin,
    };
  }

  /**
   * Destroy the manager and all documents
   */
  destroy(): void {
    if (this.isDestroyed) return;

    for (const meta of this.documents.values()) {
      meta.doc.destroy();
    }

    this.documents.clear();
    this.isDestroyed = true;
  }
}

/**
 * Create a new CRDT manager instance
 */
export function createCRDTManager(options?: CRDTManagerOptions): CRDTManager {
  return new CRDTManager(options);
}
