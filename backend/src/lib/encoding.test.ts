import { describe, expect, it } from 'vitest';

import {
  base64urlToBytes,
  bytesToBase64url,
  randomToken,
  sha256,
} from './encoding';

describe('encoding', () => {
  it('round trips arbitrary bytes as unpadded base64url', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const encoded = bytesToBase64url(bytes);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(base64urlToBytes(encoded)).toEqual(bytes);
  });

  it('generates suitably large independent tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => randomToken()));
    expect(tokens.size).toBe(100);
    expect([...tokens].every((token) => token.length >= 43)).toBe(true);
  });

  it('produces a stable base64url SHA-256 digest', async () => {
    expect(await sha256('hello')).toBe('LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ');
  });
});
