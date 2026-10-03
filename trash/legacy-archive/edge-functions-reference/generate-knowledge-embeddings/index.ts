/**
 * Generate Knowledge Embeddings Edge Function
 *
 * Chunks knowledge_items content into ~500-token segments and generates
 * OpenAI embeddings (text-embedding-3-small, 1536 dims) for each chunk.
 *
 * Pipeline:
 *   knowledge_items → knowledge_chunks → knowledge_embeddings
 *
 * POST /generate-knowledge-embeddings
 * Headers: Authorization: Bearer <service_role_key>
 * Body: {
 *   "force": false,        // Re-chunk and re-embed all items
 *   "batch_size": 10,      // Max items per invocation
 *   "item_type": null,     // Filter by knowledge_item_type enum
 *   "source_slug": null    // Process only a specific source_slug
 * }
 *
 * @module
 */

import { serve, type SupabaseClient } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import {
  requireSupabaseEnv,
  createServiceRoleSupabaseClient,
} from "../_shared/supabase.ts";
import { getOpenAiApiKey } from "../_shared/openaiKey.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

/** OpenAI embedding model — text-embedding-3-small produces 1536-dim vectors */
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_MODEL_VERSION = "2024-01";

/** Target chunk size in characters (~500 tokens ≈ 2000 chars) */
const TARGET_CHUNK_CHARS = 2000;

/** Overlap between chunks in characters (~50 tokens ≈ 200 chars) */
const CHUNK_OVERLAP_CHARS = 200;

/** Minimum chunk size — don't create tiny fragments */
const MIN_CHUNK_CHARS = 100;

/** Maximum batch size per invocation */
const MAX_BATCH_SIZE = 50;

/** Approximate tokens-per-char ratio for English text */
const CHARS_PER_TOKEN = 4;

// ─── Types ───────────────────────────────────────────────────────────────────

interface RequestBody {
  force?: boolean;
  batch_size?: number;
  item_type?: string;
  source_slug?: string;
  /** Process a single knowledge item by ID (used by auto-embed trigger) */
  item_id?: string;
}

interface ChunkData {
  chunk_index: number;
  chunk_text: string;
  token_count: number;
  section_title: string | null;
  source_field: string;
}

interface ItemResult {
  source_slug: string | null;
  title: string;
  status: "success" | "skipped" | "error";
  chunks_created?: number;
  embeddings_created?: number;
  error?: string;
}

// ─── Chunking Logic ──────────────────────────────────────────────────────────

/**
 * Extract a section title from a markdown heading near the start of a chunk.
 * Returns null if no heading is found in the first 200 chars.
 */
function extractSectionTitle(text: string): string | null {
  const match = text.match(/^#{1,4}\s+(.+)$/m);
  if (match && text.indexOf(match[0]) < 200) {
    return match[1].trim();
  }
  return null;
}

/**
 * Estimate token count from character count.
 * Conservative estimate: ~4 chars per token for English/mixed content.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Split text into chunks of ~TARGET_CHUNK_CHARS with CHUNK_OVERLAP_CHARS overlap.
 *
 * Strategy:
 * 1. Try to split on paragraph boundaries (\n\n)
 * 2. Fall back to sentence boundaries (. ! ?)
 * 3. Fall back to word boundaries
 * 4. Hard split as last resort
 */
function chunkText(
  text: string,
  sourceField: string,
): ChunkData[] {
  if (!text || text.trim().length < MIN_CHUNK_CHARS) {
    if (text && text.trim().length > 0) {
      return [
        {
          chunk_index: 0,
          chunk_text: text.trim(),
          token_count: estimateTokens(text.trim()),
          section_title: extractSectionTitle(text.trim()),
          source_field: sourceField,
        },
      ];
    }
    return [];
  }

  const chunks: ChunkData[] = [];
  let position = 0;
  let chunkIndex = 0;

  while (position < text.length) {
    const remaining = text.length - position;

    // If remaining text fits in one chunk, take it all
    if (remaining <= TARGET_CHUNK_CHARS + CHUNK_OVERLAP_CHARS) {
      const chunkText = text.slice(position).trim();
      if (chunkText.length >= MIN_CHUNK_CHARS) {
        chunks.push({
          chunk_index: chunkIndex,
          chunk_text: chunkText,
          token_count: estimateTokens(chunkText),
          section_title: extractSectionTitle(chunkText),
          source_field: sourceField,
        });
      }
      break;
    }

    // Extract a window of TARGET_CHUNK_CHARS
    let end = position + TARGET_CHUNK_CHARS;

    // Try to find a paragraph break
    const paragraphBreak = text.lastIndexOf("\n\n", end);
    if (paragraphBreak > position + TARGET_CHUNK_CHARS * 0.5) {
      end = paragraphBreak;
    } else {
      // Try sentence break
      const sentenceBreak = findLastSentenceBreak(text, position, end);
      if (sentenceBreak > position + TARGET_CHUNK_CHARS * 0.3) {
        end = sentenceBreak;
      } else {
        // Try word break
        const wordBreak = text.lastIndexOf(" ", end);
        if (wordBreak > position + TARGET_CHUNK_CHARS * 0.3) {
          end = wordBreak;
        }
        // else: hard split at TARGET_CHUNK_CHARS
      }
    }

    const chunkContent = text.slice(position, end).trim();
    if (chunkContent.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        chunk_index: chunkIndex,
        chunk_text: chunkContent,
        token_count: estimateTokens(chunkContent),
        section_title: extractSectionTitle(chunkContent),
        source_field: sourceField,
      });
      chunkIndex++;
    }

    // Advance position with overlap, ensuring forward progress
    const newPosition = end - CHUNK_OVERLAP_CHARS;
    position = Math.max(newPosition, position + MIN_CHUNK_CHARS);
  }

  return chunks;
}

/**
 * Find the last sentence-ending punctuation followed by a space or newline.
 */
function findLastSentenceBreak(
  text: string,
  start: number,
  end: number,
): number {
  const segment = text.slice(start, end);
  // Look for ". " or "? " or "! " or ".\n"
  let lastBreak = -1;
  for (let i = segment.length - 1; i >= 0; i--) {
    const ch = segment[i];
    if ((ch === "." || ch === "?" || ch === "!") && i + 1 < segment.length) {
      const next = segment[i + 1];
      if (next === " " || next === "\n") {
        lastBreak = start + i + 1;
        break;
      }
    }
  }
  return lastBreak;
}

/**
 * Build chunks for a knowledge item by combining body_markdown and ai_instructions.
 */
function buildChunksForItem(item: {
  body_markdown: string;
  ai_instructions: string | null;
  title: string;
  summary: string | null;
}): ChunkData[] {
  const allChunks: ChunkData[] = [];

  // Prepend title + summary as context to the first body chunk
  const contextPrefix = [
    `# ${item.title}`,
    item.summary ? `\n${item.summary}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Chunk body_markdown (primary content)
  const bodyWithContext = contextPrefix
    ? `${contextPrefix}\n\n${item.body_markdown}`
    : item.body_markdown;

  const bodyChunks = chunkText(bodyWithContext, "body");
  allChunks.push(...bodyChunks);

  // Chunk ai_instructions separately (if substantial)
  if (item.ai_instructions && item.ai_instructions.trim().length >= MIN_CHUNK_CHARS) {
    const instrChunks = chunkText(item.ai_instructions, "ai_instructions");
    // Re-index after body chunks
    const offset = allChunks.length;
    for (const chunk of instrChunks) {
      chunk.chunk_index = offset + instrChunks.indexOf(chunk);
      allChunks.push(chunk);
    }
  }

  return allChunks;
}

// ─── OpenAI Embedding ────────────────────────────────────────────────────────

/**
 * Generate embeddings for multiple texts in a single API call (batch).
 * OpenAI supports up to 2048 inputs per request.
 */
async function generateEmbeddingsBatch(
  apiKey: string,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await fetch("https://api.openai.com/v1/embeddings", {
      signal: AbortSignal.timeout(60000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenAI API error ${response.status}: ${errorBody.slice(0, 300)}`,
    );
  }

  const result = await response.json();
  // OpenAI returns data sorted by index
  const sorted = result.data.sort(
    (a: { index: number }, b: { index: number }) => a.index - b.index,
  );
  return sorted.map((item: { embedding: number[] }) => item.embedding);
}

// ─── Database Operations ─────────────────────────────────────────────────────

/**
 * Delete existing chunks and embeddings for a knowledge item.
 */
async function clearItemChunks(
  supabase: SupabaseClient,
  itemId: string,
): Promise<void> {
  // Embeddings cascade from chunks via FK, but delete explicitly to be sure
  const { error: embError } = await supabase
    .from("knowledge_embeddings")
    .delete()
    .eq("knowledge_item_id", itemId);

  if (embError) {
    console.error(`[clearItemChunks] Failed to delete embeddings for ${itemId}:`, embError.message);
  }

  const { error: chunkError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("knowledge_item_id", itemId);

  if (chunkError) {
    throw new Error(`Failed to delete chunks for ${itemId}: ${chunkError.message}`);
  }
}

/**
 * Insert chunks and their embeddings for a knowledge item.
 */
async function insertChunksAndEmbeddings(
  supabase: SupabaseClient,
  itemId: string,
  chunks: ChunkData[],
  embeddings: number[][],
): Promise<{ chunksInserted: number; embeddingsInserted: number }> {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `Mismatch: ${chunks.length} chunks vs ${embeddings.length} embeddings`,
    );
  }

  let chunksInserted = 0;
  let embeddingsInserted = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];

    // Insert chunk
    const { data: chunkRow, error: chunkError } = await supabase
      .from("knowledge_chunks")
      .insert({
        knowledge_item_id: itemId,
        chunk_index: chunk.chunk_index,
        chunk_text: chunk.chunk_text,
        token_count: chunk.token_count,
        section_title: chunk.section_title,
        source_field: chunk.source_field,
      })
      .select("id")
      .single();

    if (chunkError) {
      throw new Error(
        `Failed to insert chunk ${i} for ${itemId}: ${chunkError.message}`,
      );
    }

    chunksInserted++;

    // Insert embedding
    const { error: embError } = await supabase
      .from("knowledge_embeddings")
      .insert({
        chunk_id: chunkRow.id,
        knowledge_item_id: itemId,
        embedding: JSON.stringify(embedding),
        model: EMBEDDING_MODEL,
        model_version: EMBEDDING_MODEL_VERSION,
      });

    if (embError) {
      throw new Error(
        `Failed to insert embedding for chunk ${chunkRow.id}: ${embError.message}`,
      );
    }

    embeddingsInserted++;
  }

  return { chunksInserted, embeddingsInserted };
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return preflightResponse(corsHeaders);
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Require service role
  const env = requireSupabaseEnv({ requireServiceRole: true });
  if (!env.ok) {
    return new Response(JSON.stringify({ error: env.error }), {
      status: env.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify authorization — must use service role key
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (token !== env.supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — service role required" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Parse request body
  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    // Use defaults
  }

  const force = body.force ?? false;
  const batchSize = Math.min(body.batch_size ?? 10, MAX_BATCH_SIZE);
  const filterItemType = body.item_type ?? null;
  const filterSourceSlug = body.source_slug ?? null;
  const filterItemId = body.item_id ?? null;

  // Create service role client
  const supabase = createServiceRoleSupabaseClient({
    supabaseUrl: env.supabaseUrl,
    supabaseServiceKey: env.supabaseServiceKey!,
  });

  // Get OpenAI API key
  const openaiApiKey =
    (await getOpenAiApiKey(supabase)) ?? Deno.env.get("OPENAI_API_KEY");

  if (!openaiApiKey) {
    return new Response(
      JSON.stringify({ error: "OpenAI API key not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ─── Fetch knowledge items that need processing ──────────────────────────

  let query = supabase
    .from("knowledge_items")
    .select("id, title, summary, body_markdown, ai_instructions, source_slug, item_type, status")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (filterItemType) {
    query = query.eq("item_type", filterItemType);
  }

  if (filterSourceSlug) {
    query = query.eq("source_slug", filterSourceSlug);
  }

  if (filterItemId) {
    query = query.eq("id", filterItemId);
  }

  const { data: items, error: fetchError } = await query;

  if (fetchError) {
    return new Response(
      JSON.stringify({
        error: "Failed to fetch knowledge items",
        detail: fetchError.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (!items || items.length === 0) {
    return new Response(
      JSON.stringify({
        message: "No knowledge items found to process",
        processed: 0,
        results: [],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // If not force, filter out items that already have chunks
  let itemsToProcess = items;
  if (!force) {
    const { data: existingChunks, error: chunkCheckError } = await supabase
      .from("knowledge_chunks")
      .select("knowledge_item_id")
      .in(
        "knowledge_item_id",
        items.map((i) => i.id),
      );

    if (!chunkCheckError && existingChunks) {
      const itemsWithChunks = new Set(
        existingChunks.map((c) => c.knowledge_item_id),
      );
      itemsToProcess = items.filter((i) => !itemsWithChunks.has(i.id));
    }
  }

  if (itemsToProcess.length === 0) {
    return new Response(
      JSON.stringify({
        message: "All items already have embeddings. Use force=true to regenerate.",
        processed: 0,
        total_items: items.length,
        results: [],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ─── Process each item ───────────────────────────────────────────────────

  const results: ItemResult[] = [];
  let totalChunks = 0;
  let totalEmbeddings = 0;

  for (const item of itemsToProcess) {
    try {
      // 1. Build chunks
      const chunks = buildChunksForItem({
        body_markdown: item.body_markdown,
        ai_instructions: item.ai_instructions,
        title: item.title,
        summary: item.summary,
      });

      if (chunks.length === 0) {
        results.push({
          source_slug: item.source_slug,
          title: item.title,
          status: "skipped",
          error: "No content to chunk",
        });
        continue;
      }

      // 2. Generate embeddings for all chunks (batch API call)
      const chunkTexts = chunks.map((c) => c.chunk_text);
      const embeddings = await generateEmbeddingsBatch(
        openaiApiKey,
        chunkTexts,
      );

      // 3. Clear existing chunks/embeddings if force
      if (force) {
        await clearItemChunks(supabase, item.id);
      }

      // 4. Insert chunks and embeddings
      const { chunksInserted, embeddingsInserted } =
        await insertChunksAndEmbeddings(
          supabase,
          item.id,
          chunks,
          embeddings,
        );

      totalChunks += chunksInserted;
      totalEmbeddings += embeddingsInserted;

      results.push({
        source_slug: item.source_slug,
        title: item.title,
        status: "success",
        chunks_created: chunksInserted,
        embeddings_created: embeddingsInserted,
      });
    } catch (err) {
      results.push({
        source_slug: item.source_slug,
        title: item.title,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  return new Response(
    JSON.stringify({
      message: `Processed ${itemsToProcess.length} items: ${succeeded} success, ${failed} failed, ${skipped} skipped`,
      processed: itemsToProcess.length,
      succeeded,
      failed,
      skipped,
      total_chunks: totalChunks,
      total_embeddings: totalEmbeddings,
      results,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
