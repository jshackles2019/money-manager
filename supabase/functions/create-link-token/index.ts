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
  received_redirect_uri?: string | null;
};

type PlaidEndpointInfo = {
  plaidEnvRaw: string;
  plaidEnvNormalized: 'sandbox' | 'development' | 'production';
  plaidBaseUrl: string;
  plaidBaseUrlSource: 'PLAID_BASE_URL' | 'PLAID_ENV';
};

function resolvePlaidEndpoint(): PlaidEndpointInfo {
  const rawEnv = (Deno.env.get('PLAID_ENV') || 'sandbox').trim().toLowerCase();
  const overrideBaseUrl = (Deno.env.get('PLAID_BASE_URL') || '').trim();

  if (overrideBaseUrl) {
    return {
      plaidEnvRaw: rawEnv || 'sandbox',
      plaidEnvNormalized: rawEnv === 'production' || rawEnv === 'prod'
        ? 'production'
        : rawEnv === 'development' || rawEnv === 'dev'
          ? 'development'
          : 'sandbox',
      plaidBaseUrl: overrideBaseUrl,
      plaidBaseUrlSource: 'PLAID_BASE_URL'
    };
  }

  const normalizedEnv: 'sandbox' | 'development' | 'production' =
    rawEnv === 'production' || rawEnv === 'prod'
      ? 'production'
      : rawEnv === 'development' || rawEnv === 'dev'
        ? 'development'
        : 'sandbox';

  const plaidBaseUrl = normalizedEnv === 'production'
    ? 'https://production.plaid.com'
    : normalizedEnv === 'development'
      ? 'https://development.plaid.com'
      : 'https://sandbox.plaid.com';

  return {
    plaidEnvRaw: rawEnv || 'sandbox',
    plaidEnvNormalized: normalizedEnv,
    plaidBaseUrl,
    plaidBaseUrlSource: 'PLAID_ENV'
  };
}

function getDebugInfo(payload: RequestPayload, authHeader: string | null) {
  const plaidClientId = Deno.env.get('PLAID_CLIENT_ID') || '';
  const plaidSecret = Deno.env.get('PLAID_SECRET') || '';
  const plaidWebhookUrl = Deno.env.get('PLAID_WEBHOOK_URL') || '';
  const plaidRedirectUri = Deno.env.get('PLAID_REDIRECT_URI') || '';
  const endpoint = resolvePlaidEndpoint();

  return {
    plaidEnv: endpoint.plaidEnvRaw,
    plaidEnvNormalized: endpoint.plaidEnvNormalized,
    plaidBaseUrl: endpoint.plaidBaseUrl,
    plaidBaseUrlSource: endpoint.plaidBaseUrlSource,
    hasAuthHeader: Boolean(authHeader),
    hasPlaidClientId: Boolean(plaidClientId),
    plaidClientIdLength: plaidClientId.length,
    hasPlaidSecret: Boolean(plaidSecret),
    plaidSecretLength: plaidSecret.length,
    hasPlaidWebhookUrl: Boolean(plaidWebhookUrl),
    hasPlaidRedirectUri: Boolean(plaidRedirectUri),
    preferredInstitution: payload.preferred_institution_name || null,
    hasReceivedRedirectUri: Boolean(payload.received_redirect_uri)
  };
}

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
  const endpoint = resolvePlaidEndpoint();

  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    throw new Error('Missing PLAID_CLIENT_ID or PLAID_SECRET.');
  }

  const response = await fetch(`${endpoint.plaidBaseUrl}${path}`, {
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

  let stage = 'start';
  let debugInfo: Record<string, unknown> = {};

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';

    stage = 'parse_payload';
    const payload = (await req.json().catch(() => ({}))) as RequestPayload;
    debugInfo = getDebugInfo(payload, authHeader);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    stage = 'auth_get_user';
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const preferredName = payload.preferred_institution_name || null;
    const preferredAliases = payload.preferred_institution_aliases || [];
    const receivedRedirectUri = payload.received_redirect_uri || null;
    const plaidRedirectUri = Deno.env.get('PLAID_REDIRECT_URI') || null;

    let supportStatus: 'supported' | 'unsupported' | 'unknown' = 'unknown';
    let matchedInstitutionId: string | null = null;

    if (preferredName) {
      stage = 'institutions_search';
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

    if (plaidRedirectUri) {
      linkPayload.redirect_uri = plaidRedirectUri;
    }

    if (receivedRedirectUri) {
      if (!plaidRedirectUri) {
        throw new Error('PLAID_REDIRECT_URI secret is required to resume OAuth redirect flows.');
      }

      linkPayload.received_redirect_uri = receivedRedirectUri;
    }

    if (matchedInstitutionId) {
      linkPayload.institution_id = matchedInstitutionId;
    }

    stage = 'link_token_create';
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
    console.error('create-link-token failed', {
      stage,
      error: (error as Error).message,
      debugInfo
    });

    return new Response(JSON.stringify({
      error: (error as Error).message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
