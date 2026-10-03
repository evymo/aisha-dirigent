/**
 * Mobile app ESLint config (ESLint 9 + typescript-eslint v8).
 */

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactHooks = require('eslint-plugin-react-hooks');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'build/**',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      // ⛔ NAMĚŘENO 2026-08-20. Plugin tu CHYBĚL, a přitom se na něj kód
      // odvolával: `useTranslation.ts` měl `eslint-disable-next-line
      // react-hooks/exhaustive-deps` na pravidlo, které nikdy neexistovalo.
      // ESLint takový odkaz hlásí jako CHYBU — jenže `npm run lint` se
      // v CI u appky nikdy nespouštěl (web ano, n8n-nodes ano, mobil ne),
      // takže to nikdo neviděl. `rules-of-hooks` je v React Native to
      // nejcennější pravidlo vůbec: chytá podmíněně volané hooky, které
      // se jinak projeví až pádem na zařízení.
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': 'off',
      'no-debugger': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      // ⛔ NAMĚŘENO 2026-08-20: na obě tahle pravidla se kód ODVOLÁVAL
      // `eslint-disable` komentáři, ale zapnutá nebyla ani jedno. Jeden
      // z těch komentářů to říká nahlas — „the root config flags it as
      // no-require-imports" — autor tedy počítal s tím, že si appka
      // kořenovou konfiguraci dědí. Nedědí: `lint` běží s
      // `--no-config-lookup`, takže platí VÝHRADNĚ tenhle soubor.
      //
      // Zapnutí stojí NULU: naměřeno `--no-inline-config`, že v celém
      // stromu je 3× `any` a 2× `require()` a všech pět už má svou
      // výjimku na místě. Pravidla tedy jen zamykají stav, který platí,
      // aby šesté přibylo VĚDOMĚ a s odůvodněním na řádku.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'error',
    },
  },
];
