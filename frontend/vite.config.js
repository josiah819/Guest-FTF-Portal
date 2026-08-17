import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_PROXY_TARGET (e.g. in an uncommitted .env.local) points the dev proxy
// at a backend on a non-default port.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PROXY_TARGET || 'http://localhost:4000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': target,
        '/uploads': target,
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
