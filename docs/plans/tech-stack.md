# 技术选型方案

## 前端/客户端

### 数据库层

#### RxDB（首选）

**优势**
- 专为 JavaScript 设计的 NoSQL 数据库
- 底层自动支持 IndexedDB
- 自带 Replication 协议
- 响应式查询（基于 Observable）
- 完美契合 Offline First 理念
- 支持 TypeScript

**劣势**
- 学习曲线较陡
- 包体积较大（~100KB gzipped）

**适用场景**
- 复杂的前端应用
- 需要响应式数据流
- 长期维护的项目

#### PouchDB（备选）

**优势**
- 老牌成熟库，社区活跃
- 完全兼容 CouchDB 协议
- 与 CouchDB 配合零代码同步
- 包体积较小（~40KB gzipped）

**劣势**
- API 相对底层
- 同步协议固定为 CouchDB

**适用场景**
- 快速原型开发
- 后端采用 CouchDB
- 简单的离线需求

### 移动端

#### React Native
- SQLite (react-native-quick-sqlite)
- WatermelonDB（性能优化）

#### Flutter
- sqflite (SQLite)
- ObjectBox

#### 原生
- iOS: CoreData / SQLite / Realm
- Android: Room / Realm

## 后端

### 方案一：Java/Go + MySQL

#### 技术栈
- **语言**: Java 17+ 或 Go 1.21+
- **框架**: Spring Boot (Java) / Gin (Go)
- **数据库**: MySQL 8.0+
- **变更监听**: Canal (MySQL Binlog)
- **消息队列**: Kafka / RabbitMQ

**优势**
- 成熟稳定
- 团队熟悉度高
- SQL 强大的查询能力
- 便于集成现有系统

**劣势**
- 同步逻辑需要自己实现
- 需要额外维护 Canal
- 开发周期较长

**适用场景**
- 已有 MySQL 数据库
- 复杂的报表分析需求
- Java/Go 技术团队

### 方案二：Node.js + CouchDB

#### 技术栈
- **运行时**: Node.js 20+
- **框架**: Fastify / Express
- **数据库**: CouchDB 3.x
- **同步**: 内置 _changes feed

**优势**
- 研发速度最快
- PouchDB + CouchDB 零代码同步
- 同步机制开箱即用
- 多主复制原生支持

**劣势**
- CouchDB 查询能力较弱
- 不适合复杂报表
- 需要额外 ETL 到 MySQL

**适用场景**
- 快速上线
- 前端主导项目
- 新项目无历史包袱

### 方案三：混合架构（推荐）

#### 技术栈
- **同步层**: CouchDB
- **业务层**: MySQL / PostgreSQL
- **ETL**: 自定义或 Airbyte

```
前端 PouchDB ←→ CouchDB (同步)
                      ↓
                   ETL 管道
                      ↓
                  MySQL (业务/报表)
```

**优势**
- 兼顾同步便利性和查询能力
- CouchDB 专注弱网同步
- MySQL 专注业务和报表

**劣势**
- 需要维护两套数据库
- 数据一致性需要额外处理

**适用场景**
- 海安控股类场景
- 需要强大的报表功能
- 长期维护的项目

## 冲突解决

### Last-Write-Wins (LWW)

**实现**
- 数据库字段: `updated_at`, `updated_by`
- 比较逻辑: 时间戳大的覆盖小的

**适用**: 第一阶段 MVP

### CRDT

#### Yjs（推荐）

**优势**
- 性能优秀
- 二进制格式，体积小
- 社区活跃
- 支持多种数据结构

**劣势**
- 学习曲线陡峭
- 需要额外存储 CRDT 状态

**适用**: 第三阶段，需要字段级合并

#### Automerge

**优势**
- 专注于 JSON 文档
- API 简洁

**劣势**
- 性能不如 Yjs

## 数据传输

### 序列化格式

| 格式 | 体积 | 速度 | 可读性 | 推荐度 |
|------|------|------|--------|--------|
| JSON | 100% | ⭐⭐⭐⭐ | ✓ | ⭐⭐⭐ |
| MsgPack | ~60% | ⭐⭐⭐⭐ | ✗ | ⭐⭐⭐⭐ |
| Protobuf | ~40% | ⭐⭐⭐ | ✗ | ⭐⭐⭐⭐⭐ |
| CBOR | ~55% | ⭐⭐⭐⭐ | ✗ | ⭐⭐⭐⭐ |

**推荐**: Protobuf（第三阶段）

### 文件上传

#### tus 协议

**优势**
- RFC 标准
- 断点续传原生支持
- 服务端实现丰富

**推荐用于**: 所有阶段的文件上传

## 实时通信

### WebSocket

**优势**
- 双向通信
- 低延迟
- 广泛支持

**实现**
- 服务端: ws (Node.js) / netty (Java) / gorilla websocket (Go)
- 客户端: 浏览器原生 / 库封装

## 推荐组合

### 组合 A：快速上线
```
前端: PouchDB
后端: Node.js + CouchDB
冲突: LWW
传输: JSON
```

### 组合 B：长期维护（推荐）
```
前端: RxDB
后端: Java/Go + MySQL
同步: 自研 (参考 CouchDB 协议)
冲突: LWW → CRDT
传输: JSON → Protobuf
```

### 组合 C：混合架构
```
前端: RxDB
后端: Node.js + CouchDB + MySQL
同步: PouchDB → CouchDB
业务: ETL → MySQL
冲突: LWW → CRDT
```

## 待确认事项

| 决策项 | 选项 | 状态 |
|--------|------|------|
| 后端语言 | Java / Go / Node.js | 🔴 待决策 |
| 数据库 | MySQL / CouchDB / 混合 | 🔴 待决策 |
| 首发平台 | Web / iOS / Android | 🔴 待决策 |
| 前端框架 | React / Vue / Angular | 🔴 待决策 |
| 是否需要 CRDT | 是 / 否 | 🟡 待评估 |
