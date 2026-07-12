export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (!env.SUPABASE_WEBHOOK_URL) {
      return new Response('Missing SUPABASE_WEBHOOK_URL secret', { status: 500 });
    }

    if (!env.PLAID_PROXY_SHARED_SECRET) {
      return new Response('Missing PLAID_PROXY_SHARED_SECRET secret', { status: 500 });
    }

    const rawBody = await request.text();

    const forwardHeaders = new Headers();
    forwardHeaders.set('content-type', request.headers.get('content-type') || 'application/json');
    forwardHeaders.set('x-money-manager-webhook-secret', env.PLAID_PROXY_SHARED_SECRET);

    const plaidVerification =
      request.headers.get('Plaid-Verification') || request.headers.get('plaid-verification');
    if (plaidVerification) {
      forwardHeaders.set('Plaid-Verification', plaidVerification);
    }

    const forwarded = await fetch(env.SUPABASE_WEBHOOK_URL, {
      method: 'POST',
      headers: forwardHeaders,
      body: rawBody
    });

    const responseBody = await forwarded.text();

    return new Response(responseBody, {
      status: forwarded.status,
      headers: { 'content-type': forwarded.headers.get('content-type') || 'application/json' }
    });
  }
};
