import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // WEB_PORT / API_PORT let a second copy of the repo run beside the first (.env.local).
  const env = loadEnv(mode, import.meta.dirname, '');
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@universe/contracts': fileURLToPath(
          new URL('../../packages/contracts/src/index.ts', import.meta.url),
        ),
        '@universe/wellbeing-core': fileURLToPath(
          new URL('../../packages/wellbeing-core/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      // SSE passes through unbuffered: the API sends no compression and sets X-Accel-Buffering: no.
      proxy: {
        '/api': { target: `http://localhost:${env.API_PORT ?? 4000}`, changeOrigin: false },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['test/setup.ts'],
      include: ['test/**/*.test.{ts,tsx}'],
    },
  };
});
