/**
 * sentry-monitor — Edge function for Sentry issue monitoring & AISHA analysis.
 *
 * Endpoints:
 *   GET  ?action=issues&project=<slug>  — List unresolved issues for a project
 *   POST { action: "analyze", issue_id }   — Trigger AISHA analysis for a specific issue
 *
 * Requires SENTRY_AUTH_TOKEN and SENTRY_ORG env vars.
 * Self-hosted Sentry at sentry.id3a.cz.
 */
import { serve, createClient } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import { bearerTokenGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import {
  requireSupabaseEnv,
  createAuthedSupabaseClient,
  createServiceRoleSupabaseClient,
} from "../_shared/supabase.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();
const SENTRY_BASE_URL = Deno.env.get("SENTRY_BASE_URL") ?? "https://sentry.id3a.cz";
const SENTRY_ORG = Deno.env.get("SENTRY_ORG") ?? "sentry";
const SENTRY_AUTH_TOKEN = Deno.env.get("SENTRY_AUTH_TOKEN") ?? "";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

interface SentryIssue {
  id: string;
  title: string;
  culprit: string | null;
  level: string;
  status: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  shortId: string;
  project: { slug: string };
}

interface CachedResult {
  data: unknown;
  timestamp: number;
}

const issueCache = new Map<string, CachedResult>();

/** Fetch issues from Sentry API */
async function fetchSentryIssues(
  projectSlug: string,
  query = "is:unresolved",
  limit = 25
): Promise<SentryIssue[]> {
  const cacheKey = `${projectSlug}:${query}`;
  const cached = issueCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data as SentryIssue[];
  }

  const url = new URL(
    `/api/0/projects/${SENTRY_ORG}/${projectSlug}/issues/`,
    SENTRY_BASE_URL
  );
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "date");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sentry API error: ${response.status} ${text.slice(0, 200)}`);
  }

  const issues: SentryIssue[] = await response.json();
  issueCache.set(cacheKey, { data: issues, timestamp: Date.now() });
  return issues;
}

/** Map Sentry response to mobile-friendly format */
function mapIssues(issues: SentryIssue[], projectSlug: string) {
  return issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    culprit: issue.culprit ?? null,
    level: issue.level,
    status: issue.status,
    count: parseInt(issue.count, 10) || 0,
    first_seen: issue.firstSeen,
    last_seen: issue.lastSeen,
    project_slug: projectSlug,
    short_id: issue.shortId ?? null,
    aisha_suggestion: null,
  }));
}

/** Trigger AISHA analysis for a Sentry issue */
async function analyzeIssue(
  issueId: string,
  projectSlug: string,
  supabaseAdmin: ReturnType<typeof createClient>
) {
  // Fetch full issue with stacktrace
  const url = new URL(
    `/api/0/issues/${issueId}/events/latest/`,
    SENTRY_BASE_URL
  );
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Sentry issue fetch failed: ${response.status}`);
  }

  const event = await response.json();
  const title = event.title ?? "Unknown issue";
  const stacktrace = extractStacktrace(event);

  // Call AI router to analyze
  const prompt = `Analyze this Sentry error and suggest a fix.\n\nTitle: ${title}\nProject: ${projectSlug}\n\nStacktrace:\n${stacktrace}\n\nProvide:\n1. Root cause\n2. Recommended fix\n3. Affected files`;

  const { data: analysisResult, error: analysisError } = await supabaseAdmin.rpc(
    "route_ai_task",
    {
      p_metadata: { sentry_issue_id: issueId, project_slug: projectSlug },
      p_prompt: prompt,
      p_task_kind: "incident",
    }
  );

  return {
    issue_id: issueId,
    analysis: analysisResult ?? null,
    error: analysisError?.message ?? null,
  };
}

/** Extract readable stacktrace from Sentry event */
function extractStacktrace(event: Record<string, unknown>): string {
  try {
    const entries = (event.entries as Array<Record<string, unknown>>) ?? [];
    const exceptionEntry = entries.find(
      (e) => e.type === "exception"
    );
    if (!exceptionEntry) return "No stacktrace available";

    const data = exceptionEntry.data as Record<string, unknown>;
    const values = (data?.values as Array<Record<string, unknown>>) ?? [];
    const frames: string[] = [];

    for (const value of values.slice(0, 3)) {
      const stacktrace = value.stacktrace as Record<string, unknown> | undefined;
      const frameList = (stacktrace?.frames as Array<Record<string, unknown>>) ?? [];
      for (const frame of frameList.slice(-10)) {
        const filename = frame.filename ?? "?";
        const lineNo = frame.lineNo ?? "?";
        const func = frame.function ?? "?";
        frames.push(`  at ${func} (${filename}:${lineNo})`);
      }
    }

    return frames.join("\n") || "No frames available";
  } catch (err) {
    console.warn("[sentry-monitor] stacktrace extraction failed:", err instanceof Error ? err.message : String(err));
    return "Stacktrace extraction failed";
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw);
  }

  const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw);

  try {
    // Auth guard
    const authResult = bearerTokenGuard({
      authorizationHeader: req.headers.get("Authorization"),
    });
    if ("status" in authResult) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    if (!SENTRY_AUTH_TOKEN) {
      return new Response(
        JSON.stringify({ error: "SENTRY_AUTH_TOKEN not configured" }),
        { status: 503, headers: corsHeaders }
      );
    }

    const { supabaseUrl, supabaseAnonKey } = requireSupabaseEnv();

    if (req.method === "GET") {
      // GET ?action=issues&project=<slug>
      const url = new URL(req.url);
      const action = url.searchParams.get("action") ?? "issues";
      const projectSlug = url.searchParams.get("project");

      if (action === "issues") {
        if (!projectSlug) {
          return new Response(
            JSON.stringify({ error: "Missing 'project' parameter" }),
            { status: 400, headers: corsHeaders }
          );
        }
        const query = url.searchParams.get("query") ?? "is:unresolved";
        const issues = await fetchSentryIssues(projectSlug, query);
        const mapped = mapIssues(issues, projectSlug);

        return new Response(JSON.stringify({ issues: mapped }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ error: "Unknown action" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { action, issue_id, project_slug } = body;

      if (action === "analyze") {
        if (!issue_id || !project_slug) {
          return new Response(
            JSON.stringify({ error: "Missing issue_id or project_slug" }),
            { status: 400, headers: corsHeaders }
          );
        }

        const supabaseAdmin = createServiceRoleSupabaseClient({
          supabaseUrl,
        });

        const result = await analyzeIssue(issue_id, project_slug, supabaseAdmin);

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ error: "Unknown action" }),
        { status: 400, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders }
    );
  } catch (error) {
    console.error("sentry-monitor error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
