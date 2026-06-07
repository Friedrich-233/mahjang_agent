import { defineConfig } from 'vite';

const devApiPort = 8788;

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${devApiPort}`,
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'es2022'
  }
});
