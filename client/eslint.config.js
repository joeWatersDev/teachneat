import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // The context files in src/hooks pair a provider component with the hook
    // that reads it, which is the idiomatic React shape and the one this
    // codebase uses everywhere. react-refresh/only-export-components objects
    // because a file exporting both cannot be a hot-reload boundary.
    //
    // Off rather than fixed, deliberately. The rule's entire effect is a
    // dev-time full reload instead of a fast refresh; it changes nothing in a
    // build. The alternative is splitting four providers from their hooks and
    // updating every import site, which trades a working convention for a
    // marginal dev-server nicety.
    //
    // Scoped to this directory so the rule keeps applying to components, where
    // it catches something real.
    files: ['src/hooks/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
