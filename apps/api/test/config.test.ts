import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

const base = { DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'sixteen-chars-at-least' };

describe('config', () => {
  it('trusts one proxy (Caddy) by default', () => {
    expect(loadConfig(base).TRUST_PROXY).toBe(1);
  });
  it('reads TRUST_PROXY as a hop count, true, or a list of addresses', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'loopback' }).TRUST_PROXY).toBe('loopback');
  });
  it('keeps the SRS sign-in limit unless told otherwise', () => {
    expect(loadConfig(base).RATE_LIMIT_AUTH).toBe(10);
  });
});
