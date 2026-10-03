// Supabase client utilities for edge functions
import { createClient } from "./deps.ts";
import type { SupabaseClient } from "./deps.ts";

export type { SupabaseClient };

type SupabaseEnvOk = {
  ok: true;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey?: string;
};

type SupabaseEnvErr = {
  ok: false;
  status: 500;
  error: "Server not configured";
};

export function requireSupabaseEnv(params: {
  requireServiceRole: boolean;
}): SupabaseEnvOk | SupabaseEnvErr {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, status: 500, error: "Server not configured" };
  }

  if (params.requireServiceRole && !supabaseServiceKey) {
    return { ok: false, status: 500, error: "Server not configured" };
  }

  return {
    ok: true,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceKey: supabaseServiceKey || undefined,
  };
}

export function createUserSupabaseClient(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  token: string;
}) {
  return createClient(params.supabaseUrl, params.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${params.token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createServiceRoleSupabaseClient(params: {
  supabaseUrl: string;
  supabaseServiceKey: string;
}) {
  return createClient(params.supabaseUrl, params.supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createAuthedSupabaseClient(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  authorizationHeader: string;
}) {
  return createClient(params.supabaseUrl, params.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: params.authorizationHeader,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
