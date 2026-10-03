// Edge function for public partners directory
/**
 * Partners Directory Edge Function
 * 
 * SECURITY: This endpoint supports two modes:
 * 1. AUTHENTICATED (Bearer token): Full partner listing with all public details
 * 2. ANONYMOUS (no token): Limited preview (max 6 partners, minimal fields) with IP rate limiting
 * 
 * This allows potential customers to see partners exist without exposing full directory to scrapers.
 */
import { serve } from "../_shared/deps.ts";

import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import {
  createServiceRoleSupabaseClient,
  createUserSupabaseClient,
  requireSupabaseEnv,
} from "../_shared/supabase.ts";
import { getPublicPartnersDirectoryConfig } from "../_shared/runtimeConfig.ts";

const publicConfig = getPublicPartnersDirectoryConfig();
const allowedOriginsRaw = publicConfig.allowedOriginsRaw;
const REQUESTS_PER_HOUR_PER_USER = publicConfig.requestsPerHourPerIp;
const MAX_RESULTS = publicConfig.maxResults;

// Anonymous access limits (same max results as authenticated, just limited fields)
const ANONYMOUS_REQUESTS_PER_HOUR_PER_IP = 20;

// Fields exposed to anonymous users (minimal - no contact info, no full description)
const ANONYMOUS_FIELDS = [
  "id",
  "display_name",
  "city",
  "country",
  "certification_level",
  "is_production_provider",
  "accepts_online_appointments",
  "accepts_in_person_appointments",
  "avatar_url",
] as const;

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getClientIp(req: Request): string {
  // Check common proxy headers
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }
  // Fallback - won't have real IP in edge function context
  return "unknown";
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsFailure = corsGuard({ origin, allowedOriginsRaw });
  if (corsFailure) return silentCorsDenyResponse();

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw, { allowMethods: "POST, OPTIONS" });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseEnv = requireSupabaseEnv({ requireServiceRole: true });
  if (!supabaseEnv.ok) return jsonResponse(req, { error: supabaseEnv.error }, supabaseEnv.status);
  const { supabaseUrl, supabaseAnonKey, supabaseServiceKey } = supabaseEnv;

  const supabaseAdmin = createServiceRoleSupabaseClient({
    supabaseUrl,
    supabaseServiceKey: supabaseServiceKey!,
  });

  // Check for Bearer token (optional for this endpoint)
  const authHeader = req.headers.get("Authorization");
  const hasToken = authHeader?.startsWith("Bearer ") && authHeader.length > 7;
  
  let isAuthenticated = false;
  let userId: string | null = null;
  let userIdHash: string | null = null;

  if (hasToken) {
    const token = authHeader!.substring(7);
    const supabaseUser = createUserSupabaseClient({
      supabaseUrl,
      supabaseAnonKey,
      token,
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (!userError && user) {
      isAuthenticated = true;
      userId = user.id;
      userIdHash = await sha256Hex(userId);
    }
  }

  // Rate limiting
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  if (isAuthenticated && userId) {
    // Authenticated: rate limit per user
    const { data: countResult, error: countError } = await supabaseAdmin.rpc(
      "edge_public_partners_directory",
      {
        p_action: "count_requests_authenticated",
        p_payload: {
          since,
          summary: "Partners directory queried",
          user_id: userId,
        },
      }
    );
    const count = (countResult as { count?: number } | null)?.count ?? 0;

    if (!countError && (count ?? 0) >= REQUESTS_PER_HOUR_PER_USER) {
      await supabaseAdmin.rpc("write_audit_journal", {
        p_action_type: "error",
        p_area: "partners",
        p_details: {
          result: "rate_limited",
          mode: "authenticated",
          user_id_hash: userIdHash,
          max_per_hour: REQUESTS_PER_HOUR_PER_USER,
        },
        p_entity_id: null,
        p_entity_type: "partner_profiles",
        p_summary: "Partners directory rate limited",
        p_tags: ["partners", "rate_limit"],
        p_user_id: userId
      });

      return jsonResponse(req, { error: "Rate limit exceeded" }, 429);
    }
  } else {
    // Anonymous: rate limit per IP (hashed)
    const clientIp = getClientIp(req);
    const ipHash = await sha256Hex(clientIp);

    const { data: countResult, error: countError } = await supabaseAdmin.rpc(
      "edge_public_partners_directory",
      {
        p_action: "count_requests_anonymous",
        p_payload: {
          ip_hash: ipHash,
          since,
          summary: "Partners directory queried (anonymous)",
        },
      }
    );
    const count = (countResult as { count?: number } | null)?.count ?? 0;

    if (!countError && (count ?? 0) >= ANONYMOUS_REQUESTS_PER_HOUR_PER_IP) {
      await supabaseAdmin.rpc("write_audit_journal", {
        p_action_type: "error",
        p_area: "partners",
        p_details: {
          result: "rate_limited",
          mode: "anonymous",
          ip_hash: ipHash,
          max_per_hour: ANONYMOUS_REQUESTS_PER_HOUR_PER_IP,
        },
        p_entity_id: null,
        p_entity_type: "partner_profiles",
        p_summary: "Partners directory rate limited (anonymous)",
        p_tags: ["partners", "rate_limit", "anonymous"],
        p_user_id: null
      });

      return jsonResponse(req, { error: "Rate limit exceeded" }, 429);
    }
  }

  let body: { city?: string; limit?: number } = {};
  try {
    body = await req.json() as { city?: string; limit?: number };
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const cityRaw = typeof body?.city === "string" ? body.city.trim() : "";
  const city = cityRaw.length ? cityRaw.slice(0, 100) : null;

  // Same limit for both modes - anonymous just gets fewer fields
  const limitRaw = body.limit;
  const limit = Math.min(Math.max(1, typeof limitRaw === "number" && Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : MAX_RESULTS), MAX_RESULTS);

  const { data: partnersResult, error } = await supabaseAdmin.rpc("edge_public_partners_directory", {
    p_action: "get_partners",
    p_payload: {
      authenticated: isAuthenticated,
      city,
      limit,
    },
  });
  if (error) {
    return jsonResponse(req, { error: "Failed to load partners" }, 500);
  }

  const data = (partnersResult as { rows?: unknown[] } | null)?.rows ?? [];

  // Get total count for anonymous users to show "X more partners available"
  let totalCount: number | undefined;
  if (!isAuthenticated) {
    const { data: visibleResult } = await supabaseAdmin.rpc("edge_public_partners_directory", {
      p_action: "count_visible",
      p_payload: {},
    });
    totalCount = (visibleResult as { count?: number } | null)?.count;
  }

  // Audit logging
  if (isAuthenticated && userId) {
    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "view",
      p_area: "partners",
      p_details: {
        result: "granted",
        mode: "authenticated",
        user_id_hash: userIdHash,
        city: city,
        limit,
        returned: Array.isArray(data) ? data.length : 0,
      },
      p_entity_id: null,
      p_entity_type: "partner_profiles",
      p_summary: "Partners directory queried",
      p_tags: ["partners"],
      p_user_id: userId
    });
  } else {
    const clientIp = getClientIp(req);
    const ipHash = await sha256Hex(clientIp);

    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "view",
      p_area: "partners",
      p_details: {
        result: "granted",
        mode: "anonymous",
        ip_hash: ipHash,
        city: city,
        limit,
        returned: Array.isArray(data) ? data.length : 0,
      },
      p_entity_id: null,
      p_entity_type: "partner_profiles",
      p_summary: "Partners directory queried (anonymous)",
      p_tags: ["partners", "anonymous"],
      p_user_id: null
    });
  }

  return jsonResponse(req, {
    partners: data ?? [],
    isAuthenticated,
    totalCount: totalCount, // Only present for anonymous
    limit,
  }, 200);
});
