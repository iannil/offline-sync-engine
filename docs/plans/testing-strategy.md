# 测试策略

## 测试目标

确保离线同步引擎在各种网络条件和场景下可靠运行。

## 测试层级

```
┌─────────────────────────────────────────────────────────┐
│                      E2E 测试                            │
│                 完整的用户场景模拟                        │
├─────────────────────────────────────────────────────────┤
│                    集成测试                              │
│            客户端-服务端同步流程验证                      │
├─────────────────────────────────────────────────────────┤
│                    单元测试                              │
│              各模块独立功能验证                          │
└─────────────────────────────────────────────────────────┘
```

## 单元测试

### 客户端单元测试

**目标覆盖率**: > 70%

#### 测试模块

| 模块 | 测试内容 | 工具 |
|------|----------|------|
| 本地存储 | CRUD、索引、查询 | Jest + rxdb-memory |
| Outbox | 入队、出队、状态管理 | Jest |
| 网络管理 | 在线/离线检测、退避算法 | Jest + mock |
| 同步引擎 | Push/Pull 逻辑 | Jest + mock |
| 冲突解决 | LWW 算法 | Jest |

#### 示例测试用例

```typescript
describe('Outbox', () => {
  it('should enqueue action correctly', async () => {
    const outbox = new Outbox(db);
    const action = createMockAction();
    await outbox.enqueue(action);
    const count = await outbox.count();
    expect(count).toBe(1);
  });

  it('should apply exponential backoff', async () => {
    const backoff = new ExponentialBackoff();
    expect(backoff.nextDelay(1)).toBe(1000);
    expect(backoff.nextDelay(2)).toBe(2000);
    expect(backoff.nextDelay(3)).toBe(4000);
  });
});
```

### 服务端单元测试

**目标覆盖率**: > 75%

#### 测试模块

| 模块 | 测试内容 | 工具 |
|------|----------|------|
| Applier | Action 应用、事务 | Jest + Test DB |
| Arbiter | 冲突检测、LWW、CRDT | Jest |
| Push Service | WebSocket 广播 | Jest + mock-websocket |
| API 端点 | 请求/响应验证 | Supertest |

#### 示例测试用例

```typescript
describe('Arbiter', () => {
  describe('LWW Strategy', () => {
    it('should choose record with later timestamp', () => {
      const local = { value: 'A', timestamp: 1000 };
      const remote = { value: 'B', timestamp: 2000 };
      const result = arbiter.resolveLWW(local, remote);
      expect(result).toBe(remote);
    });

    it('should detect concurrent modifications', () => {
      const local = { value: 'A', timestamp: 1000 };
      const remote = { value: 'B', timestamp: 1000 };
      const result = arbiter.detectConflict(local, remote);
      expect(result.hasConflict).toBe(true);
    });
  });
});
```

## 集成测试

### 同步流程测试

#### 测试场景

```typescript
describe('Sync Integration', () => {
  it('should sync data from client to server', async () => {
    // 客户端创建数据
    await client.orders.create({ id: '1', status: 'pending' });

    // 触发同步
    await client.sync();

    // 验证服务端数据
    const serverRecord = await server.db.orders.get('1');
    expect(serverRecord.status).toBe('pending');
  });

  it('should sync data from server to client', async () => {
    // 服务端创建数据
    await server.db.orders.insert({ id: '2', status: 'confirmed' });

    // 客户端拉取
    await client.pull();

    // 验证客户端数据
    const localRecord = await client.orders.get('2');
    expect(localRecord.status).toBe('confirmed');
  });
});
```

### 冲突解决测试

```typescript
describe('Conflict Resolution', () => {
  it('should resolve LWW conflict correctly', async () => {
    // 客户端 A 修改
    await clientA.orders.update('1', { status: 'paused' });

    // 客户端 B 修改（时间戳更新）
    await clientB.orders.update('1', { status: 'active' });

    // 同步
    await clientA.sync();
    await clientB.sync();

    // 验证最终状态
    const finalA = await clientA.orders.get('1');
    const finalB = await clientB.orders.get('1');
    expect(finalA.status).toBe('active');
    expect(finalB.status).toBe('active');
  });
});
```

## 弱网测试

### 网络条件模拟

```typescript
// 使用 Chrome DevTools Protocol 或 Network Emulation
const networkConditions = {
  offline: { offline: true },
  slow2g: { download: 10, upload: 10, latency: 2000 },
  '2g': { download: 50, upload: 50, latency: 300 },
  '3g': { download: 750, upload: 250, latency: 100 },
  '4g': { download: 4000, upload: 3000, latency: 20 }
};

describe('Weak Network Tests', () => {
  Object.entries(networkConditions).forEach(([name, condition]) => {
    it(`should work under ${name} condition`, async () => {
      await emulateNetwork(condition);
      await runSyncScenario();
      expect(await verifyData()).toBe(true);
    });
  });
});
```

### 测试场景

| 场景 | 描述 | 验收标准 |
|------|------|----------|
| 离线创建 | 断网下创建数据，恢复后同步 | 数据最终一致 |
| 离线修改 | 断网下修改数据，恢复后同步 | 修改成功同步 |
| 网络切换 | 4G → 3G → 2G 网络切换 | 同步不中断 |
| 长时间离线 | 离线 24h 后恢复 | 数据可恢复 |
| 不稳定网络 | 间歇性断网 | 重试成功 |
| 高延迟 | 2G 网络高延迟 | 最终同步成功 |

## E2E 测试

### 用户场景测试

```typescript
describe('User Scenarios', () => {
  it('should complete order creation flow offline', async () => {
    // 1. 打开应用
    await page.goto('/');

    // 2. 断网
    await page.setOffline(true);

    // 3. 创建订单
    await page.fill('#customer', 'Customer A');
    await page.click('#create-order');

    // 4. 验证本地保存
    expect(await page.textContent('.order-status')).toBe('已保存');

    // 5. 恢复网络
    await page.setOffline(false);

    // 6. 等待同步
    await page.waitForSelector('.sync-status', { state: 'synced' });

    // 7. 验证服务端数据
    const serverData = await fetchFromServer(`/orders/${orderId}`);
    expect(serverData.customer).toBe('Customer A');
  });
});
```

### 多客户端协作测试

```typescript
describe('Multi-Client Collaboration', () => {
  it('should sync changes between two clients', async () => {
    // 客户端 A 修改
    const browserA = await playwright.launch();
    const pageA = await browserA.newPage();
    await pageA.goto('/');
    await pageA.fill('#order-1-status', 'confirmed');
    await pageA.click('#save');

    // 等待同步
    await pageA.waitForSelector('.synced');

    // 客户端 B 获取更新
    const browserB = await playwright.launch();
    const pageB = await browserB.newPage();
    await pageB.goto('/');
    await pageB.waitForSelector('.synced');

    // 验证更新
    expect(await pageB.textContent('#order-1-status')).toBe('confirmed');
  });
});
```

## 性能测试

### 指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 本地读写延迟 | < 10ms | Performance API |
| 同步延迟 (4G) | < 1s | Network Timing |
| 同步延迟 (3G) | < 5s | Network Timing |
| 同步延迟 (2G) | < 30s | Network Timing |
| 内存占用 | < 50MB | Performance.memory |
| 包体积 (gzip) | < 150KB | Bundle Analyzer |

### 压力测试

```typescript
describe('Performance Tests', () => {
  it('should handle 1000 records sync', async () => {
    // 创建 1000 条记录
    const records = Array.from({ length: 1000 }, (_, i) => ({
      id: `order-${i}`,
      amount: Math.random() * 1000
    }));

    await client.orders.batchCreate(records);
    await client.sync();

    // 验证
    const count = await server.db.orders.count();
    expect(count).toBe(1000);
  });

  it('should handle concurrent clients', async () => {
    const clients = Array.from({ length: 10 }, () => new OfflineSync());

    await Promise.all(clients.map(c => c.sync()));

    // 验证无数据丢失
    const serverCount = await server.db.orders.count();
    const localCounts = await Promise.all(
      clients.map(c => c.orders.count())
    );

    localCounts.forEach(count => {
      expect(count).toBe(serverCount);
    });
  });
});
```

## 测试工具

| 工具 | 用途 |
|------|------|
| Jest | 单元测试框架 |
| Supertest | HTTP 接口测试 |
| Playwright | E2E 测试 |
| rxdb-memory | RxDB 内存数据库 |
| MSW (Mock Service Worker) | API Mock |
| Chrome DevTools Protocol | 网络模拟 |
| k6 / Artillery | 性能测试 |

## 测试环境

### 本地开发
```bash
# 运行单元测试
npm test

# 运行集成测试
npm run test:integration

# 运行 E2E 测试
npm run test:e2e
```

### CI/CD
```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: |
          npm ci
          npm test
          npm run test:integration
```

## 测试计划

### 阶段一测试
- [ ] 单元测试框架搭建
- [ ] 本地存储测试
- [ ] Outbox 测试
- [ ] 网络管理器测试
- [ ] 基础同步流程测试
- [ ] 离线场景测试

### 阶段二测试
- [ ] 增量同步测试
- [ ] Protobuf 编解码测试
- [ ] 性能基准测试
- [ ] 流量统计测试

### 阶段三测试
- [ ] CRDT 合并测试
- [ ] 字段级冲突测试
- [ ] tus 断点续传测试
- [ ] WebSocket 推送测试
- [ ] 多客户端协作测试
- [ ] 完整 E2E 测试套件
