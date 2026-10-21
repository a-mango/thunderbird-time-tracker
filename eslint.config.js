import js from '@eslint/js';
import globals from 'globals';

const htmlSinks = ['innerHTML', 'outerHTML'].map((property) => ({
  selector: `AssignmentExpression > MemberExpression.left[property.name='${property}']`,
  message: `No ${property}: build DOM with templates and createElement/textContent.`,
}));

export default [
  {
    ignores: [
      '.ref/',
      'node_modules/',
      'dist/',
      'artifacts/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      '.tb-profile/',
      '.tb-stage/',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, messenger: 'readonly', browser: 'readonly' },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': ['error', ...htmlSinks],
      'no-restricted-properties': [
        'error',
        { property: 'insertAdjacentHTML', message: 'No insertAdjacentHTML.' },
        { object: 'document', property: 'write', message: 'No document.write.' },
      ],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**', 'tests/**', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
