import { decodeProtectedHeader, importJWK, jwtVerify } from 'https://esm.sh/jose@5.9.6';
import { plaidRequest } from './plaid.ts';
import { sha256Hex } from './crypto.ts';

function getClaim(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

export async function verifyPlaidWebhookSignature(rawBody: string, plaidVerificationHeader: string): Promise<void> {
  if (!plaidVerificationHeader) {
    throw new Error('Missing Plaid-Verification header.');
  }

  const protectedHeader = decodeProtectedHeader(plaidVerificationHeader);
  if (!protectedHeader?.kid) {
    throw new Error('Plaid verification token missing key id.');
  }

  const keyResponse = await plaidRequest('/webhook_verification_key/get', {
    key_id: protectedHeader.kid
  });

  const jwk = keyResponse?.key;
  if (!jwk) {
    throw new Error('Unable to fetch Plaid webhook verification key.');
  }

  const cryptoKey = await importJWK(jwk, protectedHeader.alg || 'ES256');
  const verified = await jwtVerify(plaidVerificationHeader, cryptoKey, {
    algorithms: ['ES256', 'RS256']
  });

  const payload = verified.payload as Record<string, unknown>;
  const expectedHash = getClaim(payload, ['request_body_sha256', 'body_sha256']);
  if (!expectedHash) {
    throw new Error('Plaid verification payload missing body hash claim.');
  }

  const actualHash = await sha256Hex(rawBody);
  if (actualHash !== expectedHash.toLowerCase()) {
    throw new Error('Webhook body hash mismatch during Plaid verification.');
  }
}
