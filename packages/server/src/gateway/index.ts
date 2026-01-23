/**
 * Gateway module - handles client synchronization requests
 * @module gateway
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { applyBatchActions } from '../applier/index.js';
import { getChanges, getDocument, queryDocuments } from '../database/index.js';
import { encode, decode } from '@msgpack/msgpack';
import { deflate, inflate } from 'pako';

/**
 * Push request from client
 */
interface PushRequest {
  actions: Array<{
    id: string;
    type: 'CREATE' | 'UPDATE' | 'DELETE';
    collection: string;
    documentId: string;
    data: Record<string, unknown>;
    timestamp: number;
  }>;
}

/**
 * Push response to client
 */
interface PushResponse {
  succeeded: string[];
  failed: Array<{ actionId: string; error: string }>;
}

/**
 * Pull request parameters
 */
interface PullQuery {
  since?: string;
  collection?: string;
  limit?: number;
}

/**
 * Pull response item
 */
interface PullItem {
  collection: string;
  document: Record<string, unknown>;
  timestamp: number;
  seq: string;
}

/**
 * Pull response to client
 */
interface PullResponse {
  items: PullItem[];
  since: string;
  hasMore: boolean;
}

/**
 * In-memory change log for real-time broadcasting
 */
interface ChangeRecord {
  collection: string;
  documentId: string;
  document: Record<string, unknown>;
  timestamp: number;
  seq: string;
}

/**
 * Compression utilities
 */
function compressData(data: unknown): Uint8Array {
  const encoded = encode(data);
  return deflate(encoded);
}

function decompressData<T = unknown>(data: string | Uint8Array): T {
  let uint8Data: Uint8Array;

  if (typeof data === 'string') {
    // Assume base64 encoded
    uint8Data = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } else {
    uint8Data = data;
  }

  const inflated = inflate(uint8Data);
  return decode(inflated) as T;
}

function isCompressedRequest(contentType?: string): boolean {
  if (!contentType) return false;
  return contentType.includes('msgpack') || contentType.includes('deflate');
}

const changeLog: ChangeRecord[] = [];
const subscribers = new Set<FastifyInstance>();

/**
 * Subscribe a connection to changes
 */
export function subscribeToChanges(fastify: FastifyInstance) {
  subscribers.add(fastify);
  return () => subscribers.delete(fastify);
}

/**
 * Broadcast a change to all subscribers
 */
export async function broadcastChange(change: ChangeRecord) {
  changeLog.push(change);

  // Keep only recent changes (last 1000)
  if (changeLog.length > 1000) {
    changeLog.splice(0, changeLog.length - 1000);
  }

  // Notify all WebSocket subscribers
  for (const sub of subscribers) {
    try {
      // WebSocket is available via @fastify/websocket
      const ws = (sub as unknown as { websocket?: { send: (data: string) => void } }).websocket;
      if (ws) {
        ws.send(JSON.stringify({
          type: 'change',
          data: change,
        }));
      }
    } catch (error) {
      console.error('Failed to send change notification:', error);
    }
  }
}

/**
 * Register gateway routes
 */
export async function registerGatewayRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) {
  /**
   * POST /api/sync/push - Receive client actions
   */
  fastify.post('/push', async (request, reply) => {
    const contentType = request.headers['content-type'] || '';
    const acceptCompression = request.headers['accept']?.includes('msgpack');

    let body: PushRequest | undefined;

    try {
      // Check if request is compressed
      if (isCompressedRequest(contentType)) {
        // Parse compressed request body
        const rawBody = request.raw as unknown as { body: string | Uint8Array };
        body = decompressData<PushRequest>(rawBody.body || request.body as string);
      } else {
        body = request.body as PushRequest;
      }

      // Apply actions using the Applier module
      const result = await applyBatchActions(body.actions);

      // Broadcast successful changes to other clients
      for (const actionId of result.succeeded) {
        const action = body.actions.find((a) => a.id === actionId);
        if (action) {
          // Get the updated document
          const doc = await getDocument(action.collection, action.documentId);

          await broadcastChange({
            collection: action.collection,
            documentId: action.documentId,
            document: doc || action.data,
            timestamp: Date.now(),
            seq: `${Date.now()}`,
          });
        }
      }

      const response: PushResponse = result;

      // Return compressed response if client supports it
      if (acceptCompression) {
        reply.header('Content-Type', 'application/msgpack+deflate');
        reply.header('X-Compression', 'msgpack-deflate');
        reply.send(compressData(response));
        return reply;
      }

      return response;
    } catch (error) {
      reply.code(500);

      const response = {
        succeeded: [],
        failed: (body?.actions || []).map((a: any) => ({
          actionId: a.id,
          error: error instanceof Error ? error.message : String(error),
        })),
      };

      if (acceptCompression) {
        reply.header('Content-Type', 'application/msgpack+deflate');
        reply.header('X-Compression', 'msgpack-deflate');
        reply.send(compressData(response));
        return reply;
      }

      return response;
    }
  });

  /**
   * GET /api/sync/pull - Send changes to client (incremental sync)
   */
  fastify.get('/pull', async (request, reply) => {
    const query = request.query as PullQuery;
    const since = query.since || '0';
    const limit = query.limit ? Number(query.limit) : 100;
    const collection = query.collection || 'todos';
    const acceptCompression = request.headers['accept']?.includes('msgpack');

    try {
      // Get changes from CouchDB _changes feed
      const couchdbChanges = await getChanges(collection, since, limit);

      // Convert to pull response format
      const items: PullItem[] = couchdbChanges
        .filter((change) => !change.deleted && change.doc)
        .map((change) => ({
          collection,
          document: {
            id: change.doc._id,
            ...change.doc,
          },
          timestamp: change.doc.updatedAt
            ? new Date(change.doc.updatedAt as string).getTime()
            : Date.now(),
          seq: change.seq,
        }));

      // Get the latest seq for next request
      const latestSeq = couchdbChanges.length > 0
        ? couchdbChanges[couchdbChanges.length - 1].seq
        : since;

      const response: PullResponse = {
        items,
        since: latestSeq,
        hasMore: couchdbChanges.length === limit,
      };

      // Return compressed response if client supports it
      if (acceptCompression) {
        reply.header('Content-Type', 'application/msgpack+deflate');
        reply.header('X-Compression', 'msgpack-deflate');
        reply.send(compressData(response));
        return reply;
      }

      return response;
    } catch (error) {
      reply.code(500);

      const response = {
        error: error instanceof Error ? error.message : String(error),
        items: [],
        since: query.since || '0',
        hasMore: false,
      };

      if (acceptCompression) {
        reply.header('Content-Type', 'application/msgpack+deflate');
        reply.header('X-Compression', 'msgpack-deflate');
        reply.send(compressData(response));
        return reply;
      }

      return response;
    }
  });

  /**
   * GET /api/sync/status - Get sync status
   */
  fastify.get('/status', async () => {
    return {
      status: 'ok',
      pendingChanges: changeLog.length,
      lastUpdate:
        changeLog.length > 0
          ? changeLog[changeLog.length - 1].timestamp
          : null,
      connectedClients: subscribers.size,
    };
  });

  /**
   * GET /api/sync/:collection - Get all documents in a collection
   */
  fastify.get('/:collection', async (request, reply) => {
    const { collection } = request.params as { collection: string };

    try {
      // Get non-deleted documents
      const docs = await queryDocuments(collection, {
        deleted: { $ne: true },
      });

      return {
        collection,
        documents: docs,
        count: docs.length,
      };
    } catch (error) {
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : String(error),
        collection,
        documents: [],
        count: 0,
      };
    }
  });

  /**
   * GET /api/sync/:collection/:id - Get a specific document
   */
  fastify.get('/:collection/:id', async (request, reply) => {
    const { collection, id } = request.params as { collection: string; id: string };

    try {
      const doc = await getDocument(collection, id);
      if (!doc) {
        reply.code(404);
        return {
          error: 'Document not found',
        };
      }

      // Check if soft-deleted
      if ((doc as any).deleted) {
        reply.code(404);
        return {
          error: 'Document not found',
        };
      }

      return doc;
    } catch (error) {
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
