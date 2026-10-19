// Statik kontrol: modüller arası bölmede tanımsız referansları ve kullanılmayan kodu yakalar.
import globals from 'globals';

export default [
  {
    files: ['assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, mermaid: 'readonly', module: 'readonly' },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
    },
  },
  {
    files: ['tests/**/*.mjs', '*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-undef': 'error' },
  },
];
