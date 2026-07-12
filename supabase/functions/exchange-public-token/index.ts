import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { plaidRequest } from '../_shared/plaid.ts';
import { encryptAccessToken } from '../_shared/crypto.ts';

type AccountMeta = {
  id?: string;
  name?: string;
  mask?: string;
  subtype?: string;
  type?: string;
};

type RequestPayload = {
  public_token: string;
  institution_name?: string | null;
  institution_id?: string | null;
  accounts?: AccountMeta[];
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

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const payload = (await req.json()) as RequestPayload;
    if (!payload.public_token) {
      return new Response(JSON.stringify({ error: 'public_token is required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const exchange = await plaidRequest('/item/public_token/exchange', {
      public_token: payload.public_token
    });

    const itemId = String(exchange.item_id || '');
    const accessToken = String(exchange.access_token || '');
    const encryptedToken = await encryptAccessToken(accessToken);

    const accountsResponse = await plaidRequest('/accounts/get', {
      access_token: accessToken
    });

    const plaidAccounts = Array.isArray(accountsResponse?.accounts)
      ? accountsResponse.accounts
      : [];

    const { data: itemRow, error: itemError } = await adminClient
      .from('financial_items')
      .upsert({
        user_id: authData.user.id,
        plaid_item_id: itemId,
        institution_name: payload.institution_name || null,
        institution_id: payload.institution_id || null,
        access_token_ciphertext: encryptedToken,
        status: 'connected',
        accounts_count: plaidAccounts.length,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,plaid_item_id' })
      .select('id, institution_name')
      .single();

    if (itemError || !itemRow) {
      throw new Error(itemError?.message || 'Unable to save financial item.');
    }

    if (plaidAccounts.length > 0) {
      const accountRows = plaidAccounts.map((account: Record<string, unknown>) => ({
        user_id: authData.user.id,
        item_id: itemRow.id,
        plaid_account_id: String(account.account_id || ''),
        name: String(account.name || account.official_name || 'Account'),
        mask: account.mask ? String(account.mask) : null,
        subtype: account.subtype ? String(account.subtype) : null,
        type: account.type ? String(account.type) : null,
        current_balance: Number(account.balances?.current || 0),
        available_balance: Number(account.balances?.available || 0),
        iso_currency_code: account.balances?.iso_currency_code ? String(account.balances.iso_currency_code) : null,
        unofficial_currency_code: account.balances?.unofficial_currency_code ? String(account.balances.unofficial_currency_code) : null,
        updated_at: new Date().toISOString()
      }));

      const { error: accountsError } = await adminClient
        .from('financial_accounts')
        .upsert(accountRows, { onConflict: 'user_id,plaid_account_id' });

      if (accountsError) {
        throw new Error(accountsError.message);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      institution_name: itemRow.institution_name,
      accounts_count: plaidAccounts.length
    }), {
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
