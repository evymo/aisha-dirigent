/**
 * Generate Embeddings Edge Function
 *
 * Generates OpenAI embeddings for expert_rules content and stores them
 * in the content_embedding column (vector(1536)).
 *
 * Processes rules that have body_markdown but no embedding yet,
 * or all rules when force=true.
 *
 * POST /generate-embeddings
 * Headers: Authorization: Bearer <service_role_key>
 * Body: { "force": false, "batch_size": 10 }
 *
 * @module
 */

import { serve } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import {
  requireSupabaseEnv,
  createServiceRoleSupabaseClient,
} from "../_shared/supabase.ts";
import { jsonResponse } from "../_shared/http.ts";
import { getOpenAiApiKey } from "../_shared/openaiKey.ts";

/** OpenAI embedding model — text-embedding-3-small produces 1536-dim vectors */
const EMBEDDING_MODEL = "text-embedding-3-small";

/** Maximum tokens per embedding request (roughly) */
const MAX_CHARS_PER_CHUNK = 8000;

interface EmbeddingRequest {
  /** Re-generate all embeddings, even existing ones */
  force?: boolean;
  /** Number of rules to process per batch (default: 10) */
  batch_size?: number;
  /** Process only a specific slug */
  slug?: string;
}

interface EmbeddingResult {
  slug: string;
  status: "success" | "skipped" | "error";
  chars?: number;
  error?: string;
}

/**
 * Compose the text to embed for an expert rule.
 * Combines title, summary, ai_instructions, tags, and body content.
 */
function composeEmbeddingText(rule: {
  title: string;
  summary: string;
  body_markdown: string;
  ai_instructions: string | null;
  ai_context_tags: string[] | null;
}): string {
  const parts: string[] = [];

  parts.push(`# ${rule.title}`);
  parts.push(rule.summary);

  if (rule.ai_instructions) {
    parts.push(`AI Instructions: ${rule.ai_instructions}`);
  }

  if (rule.ai_context_tags?.length) {
    parts.push(`Tags: ${rule.ai_context_tags.join(", ")}`);
  }

  // Truncate body to fit within embedding limits
  const remainingChars =
    MAX_CHARS_PER_CHUNK -
    parts.reduce((sum, p) => sum + p.length, 0) -
    100; // buffer

  if (remainingChars > 500 && rule.body_markdown) {
    parts.push(rule.body_markdown.slice(0, remainingChars));
  }

  return parts.join("\n\n");
}

/**
 * Call OpenAI embeddings API for a single text.
 */
async function generateEmbedding(
  apiKey: string,
  text: string,
): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
      signal: AbortSignal.timeout(60000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenAI API error ${response.status}: ${errorBody.slice(0, 200)}`,
    );
  }

  const result = await response.json();
  return result.data[0].embedding;
}

serve(async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return preflightResponse(corsHeaders);
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  // Require service role (admin-only operation)
  const env = requireSupabaseEnv({ requireServiceRole: true });
  if (!env.ok) {
    return jsonResponse(req, { error: env.error }, env.status);
  }

  // Verify authorization — must use service role key
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (token !== env.supabaseServiceKey) {
    return jsonResponse(req, { error: "Unauthorized — service role required" }, 401);
  }

  // Parse request body
  let body: EmbeddingRequest = {};
  try {
    body = await req.json();
  } catch {
    // Default values
  }

  const force = body.force ?? false;
  const batchSize = Math.min(body.batch_size ?? 10, 50);
  const targetSlug = body.slug;

  // Get OpenAI API key
  const supabase = createServiceRoleSupabaseClient({
    supabaseUrl: env.supabaseUrl,
    supabaseServiceKey: env.supabaseServiceKey!,
  });

  const openaiApiKey =
    (await getOpenAiApiKey(supabase)) ?? Deno.env.get("OPENAI_API_KEY");

  if (!openaiApiKey) {
    return jsonResponse(
      req,
      { error: "OpenAI API key not configured" },
      500,
    );
  }

  // Fetch rules that need embeddings
  let query = `
    SELECT id, slug, title, summary, body_markdown, ai_instructions, ai_context_tags, content_embedding IS NOT NULL as has_embedding
    FROM expert_rules
    WHERE status = 'published'
  `;

  const queryParams: unknown[] = [];

  if (targetSlug) {
    queryParams.push(targetSlug);
    query += ` AND slug = $${queryParams.length}`;
  }

  if (!force) {
    query += ` AND content_embedding IS NULL`;
  }

  query += ` ORDER BY created_at ASC LIMIT $${queryParams.length + 1}`;
  queryParams.push(batchSize);

  // Use raw SQL through RPC or direct query
  // Since we have service role, we can query directly
  const { data: rules, error: fetchError } = await supabase
    .from("expert_rules")
    .select(
      "id, slug, title, summary, body_markdown, ai_instructions, ai_context_tags",
    )
    .eq("status", "published")
    .is(force ? undefined! : "content_embedding", force ? undefined! : null)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  // Fallback: if `.is()` with undefined doesn't work cleanly, use RPC
  // For now, let's handle both paths
  let rulesToProcess: Array<{
    id: string;
    slug: string;
    title: string;
    summary: string;
    body_markdown: string;
    ai_instructions: string | null;
    ai_context_tags: string[] | null;
  }>;

  if (fetchError) {
    // Fallback: query all published and filter in code
    const { data: allRules, error: allError } = await supabase
      .from("expert_rules")
      .select(
        "id, slug, title, summary, body_markdown, ai_instructions, ai_context_tags, content_embedding",
      )
      .eq("status", "published")
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (allError) {
      return jsonResponse(
        req,
        { error: "Failed to fetch rules", detail: allError.message },
        500,
      );
    }

    rulesToProcess = (allRules ?? []).filter(
      (r) =>
        force ||
        r.content_embedding === null ||
        r.content_embedding === undefined,
    ) as typeof rulesToProcess;

    if (targetSlug) {
      rulesToProcess = rulesToProcess.filter((r) => r.slug === targetSlug);
    }
  } else {
    rulesToProcess = (rules ?? []) as typeof rulesToProcess;
    if (targetSlug) {
      rulesToProcess = rulesToProcess.filter((r) => r.slug === targetSlug);
    }
  }

  if (rulesToProcess.length === 0) {
    return jsonResponse(req, {
      message: "No rules need embedding generation",
      processed: 0,
      results: [],
    });
  }

  // Process each rule
  const results: EmbeddingResult[] = [];

  for (const rule of rulesToProcess) {
    try {
      const text = composeEmbeddingText(rule);
      const embedding = await generateEmbedding(openaiApiKey, text);

      // Store embedding
      const { error: updateError } = await supabase
        .from("expert_rules")
        .update({
          content_embedding: JSON.stringify(embedding),
          updated_at: new Date().toISOString(),
        })
        .eq("id", rule.id);

      if (updateError) {
        results.push({
          slug: rule.slug,
          status: "error",
          error: updateError.message,
        });
      } else {
        results.push({
          slug: rule.slug,
          status: "success",
          chars: text.length,
        });
      }
    } catch (err) {
      results.push({
        slug: rule.slug,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "error").length;

  return jsonResponse(req, {
    message: `Processed ${rulesToProcess.length} rules: ${succeeded} success, ${failed} failed`,
    processed: rulesToProcess.length,
    succeeded,
    failed,
    results,
  });
});
