import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    timeout: 10000,
    include: ['src/**/*.test.ts', 'src/**/__tests__/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/index.ts',       // 仅主入口文件
        'src/testing/**',     // 测试工具
        'src/storage/batch.ts', // 批量操作 - 需要 IndexedDB
        'src/storage/indexing.ts', // 索引 - 需要 IndexedDB
        'src/storage/query.ts', // 查询 - 需要 IndexedDB
        'src/storage/init.ts', // 初始化 - 需要 IndexedDB
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
