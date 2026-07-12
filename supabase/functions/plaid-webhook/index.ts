import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { syncItemTransactions } from '../_shared/sync.ts';
import { verifyPlaidWebhookSignature } from '../_shared/webhook-verify.ts';
import { sha256Hex } from '../_shared/crypto.ts';

type PlaidWebhookPayload = {
  webhook_type?: string;
  webhook_code?: string;
  webhook_id?: string;
  item_id?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const expectedSecret = Deno.env.get('PLAID_WEBHOOK_SECRET') || '';
    const receivedSecret = req.headers.get('x-money-manager-webhook-secret') || '';
    const plaidVerificationHeader = req.headers.get('Plaid-Verification') || req.headers.get('plaid-verification') || '';
    const rawBody = await req.text();
    const eventFingerprint = await sha256Hex(rawBody);

    if (expectedSecret && receivedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Forbidden.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await verifyPlaidWebhookSignature(rawBody, plaidVerificationHeader);

    const payload = JSON.parse(rawBody) as PlaidWebhookPayload;
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: existingEvent } = await adminClient
      .from('financial_webhook_events')
      .select('id, status')
      .eq('event_fingerprint', eventFingerprint)
      .maybeSingle();

    if (existingEvent) {
      return new Response(JSON.stringify({ ok: true, duplicate: true, event_id: existingEvent.id }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: itemRow } = await adminClient
      .from('financial_items')
      .select('id, user_id, plaid_item_id, access_token_ciphertext, cursor')
      .eq('plaid_item_id', payload.item_id || '')
      .maybeSingle();

    const { data: eventRow, error: eventError } = await adminClient
      .from('financial_webhook_events')
      .insert({
        item_id: itemRow?.id || null,
        plaid_item_id: payload.item_id || null,
        webhook_type: payload.webhook_type || null,
        webhook_code: payload.webhook_code || null,
        webhook_id: payload.webhook_id || null,
        event_fingerprint: eventFingerprint,
        payload,
        status: 'received'
      })
      .select('id')
      .single();

    if (eventError) {
      throw new Error(eventError.message);
    }

    if (!itemRow || !itemRow.user_id) {
      await adminClient
        .from('financial_webhook_events')
        .update({
          status: 'ignored',
          error_message: 'No matching financial item found for webhook payload.',
          processed_at: new Date().toISOString()
        })
        .eq('id', eventRow.id);

      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (payload.webhook_type === 'TRANSACTIONS') {
      try {
        await syncItemTransactions(adminClient, itemRow.user_id, itemRow);

        await adminClient
          .from('financial_webhook_events')
          .update({
            status: 'processed',
            processed_at: new Date().toISOString()
          })
          .eq('id', eventRow.id);
      } catch (syncError) {
        await adminClient
          .from('financial_webhook_events')
          .update({
            status: 'error',
            error_message: (syncError as Error).message,
            processed_at: new Date().toISOString()
          })
          .eq('id', eventRow.id);

        throw syncError;
      }
    } else {
      await adminClient
        .from('financial_webhook_events')
        .update({
          status: 'ignored',
          error_message: 'Webhook type is not TRANSACTIONS.',
          processed_at: new Date().toISOString()
        })
        .eq('id', eventRow.id);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
