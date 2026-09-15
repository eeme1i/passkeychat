export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');

  const binary = atob(base64);

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(
    new Uint8Array(byteLength),
  );

  return bytesToBase64url(bytes);
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);

  const hash = await crypto.subtle.digest(
    'SHA-256',
    bytes,
  );

  return bytesToBase64url(new Uint8Array(hash));
}
