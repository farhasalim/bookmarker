import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * In production Caddy sends /api/* and /socket.io/* to the API on the same origin,
 * so cookies are first-party. In development Next rewrites /api/* to the API.
 */
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" +
        (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://covers.openlibrary.org https://lh3.googleusercontent.com",
      "font-src 'self'",
      `connect-src 'self' ${process.env.NEXT_PUBLIC_SOCKET_URL ?? ''} ws: wss:`.trim(),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://accounts.google.com",
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: trace workspace packages from the repo root into the standalone build.
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['@bookmarker/shared'],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
