import type { SupabaseClient } from "./deps.ts";

export interface HomeAssistantConfig {
  accessToken: string;
  baseUrl: string;
}

const HOME_ASSISTANT_BASE_URL_KEY = "homeassistant_base_url";
const HOME_ASSISTANT_ACCESS_TOKEN_KEY = "homeassistant_access_token";

const readNonEmptyString = (value: string | undefined | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

function normalizeBaseUrl(rawBaseUrl: string): string {
  return rawBaseUrl.replace(/\/+$/, "");
}

/**
 * Loads Home Assistant configuration from app secrets with environment fallback.
 *
 * Preferred source:
 * 1) app_secrets via `edge_app_secrets`
 * 2) environment variables `HOMEASSISTANT_URL` + `HOMEASSISTANT_ACCESS_TOKEN`
 */
export async function getHomeAssistantConfig(
  supabase: SupabaseClient,
): Promise<HomeAssistantConfig | null> {
  const { data, error } = await supabase.rpc("edge_app_secrets", {
    p_action: "get_many",
    p_payload: {
      keys: [HOME_ASSISTANT_BASE_URL_KEY, HOME_ASSISTANT_ACCESS_TOKEN_KEY],
    },
  });

  const rows = (data as { rows?: Array<{ key?: unknown; value?: unknown }> } | null)?.rows ?? [];

  if (!error && rows.length > 0) {
    const secrets: Record<string, string> = {};
    for (const row of rows) {
      if (typeof row.key === "string" && typeof row.value === "string") {
        secrets[row.key] = row.value;
      }
    }

    const baseUrl = readNonEmptyString(secrets[HOME_ASSISTANT_BASE_URL_KEY]);
    const accessToken = readNonEmptyString(secrets[HOME_ASSISTANT_ACCESS_TOKEN_KEY]);
    if (baseUrl && accessToken) {
      return {
        accessToken,
        baseUrl: normalizeBaseUrl(baseUrl),
      };
    }
  }

  const envBaseUrl = readNonEmptyString(Deno.env.get("HOMEASSISTANT_URL"));
  const envAccessToken = readNonEmptyString(Deno.env.get("HOMEASSISTANT_ACCESS_TOKEN"));

  if (!envBaseUrl || !envAccessToken) {
    return null;
  }

  return {
    accessToken: envAccessToken,
    baseUrl: normalizeBaseUrl(envBaseUrl),
  };
}
