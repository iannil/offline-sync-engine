/**
 * Applier module - applies client actions to CouchDB
 * @module applier
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  getDocument,
  insertDocument,
  updateDocument,
  deleteDocument,
  bulkInsert,
  getDatabaseInfo,
} from '../database/index.js';

/**
 * Action to apply
 */
export interface Action {
  id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  collection: string;
  documentId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/**
 * Apply result
 */
export interface ApplyResult {
  success: boolean;
  documentId: string;
  rev?: string;
  error?: string;
}

/**
 * Batch apply result
 */
export interface BatchApplyResult {
  succeeded: string[];
  failed: Array<{ actionId: string; error: string }>;
}

/**
 * Register applier routes
 */
export async function registerApplierRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  /**
   * POST /api/applier/apply - Apply a single action
   */
  fastify.post('/apply', async (request, reply) => {
    const action = request.body as Action;

    try {
      const result = await applyAction(action);
      return result;
    } catch (error) {
      reply.code(400);
      return {
        success: false,
        documentId: action.documentId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * POST /api/applier/batch - Apply multiple actions
   */
  fastify.post('/batch', async (request, reply) => {
    const actions = request.body as Action[];
    const results = await applyBatchActions(actions);
    return results;
  });

  /**
   * GET /api/applier/document/:collection/:id - Get a document
   */
  fastify.get('/document/:collection/:id', async (request, reply) => {
    const { collection, id } = request.params as { collection: string; id: string };

    try {
      const doc = await getDocument(collection, id);
      if (!doc) {
        reply.code(404);
        return { error: 'Document not found' };
      }
      return doc;
    } catch (error) {
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * GET /api/applier/info/:collection - Get database info
   */
  fastify.get('/info/:collection', async (request, reply) => {
    const { collection } = request.params as { collection: string };

    try {
      const info = await getDatabaseInfo(collection);
      return info;
    } catch (error) {
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/**
 * Apply a single action to CouchDB
 */
async function applyAction(action: Action): Promise<ApplyResult> {
  const { type, collection, documentId, data } = action;

  try {
    switch (type) {
      case 'CREATE': {
        // Check if document already exists
        const existing = await getDocument(collection, documentId);
        if (existing) {
          return {
            success: false,
            documentId,
            error: 'Document already exists',
          };
        }

        // Insert new document with CouchDB _id
        const doc = await insertDocument(collection, {
          _id: documentId,
          ...data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        return {
          success: true,
          documentId,
          rev: (doc as any).rev,
        };
      }

      case 'UPDATE': {
        // Get existing document
        const existing = await getDocument(collection, documentId);
        if (!existing) {
          return {
            success: false,
            documentId,
            error: 'Document not found',
          };
        }

        // Merge updates with existing document
        const updatedDoc = {
          ...existing,
          ...data,
          _id: documentId,
          _rev: (existing as any)._rev,
          updatedAt: new Date().toISOString(),
        };

        const result = await updateDocument(collection, updatedDoc);

        return {
          success: true,
          documentId,
          rev: (result as any).rev,
        };
      }

      case 'DELETE': {
        // Get existing document
        const existing = await getDocument(collection, documentId);
        if (!existing) {
          return {
            success: false,
            documentId,
            error: 'Document not found',
          };
        }

        // Delete document (soft delete preferred for sync)
        const rev = (existing as any)._rev;

        // For soft delete, we update with deleted flag
        await updateDocument(collection, {
          ...existing,
          _id: documentId,
          _rev: rev,
          deleted: true,
          updatedAt: new Date().toISOString(),
        });

        return {
          success: true,
          documentId,
        };
      }

      default:
        return {
          success: false,
          documentId,
          error: `Unknown action type: ${type}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      documentId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply multiple actions in batch
 */
export async function applyBatchActions(actions: Action[]): Promise<BatchApplyResult> {
  const succeeded: string[] = [];
  const failed: Array<{ actionId: string; error: string }> = [];

  // Group actions by collection for bulk operations
  const actionsByCollection = new Map<string, Action[]>();
  for (const action of actions) {
    if (!actionsByCollection.has(action.collection)) {
      actionsByCollection.set(action.collection, []);
    }
    actionsByCollection.get(action.collection)!.push(action);
  }

  // Process each collection's actions
  for (const [collection, collectionActions] of actionsByCollection) {
    // Prepare bulk documents
    const bulkDocs: Array<{ _id: string; _rev?: string; deleted?: boolean }> = [];

    for (const action of collectionActions) {
      try {
        switch (action.type) {
          case 'CREATE': {
            // Check if exists first
            const existing = await getDocument(collection, action.documentId);
            if (existing) {
              failed.push({ actionId: action.id, error: 'Document already exists' });
              continue;
            }
            bulkDocs.push({
              _id: action.documentId,
              ...action.data,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            break;
          }
          case 'UPDATE': {
            const existing = await getDocument(collection, action.documentId);
            if (!existing) {
              failed.push({ actionId: action.id, error: 'Document not found' });
              continue;
            }
            bulkDocs.push({
              ...(existing as any),
              ...action.data,
              _id: action.documentId,
              _rev: (existing as any)._rev,
              updatedAt: new Date().toISOString(),
            });
            break;
          }
          case 'DELETE': {
            const existing = await getDocument(collection, action.documentId);
            if (!existing) {
              failed.push({ actionId: action.id, error: 'Document not found' });
              continue;
            }
            bulkDocs.push({
              ...(existing as any),
              _id: action.documentId,
              _rev: (existing as any)._rev,
              deleted: true,
              updatedAt: new Date().toISOString(),
            });
            break;
          }
        }
      } catch (error) {
        failed.push({
          actionId: action.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Bulk insert/update for this collection
    if (bulkDocs.length > 0) {
      try {
        const results = await bulkInsert(collection, bulkDocs);

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const action = collectionActions[i];

          if (result.ok) {
            succeeded.push(action.id);
          } else {
            failed.push({
              actionId: action.id,
              error: result.error || 'Unknown error',
            });
          }
        }
      } catch (error) {
        // If bulk fails, try individual operations
        for (const doc of bulkDocs) {
          try {
            const action = collectionActions.find((a) => a.documentId === doc._id);
            if (!action) continue;

            const result = await applyAction(action);
            if (result.success) {
              succeeded.push(action.id);
            } else {
              failed.push({
                actionId: action.id,
                error: result.error || 'Unknown error',
              });
            }
          } catch (err) {
            failed.push({
              actionId: doc._id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
  }

  return { succeeded, failed };
}
