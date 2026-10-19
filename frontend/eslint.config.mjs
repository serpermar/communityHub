// ---------------------------------------------------------------------------
// ESLint (flat config) · frontend
//
// El formato lo manda Prettier (`.prettierrc.json` en la raiz) y
// `eslint-config-prettier` apaga las reglas de estilo que chocarian con el.
//
// De `react-hooks` se activan solo las dos reglas clasicas. El preset
// `recommended-latest` de la v7 anade las reglas del React Compiler, que en un
// codigo escrito antes de React 19 marcan cientos de avisos de estilo; aqui
// interesa cazar bugs, no reescribir la SPA.
// ---------------------------------------------------------------------------

import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'e2e/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  prettier,
)
