import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/_clideck-mcp-ui/',
  plugins: [react()],
  build: {
    outDir: '../../dist-admin',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022'
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/admin/api': 'http://127.0.0.1:8790',
      '/admin/auth': 'http://127.0.0.1:8790'
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts']
  }
})
