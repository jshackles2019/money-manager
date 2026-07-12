export async function plaidRequest(path: string, body: Record<string, unknown>) {
  const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID');
  const PLAID_SECRET = Deno.env.get('PLAID_SECRET');
  const PLAID_ENV = Deno.env.get('PLAID_ENV') || 'sandbox';

  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    throw new Error('Missing PLAID_CLIENT_ID or PLAID_SECRET.');
  }

  const baseUrl = PLAID_ENV === 'production'
    ? 'https://production.plaid.com'
    : PLAID_ENV === 'development'
      ? 'https://development.plaid.com'
      : 'https://sandbox.plaid.com';

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      ...body
    })
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error_message || `Plaid request failed (${response.status}).`);
  }

  return json;
}
