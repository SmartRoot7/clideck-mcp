import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/entrypoints/**', 'src/cli/**']
    }
  }
})
