import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: {
    outDir: '../../../dist/src/admin',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/admin/api': 'http://localhost:3000',
    },
  },
});
