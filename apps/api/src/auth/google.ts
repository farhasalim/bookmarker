import { Google, generateCodeVerifier, generateState } from 'arctic';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { randomBytes } from 'node:crypto';

/**
 * Google sign-in (FR-1, SEC-2): authorization code + PKCE, with state and nonce,
 * and the ID token verified against Google's JWKS. Built on `arctic` (a thin,
 * provider-neutral OAuth client) so there is no auth vendor to leave.
 */
export interface GoogleAuth {
  start(): { url: URL; state: string; codeVerifier: string; nonce: string };
  finish(code: string, codeVerifier: string, nonce: string): Promise<GoogleProfile>;
}

export interface GoogleProfile {
  subject: string;
  email: string;
  name?: string | undefined;
  picture?: string | undefined;
}

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export function googleAuth(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): GoogleAuth {
  const client = new Google(clientId, clientSecret, redirectUri);
  const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return {
    start() {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const nonce = randomBytes(16).toString('base64url');
      const url = client.createAuthorizationURL(state, codeVerifier, [
        'openid',
        'email',
        'profile',
      ]);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('prompt', 'select_account');
      return { url, state, codeVerifier, nonce };
    },
    async finish(code, codeVerifier, nonce) {
      const tokens = await client.validateAuthorizationCode(code, codeVerifier);
      const { payload } = await jwtVerify(tokens.idToken(), jwks, {
        issuer: ISSUERS,
        audience: clientId,
      });
      return profileFromClaims(payload, nonce);
    },
  };
}

/** Exported for tests: claim checks after the signature is verified. */
export function profileFromClaims(
  p: JWTPayload & Record<string, unknown>,
  nonce: string,
): GoogleProfile {
  if (p.nonce !== nonce) throw new Error('nonce mismatch');
  if (typeof p.sub !== 'string' || typeof p.email !== 'string') throw new Error('missing claims');
  if (p.email_verified !== true) throw new Error('email not verified');
  return {
    subject: p.sub,
    email: p.email,
    name: typeof p.name === 'string' ? p.name : undefined,
    picture: typeof p.picture === 'string' ? p.picture : undefined,
  };
}
