import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@offline-sync/sdk': path.resolve(__dirname, '../../packages/sdk/src'),
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['rxdb'],
  },
  define: {
    // RxDB requires this
    global: 'globalThis',
  },
});
