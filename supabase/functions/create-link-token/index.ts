import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type PriorityInstitution = {
  key: string;
  name: string;
  aliases: string[];
};

type RequestPayload = {
  preferred_institution_name?: string | null;
  preferred_institution_aliases?: string[];
  priority_institutions?: PriorityInstitution[];
};

function normalize(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isMatch(name: string, aliases: string[]): boolean {
  const normalizedName = normalize(name);
  return aliases.some((alias) => normalize(alias) === normalizedName);
}

async function plaidRequest(path: string, body: Record<string, unknown>) {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const payload = (await req.json().catch(() => ({}))) as RequestPayload;
    const preferredName = payload.preferred_institution_name || null;
    const preferredAliases = payload.preferred_institution_aliases || [];

    let supportStatus: 'supported' | 'unsupported' | 'unknown' = 'unknown';
    let matchedInstitutionId: string | null = null;

    if (preferredName) {
      const search = await plaidRequest('/institutions/search', {
        query: preferredName,
        products: ['transactions'],
        country_codes: ['US'],
        options: { include_optional_metadata: true }
      });

      const institutions = Array.isArray(search?.institutions) ? search.institutions : [];
      const exact = institutions.find((inst: Record<string, unknown>) => {
        const name = String(inst.name || '');
        return isMatch(name, [preferredName, ...preferredAliases]);
      });

      if (exact) {
        supportStatus = 'supported';
        matchedInstitutionId = String(exact.institution_id || '');
      } else {
        supportStatus = 'unsupported';
      }
    }

    const linkPayload: Record<string, unknown> = {
      user: { client_user_id: authData.user.id },
      client_name: 'Money Manager',
      language: 'en',
      country_codes: ['US'],
      products: ['transactions'],
      webhook: Deno.env.get('PLAID_WEBHOOK_URL') || undefined
    };

    if (matchedInstitutionId) {
      linkPayload.institution_id = matchedInstitutionId;
    }

    const linkResponse = await plaidRequest('/link/token/create', linkPayload);

    return new Response(JSON.stringify({
      link_token: linkResponse.link_token,
      support_status: supportStatus,
      institution_id: matchedInstitutionId
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
