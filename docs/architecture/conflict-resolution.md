# 冲突解决策略

## 问题场景

**典型冲突场景：**

经理在肯尼亚（离线）把项目状态改为"暂停"，同时总监在国内（在线）把项目状态改为"进行中"。当肯尼亚的网络恢复后，听谁的？

```
时间线：
─────────────────────────────────────────────────────────────→
      │                                    │
    经理(离线)                           总监(在线)
  "暂停"项目                           "进行中"项目
      │                                    │
      └────────── 网络恢复 ─────────────────┘
                        │
                    冲突发生！
```

## 解决方案对比

| 方案 | 复杂度 | 一致性 | 用户体验 | 适用场景 |
|------|-------|--------|---------|---------|
| Last-Write-Wins | 低 | 最终一致 | 可能丢失修改 | 低频修改数据 |
| CRDT（字段级） | 高 | 强一致 | 保留所有修改 | 高频协作数据 |
| 人工解决 | 中 | 强一致 | 需要用户介入 | 关键业务数据 |

## 方案 A：Last-Write-Wins（LWW）

### 原理
每行数据维护一个 `updated_at` 时间戳，同步时比较时间戳，晚的覆盖早的。

### 实现
```javascript
// 数据模型
{
  id: 'project-123',
  name: '海外项目A',
  status: '进行中',
  updated_at: 1678888888000,  // 时间戳
  updated_by: 'client-director-id'
}

// 冲突解决逻辑
function resolveLWW(local, remote) {
  if (local.updated_at > remote.updated_at) {
    return local;  // 本地版本更新
  } else if (local.updated_at < remote.updated_at) {
    return remote; // 远程版本更新
  } else {
    // 时间戳相同，按 client_id 排序决定
    return local.updated_by > remote.updated_by ? local : remote;
  }
}
```

### 优点
- 实现简单
- 无需额外依赖
- 数据库改动小

### 缺点
- 极端并发下可能丢失部分字段修改
- 例如：A 改了名字，B 改了年龄，LWW 可能导致名字的修改被覆盖

## 方案 B：基于 CRDT（推荐）

### 原理
数据不再是简单的 JSON，而是由一系列原子操作（Insert, Delete）组成的链表。CRDT 保证无论操作到达服务器的顺序如何，最终的数据状态是一致的。

### Yjs 集成方案

#### 前端实现
```javascript
import * as Y from 'yjs';

// 初始化 CRDT 文档
const ydoc = new Y.Doc();
const yData = ydoc.getMap('data');

// 数据绑定到表单
const yText = yText.get('project-name');

yText.observe((event) => {
  // 自动更新 UI
  document.getElementById('name').value = yText.toString();
});

// 用户修改时
document.getElementById('name').addEventListener('input', (e) => {
  yText.insert(0, e.target.value);
});
```

#### 同步流程
```
1. 前端使用 Yjs 的数据结构（Y.Map, Y.Array）绑定到表单
2. 修改时，Yjs 自动生成二进制的 Update Blob
3. 离线时，将 Blob 存入 IndexedDB
4. 联网后，将 Blob 发给后端
5. 后端合并 Blob 并生成新的 Blob 返回
```

#### 后端实现
```javascript
const Y = require('yjs');

class CRDTService {
  constructor() {
    this.documents = new Map(); // docId -> Y.Doc
  }

  // 应用客户端更新
  applyUpdate(docId, updateBuffer) {
    let ydoc = this.documents.get(docId);

    if (!ydoc) {
      ydoc = new Y.Doc();
      this.documents.set(docId, ydoc);
    }

    // 应用更新
    Y.applyUpdate(ydoc, updateBuffer);

    // 返回新的状态
    return {
      state: Y.encodeStateAsUpdate(ydoc),
      vector: Y.encodeStateVector(ydoc)
    };
  }

  // 获取文档状态
  getState(docId) {
    const ydoc = this.documents.get(docId);
    if (!ydoc) {
      return null;
    }

    return {
      json: ydoc.getMap('data').toJSON(),
      state: Y.encodeStateAsUpdate(ydoc)
    };
  }
}
```

### 字段级合并示例

```javascript
// 初始数据
{
  name: '海外项目A',
  status: '规划中',
  budget: 1000000
}

// 客户端 A（经理）离线修改
{
  name: '海外项目A',
  status: '暂停',      // ← 修改
  budget: 1000000
}

// 客户端 B（总监）在线修改
{
  name: '肯尼亚项目',   // ← 修改
  status: '进行中',    // ← 修改
  budget: 1000000
}

// CRDT 合并结果
{
  name: '肯尼亚项目',   // 来自 B
  status: '进行中',    // ← 冲突，按时间戳/LWW
  budget: 1000000
}
```

### CRDT 数据结构
```javascript
// CRDT 编码的存储格式
{
  id: 'project-123',
  // 原始 JSON（兼容性）
  data_json: {
    name: '海外项目A',
    status: '进行中'
  },
  // CRDT 状态（用于同步和合并）
  crdt_state: Buffer,   // Yjs 二进制状态
  crdt_vector: Buffer,  // 向量时钟（用于增量同步）
  updated_at: 1678888888000
}
```

## 方案 C：人工干预

### 适用场景
- 关键业务决策（如合同金额）
- 需要审计记录的修改
- CRDT 无法自动解决的语义冲突

### 实现
```javascript
// 冲突记录
{
  id: 'conflict-123',
  table: 'projects',
  record_id: 'project-123',
  conflict_type: 'VALUE_MISMATCH',
  local_value: { status: '暂停' },
  remote_value: { status: '进行中' },
  detected_at: 1678888888000,
  status: 'pending'  // pending | resolved | ignored
}

// 用户界面
function showConflictDialog(conflict) {
  return `
    <div class="conflict-dialog">
      <h3>数据冲突</h3>
      <p>项目 ${conflict.record_id} 存在冲突</p>

      <div class="options">
        <label>
          <input type="radio" name="resolve" value="local">
          本地版本：${conflict.local_value.status}
          <small>${formatTime(conflict.local_timestamp)}</small>
        </label>

        <label>
          <input type="radio" name="resolve" value="remote">
          服务器版本：${conflict.remote_value.status}
          <small>${formatTime(conflict.remote_timestamp)}</small>
        </label>

        <label>
          <input type="radio" name="resolve" value="merge">
          自定义合并
        </label>
      </div>

      <button onclick="resolveConflict()">确定</button>
    </div>
  `;
}
```

## 推荐策略

### 阶段一（MVP）：Last-Write-Wins
- 使用 `updated_at` + `updated_by` 字段
- 记录所有被覆盖的值到审计日志
- 简单可靠，快速上线

### 阶段二：增强型 LWW
- 支持字段级的时间戳
- 每个字段独立比较 `updated_at`
- 可以保留更多的修改

### 阶段三：CRDT
- 针对高频协作的文档/表格
- 使用 Yjs 或 Automerge
- 实现真正的无冲突合并

### 阶段四：混合策略
```javascript
function resolveConflict(local, remote, schema) {
  // 根据数据类型选择策略
  if (schema.conflictStrategy === 'crdt') {
    return resolveWithCRDT(local, remote);
  } else if (schema.conflictStrategy === 'manual') {
    return requireManualResolution(local, remote);
  } else {
    return resolveLWW(local, remote);  // 默认
  }
}
```

## 数据库设计（支持多策略）

```sql
-- 业务表
CREATE TABLE projects (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255),
  status VARCHAR(50),
  budget DECIMAL(15,2),

  -- LWW 字段
  version BIGINT DEFAULT 1,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by VARCHAR(36),

  -- CRDT 支持（可选）
  crdt_state BYTEA,
  crdt_vector BYTEA,

  -- 冲突解决策略
  conflict_strategy VARCHAR(20) DEFAULT 'lww'
);

-- 冲突记录表
CREATE TABLE conflicts (
  id VARCHAR(36) PRIMARY KEY,
  table_name VARCHAR(50),
  record_id VARCHAR(36),
  field_name VARCHAR(50),
  local_value JSONB,
  remote_value JSONB,
  resolved_value JSONB,
  resolved_by VARCHAR(36),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 审计日志（记录所有变更）
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name VARCHAR(50),
  record_id VARCHAR(36),
  action VARCHAR(10),
  old_value JSONB,
  new_value JSONB,
  changed_by VARCHAR(36),
  changed_at TIMESTAMP DEFAULT NOW()
);
```
