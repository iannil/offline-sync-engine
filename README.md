# Offline Sync Engine

> Local-first offline sync engine, optimized for low-bandwidth environments

[中文版](README.zh-CN.md) | English

A complete offline sync solution using Local-First architecture. Apps run fully offline with local storage as the primary data source, while automatically syncing with the server in the background. Optimized for unstable network conditions (like 2G/3G networks in Africa), with data compression, resumable uploads, and intelligent conflict resolution.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
[![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

### Core Capabilities

- 🌐 **Full Offline Support** - Works completely offline with IndexedDB local storage
- 🔄 **Auto Sync** - Automatically syncs when network is detected
- ⚡ **Incremental Sync** - Transmits only changed data to save bandwidth
- 🗜️ **Outbox Pattern** - Intercepts writes, queues them locally, reliable sync
- 🧠 **Smart Conflict Resolution** - Last-Write-Wins (LWW) + Vector Clocks
- 📱 **Cross-Platform** - Works on Web and mobile (based on RxDB)

### Advanced Features

- 📦 **Data Compression** - MessagePack + DEFLATE, reduces data by 40-60%
- 📤 **Resumable Uploads** - Full TUS protocol implementation for large files
- ⚡ **Performance Optimized** - Batch operations, indexing, query caching
- 🔌 **Real-time Push** - WebSocket server push notifications
- 🛡️ **Type-Safe** - End-to-end TypeScript support

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Client App                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    UI Layer (React)                    │ │
│  └──────────────────────┬─────────────────────────────────┘ │
│                         │                                   │
│  ┌──────────────────────▼─────────────────────────────────┐ │
│  │                 Offline SDK (@offline-sync/sdk)        │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐     │ │
│  │  │ Storage │  │ Network │  │ Outbox  │  │ Sync   │     │ │
│  │  │ (RxDB)  │  │Manager  │  │ (Queue) │  │Manager │     │ │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └───┬────┘     │ │
│  │       │            │            │            │         │ │
│  │  ┌───▼────────────▼────────────▼────────────▼───┐      │ │
│  │  │           IndexedDB (Browser Local Storage)      │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS (Compressed)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Sync Gateway Server                      │
│  ┌──────────────┐  ┌──────────┐  ┌─────────┐   ┌────────┐   │
│  │   Gateway    │  │ Applier  │  │ Arbiter │   │   TUS  │   │
│  │  (Routing)   │  │(Apply    │  │(Conflict│   │(Resumable│ │
│  │              │  │Actions)  │  │Resolution)│ │Uploads) │  │
│  └──────┬───────┘  └────┬─────┘  └────┬─────┘  └────┬───┘   │
│         │               │             │             │       │
│  ┌──────▼──────────────▼─────────────▼─────────────▼────┐   │
│  │                 CouchDB (Main Database)              │   │
│  │  - todos, products, customers, orders                │   │
│  │  - _changes feed for incremental sync                │   │
│  │  - Mango Query support                               │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/iannil/offline-sync-engine.git
cd offline-sync-engine

# Install dependencies
pnpm install
```

### Run Development Servers

```bash
# Start server (port 3000)
pnpm dev:server

# Start client demo (port 5173)
pnpm dev:client
```

### Build

```bash
# Build SDK
pnpm --filter @offline-sync/sdk build

# Build server
pnpm --filter @offline-sync/server build

# Build demo
pnpm --filter @offline-sync/client-demo build
```

## 💻 Usage Examples

### SDK Basic Usage

```typescript
import { OfflineClient } from '@offline-sync/sdk';

// Initialize client
const client = new OfflineClient({
  database: { name: 'my-app' },
  sync: {
    enabled: true,
    url: 'https://api.example.com/sync',
    interval: 30000,  // sync every 30s
    enableCompression: true,
  },
});

// Wait for client to be ready
await client.initialize();

// Get database
const db = client.getDatabase();

// Create a todo (offline + auto sync)
const todo = await db.todos.insert({
  id: 'todo-1',
  text: 'Learn Offline Sync Engine',
  completed: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// Manually trigger sync
await client.getSyncManager().triggerSync();

// Monitor sync state
client.getSyncManager().onStateChange((state) => {
  console.log('Syncing:', state.isSyncing);
  console.log('Pending:', state.pendingCount);
});
```

### TUS Resumable Uploads

```typescript
import { createTusUpload } from '@offline-sync/sdk/storage';

// Create file upload
const uploader = createTusUpload({
  endpoint: 'https://api.example.com/api/tus',
  data: file,
  metadata: {
    filename: file.name,
    type: file.type,
  },
  chunkSize: 5 * 1024 * 1024,  // 5MB chunks
  onProgress: (sent, total) => {
    console.log(`Progress: ${(sent / total * 100).toFixed(1)}%`);
  },
});

// Start upload
const uploadUrl = await uploader.start();

// Pause upload
uploader.pause();

// Resume upload (supports resumable uploads)
await uploader.resume();
```

### Server API

```bash
# Push local operations to server
curl -X POST https://api.example.com/api/sync/push \
  -H "Content-Type: application/msgpack+deflate" \
  -H "Accept: application/msgpack+deflate" \
  --data-binary '@payload.bin'

# Pull server changes
curl "https://api.example.com/api/sync/pull?since=1234567890" \
  -H "Accept: application/msgpack+deflate"

# TUS create upload
curl -X POST https://api.example.com/api/tus \
  -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Length: 1024000" \
  -H "Upload-Metadata: filename dGVzdC5qcGc="
```

## 📦 Package Structure

```
offline-sync-engine/
├── packages/
│   ├── sdk/              # Client SDK
│   │   ├── src/
│   │   │   ├── storage/     # Storage modules
│   │   │   ├── network/     # Network management
│   │   │   ├── outbox/      # Offline queue
│   │   │   ├── sync/        # Sync management
│   │   │   └── client/      # Client entry
│   │   └── package.json
│   │
│   ├── server/           # Sync gateway server
│   │   ├── src/
│   │   │   ├── gateway/     # Sync gateway
│   │   │   ├── applier/     # Operation applier
│   │   │   ├── arbiter/     # Conflict arbiter
│   │   │   ├── database/    # Database layer
│   │   │   └── tus/         # TUS protocol
│   │   └── package.json
│   │
│   └── client-demo/       # Demo application
│       ├── src/
│       │   ├── components/
│       │   └── db/
│       └── package.json
│
├── docs/                 # Documentation
├── pnpm-workspace.yaml  # Monorepo configuration
└── package.json
```

## 🔧 Configuration

### SDK Configuration

```typescript
interface OfflineClientConfig {
  // Database configuration
  database: {
    name: string;              // Database name
  };

  // Sync configuration
  sync?: {
    enabled: boolean;         // Enable sync
    url: string;              // Sync server URL
    interval?: number;        // Sync interval (ms)
    batchSize?: number;       // Batch size
    enableCompression?: boolean;  // Enable compression
    enableWebSocket?: boolean;    // Enable WebSocket
  };

  // Outbox configuration
  outbox?: {
    maxRetries?: number;      // Max retry attempts
    initialDelay?: number;    // Initial retry delay (ms)
    maxDelay?: number;        // Max retry delay (ms)
  };
}
```

### Server Configuration

```bash
# Environment variables
COUCHDB_URL=http://localhost:5984
COUCHDB_USERNAME=admin
COUCHDB_PASSWORD=password
COUCHDB_DB_PREFIX=offline-sync
PORT=3000
HOST=0.0.0.0
```

## 📚 API Documentation

### SDK Exports

```typescript
// Client
import { OfflineClient } from '@offline-sync/sdk/client';

// Storage
import {
  createDatabase,
  getDatabase,
  todoSchema,
  productSchema,
} from '@offline-sync/sdk/storage';

// Query
import {
  findAll,
  findById,
  findWhere,
  paginate,
  count,
  QueryBuilder,
} from '@offline-sync/sdk/storage';

// Compression
import {
  CompressionService,
  compress,
  decompress,
} from '@offline-sync/sdk/storage';

// TUS Protocol
import {
  createTusUpload,
  uploadFile,
  TusUploader,
} from '@offline-sync/sdk/storage';

// Testing
import {
  benchmarkWrite,
  benchmarkRead,
  benchmarkQuery,
  testCapacity,
} from '@offline-sync/sdk/testing';

// Types
import type { Todo, Product, OutboxAction, NetworkStatus } from '@offline-sync/sdk';
```

### Server Endpoints

| Endpoint | Method | Description |
| ---------- | -------- | ------------- |
| `/health` | GET | Health check |
| `/api/sync/push` | POST | Push local operations |
| `/api/sync/pull` | GET | Pull remote changes |
| `/api/sync/:collection` | GET | Get collection data |
| `/api/sync/:collection/:id` | GET | Get single document |
| `/api/applier/apply` | POST | Apply single operation |
| `/api/applier/batch` | POST | Batch apply operations |
| `/api/arbiter/check` | POST | Conflict detection |
| `/api/arbiter/resolve` | POST | LWW conflict resolution |
| `/api/arbiter/resolve/merge` | POST | Field-level merge |
| `/api/tus` | POST | Create upload |
| `/api/tus/:id` | PATCH | Upload chunk |
| `/api/stream` | WS | Real-time push |

## 🧪 Development

### Requirements

- Node.js >= 18
- pnpm >= 8
- CouchDB >= 3.0 (optional, for production)

### Development Commands

```bash
# Install dependencies
pnpm install

# Start dev servers
pnpm dev:server  # Server
pnpm dev:client  # Client

# Run tests
pnpm test

# Lint code
pnpm lint
pnpm format
```

### Local CouchDB Development

```bash
# Start CouchDB with Docker
docker run -d \
  --name couchdb \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=password \
  couchdb:3
```

## 📖 Documentation

| Document | Description |
| ---------- | ------------- |
| [Architecture Overview](docs/architecture/overview.md) | Local-First architecture design |
| [API Documentation](docs/api/) | Client/Server API definitions |
| [Verification Report](docs/VERIFICATION.md) | Feature verification checklist |
| [Development Progress](docs/progress/next-steps.md) | Development roadmap |

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

### Code Standards

- Write code in TypeScript
- Follow ESLint rules
- Add unit tests for new features
- Update relevant documentation

## 📊 Development Progress

```
✅ Phase 1: Basic Offline  [████████████████████████████] 100%
   └─ RxDB integration, schemas, offline queue, LWW conflict resolution

✅ Phase 2: Optimization     [████████████████████████████] 100%
   └─ Incremental sync, MessagePack compression

✅ Phase 3: Advanced Features  [████████████████████████████] 100%
   └─ TUS resumable uploads, WebSocket push, performance optimization
```

See [Development Progress](docs/progress/next-steps.md) for details.

## 🔗 Tech Stack

| Category | Technology |
| ---------- | ------------ |
| Frontend Framework | React + TypeScript |
| Local Database | RxDB + Dexie (IndexedDB) |
| Backend Framework | Fastify (Node.js) |
| Main Database | CouchDB |
| Data Serialization | MessagePack |
| Data Compression | DEFLATE (pako) |
| Resumable Upload | TUS Protocol v1.0.0 |
| Real-time Communication | WebSocket |
| Package Manager | pnpm workspaces |
| Build Tools | tsup (libraries) + Vite (apps) |
| Testing Framework | Vitest |

## 📄 License

MIT License - see [LICENSE](LICENSE) file

## 🙏 Acknowledgments

This project is built on top of excellent open source projects:

- [RxDB](https://rxdb.info/) - JavaScript NoSQL database
- [Fastify](https://www.fastify.io/) - High-performance Node.js web framework
- [Nano](https://www.npmjs.com/package/nano) - CouchDB client
- [MessagePack](https://msgpack.org/) - Efficient binary serialization
- [TUS Protocol](https://tus.io/) - Resumable upload protocol
- [Pako](https://github.com/nodeca/pako) | zlib interface

---

<p align="center">
  <sub>Built with ❤️ for offline-first applications in low-bandwidth environments</sub>
</p>
