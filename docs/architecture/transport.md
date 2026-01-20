# 传输协议层（The Tunnel）

## 概述

传输协议层负责在客户端和服务端之间高效、可靠地传输数据。针对非洲 2G/3G 网络环境进行了特殊优化。

## 核心特性

### 1. 增量同步（Delta Sync）

#### 原理
绝对不传输全量 JSON，只传输变更集（Changeset）。

#### 差异检测机制

**方案 A：向量时钟（Vector Clock）**
```javascript
// 每个数据节点维护一个版本向量
{
  id: 'order-123',
  data: { /* ... */ },
  vectorClock: {
    clientA: 5,
    clientB: 3,
    server: 8
  }
}

// 比较逻辑：dominates(vc1, vc2)
// 如果 vc1 所有版本 >= vc2，则 vc1 更新（或相等）
```

**方案 B：默克尔树（Merkle Tree）**
```
                    Root Hash
                   /          \
              Hash AB        Hash CD
             /      \        /      \
          Hash A   Hash B  Hash C  Hash D
           |        |        |        |
          Doc1     Doc2     Doc3     Doc4

// 只需同步差异的分支
```

#### 同步请求示例
```
GET /api/sync/pull?since=1678888888000&limit=100

Response:
{
  "hasMore": true,
  "cursor": "next-cursor-token",
  "changes": [
    { "type": "UPDATE", "table": "orders", "doc": { /* ... */ } },
    { "type": "DELETE", "table": "products", "id": "prod-123" },
    // ... 更多变更
  ]
}
```

### 2. 断点续传（针对附件）

#### tus 协议集成

**文件分片上传**
```
原始文件：5MB
分片大小：50KB
总片数：100片

┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│  1  │  2  │  3  │  4  │ ... │ 99  │100  │
└─────┴─────┴─────┴─────┴─────┴─────┴─────┘
  ✓      ✓      ✓      ✗     ...   ✓     ✓
                              ↑
                         上传失败点

// 下次续传从第4片开始
```

#### API 示例
```
POST /api/files/upload
Upload-Encoding: tus-resumable
Content-Length: 50000
Upload-Offset: 150000
Tus-Resumable: 1.0.0

[二进制数据...]

Response:
204 No Content
Upload-Offset: 200000
Upload-Expires: 2025-01-27T00:00:00Z
```

### 3. 数据压缩

#### 格式对比

| 格式 | 相对大小 | 序列化速度 | 反序列化速度 | 可读性 |
|------|---------|-----------|-------------|--------|
| JSON | 100% | 快 | 快 | ✓ |
| MsgPack | ~60% | 快 | 快 | ✗ |
| Protobuf | ~40% | 中 | 中 | ✗ |
| CBOR | ~55% | 快 | 快 | ✗ |

#### 推荐方案：Protobuf

```protobuf
// sync.proto
syntax = "proto3";

message SyncRequest {
  int64 since = 1;
  int32 limit = 2;
  string cursor = 3;
}

message SyncResponse {
  bool has_more = 1;
  string cursor = 2;
  repeated Change changes = 3;
}

message Change {
  enum Type { CREATE = 0; UPDATE = 1; DELETE = 2; }
  Type type = 1;
  string table = 2;
  bytes data = 3;  // JSON 或 protobuf 编码的数据
}
```

### 4. 请求优化

#### 批量处理
```javascript
// 单次请求合并多个 Action
POST /api/sync/push
Content-Type: application/x-protobuf

{
  "actions": [
    { "id": "uuid-1", "type": "UPDATE", "table": "orders", "data": {...} },
    { "id": "uuid-2", "type": "CREATE", "table": "products", "data": {...} },
    { "id": "uuid-3", "type": "DELETE", "table": "users", "data": {...} },
    // ... 最多 100 个
  ],
  "checksum": "sha256-..."
}
```

#### 优先级队列
```
高优先级：用户主动操作（创建、删除）
中优先级：后台数据更新
低优先级：分析数据上报
```

## 网络适配策略

### 弱网检测
```javascript
// 检测网络质量
function detectNetworkQuality() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  return {
    type: connection.effectiveType, // '4g', '3g', '2g', 'slow-2g'
    downlink: connection.downlink,   // 带宽估算 (Mbps)
    rtt: connection.rtt,             // 往返时间 (ms)
    saveData: connection.saveData   // 用户是否开启省流量模式
  };
}

// 根据网络质量调整策略
if (quality.type === '2g' || quality.saveData) {
  config.batchSize = 10;        // 减小批次
  config.retryDelay = 5000;     // 增加重试延迟
  config.compression = true;    // 强制压缩
}
```

### 自适应分片
```
网络条件      分片大小    并发数
4G/WiFi      256KB       3
3G           128KB       2
2G           50KB        1
slow-2g      25KB        1
```

## API 规范

### 推送变更（Push）
```
POST /api/sync/push

Request Body:
{
  "client_id": "device-uuid",
  "actions": [...],
  "checksum": "sha256-..."
}

Response:
{
  "processed": 100,
  "failed": 2,
  "conflicts": [...],
  "server_time": 1678888888000
}
```

### 拉取变更（Pull）
```
GET /api/sync/pull?since={timestamp}&limit={count}&cursor={token}

Response:
{
  "has_more": true,
  "cursor": "next-token",
  "changes": [...],
  "server_time": 1678888888000
}
```

### 文件上传
```
POST /api/files/upload
Upload-Encoding: tus-resumable
Tus-Resumable: 1.0.0
Content-Length: {chunk_size}
Upload-Offset: {offset}
Upload-Length: {total_size}

[二进制数据...]
```
