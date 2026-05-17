import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const webPort = Number(process.env.CONDUCTOR_WEB_PORT ?? 5174);
const apiPort = Number(process.env.CONDUCTOR_API_PORT ?? 5175);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
