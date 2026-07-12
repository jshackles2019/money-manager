import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { syncItemTransactions } from '../_shared/sync.ts';

type RequestPayload = {
  item_id?: number;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const payload = (await req.json().catch(() => ({}))) as RequestPayload;
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    let query = adminClient
      .from('financial_items')
      .select('id, plaid_item_id, access_token_ciphertext, cursor')
      .eq('user_id', authData.user.id);

    if (payload.item_id) {
      query = query.eq('id', payload.item_id);
    }

    const { data: items, error: itemsError } = await query;
    if (itemsError) {
      throw new Error(itemsError.message);
    }

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ synced_count: 0, skipped_count: 0, message: 'No linked bank items found.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let syncedCount = 0;
    let skippedCount = 0;

    for (const item of items) {
      const result = await syncItemTransactions(adminClient, authData.user.id, item);
      syncedCount += result.syncedCount;
      skippedCount += result.skippedCount;
    }

    return new Response(JSON.stringify({ synced_count: syncedCount, skipped_count: skippedCount }), {
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
