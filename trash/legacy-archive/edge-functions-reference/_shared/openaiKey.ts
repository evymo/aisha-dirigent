import type { SupabaseClient } from "./deps.ts";

export async function getOpenAiApiKey(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("edge_app_secrets", {
    p_action: "get_many",
    p_payload: {
      keys: ["openai_api_key"],
    },
  });

  if (error) {
    console.error("[getOpenAiApiKey] RPC edge_app_secrets failed:", error.message, "| code:", error.code);
    return null;
  }

  const rows = (data as { rows?: Array<{ key?: unknown; value?: unknown }> } | null)?.rows ?? [];
  const row = rows.find((item) => item.key === "openai_api_key");
  const value = row?.value;

  if (!row) {
    console.warn("[getOpenAiApiKey] openai_api_key not found in vault (returned rows:", rows.length, ")");
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
