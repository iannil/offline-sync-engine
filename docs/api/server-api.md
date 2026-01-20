# 服务端 API 规范

> **状态**：草案，尚未实现
> **版本**：v1.0.0-draft

## 基础信息

- **Base URL**: `/api/sync`
- **协议**: HTTP/1.1, HTTP/2
- **编码**: Protobuf（推荐）或 JSON
- **认证**: Bearer Token / API Key

## 通用响应格式

### 成功响应
```json
{
  "success": true,
  "data": { /* 业务数据 */ },
  "server_time": 1678888888000
}
```

### 错误响应
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": { /* 额外信息 */ }
  },
  "server_time": 1678888888000
}
```

## 端点定义

### 1. 健康检查

```http
GET /api/sync/health

Response 200:
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "1.0.0"
  }
}
```

### 2. 推送变更（Push）

```http
POST /api/sync/push
Content-Type: application/json
Authorization: Bearer {token}

Request Body:
{
  "client_id": "device-uuid-xxx",
  "actions": [
    {
      "id": "action-uuid-1",
      "type": "CREATE",
      "table": "orders",
      "data": {
        "id": "order-123",
        "customer_id": "customer-456",
        "amount": 1000.00,
        "status": "pending"
      },
      "timestamp": 1678888888000
    },
    {
      "id": "action-uuid-2",
      "type": "UPDATE",
      "table": "orders",
      "data": {
        "id": "order-123",
        "status": "confirmed"
      },
      "timestamp": 1678888888100
    }
  ],
  "checksum": "sha256-..."
}

Response 200:
{
  "success": true,
  "data": {
    "processed": 2,
    "failed": 0,
    "conflicts": [],
    "server_time": 1678888888000
  }
}

Response 409 (Conflict):
{
  "success": false,
  "error": {
    "code": "CONFLICT_DETECTED",
    "message": "检测到数据冲突",
    "details": {
      "conflicts": [
        {
          "action_id": "action-uuid-2",
          "table": "orders",
          "record_id": "order-123",
          "local_value": { "status": "confirmed" },
          "remote_value": { "status": "cancelled" },
          "remote_timestamp": 1678888888050
        }
      ]
    }
  }
}
```

### 3. 拉取变更（Pull）

```http
GET /api/sync/pull?since={timestamp}&limit={count}&cursor={token}
Authorization: Bearer {token}

Query Parameters:
- since: long      // 起始时间戳（毫秒）
- limit: int       // 返回数量限制（默认 100，最大 1000）
- cursor: string   // 分页游标（用于获取下一页）

Response 200:
{
  "success": true,
  "data": {
    "has_more": true,
    "cursor": "next-page-token",
    "changes": [
      {
        "type": "UPDATE",
        "table": "orders",
        "data": {
          "id": "order-456",
          "status": "shipped"
        },
        "version": 5,
        "timestamp": 1678888889000
      },
      {
        "type": "DELETE",
        "table": "products",
        "id": "prod-789",
        "timestamp": 1678888889500
      }
    ],
    "server_time": 1678888889000
  }
}
```

### 4. 获取同步状态

```http
GET /api/sync/status
Authorization: Bearer {token}

Response 200:
{
  "success": true,
  "data": {
    "client_id": "device-uuid-xxx",
    "last_sync": 1678888888000,
    "pending_actions": 0,
    "server_time": 1678888889000
  }
}
```

### 5. 解决冲突

```http
POST /api/sync/resolve-conflict
Content-Type: application/json
Authorization: Bearer {token}

Request Body:
{
  "conflict_id": "conflict-uuid",
  "resolution": "local",  // "local" | "remote" | "custom"
  "custom_value": { /* 仅当 resolution=custom 时需要 */ }
}

Response 200:
{
  "success": true,
  "data": {
    "resolved": true,
    "document": { /* 合并后的文档 */ }
  }
}
```

### 6. 文件上传初始化（tus 协议）

```http
POST /api/files/upload
Upload-Encoding: tus-resumable
Tus-Resumable: 1.0.0
Upload-Length: 5242880
Upload-Metadata: filename dGVzdC5qcGc=,type aW1hZ2UvanBn

Response 201:
{
  "success": true,
  "data": {
    "upload_id": "upload-uuid-xxx",
    "upload_url": "/api/files/upload/upload-uuid-xxx"
  }
}

Headers:
Location: /api/files/upload/upload-uuid-xxx
Tus-Resumable: 1.0.0
Upload-Expires: 2025-01-27T00:00:00Z
```

### 7. 文件分片上传（tus 协议）

```http
PATCH /api/files/upload/{upload_id}
Tus-Resumable: 1.0.0
Content-Type: application/offset+octet-stream
Content-Length: 50000
Upload-Offset: 0

[二进制数据...]

Response 204:
Headers:
Upload-Offset: 50000
Tus-Resumable: 1.0.0
```

### 8. 查询上传状态

```http
HEAD /api/files/upload/{upload_id}
Tus-Resumable: 1.0.0

Response 200:
Headers:
Upload-Length: 5242880
Upload-Offset: 50000
Tus-Resumable: 1.0.0
```

## WebSocket 接口

### 连接

```javascript
const ws = new WebSocket('wss://api.example.com/sync/ws?token={token}');
```

### 消息格式

#### 服务器 → 客户端

```json
{
  "type": "change",
  "data": {
    "table": "orders",
    "change": {
      "type": "UPDATE",
      "data": { /* ... */ },
      "timestamp": 1678888889000
    }
  }
}

{
  "type": "conflict",
  "data": {
    "conflict_id": "conflict-uuid",
    "table": "orders",
    "record_id": "order-123",
    "remote_value": { /* ... */ }
  }
}

{
  "type": "ping",
  "data": {
    "server_time": 1678888889000
  }
}
```

#### 客户端 → 服务器

```json
{
  "type": "ping",
  "data": {
    "client_time": 1678888889000
  }
}

{
  "type": "subscribe",
  "data": {
    "tables": ["orders", "products"]
  }
}
```

## 错误码

| 错误码 | 描述 | HTTP 状态 |
|--------|------|-----------|
| INVALID_REQUEST | 请求参数无效 | 400 |
| UNAUTHORIZED | 未授权 | 401 |
| FORBIDDEN | 无权限 | 403 |
| NOT_FOUND | 资源不存在 | 404 |
| CONFLICT_DETECTED | 数据冲突 | 409 |
| RATE_LIMIT_EXCEEDED | 超出速率限制 | 429 |
| INTERNAL_ERROR | 服务器内部错误 | 500 |
| SERVICE_UNAVAILABLE | 服务不可用 | 503 |

## 速率限制

```
默认限制：
- 每个客户端：100 请求/分钟
- 文件上传：1 GB/小时

超出限制返回：
HTTP 429
Retry-After: 60
```

## Protobuf 定义

```protobuf
syntax = "proto3";

package sync;

service SyncService {
  rpc Push(PushRequest) returns (PushResponse);
  rpc Pull(PullRequest) returns (PullResponse);
  rpc GetStatus(StatusRequest) returns (StatusResponse);
  rpc ResolveConflict(ConflictRequest) returns (ConflictResponse);
}

message PushRequest {
  string client_id = 1;
  repeated Action actions = 2;
  string checksum = 3;
}

message Action {
  string id = 1;
  enum Type { CREATE = 0; UPDATE = 1; DELETE = 2; }
  Type type = 2;
  string table = 3;
  bytes data = 4;
  int64 timestamp = 5;
}

message PushResponse {
  bool success = 1;
  int32 processed = 2;
  int32 failed = 3;
  repeated Conflict conflicts = 4;
  int64 server_time = 5;
}

message PullRequest {
  int64 since = 1;
  int32 limit = 2;
  string cursor = 3;
}

message PullResponse {
  bool has_more = 1;
  string cursor = 2;
  repeated Change changes = 3;
  int64 server_time = 4;
}

message Change {
  enum Type { CREATE = 0; UPDATE = 1; DELETE = 2; }
  Type type = 1;
  string table = 2;
  bytes data = 3;
  int64 version = 4;
  int64 timestamp = 5;
}
```
