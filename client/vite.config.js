import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to the API server so cookies stay same-origin.
// For a deployed build, set VITE_API_URL to the API's public URL (see .env.example).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': env.API_PROXY_TARGET || 'http://localhost:3000' },
    },
  };
});
