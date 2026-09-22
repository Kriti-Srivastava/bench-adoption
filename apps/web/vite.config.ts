import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin in development, so the session cookie just works.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
