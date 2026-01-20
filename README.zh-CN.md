# 离线同步引擎

> Local-First 架构的离线同步引擎，针对低带宽环境优化

中文版 | [English](README.md)

完整的离线同步解决方案，采用 Local-First 架构设计。应用可以完全离线运行，以本地存储作为主数据源，同时在后台自动与服务器同步。针对不稳定的网络条件（如非洲地区的 2G/3G 网络）进行了优化，支持数据压缩、断点续传和智能冲突解决。

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
[![License](https://img.shields.io/badge/license-MIT-green)

## ✨ 特性

### 核心能力

- 🌐 **完全离线支持** - 基于 IndexedDB 本地存储，可完全离线工作
- 🔄 **自动同步** - 检测到网络后自动同步
- ⚡ **增量同步** - 仅传输变更数据，节省带宽
- 🗜️ **Outbox 模式** - 拦截写操作，本地排队，可靠同步
- 🧠 **智能冲突解决** - Last-Write-Wins (LWW) + 向量时钟
- 📱 **跨平台** - 基于 RxDB，支持 Web 和移动端

### 高级特性

- 📦 **数据压缩** - MessagePack + DEFLATE，减少 40-60% 数据量
- 📤 **断点续传** - 完整的 TUS 协议实现，支持大文件上传
- ⚡ **性能优化** - 批量操作、索引优化、查询缓存
- 🔌 **实时推送** - WebSocket 服务端推送通知
- 🛡️ **类型安全** - 端到端 TypeScript 支持

## 📐 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端应用                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    UI 层 (React)                       │ │
│  └──────────────────────┬─────────────────────────────────┘ │
│                         │                                   │
│  ┌──────────────────────▼─────────────────────────────────┐ │
│  │                 离线 SDK (@offline-sync/sdk)            │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐     │ │
│  │  │ 存储层   │  │ 网络管理 │  │ Outbox  │  │ 同步    │     │ │
│  │  │ (RxDB)  │  │  器     │  │ (队列)   │  │管理器   │     │ │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └───┬────┘     │ │
│  │       │            │            │            │         │ │
│  │  ┌───▼────────────▼────────────▼────────────▼───────┐  │ │
│  │  │           IndexedDB (浏览器本地存储)               │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS (压缩传输)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    同步网关服务器                             │
│  ┌──────────────┐  ┌──────────┐  ┌─────────┐  ┌────────┐    │
│  │   网关        │  │ 应用器    │  │ 仲裁器   │  │   TUS  │    │
│  │  (路由)       │  │(应用操作) │  │(冲突解决) │  │(断点续传)│   │
│  └──────┬───────┘  └────┬─────┘  └────┬─────┘  └────┬───┘   │
│         │               │             │             │       │
│  ┌──────▼──────────────▼─────────────▼─────────────▼───┐    │
│  │                 CouchDB (主数据库)                    │   │
│  │  - todos, products, customers, orders                │   │
│  │  - _changes feed 用于增量同步                          │   │
│  │  - Mango Query 支持                                   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/iannil/offline-sync-engine.git
cd offline-sync-engine

# 安装依赖
pnpm install
```

### 运行开发服务器

```bash
# 启动服务端 (端口 3000)
pnpm dev:server

# 启动客户端演示 (端口 5173)
pnpm dev:client
```

### 构建

```bash
# 构建 SDK
pnpm --filter @offline-sync/sdk build

# 构建服务端
pnpm --filter @offline-sync/server build

# 构建演示应用
pnpm --filter @offline-sync/client-demo build
```

## 💻 使用示例

### SDK 基础用法

```typescript
import { OfflineClient } from '@offline-sync/sdk';

// 初始化客户端
const client = new OfflineClient({
  database: { name: 'my-app' },
  sync: {
    enabled: true,
    url: 'https://api.example.com/sync',
    interval: 30000,  // 每 30 秒同步一次
    enableCompression: true,
  },
});

// 等待客户端就绪
await client.initialize();

// 获取数据库
const db = client.getDatabase();

// 创建待办事项 (离线 + 自动同步)
const todo = await db.todos.insert({
  id: 'todo-1',
  text: '学习离线同步引擎',
  completed: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// 手动触发同步
await client.getSyncManager().triggerSync();

// 监听同步状态
client.getSyncManager().onStateChange((state) => {
  console.log('同步中:', state.isSyncing);
  console.log('待同步数量:', state.pendingCount);
});
```

### TUS 断点续传

```typescript
import { createTusUpload } from '@offline-sync/sdk/storage';

// 创建文件上传
const uploader = createTusUpload({
  endpoint: 'https://api.example.com/api/tus',
  data: file,
  metadata: {
    filename: file.name,
    type: file.type,
  },
  chunkSize: 5 * 1024 * 1024,  // 5MB 分片
  onProgress: (sent, total) => {
    console.log(`进度: ${(sent / total * 100).toFixed(1)}%`);
  },
});

// 开始上传
const uploadUrl = await uploader.start();

// 暂停上传
uploader.pause();

// 恢复上传 (支持断点续传)
await uploader.resume();
```

### 服务端 API

```bash
# 推送本地操作到服务器
curl -X POST https://api.example.com/api/sync/push \
  -H "Content-Type: application/msgpack+deflate" \
  -H "Accept: application/msgpack+deflate" \
  --data-binary '@payload.bin'

# 拉取服务器变更
curl "https://api.example.com/api/sync/pull?since=1234567890" \
  -H "Accept: application/msgpack+deflate"

# TUS 创建上传
curl -X POST https://api.example.com/api/tus \
  -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Length: 1024000" \
  -H "Upload-Metadata: filename dGVzdC5qcGc="
```

## 📦 包结构

```
offline-sync-engine/
├── packages/
│   ├── sdk/              # 客户端 SDK
│   │   ├── src/
│   │   │   ├── storage/     # 存储模块
│   │   │   ├── network/     # 网络管理
│   │   │   ├── outbox/      # 离线队列
│   │   │   ├── sync/        # 同步管理
│   │   │   └── client/      # 客户端入口
│   │   └── package.json
│   │
│   ├── server/           # 同步网关服务器
│   │   ├── src/
│   │   │   ├── gateway/     # 同步网关
│   │   │   ├── applier/     # 操作应用器
│   │   │   ├── arbiter/     # 冲突仲裁器
│   │   │   ├── database/    # 数据库层
│   │   │   └── tus/         # TUS 协议
│   │   └── package.json
│   │
│   └── client-demo/       # 演示应用
│       ├── src/
│       │   ├── components/
│       │   └── db/
│       └── package.json
│
├── docs/                 # 文档
├── pnpm-workspace.yaml  # Monorepo 配置
└── package.json
```

## 🔧 配置

### SDK 配置

```typescript
interface OfflineClientConfig {
  // 数据库配置
  database: {
    name: string;              // 数据库名称
  };

  // 同步配置
  sync?: {
    enabled: boolean;         // 启用同步
    url: string;              // 同步服务器 URL
    interval?: number;        // 同步间隔 (毫秒)
    batchSize?: number;       // 批量大小
    enableCompression?: boolean;  // 启用压缩
    enableWebSocket?: boolean;    // 启用 WebSocket
  };

  // Outbox 配置
  outbox?: {
    maxRetries?: number;      // 最大重试次数
    initialDelay?: number;    // 初始重试延迟 (毫秒)
    maxDelay?: number;        // 最大重试延迟 (毫秒)
  };
}
```

### 服务端配置

```bash
# 环境变量
COUCHDB_URL=http://localhost:5984
COUCHDB_USERNAME=admin
COUCHDB_PASSWORD=password
COUCHDB_DB_PREFIX=offline-sync
PORT=3000
HOST=0.0.0.0
```

## 📚 API 文档

### SDK 导出

```typescript
// 客户端
import { OfflineClient } from '@offline-sync/sdk/client';

// 存储
import {
  createDatabase,
  getDatabase,
  todoSchema,
  productSchema,
} from '@offline-sync/sdk/storage';

// 查询
import {
  findAll,
  findById,
  findWhere,
  paginate,
  count,
  QueryBuilder,
} from '@offline-sync/sdk/storage';

// 压缩
import {
  CompressionService,
  compress,
  decompress,
} from '@offline-sync/sdk/storage';

// TUS 协议
import {
  createTusUpload,
  uploadFile,
  TusUploader,
} from '@offline-sync/sdk/storage';

// 测试
import {
  benchmarkWrite,
  benchmarkRead,
  benchmarkQuery,
  testCapacity,
} from '@offline-sync/sdk/testing';

// 类型
import type { Todo, Product, OutboxAction, NetworkStatus } from '@offline-sync/sdk';
```

### 服务端端点

| 端点 | 方法 | 描述 |
| ---------- | -------- | ------------- |
| `/health` | GET | 健康检查 |
| `/api/sync/push` | POST | 推送本地操作 |
| `/api/sync/pull` | GET | 拉取远程变更 |
| `/api/sync/:collection` | GET | 获取集合数据 |
| `/api/sync/:collection/:id` | GET | 获取单个文档 |
| `/api/applier/apply` | POST | 应用单个操作 |
| `/api/applier/batch` | POST | 批量应用操作 |
| `/api/arbiter/check` | POST | 冲突检测 |
| `/api/arbiter/resolve` | POST | LWW 冲突解决 |
| `/api/arbiter/resolve/merge` | POST | 字段级合并 |
| `/api/tus` | POST | 创建上传 |
| `/api/tus/:id` | PATCH | 上传分片 |
| `/api/stream` | WS | 实时推送 |

## 🧪 开发

### 环境要求

- Node.js >= 18
- pnpm >= 8
- CouchDB >= 3.0 (可选，用于生产环境)

### 开发命令

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev:server  # 服务端
pnpm dev:client  # 客户端

# 运行测试
pnpm test

# 代码检查
pnpm lint
pnpm format
```

### 本地 CouchDB 开发

```bash
# 使用 Docker 启动 CouchDB
docker run -d \
  --name couchdb \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=password \
  couchdb:3
```

## 📖 文档

| 文档 | 描述 |
| ---------- | ------------- |
| [架构概览](docs/architecture/overview.md) | Local-First 架构设计 |
| [API 文档](docs/api/) | 客户端/服务端 API 定义 |
| [验收报告](docs/VERIFICATION.md) | 功能验证清单 |
| [开发进度](docs/progress/next-steps.md) | 开发路线图 |

## 🤝 贡献

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码规范

- 使用 TypeScript 编写代码
- 遵循 ESLint 规则
- 为新功能添加单元测试
- 更新相关文档

## 📊 开发进度

```
✅ 第一阶段: 基础离线  [████████████████████████████] 100%
   └─ RxDB 集成、Schema 定义、离线队列、LWW 冲突解决

✅ 第二阶段: 优化       [████████████████████████████] 100%
   └─ 增量同步、MessagePack 压缩

✅ 第三阶段: 高级特性   [████████████████████████████] 100%
   └─ TUS 断点续传、WebSocket 推送、性能优化
```

详见 [开发进度](docs/progress/next-steps.md)。

## 🔗 技术栈

| 类别 | 技术 |
| ---------- | ------------ |
| 前端框架 | React + TypeScript |
| 本地数据库 | RxDB + Dexie (IndexedDB) |
| 后端框架 | Fastify (Node.js) |
| 主数据库 | CouchDB |
| 数据序列化 | MessagePack |
| 数据压缩 | DEFLATE (pako) |
| 断点续传 | TUS 协议 v1.0.0 |
| 实时通信 | WebSocket |
| 包管理器 | pnpm workspaces |
| 构建工具 | tsup (库) + Vite (应用) |
| 测试框架 | Vitest |

## 📄 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

本项目构建于以下优秀的开源项目之上：

- [RxDB](https://rxdb.info/) - JavaScript NoSQL 数据库
- [Fastify](https://www.fastify.io/) - 高性能 Node.js Web 框架
- [Nano](https://www.npmjs.com/package/nano) - CouchDB 客户端
- [MessagePack](https://msgpack.org/) - 高效的二进制序列化
- [TUS 协议](https://tus.io/) - 断点续传协议
- [Pako](https://github.com/nodeca/pako) - zlib 接口

---

<p align="center">
  <sub>为低带宽环境的离线优先应用而构建 ❤️</sub>
</p>
