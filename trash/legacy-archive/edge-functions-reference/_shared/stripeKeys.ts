import type { SupabaseClient } from "./deps.ts";

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
}

/**
 * Get Stripe API configuration from app_secrets table.
 * Falls back to environment variables if not found in DB.
 */
export async function getStripeConfig(supabase: SupabaseClient): Promise<StripeConfig | null> {
  const { data, error } = await supabase.rpc("edge_app_secrets", {
    p_action: "get_many",
    p_payload: {
      keys: ["stripe_secret_key", "stripe_publishable_key"],
    },
  });

  const rows = (data as { rows?: Array<{ key?: unknown; value?: unknown }> } | null)?.rows ?? [];

  if (error || rows.length === 0) {
    // Fallback to environment variables
    const envSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || Deno.env.get("STRIPE_TEST_SECRET_KEY");
    const envPublishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY") || Deno.env.get("STRIPE_TEST_PUBLISHABLE_KEY");
    
    if (envSecretKey) {
      return {
        secretKey: envSecretKey,
        publishableKey: envPublishableKey || "",
      };
    }
    return null;
  }

  const secrets: Record<string, string> = {};
  for (const row of rows) {
    if (typeof row.key === "string" && typeof row.value === "string") {
      secrets[row.key] = row.value;
    }
  }

  const secretKey = secrets["stripe_secret_key"];
  const publishableKey = secrets["stripe_publishable_key"] || "";

  if (!secretKey) {
    return null;
  }

  return {
    secretKey,
    publishableKey,
  };
}

/**
 * Get just the Stripe secret key (for simple use cases)
 */
export async function getStripeSecretKey(supabase: SupabaseClient): Promise<string | null> {
  const config = await getStripeConfig(supabase);
  return config?.secretKey || null;
}
