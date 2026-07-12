const TOKEN_PREFIX = 'v1';

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyB64 = Deno.env.get('ACCESS_TOKEN_ENCRYPTION_KEY') || '';
  if (!keyB64) {
    throw new Error('Missing ACCESS_TOKEN_ENCRYPTION_KEY secret.');
  }

  const rawKey = b64ToBytes(keyB64);
  if (rawKey.byteLength !== 32) {
    throw new Error('ACCESS_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 value.');
  }

  return await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptAccessToken(value: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(value);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return `${TOKEN_PREFIX}:${bytesToB64(iv)}:${bytesToB64(ciphertext)}`;
}

export async function decryptAccessToken(value: string): Promise<string> {
  // Backward compatibility for rows created before encryption was introduced.
  if (!value.startsWith(`${TOKEN_PREFIX}:`)) {
    return value;
  }

  const parts = value.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format.');
  }

  const [, ivB64, cipherB64] = parts;
  const key = await getEncryptionKey();
  const iv = b64ToBytes(ivB64);
  const ciphertext = b64ToBytes(cipherB64);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('');
}
