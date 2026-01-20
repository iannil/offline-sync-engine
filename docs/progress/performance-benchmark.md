# IndexedDB 性能基准测试报告

> 测试日期：2025-01-20
> 测试环境：Chrome (待补充具体版本), macOS (待补充)
> 数据库：RxDB 15.28.0 + Dexie.js (IndexedDB)

---

## 测试目标

验证 IndexedDB 在浏览器环境下的性能表现，确保满足离线同步引擎的性能要求。

### 性能基准

| 操作 | 目标 | 状态 |
|------|------|------|
| 单次写入 | < 10ms | ⏳ 待测试 |
| 批量读取（100 条） | < 50ms | ⏳ 待测试 |
| 查询（1000 条数据） | < 100ms | ⏳ 待测试 |
| 存储容量 | > 100MB | ⏳ 待测试 |

---

## 测试方法

### 写入性能测试

```typescript
// packages/sdk/src/testing/performance.ts

export async function benchmarkWrite<T>(
  collection: RxCollection,
  count: number,
  dataFactory: () => T
): Promise<BenchmarkResult>
```

**测试步骤：**
1. 生成指定数量的测试文档
2. 逐个插入到集合
3. 记录每次插入的耗时
4. 计算平均、最小、最大耗时和吞吐量

### 读取性能测试

```typescript
export async function benchmarkRead(
  collection: RxCollection,
  count: number
): Promise<BenchmarkResult>
```

**测试步骤：**
1. 预填充测试数据（至少 100 条）
2. 按主键随机读取指定次数
3. 记录每次读取的耗时
4. 计算统计数据

### 查询性能测试

```typescript
export async function benchmarkQuery(
  collection: RxCollection,
  count: number
): Promise<BenchmarkResult>
```

**测试步骤：**
1. 预填充 1000 条测试数据
2. 执行带 selector 的查询（按分类过滤）
3. 记录每次查询的耗时
4. 计算统计数据

### 容量测试

```typescript
export async function testCapacity<T>(
  collection: RxCollection,
  targetMB: number,
  dataFactory: () => T
): Promise<CapacityTestResult>
```

**测试步骤：**
1. 获取初始存储使用量（`navigator.storage.estimate()`）
2. 持续插入文档直到达到目标大小
3. 验证是否可以成功存储目标大小的数据
4. 清理测试数据

---

## 运行测试

### 通过 Demo 页面

```bash
pnpm dev:client
# 访问 http://localhost:5173
# 导航到性能测试页面
```

### 通过 Vitest

```bash
pnpm test:perf
```

---

## 测试结果

### 待补充

运行测试后，请将结果补充到本节。

---

## 已知限制

1. **浏览器兼容性**：`navigator.storage.estimate()` API 在某些浏览器中可能不可用或返回不准确的数据。

2. **性能波动**：IndexedDB 性能受多种因素影响：
   - 浏览器版本
   - 系统负载
   - 磁盘 I/O 性能
   - 其他标签页的活动

3. **测试数据**：当前测试使用简单的 Todo 数据结构，实际业务数据的复杂度可能更高。

---

## 性能优化建议

如果测试结果未达标，可考虑以下优化方案：

### 写入优化
1. 批量写入而非单条写入
2. 使用事务合并多个操作
3. 延迟索引创建到批量插入之后

### 读取优化
1. 使用索引加速查询
2. 缓存热点数据
3. 分页加载而非全量加载

### 查询优化
1. 合理设计索引
2. 避免深度嵌套查询
3. 使用 RxDB 的查询计划缓存

---

## 参考链接

- [RxDB Performance](https://rxdb.info/performance.html)
- [IndexedDB Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Best_Practices)
- [Browser Storage Quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_Estimate)
