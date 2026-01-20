# 离线同步引擎（Offline Sync Engine）

> Local-First 架构，专为弱网环境（2G/3G）优化

## 简介

这是一个离线同步引擎项目，采用 Local-First（本地优先）架构设计。与传统 Web 应用不同，我们的架构是：

```
Client → Local DB ↔ Sync Engine ↔ Server DB
```

应用程序的主数据源是本地数据库，网络只是用于数据同步的通道。

### 核心特性

- **读写分离（物理级）**: UI 界面只读写本地数据库，毫秒级响应
- **后台同步**: 同步引擎作为独立后台进程，自动处理数据传输
- **乐观更新**: 用户操作后立即反馈，无需等待服务器响应
- **增量同步**: 仅传输变更集，节省流量
- **断点续传**: 大文件上传失败后可自动恢复
- **冲突解决**: 支持 Last-Write-Wins 和 CRDT 两种策略

### 适用场景

- 非洲等弱网地区（2G/3G）
- 离线优先应用
- 多人协作场景
- 移动端应用

## 文档

| 文档 | 描述 |
|------|------|
| [架构总览](docs/architecture/overview.md) | Local-First 架构设计理念 |
| [客户端 SDK](docs/architecture/client-sdk.md) | 客户端 SDK 架构设计 |
| [传输协议](docs/architecture/transport.md) | 传输协议层设计 |
| [服务端网关](docs/architecture/server-gateway.md) | 服务端同步网关设计 |
| [冲突解决](docs/architecture/conflict-resolution.md) | CRDT 与冲突解决策略 |
| [客户端 API](docs/api/client-api.md) | 客户端 SDK 接口定义 |
| [服务端 API](docs/api/server-api.md) | 服务端同步接口定义 |
| [同步协议](docs/api/sync-protocol.md) | 数据同步协议规范 |
| [当前进度](docs/progress/current.md) | 当前开发进度与状态 |
| [技术选型](docs/plans/tech-stack.md) | 技术栈选择与理由 |
| [研发路线图](docs/plans/roadmap.md) | 三阶段研发计划 |

## 快速开始

> 项目目前处于设计阶段，尚未开始编码实现。

```bash
# 克隆仓库
git clone https://github.com/zrs-products/offline-sync-engine.git

# 安装依赖（待实现）
npm install

# 运行开发服务器（待实现）
npm run dev

# 运行测试（待实现）
npm test
```

## 技术栈

### 前端/客户端
- **RxDB**（首选）: JavaScript NoSQL 数据库，内置复制协议
- **PouchDB**: 成熟库，完全兼容 CouchDB 协议

### 后端/数据库
- **方案一**: Java/Go + MySQL + Canal
- **方案二**: Node.js + CouchDB（最快实现）
- **混合架构**: CouchDB（同步）+ MySQL（业务）

### 冲突解决
- **Last-Write-Wins**: 简单时间戳比较（第一阶段）
- **CRDT**: Yjs 或 Automerge 字段级合并（第三阶段）

## 研发路线

```
阶段一：基础离线功能    [░░░░░░░░░░] 0%  (1.5个月)
  └─ RxDB 集成、本地 Schema、离线队列、LWW 冲突解决

阶段二：流量优化        [░░░░░░░░░░] 0%  (1个月)
  └─ 增量同步、Protobuf 压缩

阶段三：强一致性        [░░░░░░░░░░] 0%  (2个月)
  └─ Yjs 协作冲突解决、tus 断点续传
```

详见 [研发路线图](docs/plans/roadmap.md) 和 [里程碑](docs/progress/milestones.md)。

## 项目结构

```
offline-sync-engine/
├── docs/                    # 项目文档
│   ├── architecture/        # 架构设计文档
│   ├── api/                 # API 规范
│   ├── progress/            # 进度追踪
│   └── plans/               # 计划文档
├── src/                     # 源代码（待开发）
│   ├── client/              # 客户端代码
│   ├── sdk/                 # SDK 封装
│   ├── server/              # 服务端代码
│   └── shared/              # 共享代码
├── tests/                   # 测试文件
│   ├── unit/                # 单元测试
│   ├── integration/         # 集成测试
│   └── e2e/                 # 端到端测试
├── config/                  # 配置文件
├── scripts/                 # 脚本工具
├── packages/                # 子包
├── README.md                # 项目说明
├── CLAUDE.md                # Claude Code 工作指导
└── package.json             # 项目配置
```

## 贡献

项目目前处于设计阶段，暂不接受外部贡献。请关注 [当前进度](docs/progress/current.md) 了解最新状态。

## 许可证

MIT

---

> 本项目旨在解决海外弱网环境下的数据同步问题，具有很好的商业前景。一旦实现，可形成独立的"海外弱网数据传输平台"产品。
