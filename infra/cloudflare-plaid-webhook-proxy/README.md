Cloudflare Worker Plaid Webhook Proxy

Purpose
- Receives Plaid webhooks.
- Forwards raw payload to Supabase function endpoint.
- Adds x-money-manager-webhook-secret header expected by plaid-webhook function.
- Preserves Plaid-Verification header so signature validation in Supabase still works.

1) Prerequisites
- Cloudflare account
- Wrangler CLI installed

2) Configure Worker secrets
Run these commands from this folder:

wrangler secret put SUPABASE_WEBHOOK_URL
Value:
https://vqaqdkcbdrtokqluahyr.functions.supabase.co/plaid-webhook

wrangler secret put PLAID_PROXY_SHARED_SECRET
Value:
Use the exact same value as Supabase secret PLAID_WEBHOOK_SECRET.

3) Deploy Worker
wrangler deploy

4) Set Plaid webhook URL
In Plaid dashboard, set webhook URL to your deployed Worker URL, for example:
https://money-manager-plaid-webhook-proxy.<your-subdomain>.workers.dev

5) Supabase secret alignment
In Supabase, ensure this secret matches the Worker secret:
PLAID_WEBHOOK_SECRET = PLAID_PROXY_SHARED_SECRET

6) Test flow
- Trigger a Plaid webhook event.
- In app Admin page, refresh Webhook Events.
- Confirm received or processed entries are created.

Troubleshooting
- 403 from Supabase webhook: shared secrets do not match.
- Signature verification errors: ensure Plaid-Verification header is present and forwarded.
- 500 from Worker: missing required Worker secrets.
