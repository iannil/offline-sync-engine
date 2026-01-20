# Contributing to Offline Sync Engine

感谢你有兴趣为 Offline Sync Engine 做贡献！

## 开发流程

### 环境准备

1. **Fork 并克隆仓库**
   ```bash
   git clone https://github.com/your-username/offline-sync-engine.git
   cd offline-sync-engine
   ```

2. **安装依赖**
   ```bash
   pnpm install
   ```

3. **启动开发服务器**
   ```bash
   # 服务端 (需要 CouchDB)
   pnpm dev:server

   # 客户端 Demo
   pnpm dev:client
   ```

### 代码规范

#### TypeScript 规范

- 使用 TypeScript 编写所有代码
- 遵循现有代码风格
- 添加适当的类型注解
- 避免使用 `any` 类型

#### 命名约定

- 文件名: `kebab-case` (如: `compression-service.ts`)
- 接口/类型: `PascalCase` (如: `SyncConfig`)
- 变量/函数: `camelCase` (如: `getDatabase`)
- 常量: `SCREAMING_SNAKE_CASE`
- 私有成员: 前缀下划线 (如: `_syncTimer`)

#### 提交信息规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
- **scope**: `sdk`, `server`, `demo`, `docs`
- **subject**: 简短描述，使用祈使句

示例:
```
feat(sdk): add MessagePack compression support

- Add CompressionService class
- Update sync module to use compressed format
- Add compression benchmarks

Closes #123
```

### 测试

在提交 PR 之前，请确保：

1. **所有测试通过**
   ```bash
   pnpm test
   ```

2. **添加新功能的测试**
   - 单元测试覆盖核心逻辑
   - 集成测试覆盖关键流程

3. **更新相关文档**
   - API 变更更新 API 文档
   - 新功能更新 README

### Pull Request 流程

1. 创建分支: `git checkout -b feature/your-feature-name`
2. 编写代码和测试
3. 确保所有检查通过: `pnpm lint && pnpm test`
4. 提交代码: `git commit -m "feat: add your feature"`
5. 推送分支: `git push origin feature/your-feature-name`
6. 创建 Pull Request

## 项目结构

```
packages/
├── sdk/           # 客户端 SDK - 功能扩展和 bug 修复
├── server/        # 服务端 API - 功能扩展和 bug 修复
└── client-demo/   # 示例应用 - 使用示例和文档
```

## 开发指南

### SDK 开发

SDK 是核心模块，修改时请注意：

1. **保持向后兼容** - 避免破坏性更改
2. **添加类型定义** - 所有公开 API 都要有类型
3. **文档注释** - 使用 JSDoc 添加文档
4. **测试覆盖** - 新功能需要单元测试

### 服务端开发

服务端 API 修改时请注意：

1. **API 版本控制** - 重大更改需要版本号升级
2. **错误处理** - 统一的错误响应格式
3. **日志记录** - 使用结构化日志
4. **性能考虑** - 数据库查询优化

### 文档更新

当添加新功能时，请更新以下文档：

1. **README.md** - 如果是用户可见的功能
2. **API 文档** - 添加新的 API 说明
3. **代码注释** - JSDoc 注释

## 报告问题

### Bug 报告

请通过 GitHub Issues 报告 bug，并提供：

1. **复现步骤**
2. **预期行为**
3. **实际行为**
4. **环境信息** (Node.js 版本、操作系统等)

### 功能请求

欢迎提出功能建议！请先创建 Issue 讨论设计。

## 开发资源

### 相关文档

- [RxDB 文档](https://rxdb.info/)
- [Fastify 文档](https://www.fastify.io/)
- [CouchDB 文档](https://docs.couchdb.org/)
- [TUS 协议](https://tus.io/)

### 设计理念

本项目遵循以下设计原则：

1. **本地优先** - 数据主要存储在本地
2. **最终一致性** - 允许短暂的数据不一致
3. **乐观更新** - 用户操作立即反馈，后台同步
4. **优雅降级** - 弱网环境下自动降级

## 行为准则

- 尊重他人，包容不同观点
- 专注于对项目最有帮助的事情
- 优先考虑社区利益

---

感谢你的贡献！
