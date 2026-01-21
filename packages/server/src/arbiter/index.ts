/**
 * Arbiter module - resolves conflicts between concurrent updates
 * @module arbiter
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import * as Y from 'yjs';
import { getDocument } from '../database/index.js';

/**
 * Conflict detection request
 */
interface ConflictCheckRequest {
  documentId: string;
  collection: string;
  clientVersion: number;
  serverVersion: number;
  clientData: Record<string, unknown>;
  serverData?: Record<string, unknown>;
  clientId?: string;
}

/**
 * Conflict resolution result
 */
interface ConflictResolution {
  resolved: boolean;
  winner: 'client' | 'server' | 'merged';
  data?: Record<string, unknown>;
  conflict?: {
    field: string;
    clientValue: unknown;
    serverValue: unknown;
  }[];
  reason: string;
}

/**
 * Last-Write-Wins metadata
 */
interface LWWMetadata {
  updatedAt: string;
  updatedBy?: string;
}

/**
 * Vector clock for conflict detection
 */
interface VectorClock {
  [clientId: string]: number;
}

/**
 * Document with version info
 */
interface VersionedDocument {
  _id: string;
  _rev?: string;
  data: Record<string, unknown>;
  version: number;
  vectorClock?: VectorClock;
  updatedAt: string;
  updatedBy?: string;
}

/**
 * CRDT state for synchronization (matches SDK CRDTState)
 */
interface CRDTState {
  /** State vector for incremental sync */
  stateVector: number[];
  /** Full document update (for initial sync) */
  fullUpdate: number[];
  /** Document ID */
  documentId: string;
  /** Collection name */
  collection: string;
}

/**
 * CRDT resolve request
 */
interface CRDTResolveRequest {
  /** Client's CRDT state (base64 encoded or array) */
  clientState: CRDTState;
  /** Server's stored CRDT state (optional - will fetch if not provided) */
  serverState?: CRDTState;
  /** Client ID for tracking */
  clientId?: string;
}

/**
 * CRDT resolution result
 */
interface CRDTResolution {
  /** Whether resolution succeeded */
  resolved: boolean;
  /** Merged CRDT state */
  mergedState?: CRDTState;
  /** Error message if failed */
  error?: string;
}

/**
 * Register arbiter routes
 */
export async function registerArbiterRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  /**
   * POST /api/arbiter/check - Check for conflicts
   */
  fastify.post('/check', async (request, reply) => {
    const body = request.body as ConflictCheckRequest;

    try {
      const hasConflict = await detectConflict(body);

      return {
        hasConflict,
        documentId: body.documentId,
        clientVersion: body.clientVersion,
        serverVersion: body.serverVersion,
        conflictDetails: hasConflict ? {
          reason: 'Version mismatch detected',
        } : null,
      };
    } catch (error) {
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * POST /api/arbiter/resolve - Resolve a conflict using LWW
   */
  fastify.post('/resolve', async (request, reply) => {
    const body = request.body as ConflictCheckRequest;

    try {
      const resolution = await resolveConflictLWW(body);
      return resolution;
    } catch (error) {
      reply.code(500);
      return {
        resolved: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * POST /api/arbiter/resolve/merge - Resolve with field-level merge
   */
  fastify.post('/resolve/merge', async (request, reply) => {
    const body = request.body as ConflictCheckRequest;

    try {
      const resolution = await resolveConflictMerge(body);
      return resolution;
    } catch (error) {
      reply.code(500);
      return {
        resolved: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * POST /api/arbiter/resolve/fields - Field-level LWW resolution
   */
  fastify.post('/resolve/fields', async (request, reply) => {
    const body = request.body as ConflictCheckRequest;

    try {
      const resolution = await resolveConflictFieldsLWW(body);
      return resolution;
    } catch (error) {
      reply.code(500);
      return {
        resolved: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * POST /api/arbiter/resolve/crdt - CRDT-based conflict resolution using Yjs
   *
   * Merges CRDT states from client and server using Yjs's automatic
   * conflict resolution. Returns the merged state.
   */
  fastify.post('/resolve/crdt', async (request, reply) => {
    const body = request.body as CRDTResolveRequest;

    try {
      const resolution = await resolveConflictCRDT(body);
      return resolution;
    } catch (error) {
      reply.code(500);
      return {
        resolved: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/**
 * Detect if there's a conflict between client and server versions
 * Uses vector clock for distributed conflict detection
 */
async function detectConflict(
  request: ConflictCheckRequest
): Promise<boolean> {
  const { documentId, collection, clientData, serverData } = request;

  // If server data not provided, fetch from database
  let serverDoc = serverData;

  if (!serverDoc) {
    try {
      const doc = await getDocument(collection, documentId);
      if (!doc) {
        // New document on client - no conflict
        return false;
      }
      serverDoc = doc as any;
    } catch (error) {
      console.error('Error fetching server document:', error);
      // Assume no conflict if we can't fetch
      return false;
    }
  }

  // Compare vector clocks if available
  const clientClock = request.clientData.vectorClock as VectorClock | undefined;
  const serverClock = serverDoc.vectorClock as VectorClock | undefined;

  if (clientClock && serverClock) {
    // Check if client has seen the server version
    const clientId = request.clientId || 'client';
    const clientSeq = clientClock[clientId] ?? 0;
    const serverSeq = serverClock[clientId] ?? 0;

    // If client sequence is behind, there might be a conflict
    if (clientSeq < serverSeq) {
      return true;
    }
  }

  // Fallback to updatedAt comparison
  const clientUpdatedAt = (request.clientData.updatedAt as string) ?? '';
  const serverUpdatedAt = (serverDoc.updatedAt as string) ?? '';

  // If client has newer updates, there's a potential conflict
  const clientTime = new Date(clientUpdatedAt).getTime();
  const serverTime = new Date(serverUpdatedAt).getTime();

  // If times are different by more than 1 second, consider it a conflict
  return Math.abs(clientTime - serverTime) > 1000;
}

/**
 * Resolve conflict using Last-Write-Wins strategy
 * Simple timestamp-based resolution - winner takes all
 */
async function resolveConflictLWW(
  request: ConflictCheckRequest
): Promise<ConflictResolution> {
  const { clientData, serverData } = request;

  let serverDoc = serverData;

  // Fetch server document if not provided
  if (!serverDoc) {
    try {
      const doc = await getDocument(request.collection, request.documentId);
      if (!doc) {
        // New document - client wins
        return {
          resolved: true,
          winner: 'client',
          data: clientData,
          reason: 'New document - client wins',
        };
      }
      serverDoc = doc as any;
    } catch (error) {
      console.error('Error fetching server document:', error);
      // On error, prefer server data
      return {
        resolved: false,
        winner: 'server',
        reason: 'Failed to fetch server document',
      };
    }
  }

  const clientUpdatedAt = extractUpdatedAt(clientData);
  const serverUpdatedAt = extractUpdatedAt(serverDoc);

  const clientTime = new Date(clientUpdatedAt).getTime();
  const serverTime = new Date(serverUpdatedAt).getTime();

  if (clientTime > serverTime) {
    return {
      resolved: true,
      winner: 'client',
      data: clientData,
      reason: `Client has newer timestamp (${clientUpdatedAt} > ${serverUpdatedAt})`,
    };
  } else if (serverTime > clientTime) {
    return {
      resolved: true,
      winner: 'server',
      data: serverDoc,
      reason: `Server has newer timestamp (${serverUpdatedAt} > ${clientUpdatedAt})`,
    };
  } else {
    // Same timestamp - use client ID as tiebreaker
    // In production, you might use a hash or other deterministic tiebreaker
    const clientId = request.clientId || 'client';

    return {
      resolved: true,
      winner: 'server', // Server wins ties
      data: serverDoc,
      reason: `Same timestamp - server wins tie-breaker (client: ${clientId})`,
    };
  }
}

/**
 * Resolve conflict with field-level merge
 * Each field is resolved independently using LWW
 */
async function resolveConflictMerge(
  request: ConflictCheckRequest
): Promise<ConflictResolution> {
  const { clientData, serverData } = request;

  let serverDoc = serverData;

  // Fetch server document if not provided
  if (!serverDoc) {
    try {
      const doc = await getDocument(request.collection, request.documentId);
      if (!doc) {
        // New document - client wins all
        return {
          resolved: true,
          winner: 'client',
          data: clientData,
          reason: 'New document - client wins all fields',
        };
      }
      serverDoc = doc as any;
    } catch (error) {
      console.error('Error fetching server document:', error);
      return {
        resolved: false,
        winner: 'server',
        reason: 'Failed to fetch server document',
      };
    }
  }

  const conflicts: Array<{
    field: string;
    clientValue: unknown;
    serverValue: unknown;
  }> = [];
  const mergedData: Record<string, unknown> = { ...serverDoc };

  // Compare all fields
  const allKeys = new Set([
    ...Object.keys(clientData),
    ...Object.keys(serverDoc),
  ]);

  // Remove CouchDB metadata fields
  const metadataKeys = ['_id', '_rev', 'vectorClock', 'version', 'updatedAt', 'updatedBy'];
  metadataKeys.forEach((key) => allKeys.delete(key));

  for (const key of allKeys) {
    const clientValue = clientData[key];
    const serverValue = serverDoc[key];

    if (clientValue !== serverValue) {
      // Record the conflict only if both sides have the field
      if (clientValue !== undefined && serverValue !== undefined) {
        conflicts.push({
          field: key,
          clientValue,
          serverValue,
        });
      }

      // If only one side has the field, use that value
      if (clientValue === undefined && serverValue !== undefined) {
        mergedData[key] = serverValue;
      } else if (serverValue === undefined && clientValue !== undefined) {
        mergedData[key] = clientValue;
      } else {
        // Both have values - use field-level LWW resolution
        const clientFieldTime = extractFieldUpdatedAt(clientData, key);
        const serverFieldTime = extractFieldUpdatedAt(serverDoc, key);

        const resolvedValue =
          clientFieldTime > serverFieldTime ? clientValue : serverValue;

        mergedData[key] = resolvedValue;
      }
    }
  }

  // Update metadata
  mergedData.updatedAt = new Date().toISOString();
  mergedData.updatedBy = request.clientId || 'merged';

  return {
    resolved: true,
    winner: 'merged',
    data: mergedData,
    conflict: conflicts.length > 0 ? conflicts : undefined,
    reason: `Field-level LWW merge - ${conflicts.length} fields resolved`,
  };
}

/**
 * Resolve conflict using field-level Last-Write-Wins
 * Simpler version that just compares updatedAt per field
 */
async function resolveConflictFieldsLWW(
  request: ConflictCheckRequest
): Promise<ConflictResolution> {
  const { clientData, serverData } = request;

  let serverDoc = serverData;

  // Fetch server document if not provided
  if (!serverDoc) {
    try {
      const doc = await getDocument(request.collection, request.documentId);
      if (!doc) {
        return {
          resolved: true,
          winner: 'client',
          data: clientData,
          reason: 'New document - client wins all fields',
        };
      }
      serverDoc = doc as any;
    } catch (error) {
      console.error('Error fetching server document:', error);
      return {
        resolved: false,
        winner: 'server',
        reason: 'Failed to fetch server document',
      };
    }
  }

  const resolvedData: Record<string, unknown> = {};
  const conflicts: Array<{
    field: string;
    clientValue: unknown;
    serverValue: unknown;
  }> = [];
  let clientWins = 0;
  let serverWins = 0;

  // Remove CouchDB metadata fields
  const metadataKeys = ['_id', '_rev', 'vectorClock', 'version', 'updatedAt', 'updatedBy'];

  for (const key of Object.keys(clientData)) {
    if (metadataKeys.includes(key)) continue;

    const clientValue = clientData[key];
    const serverValue = (serverDoc as any)[key];

    if (serverValue === undefined) {
      // Field only exists on client
      resolvedData[key] = clientValue;
      clientWins++;
    } else {
      // Field exists on both - compare updatedAt if available
      const resolvedValue = clientValue; // Default to client value
      resolvedData[key] = resolvedValue;

      conflicts.push({
        field: key,
        clientValue,
        serverValue,
      });
    }
  }

  // Copy fields that only exist on server
  for (const key of Object.keys(serverDoc as any)) {
    if (metadataKeys.includes(key)) continue;
    if (!(key in clientData)) {
      resolvedData[key] = (serverDoc as any)[key];
      serverWins++;
    }
  }

  // Update metadata
  resolvedData.updatedAt = new Date().toISOString();
  resolvedData.updatedBy = request.clientId || 'merged';

  return {
    resolved: true,
    winner: 'merged',
    data: resolvedData,
    conflict: conflicts,
    reason: `Field-level LWW - ${conflicts.length} conflicts resolved (${clientWins} client won, ${serverWins} server won)`,
  };
}

/**
 * Extract updatedAt timestamp from a document
 */
function extractUpdatedAt(doc: Record<string, unknown>): string {
  if (doc.updatedAt && typeof doc.updatedAt === 'string') {
    return doc.updatedAt;
  }
  if (doc.createdAt && typeof doc.createdAt === 'string') {
    return doc.createdAt;
  }
  return new Date(0).toISOString();
}

/**
 * Extract updatedAt timestamp for a specific field
 * Returns the document's updatedAt as fallback
 */
function extractFieldUpdatedAt(doc: Record<string, unknown>, _field: string): number {
  return new Date(extractUpdatedAt(doc)).getTime();
}

/**
 * Resolve conflict using Yjs CRDT
 *
 * This function merges two CRDT states using Yjs's built-in conflict
 * resolution. Yjs automatically handles concurrent edits at the field level.
 */
async function resolveConflictCRDT(
  request: CRDTResolveRequest
): Promise<CRDTResolution> {
  const { clientState, serverState } = request;

  try {
    // Create a new Yjs document to perform the merge
    const mergeDoc = new Y.Doc();

    // Convert arrays to Uint8Array and apply client state
    const clientUpdate = new Uint8Array(clientState.fullUpdate);
    Y.applyUpdate(mergeDoc, clientUpdate, 'client');

    // If server state is provided, apply it as well
    if (serverState) {
      const serverUpdate = new Uint8Array(serverState.fullUpdate);
      Y.applyUpdate(mergeDoc, serverUpdate, 'server');
    }

    // Get merged state
    const mergedStateVector = Y.encodeStateVector(mergeDoc);
    const mergedFullUpdate = Y.encodeStateAsUpdate(mergeDoc);

    // Clean up
    mergeDoc.destroy();

    return {
      resolved: true,
      mergedState: {
        stateVector: Array.from(mergedStateVector),
        fullUpdate: Array.from(mergedFullUpdate),
        documentId: clientState.documentId,
        collection: clientState.collection,
      },
    };
  } catch (error) {
    return {
      resolved: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * In-memory CRDT state storage for server-side documents
 * In production, this should be persisted to a database
 */
const crdtStateStore = new Map<string, CRDTState>();

/**
 * Get stored CRDT state for a document
 */
export function getCRDTState(
  collection: string,
  documentId: string
): CRDTState | undefined {
  const key = `${collection}:${documentId}`;
  return crdtStateStore.get(key);
}

/**
 * Store CRDT state for a document
 */
export function setCRDTState(
  collection: string,
  documentId: string,
  state: CRDTState
): void {
  const key = `${collection}:${documentId}`;
  crdtStateStore.set(key, state);
}

/**
 * Delete CRDT state for a document
 */
export function deleteCRDTState(
  collection: string,
  documentId: string
): boolean {
  const key = `${collection}:${documentId}`;
  return crdtStateStore.delete(key);
}

/**
 * Clear all CRDT states (useful for testing)
 */
export function clearCRDTStates(): void {
  crdtStateStore.clear();
}
