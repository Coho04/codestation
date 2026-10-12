import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@cs/shared': resolve(import.meta.dirname, 'packages/shared/src/index.ts') },
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'test/**/*.test.ts'],
    // Angular components need a TestBed and a DOM; the pure renderer logic
    // (stores, the command registry, size caches) does not, and that is what is
    // worth testing here.
    exclude: ['**/node_modules/**', '**/dist/**', 'test/e2e/**'],
  },
});
