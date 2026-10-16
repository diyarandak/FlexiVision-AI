import { defineConfig } from 'vite';

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(new Date().toISOString()) },
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
});
