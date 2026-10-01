// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Gate enforcement (SRS section 4: "No endpoint or job queries posts directly").
 * Outside packages/gate, any `<something>.post.<method>(...)` (or reply/like/review)
 * Prisma call fails lint, and so does raw SQL. Content goes through @bookmarker/gate.
 */
const gatedModels = 'post|reply|like|review';
const gateRule = {
  'no-restricted-syntax': [
    'error',
    {
      selector: `CallExpression > MemberExpression.callee > MemberExpression.object[property.name=/^(${gatedModels})$/]`,
      message:
        'Spoiler gate: read and write posts/replies/likes/reviews only through @bookmarker/gate.',
    },
    {
      selector:
        "MemberExpression[property.name=/^\\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/]",
      message: 'Raw SQL bypasses the spoiler gate. Put it in @bookmarker/gate or @bookmarker/db.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'packages/db/src/generated/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}'],
    ignores: ['apps/**/test/**'],
    rules: gateRule,
  },
);
