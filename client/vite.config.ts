import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :5100 and is proxied, so the browser sees a
// single origin (the session cookie stays first-party, as in production).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5100' },
  },
});
