import { describe, expect, it } from 'vitest';

import app from './index';

const env = {
  APP_ORIGIN: 'https://private.example.com',
  RP_ID: 'private.example.com',
  RP_NAME: 'Private',
} as never;

describe('HTTP boundary', () => {
  it('adds defensive headers', async () => {
    const response = await app.request('/health', {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects cross-origin browser mutations before route handling', async () => {
    const response = await app.request('/api/auth/login/options', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    }, env);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'invalid_origin' });
  });

  it('turns malformed JSON into a safe client error', async () => {
    const response = await app.request('/api/auth/register/options', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://private.example.com',
      },
      body: '{',
    }, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invite_required' });
  });
});
