
import { serve, createClient } from "../_shared/deps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-version, x-platform",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const platform =
      req.headers.get("x-platform")?.toLowerCase() || "unknown";
    const appVersion = req.headers.get("x-app-version") || "0.0.0";

    // target platform, default to ios if unknown/web just to get some config
    const targetPlatform = (platform === 'android') ? 'android' : 'ios';

    // Fetch config from DB via RPC
    const { data, error } = await supabase.rpc("edge_app_versions", {
      p_action: "get_platform",
      p_payload: {
        platform: targetPlatform,
      },
    });

    const versionData = (data as { row?: Record<string, unknown> | null } | null)?.row as
      | Record<string, unknown>
      | null
      | undefined;

    if (error) {
      console.error("Error fetching version config:", error);
      // Fallback to safe defaults if DB fails
      // In a real scenario, you might want to return an error or cached default
    }

    // Default config if DB is empty or error
    const config = versionData ?? {
      min_version: "1.0.0",
      latest_version: "1.0.0",
      store_url: "",
      maintenance_enabled: false,
      features: {}
    };

    // Check if update is required
    const updateRequired = compareVersions(appVersion, config.min_version) < 0;
    const updateRecommended = compareVersions(appVersion, config.latest_version) < 0;

    const response = {
      status: "ok",
      timestamp: new Date().toISOString(),

      // Version info
      version: {
        current: appVersion,
        platform,
        minimum: config.min_version,
        latest: config.latest_version,
        storeUrl: config.store_url,
      },

      // Update flags
      update: {
        required: updateRequired,
        recommended: updateRecommended,
        message: updateRequired
          ? "Prosím aktualizujte aplikaci pro pokračování."
          : updateRecommended
            ? "Je dostupná nová verze aplikace."
            : null,
      },

      // Maintenance status
      maintenance: {
        enabled: config.maintenance_enabled,
        message: config.maintenance_message,
        estimatedEnd: config.maintenance_end,
      },

      // Feature flags
      features: config.features || {},

      // Build info
      build: {
        deployedAt: new Date().toISOString(),
        version: "DYNAMIC",
      },
    };

    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60", // Cache 1 minute
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        message: "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
