import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  sortImports: {
    groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'unknown'],
    newlinesBetween: true,
    order: 'asc',
  },
  sortPackageJson: true,
  ignorePatterns: ['dist/', 'pnpm-lock.yaml'],
});
