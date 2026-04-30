import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // `host: true` makes `npm run dev:server` reachable on all interfaces, so
  // the institute LAN can hit the staging build at the host's IP. Default
  // Vite binds to 127.0.0.1 only, which would silently 404 from other devices.
  server: { host: true },
});
