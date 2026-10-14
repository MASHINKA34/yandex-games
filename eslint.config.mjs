import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'playwright-report/**',
      'test-results/**',
      'reports/**',
      'vendor/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.json',
          './tools/tsconfig.json',
          './packages/*/tsconfig.json',
          './games/*/tsconfig.json',
          './games/*/tsconfig.node.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['games/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.mjs', '*.ts', 'tools/**', 'games/*/*.ts', 'games/*/e2e/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/sdk/mock/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['packages/core/src/log.ts', 'games/*/src/log.ts'],
    rules: { 'no-console': 'off' },
  },
);
