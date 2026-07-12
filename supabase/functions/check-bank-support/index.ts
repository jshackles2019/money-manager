import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { plaidRequest } from '../_shared/plaid.ts';

type InstitutionInput = {
  name: string;
  aliases?: string[];
};

type RequestPayload = {
  institutions?: InstitutionInput[];
};

function normalize(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAliasMatch(name: string, aliases: string[]): boolean {
  const target = normalize(name);
  return aliases.some((alias) => normalize(alias) === target);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
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
    const institutions = Array.isArray(payload.institutions) ? payload.institutions : [];

    const results = [];

    for (const institution of institutions) {
      const aliases = [institution.name, ...(institution.aliases || [])];
      const search = await plaidRequest('/institutions/search', {
        query: institution.name,
        products: ['transactions'],
        country_codes: ['US'],
        options: { include_optional_metadata: true }
      });

      const matches = Array.isArray(search?.institutions) ? search.institutions : [];
      const exact = matches.find((inst: Record<string, unknown>) => isAliasMatch(String(inst.name || ''), aliases));

      results.push({
        name: institution.name,
        supported: Boolean(exact),
        matched_name: exact ? String(exact.name || '') : null,
        institution_id: exact ? String(exact.institution_id || '') : null
      });
    }

    return new Response(JSON.stringify({ results }), {
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
