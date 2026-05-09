import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/admin': 'http://localhost:3000',
      '/billing': 'http://localhost:3000',
      '/public': 'http://localhost:3000',
      '/dev': 'http://localhost:3000'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
