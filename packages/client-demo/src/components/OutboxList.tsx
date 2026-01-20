import { useEffect, useState } from 'react';
import { ActionStatus } from '@offline-sync/sdk/outbox';
import type { OutboxManager, OutboxAction } from '@offline-sync/sdk';

interface OutboxListProps {
  outboxManager: OutboxManager;
}

export function OutboxList({ outboxManager }: OutboxListProps) {
  const [actions, setActions] = useState<OutboxAction[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    async function loadOutbox() {
      // Get all pending actions
      const pending = await outboxManager.getPending(100);
      setActions(pending);

      // Get counts by status
      const counts = await outboxManager.getCountByStatus();
      setCounts(counts);

      // Subscribe to changes
      subscription = outboxManager.observe$().subscribe((results) => {
        setActions(results.slice(0, 100));
      });
    }

    loadOutbox();

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [outboxManager]);

  const handleRetry = async (actionId: string) => {
    await outboxManager.updateStatus(actionId, ActionStatus.PENDING);
  };

  const handleClear = async () => {
    await outboxManager.clear();
    setActions([]);
  };

  const getActionTypeIcon = (type: string): string => {
    switch (type) {
      case 'CREATE':
        return '➕';
      case 'UPDATE':
        return '✏️';
      case 'DELETE':
        return '🗑️';
      default:
        return '❓';
    }
  };

  const getStatusBadge = (status: string): string => {
    switch (status) {
      case ActionStatus.PENDING:
        return '⏳ 待处理';
      case 'syncing':
        return '🔄 同步中';
      case 'done':
        return '✅ 完成';
      case 'failed':
        return '❌ 失败';
      default:
        return status;
    }
  };

  const getStatusClass = (status: string): string => {
    switch (status) {
      case ActionStatus.PENDING:
        return 'status-pending';
      case 'syncing':
        return 'status-syncing';
      case 'done':
        return 'status-done';
      case 'failed':
        return 'status-failed';
      default:
        return '';
    }
  };

  return (
    <div className="outbox-list">
      <div className="outbox-header">
        <h3>同步队列</h3>
        <div className="outbox-stats">
          <span>待处理: {counts.pending || 0}</span>
          <span>同步中: {counts.syncing || 0}</span>
          <span>失败: {counts.failed || 0}</span>
        </div>
        <button className="btn btn-sm btn-secondary" onClick={handleClear}>
          清空已完成
        </button>
      </div>

      {actions.length === 0 ? (
        <div className="empty-state">
          <p>队列为空</p>
        </div>
      ) : (
        <ul className="outbox-items">
          {actions.map((action) => (
            <li key={action.id} className={`outbox-item ${getStatusClass(action.status)}`}>
              <div className="outbox-item-header">
                <span className="outbox-item-type">
                  {getActionTypeIcon(action.type)} {action.type}
                </span>
                <span className={`outbox-item-status ${getStatusClass(action.status)}`}>
                  {getStatusBadge(action.status)}
                </span>
              </div>
              <div className="outbox-item-details">
                <span className="outbox-item-collection">
                  集合: {action.collection}
                </span>
                <span className="outbox-item-id">
                  ID: {action.documentId.slice(0, 8)}...
                </span>
                <span className="outbox-item-timestamp">
                  {new Date(action.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {action.error && (
                <div className="outbox-item-error">
                  错误: {action.error}
                </div>
              )}
              {action.status === 'failed' && (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => handleRetry(action.id)}
                >
                  重试
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
