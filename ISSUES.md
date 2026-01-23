# 离线同步引擎 - 剩余问题清单

> 从全局到局部、从高风险到低风险、从高优先级到低优先级排列

---

## 一、架构层面问题（全局/高风险）

### 1.1 Phase 4 生产就绪 - 完全未开始 [P0]
**文件**: 整个项目
**状态**: 0% 完成
**影响**: 无法上线生产环境

| 子任务 | 状态 |
|--------|------|
| 请求验证/安全防护 | 未开始 |
| CORS 配置硬编码为 `*` | 待修复 |
| 无 API 认证机制 | 未开始 |
| 无速率限制 | 未开始 |
| 无结构化日志 | 未开始 |
| 无错误追踪 | 未开始 |
| 无 Docker 部署配置 | 未开始 |
| 无 API 文档自动生成 | 未开始 |

### 1.2 CRDT 模块未与 SyncManager 集成 [P1]
**文件**:
- `packages/sdk/src/crdt/index.ts` (已实现)
- `packages/sdk/src/sync/index.ts` (未集成)

**问题**: CRDT 模块 (基于 Yjs) 已实现字段级冲突解决，但 SyncManager 仍使用 LWW 策略，CRDT 功能未被使用。

### 1.3 缺少端到端集成测试 [P1]
**文件**: `vitest.integration.config.ts` (存在但测试未实现)
**问题**: 客户端 SDK 与服务端之间的完整同步流程缺乏自动化测试。

---

## 二、编译错误（高风险/高优先级）

### 2.1 Server 包 TypeScript 编译失败 [P0] ✅ 已修复
**命令**: `pnpm typecheck` 失败，共 24 个错误 → **已全部修复**

#### 修复详情
| 文件 | 错误数 | 修复方式 |
|------|--------|----------|
| `arbiter/index.ts` | 6 | 添加可选链 `?.` 和空值合并 `??` |
| `applier/index.ts` | 1 | 扩展 bulkDocs 类型支持动态属性 |
| `database/index.ts` | 2 | 重构 nano 类型使用 `ReturnType<typeof nano>` |
| `gateway/index.ts` | 2 | 修复 WebSocket 类型断言和 body 可选类型 |
| `tus/index.ts` | 2 | 处理 header `string \| string[]` 类型 |
| `index.ts` | 1 | 使用 `.toString()` 替代类型断言 |
| `test-sync.ts` | 10 | 修复导入路径，添加响应类型接口 |

---

## 三、测试覆盖率问题（中风险）

### 3.1 Server 包测试覆盖不足 [P1]
**文件**: `packages/server/src/applier/index.ts`
**覆盖率**: 42.61% (语句覆盖)
**未覆盖行**: 123-226, 299-303, 325-347

### 3.2 测试环境配置问题 [P2]
**问题**: TUS 测试中 `localStorage` 未定义
**文件**: `packages/sdk/src/storage/__tests__/tus.test.ts`
**错误**: `Cannot read properties of undefined (reading 'getItem')`

### 3.3 ESLint 无法解析测试文件 [P2]
**问题**: 8 个测试文件未包含在 `tsconfig.json` 中
**受影响文件**:
- `packages/sdk/src/client/__tests__/index.test.ts`
- `packages/sdk/src/crdt/__tests__/index.test.ts`
- `packages/sdk/src/network/__tests__/index.test.ts`
- `packages/sdk/src/outbox/__tests__/index.test.ts`
- `packages/sdk/src/performance.test.ts`
- `packages/sdk/src/storage/__tests__/compression.test.ts`
- `packages/sdk/src/storage/__tests__/tus.test.ts`

---

## 四、代码质量问题（中风险）

### 4.1 ESLint 错误 [P2]
**数量**: 约 20 个错误

| 文件 | 问题 |
|------|------|
| `sdk/src/client/index.ts` | `RxDatabase` 导入未使用; 缺少 `type` 导入 |
| `sdk/src/network/index.ts` | `Observable`, `Subject` 未使用; 空对象类型 `{}` |
| `sdk/src/outbox/index.ts` | 使用 `@ts-ignore` 应改为 `@ts-expect-error` |
| `sdk/src/storage/compression.ts` | `error` 变量未使用 |
| `sdk/src/storage/indexing.ts` | 泛型 `T` 未使用 |
| `sdk/src/storage/init.ts` | `multiTab` 变量未使用 |

### 4.2 ESLint 警告 [P3]
**数量**: 约 50 个警告

| 类型 | 数量 | 主要文件 |
|------|------|----------|
| `@typescript-eslint/no-explicit-any` | ~30 | 多个文件 |
| `no-console` | ~15 | App.tsx, batch.ts, indexing.ts |

---

## 五、功能实现缺失（按优先级）

### 5.1 向量时钟增量同步未完全实现 [P2]
**文件**:
- `packages/sdk/src/storage/schema.ts` - 定义了 `vectorClock` 字段
- `packages/sdk/src/sync/index.ts` - 仅用于存储 lastSyncAt

**问题**: 向量时钟已在 schema 中定义，但同步逻辑仍基于时间戳而非向量时钟。

### 5.2 WebSocket 消息压缩 [P3]
**文件**: `packages/server/src/gateway/index.ts`
**问题**: HTTP 请求支持 MessagePack+DEFLATE 压缩，但 WebSocket 消息使用原始 JSON。

### 5.3 客户端断线重连状态恢复 [P3]
**文件**: `packages/sdk/src/sync/index.ts`
**问题**: WebSocket 断开重连后，未恢复之前的订阅状态，硬编码订阅 `['todos', 'products']`。

---

## 六、配置/文档问题（低风险）

### 6.1 缺少环境变量示例文件 [P3]
**问题**: 无 `.env.example` 文件
**影响**: 新开发者难以配置环境

### 6.2 docs 目录链接失效 [P3]
**文件**: `README.md` 引用的文档
- `docs/architecture/overview.md` - 未找到
- `docs/api/` - 未找到
- `docs/VERIFICATION.md` - 未找到
- `docs/progress/next-steps.md` - 未找到

### 6.3 SDK 初始化方法命名不一致 [P4]
**文件**: `packages/sdk/src/client/index.ts`
**问题**: 代码使用 `init()` 方法，但 README 示例使用 `initialize()`

---

## 七、修复计划优先级排序

### 立即修复 (P0)
1. 修复 server 包的 24 个 TypeScript 编译错误
2. 添加基本安全配置（CORS、请求验证）

### 短期修复 (P1)
3. 提升 applier 模块测试覆盖率
4. 集成 CRDT 模块到 SyncManager
5. 添加端到端集成测试

### 中期修复 (P2)
6. 修复所有 ESLint 错误
7. 将测试文件添加到 tsconfig
8. 实现向量时钟同步

### 长期优化 (P3-P4)
9. 清理 ESLint 警告
10. 补全文档
11. 添加 Docker 部署配置
12. WebSocket 消息压缩
13. API 文档自动生成

---

## 八、关键文件修改清单

| 优先级 | 文件路径 | 修改类型 |
|--------|----------|----------|
| P0 | `packages/server/src/arbiter/index.ts` | 修复 undefined 检查 |
| P0 | `packages/server/src/applier/index.ts` | 修复类型定义 |
| P0 | `packages/server/src/database/index.ts` | 修复 nano 导入 |
| P0 | `packages/server/src/gateway/index.ts` | 修复变量初始化 |
| P0 | `packages/server/src/tus/index.ts` | 修复 header 类型 |
| P0 | `packages/server/src/index.ts` | 修复 WebSocket 类型 |
| P1 | `packages/sdk/src/sync/index.ts` | 集成 CRDT |
| P2 | `packages/sdk/tsconfig.json` | 包含测试文件 |
| P2 | `packages/server/tsconfig.json` | 包含测试文件 |
