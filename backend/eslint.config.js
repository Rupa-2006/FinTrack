const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'coverage/', 'tmp/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: globals.node },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'error', // use the logger, which redacts secrets
    },
  },
  { files: ['scripts/**/*.js', 'server.js'], rules: { 'no-console': 'off' } }, // command-line output
  { files: ['tests/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.jest } } },
];
