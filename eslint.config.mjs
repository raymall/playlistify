import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import checkFile from 'eslint-plugin-check-file'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import tseslint from 'typescript-eslint'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      'check-file': checkFile,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'check-file/folder-naming-convention': [
        'error',
        {
          'app/**/': 'NEXT_JS_APP_ROUTER_CASE',
          '{components,lib,scripts}/**/': 'KEBAB_CASE',
        },
      ],
      // Side effects → node builtins → external packages → @/ aliases → relative,
      // each group alphabetized and separated by a blank line.
      'simple-import-sort/imports': [
        'error',
        {
          groups: [['^\\u0000'], ['^node:'], ['^@?\\w'], ['^@/'], ['^\\.']],
        },
      ],
      'simple-import-sort/exports': 'error',
      // key/ref first, shorthand booleans next, rest alphabetized, callbacks last.
      'react/jsx-sort-props': [
        'error',
        {
          reservedFirst: true,
          shorthandFirst: true,
          callbacksLast: true,
          ignoreCase: true,
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // No `as Foo` / angle-bracket assertions; `as const` stays allowed. Use
      // `satisfies`, type guards, or schema validation at boundaries instead.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'never' },
      ],
      // Non-null assertion `!` is banned — narrow or guard instead.
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Numbers stringify unambiguously; strict's default ban is too noisy.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      // Enforce type-only imports, inline form: `import { type Foo, bar } from '...'`.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      // Repository rules prefer object-shape `type` aliases. The inherited
      // stylistic preset prefers interfaces, so disable that contradictory
      // preference and let the repository rule govern new code.
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'import', format: null },
        // Destructured names follow the shape they come from (Supabase rows, API payloads).
        { selector: 'variable', modifiers: ['destructured'], format: null },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase', 'UPPER_CASE'],
          prefix: ['is', 'has', 'should', 'can', 'did', 'will'],
        },
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        {
          selector: 'parameter',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        // Object/type properties mirror external shapes (DB columns, API fields, CSS vars).
        {
          selector: [
            'objectLiteralProperty',
            'objectLiteralMethod',
            'typeProperty',
            'classProperty',
          ],
          format: null,
        },
      ],
    },
  },
  // The service-role client bypasses RLS entirely. Queries that look correctly
  // scoped — /library's user_genres/user_moods embeds, chat's candidate fetch —
  // return only the requester's rows ONLY because they run on the RLS client.
  // The same query on the admin client returns every user's rows, and since
  // both clients are typed SupabaseClient<Database>, nothing warns you.
  // Reaching for it is therefore an allowlisted decision, not a default.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/supabase/admin', '**/lib/supabase/admin'],
              message:
                'createAdminClient() bypasses RLS. Use @/lib/supabase/server instead. If this file genuinely needs the service role, add it to the allowlist in eslint.config.mjs and scope every query by user_id yourself.',
            },
          ],
        },
      ],
    },
  },
  {
    // Files that legitimately need the service role. Each scopes its own
    // queries by hand — there is no RLS underneath them.
    files: [
      'app/auth/callback/route.ts',
      'components/account-menu.tsx',
      'lib/enrichment/engine.ts',
      'lib/enrichment/requests.ts',
      'lib/spotify/import.ts',
      'lib/spotify/token.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  prettier,
])

export default eslintConfig
