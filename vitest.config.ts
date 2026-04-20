import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['tests/**/*.test.ts', 'server/**/__tests__/**/*.test.ts'],
    globalSetup: ['./tests/setup/global-setup.ts'],
    alias: {
      '@shared': new URL('./shared', import.meta.url).pathname,
      '@server': new URL('./server', import.meta.url).pathname,
    },
  },
});
