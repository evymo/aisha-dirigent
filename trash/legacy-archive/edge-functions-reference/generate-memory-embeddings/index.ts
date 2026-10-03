/**
 * Generate Memory Embeddings Edge Function
 *
 * Generates OpenAI embeddings (text-embedding-3-small, 1536 dims) for
 * agent_memories that don't have embeddings yet.
 *
 * POST /generate-memory-embeddings
 * Headers: Authorization: Bearer <service_role_key>
 * Body: {
 *   "agent_slug": null,    // Filter by agent (optional)
 *   "memory_id": null,     // Single memory (optional)
 *   "batch_size": 50       // Max memories per invocation
 * }
 *
 * @module
 */

import { serve } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import {
  requireSupabaseEnv,
  createServiceRoleSupabaseClient,
} from "../_shared/supabase.ts";
import { getOpenAiApiKey } from "../_shared/openaiKey.ts";

const EMBEDDING_MODEL = Deno.env.get("EMBEDDING_MODEL") ?? "text-embedding-3-small";
const MAX_BATCH_SIZE = 100;

interface RequestBody {
  agent_slug?: string;
  memory_id?: string;
  batch_size?: number;
}

interface MemoryRow {
  id: string;
  content: string;
  agent_slug: string;
  memory_type: string;
}

// ─── OpenAI Embedding Call ───────────────────────────────────────────────────

async function generateEmbeddings(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI embeddings API error ${resp.status}: ${err}`);
  }

  const json = await resp.json();
  return (json.data as Array<{ embedding: number[] }>)
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((d: { embedding: number[] }) => d.embedding);
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }

  const corsHeaders = buildCorsHeaders(req);

  try {
    // Auth: service_role only
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const envResult = requireSupabaseEnv({ requireServiceRole: true });
    if (!envResult.ok) {
      return new Response(JSON.stringify({ error: envResult.error }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey =
      envResult.supabaseServiceKey ?? "";
    if (token !== serviceKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: RequestBody = req.method === "POST"
      ? await req.json()
      : {};

    const batchSize = Math.min(body.batch_size ?? 50, MAX_BATCH_SIZE);

    const supabase = createServiceRoleSupabaseClient({
      supabaseUrl: envResult.supabaseUrl,
      supabaseServiceKey: serviceKey,
    });

    // Get OpenAI API key from vault
    const openaiKey = await getOpenAiApiKey(supabase);
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fetch memories without embeddings via RPC
    const { data: memories, error: fetchError } = await supabase.rpc(
      "fn_get_memories_without_embeddings",
      {
        p_agent_slug: body.agent_slug ?? null,
        p_batch_size: batchSize,
        p_memory_id: body.memory_id ?? null,
      },
    );
    if (fetchError) {
      throw new Error(`Fetch memories failed: ${fetchError.message}`);
    }

    const rows = (memories ?? []) as MemoryRow[];
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({
          status: "ok",
          message: "No memories need embedding",
          processed: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Build text inputs: prefix with metadata for better embedding quality
    const texts = rows.map(
      (m) => `[${m.agent_slug}/${m.memory_type}] ${m.content}`,
    );

    // Generate embeddings in one batch
    const embeddings = await generateEmbeddings(texts, openaiKey);

    // Update each memory with its embedding
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const { error: updateError } = await supabase.rpc(
        "fn_update_memory_embedding",
        {
          p_embedding: JSON.stringify(embeddings[i]),
          p_memory_id: rows[i].id,
        },
      );

      if (updateError) {
        errorCount++;
        errors.push(`${rows[i].id}: ${updateError.message}`);
      } else {
        successCount++;
      }
    }

    return new Response(
      JSON.stringify({
        status: errorCount === 0 ? "ok" : "partial",
        processed: rows.length,
        success: successCount,
        errors: errorCount,
        error_details: errors.length > 0 ? errors : undefined,
        model: EMBEDDING_MODEL,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
