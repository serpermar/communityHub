// ---------------------------------------------------------------------------
// ESLint (flat config) · backend
//
// Objetivo: cazar errores reales sin pelearse con el formateo. El formato lo
// manda Prettier (`.prettierrc.json` en la raiz) y `eslint-config-prettier`
// apaga las reglas de estilo que chocarian con el.
//
// Se usa el preset `recommended` de typescript-eslint (sin reglas con tipo):
// con `project` activado el lint tarda mas y exige compilar, y el typecheck ya
// lo cubre `tsc --noEmit` en su propio paso. Menos es mas aqui.
// ---------------------------------------------------------------------------

import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // El guion bajo es la marca de "no lo uso pero la firma lo pide".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },

  {
    // Los tests usan los globals de Vitest (`describe`, `it`, `expect`...).
    files: ['**/*.test.ts', 'src/__tests__/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },

  prettier,
)
