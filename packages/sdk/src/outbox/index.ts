/**
 * Outbox module - queues write operations for background synchronization
 * @module outbox
 */

import { Observable } from 'rxjs';
import type { RxCollection } from 'rxdb';
import type { OutboxAction } from '../storage/schema.js';

/**
 * Action types for outbox operations
 */
export enum ActionType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/**
 * Action status in the outbox
 */
export enum ActionStatus {
  PENDING = 'pending',
  SYNCING = 'syncing',
  DONE = 'done',
  FAILED = 'failed',
}

/**
 * Configuration for outbox manager
 */
export interface OutboxConfig {
  maxRetries?: number;
  retryDelay?: number;
  retryBackoffMultiplier?: number;
  maxRetryDelay?: number;
}

/**
 * Result of an action enqueue operation
 */
export interface EnqueueResult {
  actionId: string;
  enqueuedAt: number;
}

/**
 * Outbox manager - queues and processes write operations
 */
export class OutboxManager {
  private outboxCollection: RxCollection;
  private config: Required<OutboxConfig>;

  private defaultConfig: Required<OutboxConfig> = {
    maxRetries: 5,
    retryDelay: 1000,
    retryBackoffMultiplier: 2,
    maxRetryDelay: 60000,
  };

  constructor(
    outboxCollection: RxCollection,
    config: OutboxConfig = {}
  ) {
    this.outboxCollection = outboxCollection;
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Enqueue a new action to the outbox
   *
   * @param type - Type of action (CREATE, UPDATE, DELETE)
   * @param collection - Target collection name
   * @param documentId - ID of the affected document
   * @param data - Document data (for CREATE/UPDATE)
   * @returns Promise resolving to the enqueue result
   */
  async enqueue(
    type: ActionType,
    collection: string,
    documentId: string,
    data: Record<string, unknown> = {}
  ): Promise<EnqueueResult> {
    const action: Omit<OutboxAction, 'status'> = {
      id: this.generateActionId(),
      type,
      collection,
      documentId,
      data,
      timestamp: Date.now(),
      retryCount: 0,
    };

    await this.outboxCollection.insert({
      ...action,
      status: ActionStatus.PENDING,
    });

    return {
      actionId: action.id,
      enqueuedAt: action.timestamp,
    };
  }

  /**
   * Get pending actions from the outbox
   *
   * @param limit - Maximum number of actions to retrieve
   * @returns Promise resolving to pending actions
   */
  async getPending(limit = 50): Promise<OutboxAction[]> {
    const result = await this.outboxCollection
      .find({
        selector: {
          status: ActionStatus.PENDING,
        },
        sort: [{ timestamp: 'asc' }],
      })
      .limit(limit)
      .exec();

    return result.map((doc: any) => doc.toJSON());
  }

  /**
   * Get actions by status
   *
   * @param status - Action status to filter by
   * @returns Promise resolving to matching actions
   */
  async getByStatus(status: ActionStatus): Promise<OutboxAction[]> {
    const result = await this.outboxCollection
      .find({
        selector: {
          status,
        },
        sort: [{ timestamp: 'asc' }],
      })
      .exec();

    return result.map((doc: any) => doc.toJSON());
  }

  /**
   * Update action status
   *
   * @param actionId - ID of the action to update
   * @param status - New status
   * @param error - Optional error message
   */
  async updateStatus(
    actionId: string,
    status: ActionStatus,
    error?: string
  ): Promise<void> {
    const doc = await this.outboxCollection
      .findOne()
      .where('id')
      .equals(actionId)
      .exec();

    if (doc) {
      await doc.patch({
        status,
        error,
        retryCount: status === ActionStatus.FAILED ? (doc.get('retryCount') ?? 0) + 1 : doc.get('retryCount'),
      });
    }
  }

  /**
   * Mark an action as syncing
   *
   * @param actionId - ID of the action to update
   */
  async markSyncing(actionId: string): Promise<void> {
    await this.updateStatus(actionId, ActionStatus.SYNCING);
  }

  /**
   * Mark an action as done (successfully synced)
   *
   * @param actionId - ID of the action to update
   */
  async markDone(actionId: string): Promise<void> {
    await this.updateStatus(actionId, ActionStatus.DONE);
  }

  /**
   * Mark an action as failed
   *
   * @param actionId - ID of the action to update
   * @param error - Error message
   */
  async markFailed(actionId: string, error: string): Promise<void> {
    await this.updateStatus(actionId, ActionStatus.FAILED, error);
  }

  /**
   * Calculate retry delay with exponential backoff
   *
   * @param retryCount - Current retry count
   * @returns Delay in milliseconds
   */
  calculateRetryDelay(retryCount: number): number {
    const delay = this.config.retryDelay * Math.pow(this.config.retryBackoffMultiplier, retryCount);
    return Math.min(delay, this.config.maxRetryDelay);
  }

  /**
   * Get actions that can be retried
   *
   * @returns Promise resolving to retryable actions
   */
  async getRetryable(): Promise<OutboxAction[]> {
    const now = Date.now();
    const failedActions = await this.getByStatus(ActionStatus.FAILED);

    return failedActions.filter((action) => {
      const retryCount = action.retryCount ?? 0;
      if (retryCount >= this.config.maxRetries) {
        return false;
      }

      const retryDelay = this.calculateRetryDelay(retryCount);
      const retryAt = action.timestamp + retryDelay;

      return now >= retryAt;
    });
  }

  /**
   * Remove completed actions from the outbox
   *
   * @param olderThan - Remove actions older than this timestamp (default: 24 hours)
   */
  async cleanup(olderThan?: number): Promise<number> {
    const cutoff = olderThan ?? Date.now() - 24 * 60 * 60 * 1000;

    const result = await this.outboxCollection
      .find({
        selector: {
          status: ActionStatus.DONE,
          timestamp: { $lt: cutoff },
        },
      })
      .exec();

    for (const doc of result as any[]) {
      await doc.remove();
    }

    return result.length;
  }

  /**
   * Get count of actions by status
   */
  async getCountByStatus(): Promise<Record<ActionStatus, number>> {
    const counts: Record<string, number> = {};

    for (const status of Object.values(ActionStatus)) {
      const result = await this.outboxCollection
        .find()
        .where('status')
        .equals(status)
        .exec();
      counts[status] = result.length;
    }

    return counts as Record<ActionStatus, number>;
  }

  /**
   * Observe changes to the outbox
   */
  observe$(): Observable<OutboxAction[]> {
    return this.outboxCollection.$.pipe(
      // Map query results to plain objects
      // @ts-ignore - RxDB observable types
      map((docs: any[]) => docs.map((doc) => doc.toJSON()))
    );
  }

  /**
   * Generate a unique action ID
   */
  private generateActionId(): string {
    return `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Clear all actions from the outbox
   */
  async clear(): Promise<void> {
    await this.outboxCollection.remove();
  }
}

/**
 * Helper function for RxJS import
 */
function map<T, R>(fn: (value: T) => R) {
  return (source: Observable<T>): Observable<R> =>
    new Observable((subscriber) => {
      const subscription = source.subscribe({
        next: (value) => subscriber.next(fn(value)),
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });
      return () => subscription.unsubscribe();
    });
}
