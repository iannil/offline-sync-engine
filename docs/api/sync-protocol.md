# 数据同步协议规范

> **状态**：草案，尚未实现
> **版本**：v1.0.0-draft

## 协议概述

本协议定义了客户端与服务端之间数据同步的通信规范，包括：
- 变更推送（Push）: 客户端 → 服务端
- 变更拉取（Pull）: 服务端 → 客户端
- 冲突检测与解决
- 增量同步机制

## 核心概念

### Action（变更动作）

客户端产生的数据变更操作，包含：

| 字段 | 类型 | 描述 |
|------|------|------|
| id | string | 唯一标识（UUID v4） |
| type | enum | CREATE, UPDATE, DELETE |
| table | string | 目标表名 |
| data | object | 变更数据 |
| timestamp | int64 | 客户端本地时间戳（毫秒） |
| client_id | string | 客户端设备标识 |

### Vector Clock（向量时钟）

用于检测和解决冲突的版本追踪机制：

```javascript
{
  "client-a": 5,    // 客户端 A 的版本
  "client-b": 3,    // 客户端 B 的版本
  "server": 8       // 服务端版本
}
```

**比较规则**：
- `VC1 == VC2`: 所有对应版本相等
- `VC1 > VC2`: VC1 所有版本 >= VC2，且至少一个 >
- `VC1 || VC2`: 并发（无法比较）

## 同步流程

### 1. 初始同步

```
客户端                      服务端
   │                          │
   │ ───────── GET /init ────→│
   │                          │ 检查客户端状态
   │ ←──── schema/info ───────│
   │                          │
   │ ───── GET /pull?since=0 →│
   │ ←─────── 全量数据 ───────│
   │                          │
   │ ── 确认同步完成 ────────→│
```

### 2. 增量同步

```
客户端                      服务端
   │                          │
   │ ────── 本地有变更 ───────│
   │                          │
   │ ─── POST /push (actions)→│
   │ ←─── 200 + conflicts ────│
   │                          │ 应用到 DB
   │                          │ 写入 change_log
   │                          │
   │ ────── 请求变更 ────────→│
   │ ←─ GET /pull?since=T ────│
   │ ←─────── changes ────────│
   │                          │
   │ 应用到本地 DB             │
```

### 3. 冲突解决流程

```
客户端                      服务端
   │                          │
   │ ──── UPDATE(order:状态) →│
   │                          │ 检测到冲突
   │ ←─── 409 Conflict ───────│
   │   (remote_value)         │
   │                          │
   │ ──── 用户选择策略 ───────│
   │ ─── POST /resolve ──────→│
   │ ←────── 200 OK ──────────│
```

## Push 协议

### 请求格式

```http
POST /api/sync/push HTTP/1.1
Content-Type: application/json
X-Client-ID: device-uuid-xxx
X-Sync-Version: 1.0.0
Authorization: Bearer {token}

{
  "client_id": "device-uuid-xxx",
  "sync_id": "sync-session-uuid",
  "actions": [
    {
      "id": "action-uuid-1",
      "type": "CREATE",
      "table": "orders",
      "data": {
        "id": "order-123",
        "customer_id": "customer-456",
        "amount": 1000.00,
        "status": "pending",
        "created_at": "2025-01-20T10:00:00Z"
      },
      "timestamp": 1678888888000
    }
  ],
  "checksum": {
    "algorithm": "sha256",
    "value": "abc123..."
  }
}
```

### 响应格式

**成功响应（200）**：
```json
{
  "sync_id": "sync-session-uuid",
  "processed": 100,
  "failed": 0,
  "conflicts": [],
  "server_time": 1678888889000
}
```

**冲突响应（409）**：
```json
{
  "sync_id": "sync-session-uuid",
  "processed": 98,
  "failed": 2,
  "conflicts": [
    {
      "action_id": "action-uuid-99",
      "table": "orders",
      "record_id": "order-456",
      "conflict_type": "VERSION_MISMATCH",
      "local_value": {
        "status": "confirmed",
        "version": 3
      },
      "remote_value": {
        "status": "cancelled",
        "version": 4
      },
      "remote_timestamp": 1678888888500
    }
  ],
  "server_time": 1678888889000
}
```

## Pull 协议

### 请求格式

```http
GET /api/sync/pull?since=1678888888000&limit=100&cursor=xxx HTTP/1.1
X-Client-ID: device-uuid-xxx
Authorization: Bearer {token}
```

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| since | int64 | 是 | 起始时间戳（毫秒），0 表示全量 |
| limit | int | 否 | 返回数量限制，默认 100，最大 1000 |
| cursor | string | 否 | 分页游标 |

### 响应格式

```json
{
  "has_more": true,
  "cursor": "next-page-token-xxx",
  "server_time": 1678888889000,
  "changes": [
    {
      "id": "change-uuid-1",
      "type": "UPDATE",
      "table": "orders",
      "data": {
        "id": "order-123",
        "status": "confirmed"
      },
      "version": 5,
      "vector_clock": {
        "device-uuid-xxx": 3,
        "server": 5
      },
      "timestamp": 1678888888500
    },
    {
      "id": "change-uuid-2",
      "type": "DELETE",
      "table": "products",
      "record_id": "prod-789",
      "version": 2,
      "timestamp": 1678888889000
    }
  ]
}
```

## 增量同步机制

### 服务端变更日志

```sql
CREATE TABLE change_log (
  id BIGSERIAL PRIMARY KEY,
  seq BIGINT NOT NULL,              -- 全局序列号
  table_name VARCHAR(50) NOT NULL,
  record_id VARCHAR(36) NOT NULL,
  action_type VARCHAR(10) NOT NULL,
  version BIGINT NOT NULL,
  data JSONB,                       -- 变更后的数据
  vector_clock JSONB,
  changed_by VARCHAR(36) NOT NULL,
  changed_at TIMESTAMP NOT NULL,
  INDEX idx_changed_at (changed_at),
  INDEX idx_seq (seq)
);
```

### 查询逻辑

```sql
-- 基本查询
SELECT * FROM change_log
WHERE changed_at > $1
ORDER BY changed_at ASC
LIMIT $2;

-- 使用游标（更高效）
SELECT * FROM change_log
WHERE seq > $1
ORDER BY seq ASC
LIMIT $2;
```

## 冲突检测

### Last-Write-Wins 检测

```javascript
function detectConflict(local, remote) {
  // 版本号不连续 = 可能存在冲突
  if (remote.version > local.version + 1) {
    return { hasConflict: true, reason: 'version_gap' };
  }

  // 时间戳相同 = 并发修改
  if (Math.abs(local.timestamp - remote.timestamp) < 1000) {
    return { hasConflict: true, reason: 'concurrent' };
  }

  return { hasConflict: false };
}
```

### CRDT 检测

```javascript
function detectCRDTConflict(localState, remoteState) {
  const localVector = decodeVectorClock(localState);
  const remoteVector = decodeVectorClock(remoteState);

  // 检查是否并发
  if (!dominates(localVector, remoteVector) &&
      !dominates(remoteVector, localVector)) {
    return { hasConflict: true, reason: 'concurrent_branch' };
  }

  return { hasConflict: false };
}
```

## 优化的批量同步

### 批量推送

```javascript
// 客户端批量收集 Actions
const batch = {
  actions: [],
  maxSize: 100,           // 最大数量
  maxWait: 5000,          // 最大等待时间（毫秒）
  maxBytes: 1024 * 512    // 最大大小（512KB）
};

// 触发条件：任一满足即发送
if (batch.actions.length >= batch.maxSize ||
    batch.waitTime >= batch.maxWait ||
    batch.byteSize >= batch.maxBytes) {
  await pushBatch(batch);
}
```

### 优先级队列

```
高优先级：
- 用户主动操作（创建、删除）
- 关键业务数据（订单、支付）

中优先级：
- 数据更新（修改）
- 非关键业务数据

低优先级：
- 分析数据上报
- 日志上传
```

## 网络优化

### 压缩

```http
POST /api/sync/push HTTP/1.1
Content-Encoding: gzip
Content-Type: application/json

[压缩后的数据...]
```

### 差异传输

对于大型文档，仅传输差异：

```javascript
// JSON Patch (RFC 6902)
{
  "table": "documents",
  "id": "doc-123",
  "patch": [
    { "op": "replace", "path": "/status", "value": "approved" },
    { "op": "add", "path": "/approved_by", "value": "user-456" }
  ]
}
```

## 安全性

### 签名验证

```javascript
// 请求签名
const signature = hmacSha256(
  JSON.stringify(request.body) + request.timestamp,
  clientSecret
);

// 请求头
X-Signature: signature
X-Timestamp: 1678888888000
```

### 重放攻击防护

```javascript
// 服务端验证
if (Math.abs(Date.now() - request.timestamp) > 300000) {
  // 请求超过 5 分钟，拒绝
  throw new Error('Request expired');
}

// 检查 nonce
if (await redis.get(`nonce:${request.nonce}`)) {
  throw new Error('Duplicate request');
}
await redis.set(`nonce:${request.nonce}`, '1', 'EX', 300);
```
