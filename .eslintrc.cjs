/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  settings: {
    next: {
      rootDir: ['apps/web/'],
    },
  },
  rules: {
    // App Router has no pages directory. The rule otherwise emits a warning
    // from every package in the monorepo.
    '@next/next/no-html-link-for-pages': 'off',
    // Product copy intentionally uses normal apostrophes/quotes in JSX text.
    'react/no-unescaped-entities': 'off',
  },
  ignorePatterns: [
    '**/dist/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/node_modules/**',
    '**/*.tsbuildinfo',
    'infrastructure/_legacy_careercraft/**',
  ],
};
