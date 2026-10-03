import type { SupabaseClient } from "./deps.ts";

export interface PacketaConfig {
  apiKey: string;
  apiPassword: string;
  senderId: string;
}

/**
 * Get Packeta API configuration from app_secrets table.
 * Falls back to environment variables if not found in DB.
 */
export async function getPacketaConfig(supabase: SupabaseClient): Promise<PacketaConfig | null> {
  const { data, error } = await supabase.rpc("edge_app_secrets", {
    p_action: "get_many",
    p_payload: {
      keys: ["packeta_api_key", "packeta_api_password", "packeta_sender_id"],
    },
  });

  const rows = (data as { rows?: Array<{ key?: unknown; value?: unknown }> } | null)?.rows ?? [];

  if (error || rows.length === 0) {
    // Fallback to environment variables
    const envApiKey = Deno.env.get("PACKETA_API_KEY");
    const envApiPassword = Deno.env.get("PACKETA_API_PASSWORD") || envApiKey;
    const envSenderId = Deno.env.get("PACKETA_SENDER_ID");
    
    if (envApiKey && envSenderId) {
      return {
        apiKey: envApiKey,
        apiPassword: envApiPassword || envApiKey,
        senderId: envSenderId,
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

  const apiKey = secrets["packeta_api_key"];
  const apiPassword = secrets["packeta_api_password"] || apiKey;
  const senderId = secrets["packeta_sender_id"];

  if (!apiKey || !senderId) {
    return null;
  }

  return {
    apiKey,
    apiPassword,
    senderId,
  };
}
