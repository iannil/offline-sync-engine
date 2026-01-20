# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码仓库中工作时提供指导。

## 项目概述

这是一个离线同步引擎（Offline Sync Engine），采用 Local-First（本地优先）架构设计，专门针对恶劣网络环境（如非洲地区的 2G/3G 网络）进行优化。系统将本地存储作为主数据源，使应用能够完全离线运行，同步过程在后台进行。

核心原理： UI 读写本地数据库（IndexedDB/Web/SQLite）→ 同步引擎处理后台同步 → 服务端存储最终一致性数据。

## 架构

系统采用三层模型：

1. 客户端 SDK（The Edge） - 嵌入前端应用中
   - 本地存储：IndexedDB（Web端）、SQLite/Realm（移动端）
   - Outbox 模式：拦截写操作，将变更作为 Action 存入队列
   - 网络管理器：指数退避重试逻辑（1s → 2s → 4s → 8s）

2. 传输协议层（The Tunnel）
   - 增量同步：仅传输变更集，而非全量数据
   - 使用向量时钟（Vector Clock）或默克尔树（Merkle Tree）进行差异检测
   - tus 协议实现分片文件上传的断点续传
   - 使用 Protobuf/MsgPack 替代 JSON（体积减少 40-60%）

3. 服务端同步网关（The Hub）
   - Applier：接收客户端 Action 并应用到主数据库
   - Arbiter：冲突仲裁模块
   - Push：通过 WebSocket 向其他在线客户端广播

## 推荐技术栈

前端/客户端：

- RxDB（首选）：JavaScript NoSQL 数据库，内置复制协议
- PouchDB：成熟库，完全兼容 CouchDB 协议

后端方案：

- 方案一：Java/Go + MySQL，使用 Canal 监听 Binlog 变更
- 方案二：Node.js + CouchDB（实现最快；PouchDB + CouchDB = 零代码同步）

冲突解决：

- Last-Write-Wins（LWW）：简单的 `updated_at` 时间戳比较（第一阶段）
- 基于 CRDT：使用 Yjs 或 Automerge 实现字段级合并（第三阶段）

## 研发阶段

第一阶段 - 基础离线功能（1.5个月）

- 引入 RxDB 替换现有 API 调用
- 构建本地 Schema
- 实现离线队列，采用 Last-Write-Wins 冲突解决策略

第二阶段 - 流量优化（1个月）

- 后端接口支持 `since` 参数实现增量同步
- 引入 Protobuf 进行数据压缩

第三阶段 - 强一致性（2个月）

- 集成 Yjs 实现协作冲突解决
- 实现 tus 协议支持文件断点续传

## 混合架构说明

对于需要复杂报表功能的生产环境：

- CouchDB：处理离线同步和弱网场景
- MySQL：核心业务数据库，用于复杂报表/分析
- ETL 管道：将数据从 CouchDB 同步到 MySQL

这种混合方案兼具两者优势：可靠的离线同步 + 强大的 SQL 分析能力。
