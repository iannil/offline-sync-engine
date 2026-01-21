# 客户端 API 规范

> **状态**：已实现
> **版本**：v1.0.0

## 初始化

### 构造函数

```typescript
import { OfflineSync } from '@offline-sync/sdk';

interface SyncConfig {
  endpoint: string;           // 同步服务端点
  dbName?: string;            // 本地数据库名称
  clientId?: string;          // 客户端标识（默认自动生成）
  autoSync?: boolean;         // 是否自动同步（默认 true）
  syncInterval?: number;      // 同步间隔（毫秒，默认 30000）
  retryLimit?: number;        // 重试次数限制（默认 10）
  compression?: boolean;      // 是否启用压缩（默认 true）
}

const sync = new OfflineSync({
  endpoint: 'https://api.example.com/sync',
  dbName: 'my-app-db',
  autoSync: true,
  retryLimit: 10
});
```

### 初始化方法

```typescript
await sync.initialize(): Promise<void>
```

## 数据库操作

### 创建集合

```typescript
interface CollectionSchema {
  name: string;
  fields: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'json'>;
  primaryKey?: string;
  indices?: string[];
}

await sync.createCollection(schema: CollectionSchema): Promise<void>

// 示例
await sync.createCollection({
  name: 'orders',
  primaryKey: 'id',
  fields: {
    id: 'string',
    customer_id: 'string',
    amount: 'number',
    status: 'string',
    items: 'json',
    created_at: 'date'
  },
  indices: ['customer_id', 'status']
});
```

### CRUD 操作

```typescript
// 创建
await sync.orders.create(data: object): Promise<string>

// 读取单条
await sync.orders.get(id: string): Promise<object | null>

// 查询
await sync.orders.find(query?: object): Promise<object[]>

// 更新
await sync.orders.update(id: string, changes: object): Promise<void>

// 删除
await sync.orders.delete(id: string): Promise<void>

// 批量操作
await sync.orders.batchCreate(items: object[]): Promise<string[]>
await sync.orders.batchUpdate(updates: Array<{id: string, changes: object}>): Promise<void>
await sync.orders.batchDelete(ids: string[]): Promise<void>
```

### 查询示例

```typescript
// 简单查询
const pending = await sync.orders.find({ status: 'pending' });

// 范围查询
const recent = await sync.orders.find({
  created_at: { $gte: '2025-01-01', $lt: '2025-02-01' }
});

// 排序和分页
const result = await sync.orders.find(
  { status: 'pending' },
  { sort: { created_at: -1 }, limit: 20, skip: 0 }
);

// 聚合查询
const stats = await sync.orders.aggregate([
  { $match: { status: 'completed' } },
  { $group: { _id: '$customer_id', total: { $sum: '$amount' } } }
]);
```

## 同步控制

### 手动同步

```typescript
// 触发一次完整的同步（推送 + 拉取）
await sync.sync(): Promise<SyncResult>

interface SyncResult {
  pushed: number;          // 成功推送的 Action 数量
  pulled: number;          // 拉取的变更数量
  conflicts: number;       // 检测到的冲突数量
  duration: number;        // 耗时（毫秒）
}

// 仅推送本地变更
await sync.push(): Promise<number>

// 仅拉取远程变更
await sync.pull(): Promise<number>
```

### 同步状态

```typescript
// 获取同步状态
const status = await sync.getStatus(): Promise<SyncStatus>

interface SyncStatus {
  state: 'idle' | 'syncing' | 'conflict' | 'offline';
  lastSyncTime: Date | null;
  pendingActions: number;
  networkQuality: '4g' | '3g' | '2g' | 'slow-2g' | 'unknown';
}

// 检查是否有待同步的变更
const hasPending = await sync.hasPending(): boolean
```

## 事件监听

```typescript
// 监听同步状态变化
sync.on('statusChange', callback: (status: SyncStatus) => void)

// 监听数据变更
sync.on('change', callback: (event: ChangeEvent) => void)

interface ChangeEvent {
  collection: string;
  documentId: string;
  type: 'create' | 'update' | 'delete';
  document: object;
  origin: 'local' | 'remote';
}

// 监听冲突
sync.on('conflict', callback: (conflict: Conflict) => void)

interface Conflict {
  id: string;
  collection: string;
  documentId: string;
  localValue: object;
  remoteValue: object;
  localTimestamp: number;
  remoteTimestamp: number;
}

// 监听网络状态
sync.on('networkChange', callback: (online: boolean) => void)

// 监听错误
sync.on('error', callback: (error: Error) => void)

// 移除监听
sync.off(eventName: string, callback: Function)
```

## 冲突处理

```typescript
// 获取所有未解决的冲突
const conflicts = await sync.getConflicts(): Promise<Conflict[]>

// 解决冲突
await sync.resolveConflict(
  conflictId: string,
  resolution: 'local' | 'remote' | 'custom',
  customValue?: object
): Promise<void>

// 批量解决冲突（全部使用本地/远程版本）
await sync.resolveAllConflicts(resolution: 'local' | 'remote'): Promise<void>
```

## 网络控制

```typescript
// 暂停自动同步
sync.pause(): void

// 恢复自动同步
sync.resume(): void

// 设置离线模式（暂停所有网络请求）
sync.goOffline(): void

// 设置在线模式
sync.goOnline(): void

// 检测网络质量
const quality = await sync.detectNetworkQuality(): Promise<NetworkQuality>

interface NetworkQuality {
  type: '4g' | '3g' | '2g' | 'slow-2g' | 'unknown';
  downlink: number;     // 带宽估算 (Mbps)
  rtt: number;          // 往返时间 (ms)
  saveData: boolean;    // 是否开启省流量模式
}
```

## 文件上传

```typescript
// 上传文件（支持断点续传）
const upload = sync.uploadFile(file: File, metadata?: object): FileUpload

interface FileUpload {
  // 进度监听
  onProgress(callback: (progress: number) => void): void;

  // 取消上传
  cancel(): void;

  // 等待完成
  waitForComplete(): Promise<string>;  // 返回文件 URL
}

// 示例
const fileUpload = sync.uploadFile(file, { type: 'attachment' });
fileUpload.onProgress((percent) => {
  console.log(`上传进度: ${percent}%`);
});
const url = await fileUpload.waitForComplete();
```

## 清理与销毁

```typescript
// 清理已完成的 Action（保留最近 N 天）
await sync.cleanup(keepDays?: number): Promise<number>

// 清理所有本地数据
await sync.clear(): Promise<void>

// 销毁同步实例
await sync.destroy(): Promise<void>
```

## 完整示例

```typescript
import { OfflineSync } from '@offline-sync/sdk';

// 初始化
const sync = new OfflineSync({
  endpoint: 'https://api.example.com/sync',
  dbName: 'my-app-db',
  autoSync: true
});

await sync.initialize();

// 创建集合
await sync.createCollection({
  name: 'orders',
  primaryKey: 'id',
  fields: {
    id: 'string',
    customer_id: 'string',
    amount: 'number',
    status: 'string',
    created_at: 'date'
  }
});

// 监听事件
sync.on('statusChange', (status) => {
  console.log('同步状态:', status.state);
});

sync.on('change', (event) => {
  console.log('数据变更:', event);
  updateUI();
});

sync.on('conflict', async (conflict) => {
  const resolution = await showConflictDialog(conflict);
  await sync.resolveConflict(conflict.id, resolution);
});

// 业务操作
async function createOrder(data) {
  const id = await sync.orders.create({
    ...data,
    created_at: new Date().toISOString()
  });
  return id;
}

async function getPendingOrders() {
  return await sync.orders.find({ status: 'pending' });
}

// 清理
await sync.cleanup(30);  // 保留30天
```

## CRDT 模块 (协作冲突解决)

CRDT（Conflict-free Replicated Data Types）模块提供字段级的自动冲突解决能力，适用于多客户端协作编辑场景。

### 导入与初始化

```typescript
import { CRDTManager, createCRDTManager } from '@offline-sync/sdk';

// 创建 CRDT 管理器
const crdt = createCRDTManager({
  clientId: 'user-123',        // 可选，默认自动生成
  gc: true,                    // 是否启用垃圾回收
  onLocalChange: (update) => { // 本地变更回调
    // 发送 update 到服务器
    syncToServer(update);
  }
});
```

### 文档操作

```typescript
// 获取或创建文档
const doc = crdt.getDocument('todos', 'todo-1');

// 检查文档是否存在
const exists = crdt.hasDocument('todos', 'todo-1');

// 删除文档
crdt.deleteDocument('todos', 'todo-1');

// 获取所有文档键
const keys = crdt.getDocumentKeys();
// 返回: [{ collection: 'todos', documentId: 'todo-1' }, ...]
```

### 字段操作

```typescript
// 设置单个字段
crdt.setField('todos', 'todo-1', 'text', 'Buy groceries');
crdt.setField('todos', 'todo-1', 'completed', false);

// 设置多个字段
crdt.setFields('todos', 'todo-1', {
  text: 'Buy groceries',
  completed: false,
  priority: 'high',
  tags: ['shopping', 'urgent']
});

// 获取单个字段
const text = crdt.getField('todos', 'todo-1', 'text');

// 获取所有字段名
const fieldNames = crdt.getFields('todos', 'todo-1');
// 返回: ['text', 'completed', 'priority', 'tags']

// 获取所有数据
const data = crdt.getData('todos', 'todo-1');
// 返回: { text: 'Buy groceries', completed: false, ... }
```

### 同步状态

```typescript
// 获取文档状态（用于同步）
const state = crdt.getState('todos', 'todo-1');
// state: { stateVector, fullUpdate, documentId, collection }

// 获取增量更新
const update = crdt.getIncrementalUpdate('todos', 'todo-1', sinceStateVector);

// 应用远程更新
crdt.applyUpdate({
  update: remoteUpdate,
  documentId: 'todo-1',
  collection: 'todos',
  origin: 'remote-client'
});

// 应用完整状态
crdt.applyState(remoteState);

// 合并状态
const mergedState = crdt.merge('todos', 'todo-1', remoteState);

// 标记已同步
crdt.markSynced('todos', 'todo-1', stateVector);
```

### 序列化

```typescript
// 状态序列化为 Base64（便于网络传输）
const base64State = CRDTManager.stateToBase64(state);

// 从 Base64 反序列化
const state = CRDTManager.stateFromBase64(base64State);

// 更新序列化
const base64Update = CRDTManager.updateToBase64(update);
const update = CRDTManager.updateFromBase64(base64Update);
```

### 清理

```typescript
// 获取客户端 ID
const clientId = crdt.getClientId();

// 销毁管理器
crdt.destroy();
```

### 完整 CRDT 示例

```typescript
import { createCRDTManager, CRDTManager } from '@offline-sync/sdk';

// 客户端 A
const crdtA = createCRDTManager({ clientId: 'client-A' });

// 客户端 B
const crdtB = createCRDTManager({ clientId: 'client-B' });

// 客户端 A 创建文档
crdtA.setFields('todos', 'shared-todo', {
  text: 'Collaborative todo',
  status: 'pending'
});

// 同步到客户端 B
const stateA = crdtA.getState('todos', 'shared-todo');
crdtB.applyState(stateA);

// 两个客户端同时修改不同字段
crdtA.setField('todos', 'shared-todo', 'status', 'in-progress');
crdtB.setField('todos', 'shared-todo', 'priority', 'high');

// 合并状态
const stateB = crdtB.getState('todos', 'shared-todo');
const merged = crdtA.merge('todos', 'shared-todo', stateB);

// 两个修改都被保留
console.log(crdtA.getData('todos', 'shared-todo'));
// { text: 'Collaborative todo', status: 'in-progress', priority: 'high' }

// 清理
crdtA.destroy();
crdtB.destroy();
```

### 与服务器同步

```typescript
import { createCRDTManager } from '@offline-sync/sdk';

const crdt = createCRDTManager({
  clientId: 'user-123',
  onLocalChange: async (update) => {
    // 当本地有变更时，发送到服务器
    await fetch('/api/arbiter/resolve/crdt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientState: {
          stateVector: Array.from(update.update),
          fullUpdate: Array.from(crdt.getState(update.collection, update.documentId).fullUpdate),
          documentId: update.documentId,
          collection: update.collection
        },
        clientId: crdt.getClientId()
      })
    });
  }
});

// 从服务器拉取更新
async function pullFromServer(collection: string, documentId: string) {
  const response = await fetch(`/api/sync/pull?collection=${collection}&documentId=${documentId}`);
  const { crdtState } = await response.json();

  if (crdtState) {
    crdt.applyState({
      stateVector: new Uint8Array(crdtState.stateVector),
      fullUpdate: new Uint8Array(crdtState.fullUpdate),
      documentId,
      collection
    });
  }
}
```
