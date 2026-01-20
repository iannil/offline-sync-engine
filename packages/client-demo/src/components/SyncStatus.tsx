import { useEffect, useState } from 'react';
import type { NetworkManager, SyncManager } from '@offline-sync/sdk';

interface SyncStatusProps {
  networkManager: NetworkManager;
  syncManager: SyncManager | null;
}

interface SyncState {
  isSyncing: boolean;
  lastSyncAt: number;
  pendingCount: number;
  error: string | null;
}

export function SyncStatus({ networkManager, syncManager }: SyncStatusProps) {
  const [syncState, setSyncState] = useState<SyncState>({
    isSyncing: false,
    lastSyncAt: 0,
    pendingCount: 0,
    error: null,
  });
  const [networkQuality, setNetworkQuality] = useState<string>('excellent');

  useEffect(() => {
    // Subscribe to network quality changes
    const qualitySub = networkManager.quality$.subscribe((quality) => {
      setNetworkQuality(quality);
    });

    return () => {
      qualitySub.unsubscribe();
    };
  }, [networkManager]);

  useEffect(() => {
    if (!syncManager) return;

    // Get initial state
    setSyncState(syncManager.getState());

    // Subscribe to state changes
    const unsubscribe = syncManager.onStateChange((state) => {
      setSyncState(state);
    });

    return unsubscribe;
  }, [syncManager]);

  const formatLastSync = (timestamp: number): string => {
    if (!timestamp) return '从未同步';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}秒前`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
    return `${Math.floor(seconds / 3600)}小时前`;
  };

  const getNetworkQualityIndicator = (quality: string): string => {
    switch (quality) {
      case 'excellent':
        return '🟢 极佳';
      case 'good':
        return '🟡 良好';
      case 'fair':
        return '🟠 一般';
      case 'poor':
        return '🔴 较差';
      case 'offline':
        return '⚫ 离线';
      default:
        return '⚪ 未知';
    }
  };

  const getSyncStatusIndicator = (): string => {
    if (syncState.error) return '⚠️ 同步错误';
    if (syncState.isSyncing) return '🔄 同步中';
    if (syncState.pendingCount > 0) return '⏳ 待同步';
    return '✅ 已同步';
  };

  return (
    <div className="sync-status">
      <div className="sync-status-item">
        <span className="sync-label">网络质量:</span>
        <span className="sync-value">{getNetworkQualityIndicator(networkQuality)}</span>
      </div>
      <div className="sync-status-item">
        <span className="sync-label">同步状态:</span>
        <span className="sync-value">{getSyncStatusIndicator()}</span>
      </div>
      <div className="sync-status-item">
        <span className="sync-label">待同步操作:</span>
        <span className="sync-value">{syncState.pendingCount}</span>
      </div>
      <div className="sync-status-item">
        <span className="sync-label">最后同步:</span>
        <span className="sync-value">{formatLastSync(syncState.lastSyncAt)}</span>
      </div>
      {syncManager && (
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => syncManager.triggerSync()}
          disabled={syncState.isSyncing || !networkManager.isOnline}
        >
          立即同步
        </button>
      )}
    </div>
  );
}
