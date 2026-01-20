# 客户端 SDK 架构（The Edge）

## 概述

客户端 SDK 是嵌入到前端业务代码中的核心库，负责本地数据管理和与服务端的同步协调。

## 核心模块

### 1. 本地存储层（Local Store）

#### Web 端
```javascript
// 使用 IndexedDB 作为本地数据库
// 容量大，支持异步，比 localStorage 强大得多
const db = {
  name: 'offline-sync-db',
  stores: {
    // 业务数据表
    orders: { keyPath: 'id' },
    products: { keyPath: 'id' },
    users: { keyPath: 'id' },

    // 系统表
    outbox: { keyPath: 'id' },      // 变更操作队列
    sync_state: { keyPath: 'key' }, // 同步状态
    conflicts: { keyPath: 'id' }    // 冲突记录
  }
};
```

#### 移动端
- **iOS/Android**: SQLite 或 Realm
- 数据结构保持一致

### 2. 拦截器与操作队列（Outbox Pattern）

#### Action 对象结构
```javascript
{
  id: 'uuid-v4',
  type: 'CREATE | UPDATE | DELETE',
  table: 'orders',
  data: { /* 业务数据 */ },
  timestamp: 1678888888000,
  status: 'pending | syncing | completed | failed',
  retryCount: 0,
  clientId: 'device-uuid'
}
```

#### 工作流程
```
用户修改数据
    ↓
SDK 拦截请求
    ↓
生成 Action 对象
    ↓
存入 Outbox 表
    ↓
更新本地数据库
    ↓
UI 立即反馈成功
    ↓
（后台）Sync Engine 监听 Outbox
    ↓
网络可用时上传
```

### 3. 网络管理器（Network Manager）

#### 网络状态监听
```javascript
// 监听浏览器在线/离线事件
window.addEventListener('online', handleNetworkRestore);
window.addEventListener('offline', handleNetworkLost);

// 额外的健康检查
setInterval(() => {
  fetch('/health')
    .then(() => setNetworkStatus(true))
    .catch(() => setNetworkStatus(false));
}, 30000); // 每30秒检查一次
```

#### 指数退避算法（Exponential Backoff）
```
重试延迟计算：delay = baseDelay * (2 ^ attemptCount)

尝试次数    延迟时间
    1         1秒
    2         2秒
    3         4秒
    4         8秒
    5        16秒
    6        32秒
    ...      ...
   最大      5分钟（可配置）
```

**目的**：避免在弱网环境下过度消耗手机电量和流量

### 4. 状态机

```javascript
const syncStates = {
  IDLE: 'idle',           // 空闲，无需同步
  SYNCING: 'syncing',     // 正在同步
  CONFLICT: 'conflict',   // 存在冲突需要处理
  OFFLINE: 'offline'      // 离线状态
};
```

## SDK API 设计（草案）

### 初始化
```javascript
import { OfflineSync } from '@offline-sync/sdk';

const sync = new OfflineSync({
  endpoint: 'https://api.example.com/sync',
  dbName: 'my-app-db',
  clientId: await getDeviceId(),
  autoSync: true,
  retryLimit: 10
});

await sync.initialize();
```

### 数据操作
```javascript
// CRUD 操作会自动拦截并进入 Outbox
await sync.orders.create({ /* data */ });
await sync.orders.update(id, { /* changes */ });
await sync.orders.delete(id);

// 查询直接从本地返回（毫秒级）
const orders = await sync.orders.find({ status: 'pending' });
const order = await sync.orders.get(id);
```

### 事件监听
```javascript
// 监听同步状态
sync.on('statusChange', (status) => {
  console.log('Sync status:', status);
});

// 监听数据变更
sync.on('change', (docs) => {
  // 本地或远程数据发生变化
});

// 监听冲突
sync.on('conflict', (conflict) => {
  // 处理冲突
});
```

## 技术选型

### 推荐：RxDB

**优势：**
- 专为 JavaScript 设计的 NoSQL 数据库
- 底层自动支持 IndexedDB
- 自带 Replication 协议
- 支持 GraphQL 或 CouchDB 风格同步
- 响应式查询（基于 Observable）
- 完美契合 Offline First 理念

### 备选：PouchDB

**优势：**
- 老牌成熟库
- 完全兼容 CouchDB 协议
- 与 CouchDB 配合可实现零代码同步
- 极其稳定

## 目录结构（规划）

```
src/client/
├── db/                 # 数据库层
│   ├── indexeddb.ts
│   ├── schema.ts
│   └── migrations/
├── outbox/             # 操作队列
│   ├── outbox.ts
│   └── action.ts
├── network/            # 网络管理
│   ├── manager.ts
│   └── backoff.ts
├── sync/               # 同步引擎
│   ├── sync-engine.ts
│   └── conflict.ts
├── api/                # 对外 API
│   └── client.ts
└── types/              # 类型定义
    └── index.ts
```
