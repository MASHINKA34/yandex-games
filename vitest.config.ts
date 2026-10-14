import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@yg/core': root('./packages/core/src'),
      '@yg/sdk': root('./packages/sdk/src'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/mock/**/*.test.ts'],
    passWithNoTests: true,
  },
});
