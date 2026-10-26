import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :5100 and is proxied, so the browser sees a
// single origin (the session cookie stays first-party, as in production).
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on IPv4: by default Node binds "localhost" to ::1 only on Windows,
    // and browsers that try 127.0.0.1 then show a blank page.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:5100' },
  },
});
