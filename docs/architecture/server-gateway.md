# 服务端同步网关（The Hub）

## 概述

服务端同步网关是离线同步引擎的服务端核心组件，负责接收客户端变更、处理冲突、维护数据一致性，并向其他客户端广播更新。

## 核心模块

### 1. 变更应用器（Applier）

#### 职责
- 接收客户端传来的 Action
- 验证 Action 的合法性
- 按顺序将变更应用到主数据库
- 处理软删除标记

#### 工作流程
```
客户端 Action 到达
    ↓
验证签名和权限
    ↓
检查版本冲突
    ↓
开启数据库事务
    ↓
应用变更到业务表
    ↓
记录变更日志（用于增量同步）
    ↓
提交事务
    ↓
触发广播推送
```

#### 数据库设计
```sql
-- 业务表（示例：订单）
CREATE TABLE orders (
  id VARCHAR(36) PRIMARY KEY,
  -- 业务字段
  customer_id VARCHAR(36),
  amount DECIMAL(10,2),
  status VARCHAR(20),

  -- 同步相关字段
  version BIGINT DEFAULT 1,           -- 版本号（用于 LWW）
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL,          -- 软删除标记
  created_by VARCHAR(36),             -- 创建者 client_id
  updated_by VARCHAR(36)              -- 最后更新者 client_id
);

-- 变更日志表（用于增量同步）
CREATE TABLE change_log (
  id BIGSERIAL PRIMARY KEY,
  table_name VARCHAR(50) NOT NULL,
  record_id VARCHAR(36) NOT NULL,
  action_type VARCHAR(10) NOT NULL,  -- CREATE, UPDATE, DELETE
  version BIGINT NOT NULL,
  changed_by VARCHAR(36) NOT NULL,
  changed_at TIMESTAMP NOT NULL,
  INDEX idx_changed_at (changed_at),
  INDEX idx_record (table_name, record_id)
);
```

### 2. 冲突仲裁器（Arbiter）

#### 职责
- 检测数据冲突
- 根据策略解决冲突
- 记录无法自动解决的冲突

#### Last-Write-Wins（LWW）实现
```javascript
function resolveLWW(existingRecord, incomingAction) {
  // 比较时间戳，晚的覆盖早的
  if (incomingAction.timestamp > existingRecord.updated_at) {
    return {
      resolution: 'accept_incoming',
      winner: incomingAction.client_id,
      loser: existingRecord.updated_by
    };
  }

  return {
    resolution: 'keep_existing',
    winner: existingRecord.updated_by,
    loser: incomingAction.client_id
  };
}
```

#### CRDT 合并实现（Yjs）
```javascript
const Y = require('yjs');

function mergeWithCRDT(existingDoc, incomingDoc) {
  const ydoc1 = Y.decodeDocument(existingDoc.crdt_state);
  const ydoc2 = Y.decodeDocument(incomingDoc.crdt_state);

  // 合并两个文档状态
  const merged = Y.mergeDocument([ydoc1, ydoc2]);

  return {
    merged: Y.encodeStateAsUpdate(merged),
    state: Y.encodeStateVector(merged)
  };
}
```

### 3. 推送服务（Push Service）

#### WebSocket 广播
```javascript
class PushService {
  constructor() {
    this.clients = new Map(); // client_id -> WebSocket
  }

  // 客户端连接
  connect(clientId, ws) {
    this.clients.set(clientId, ws);
    ws.on('close', () => this.clients.delete(clientId));
  }

  // 广播变更
  broadcast(change, excludeClientId = null) {
    const message = JSON.stringify({
      type: 'change',
      data: change
    });

    for (const [clientId, ws] of this.clients) {
      if (clientId !== excludeClientId && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  // 发送给特定客户端
  sendTo(clientId, message) {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
```

#### 连接管理
```javascript
// 心跳检测
setInterval(() => {
  for (const [clientId, ws] of pushService.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
```

## 数据同步流程

### 完整同步流程图
```
┌─────────────────────────────────────────────────────────────┐
│                        客户端 A                              │
│  修改数据 → 本地 DB → Outbox → [上传 Action]                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      服务端网关                              │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │   验证器     │───→│  仲裁器     │───→│   应用器         │  │
│  │  Validator  │    │  Arbiter    │    │   Applier       │  │
│  └─────────────┘    └─────────────┘    └────────┬────────┘  │
│                                                 │            │
│                                                 ▼            │
│                                          ┌─────────────┐    │
│                                          │ Master DB   │    │
│                                          └─────────────┘    │
│                                                 │            │
│                                                 ▼            │
│                                          ┌─────────────┐    │
│                                          │ 变更日志    │    │
│                                          └─────────────┘    │
│                                                 │            │
│                                                 ▼            │
│                                          ┌─────────────┐    │
│                                          │ 推送服务    │    │
│                                          └──────┬──────┘    │
└─────────────────────────────────────────────────┼───────────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────┐
                    │                             │                     │
                    ▼                             ▼                     ▼
            ┌───────────────┐           ┌───────────────┐     ┌───────────────┐
            │   客户端 A    │           │   客户端 B    │     │   客户端 C    │
            │ [确认响应]    │           │ [WebSocket]   │     │ [WebSocket]   │
            │               │           │ 推送变更      │     │ 推送变更      │
            └───────────────┘           └───────────────┘     └───────────────┘
```

## 目录结构（规划）

```
src/server/
├── gateway/            # 网关核心
│   ├── gateway.ts      # 主入口
│   ├── validator.ts    # 请求验证
│   └── middleware.ts   # 中间件
├── applier/            # 变更应用
│   ├── applier.ts
│   └── transaction.ts
├── arbiter/            # 冲突解决
│   ├── arbiter.ts
│   ├── lww.ts
│   └── crdt.ts
├── push/               # 推送服务
│   ├── push-service.ts
│   └── websocket.ts
├── sync/               # 同步处理
│   ├── pull.ts         # 拉取处理
│   ├── push.ts         # 推送处理
│   └── cursor.ts       # 游标管理
├── storage/            # 数据访问层
│   ├── db.ts
│   └── change-log.ts
└── api/                # HTTP 接口
    ├── routes.ts
    └── handlers.ts
```

## 扩展性考虑

### 水平扩展
- 使用 Redis 共享客户端连接状态
- 使用消息队列（Kafka/RabbitMQ）处理变更事件
- 数据库分片策略

### 高可用
- 网关服务无状态设计
- WebSocket Session 持久化
- 健康检查和自动故障转移
