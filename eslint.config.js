import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * The architectural boundaries are enforced here rather than by convention.
 *
 * Two of them matter enough to fail a build:
 *  - the renderer must never reach into main or indexer code, or the
 *    "renderer is a projection, not a state owner" rule quietly erodes;
 *  - `shared` must stay environment-free, so it may not import `electron`
 *    or Node built-ins — it is consumed by all three processes.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.angular/**', '**/node_modules/**', 'release/**', '**/.typecheck-out/**', 'test-results/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'node:*', 'fs', 'path', 'child_process'],
              message:
                '@fd/shared is consumed by main, preload, indexer and renderer. It must stay free of environment-specific imports.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['packages/renderer/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/packages/main/**', '**/packages/indexer/**', '@fd/main', '@fd/indexer'],
              message:
                'The renderer is a projection of main/indexer state and talks to them only through the preload bridge.',
            },
            {
              group: ['electron'],
              message: 'The renderer is sandboxed; use window.fd (the preload bridge) instead.',
            },
          ],
        },
      ],
    },
  },

  // Tests and build scripts live outside the composite TS projects (tests are
  // excluded so `shared` stays environment-free). `tsc -p tsconfig.test.json`
  // type-checks them; ESLint only applies syntactic rules here.
  {
    files: [
      '**/*.test.ts',
      'test/**/*.ts',
      'scripts/**/*.mjs',
      'scripts/**/*.cjs',
      'test/fixtures/bin/*.mjs',
      '*.config.js',
      '*.config.mjs',
      '*.config.ts',
      '**/esbuild.config.mjs',
    ],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ['scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    // These run as Electron CommonJS entry points, where `require` is the point.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
