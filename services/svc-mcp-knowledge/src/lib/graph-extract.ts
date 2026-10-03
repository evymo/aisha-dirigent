/**
 * Graph extract prompt + parser — Step 7.2 of retrieval optimization plan 2026.
 *
 * Hand to the LLM (resolved via capability-resolver rag.graph_extract) a
 * single ai_run's audit + attribution + memory context as fn_get_run_extract_context
 * shaped it, and parse the strict JSON output into a shape ready for
 * fn_apply_graph_extraction_audited.
 *
 * Design rules:
 *   - JSON mode required (json_mode: true) — text-mode output is rejected.
 *   - Prompt explicitly lists which graph_node identifiers are "anchorable"
 *     (Run id, ExpertRule slug, KnowledgeItem id) so the LLM emits edges
 *     whose endpoints actually resolve in fn_apply_graph_extraction_audited.
 *   - Only 'Concept' entity_type accepted by the apply RPC; the prompt
 *     mirrors that constraint so the LLM doesn't waste tokens emitting
 *     other types.
 *   - Edge relationship enum is also embedded so the LLM picks valid values.
 *
 * If the LLM returns unparseable output, the parser returns null and the
 * route logs the run as a soft failure (no audit row written, run stays
 * in the "needs extract" queue for the next batch).
 */

export interface ExtractedNode {
  entity_type: 'Concept';
  entity_slug: string;
  entity_label: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedEdge {
  from_type: string;
  from_slug: string;
  to_type: string;
  to_slug: string;
  relationship: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphExtractPayload {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
}

/** Allowed edge relationship enum — must match graph_edges CHECK constraint. */
export const ALLOWED_RELATIONSHIPS = new Set<string>([
  'USED', 'CITED', 'CAUSED', 'ESCALATED_TO', 'OVERRIDDEN_BY',
  'REFERENCES', 'AUTHORED', 'OWNED_BY', 'DERIVED_FROM', 'PART_OF',
  'PROPOSED_FOR', 'PROMOTED_FROM', 'TAGGED_AS',
]);

export const GRAPH_EXTRACT_SYSTEM = `You are AISHA's Hippocampus graph extractor.

You read the context of a single AI run (run metadata + recent audit events + retrieved knowledge attributions + derived memories) and emit a small, conservative set of abstract concepts the run touched on, plus edges connecting those concepts to anchors in the live graph.

Return ONLY a JSON object with this exact shape:

{
  "nodes": [
    {
      "entity_type": "Concept",
      "entity_slug": "<kebab-case slug, lowercase, ascii>",
      "entity_label": "<human-readable label, max 80 chars>",
      "metadata": { "description": "<one sentence>", "extracted_from": "audit|attribution|memory" }
    }
  ],
  "edges": [
    {
      "from_type": "<one of: Run, KnowledgeItem, ExpertRule, Memory, Concept>",
      "from_slug": "<existing slug in the live graph, or a Concept slug from THIS nodes list>",
      "to_type":   "<same set>",
      "to_slug":   "<same constraint>",
      "relationship": "<REFERENCES | TAGGED_AS | USED | PART_OF | DERIVED_FROM>",
      "confidence": 0.0,
      "metadata": { "why": "<one short phrase>" }
    }
  ]
}

Hard constraints (output will be rejected if violated):
- entity_type MUST be "Concept" for every node. Other types are bootstrap-owned.
- Each node's entity_slug must be a unique kebab-case slug (a-z, 0-9, hyphens), 3–60 chars.
- Edges connect to existing graph anchors. The valid anchor slugs you can reference are:
  - Run id (the run.id field in the context payload)
  - ExpertRule slug (attributions[*].rule_slug)
  - KnowledgeItem id (attributions[*].item_id, as text)
  - Memory id (memories[*].id, as text)
  - Concept slugs you declare in this same nodes array.
- Edge relationship MUST be one of: REFERENCES, TAGGED_AS, USED, PART_OF, DERIVED_FROM.
- Confidence is 0–1; default 0.7 when uncertain.
- Be conservative: emit 0–5 Concepts and 0–10 edges per run. Quality over quantity.
- If the context has no extractable concepts, return {"nodes": [], "edges": []}.
- No prose, no markdown, no code fences — JSON object only.`;

export function buildGraphExtractUserPrompt(context: unknown): string {
  // The caller hands us the jsonb output of fn_get_run_extract_context; we
  // just stringify it with light truncation. The LLM has the system prompt
  // describing the shape so it can navigate it.
  let serialized = '';
  try {
    serialized = JSON.stringify(context, null, 2);
  } catch {
    serialized = String(context);
  }
  // Hard cap; the SQL function already caps each list, but defensive.
  if (serialized.length > 12000) serialized = serialized.slice(0, 12000) + '\n... (truncated)';
  return `Run context:\n${serialized}\n\nExtract Concepts + edges per the system instructions. Return JSON object only.`;
}

/**
 * Parse LLM output strictly. Returns null on any structural defect so the
 * caller can soft-fail (the run stays in the queue for the next batch).
 *
 * Validates:
 *   - top-level object with `nodes` array and `edges` array
 *   - each node: entity_type === 'Concept', entity_slug + entity_label non-empty strings
 *   - each edge: from_type, from_slug, to_type, to_slug, relationship all non-empty strings;
 *     relationship in ALLOWED_RELATIONSHIPS; confidence (if present) is numeric in [0,1]
 *   - cap: at most 20 nodes + 40 edges (defensive — the prompt asks for far less)
 */
export function parseGraphExtractJson(raw: string): GraphExtractPayload | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) return null;
  const rawNodes = (parsed as Record<string, unknown>).nodes;
  const rawEdges = (parsed as Record<string, unknown>).edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;
  if (rawNodes.length > 20 || rawEdges.length > 40) return null;

  const nodes: ExtractedNode[] = [];
  const seenSlugs = new Set<string>();
  for (const item of rawNodes) {
    if (!isPlainObject(item)) return null;
    const rec = item as Record<string, unknown>;
    if (rec.entity_type !== 'Concept') return null;
    const slug = stringField(rec.entity_slug, 3, 60);
    const label = stringField(rec.entity_label, 1, 80);
    if (slug === null || label === null) return null;
    if (!/^[a-z0-9-]+$/.test(slug)) return null;
    if (seenSlugs.has(slug)) continue; // dedup within the payload
    seenSlugs.add(slug);
    nodes.push({
      entity_type: 'Concept',
      entity_slug: slug,
      entity_label: label,
      metadata: isPlainObject(rec.metadata) ? (rec.metadata as Record<string, unknown>) : undefined,
    });
  }

  const edges: ExtractedEdge[] = [];
  for (const item of rawEdges) {
    if (!isPlainObject(item)) return null;
    const rec = item as Record<string, unknown>;
    const fromType = stringField(rec.from_type, 1, 40);
    const fromSlug = stringField(rec.from_slug, 1, 256);
    const toType = stringField(rec.to_type, 1, 40);
    const toSlug = stringField(rec.to_slug, 1, 256);
    const rel = stringField(rec.relationship, 1, 40);
    if (fromType === null || fromSlug === null || toType === null || toSlug === null || rel === null) {
      return null;
    }
    if (!ALLOWED_RELATIONSHIPS.has(rel)) return null;
    let confidence: number | undefined;
    if (rec.confidence !== undefined && rec.confidence !== null) {
      const n = typeof rec.confidence === 'number'
        ? rec.confidence
        : typeof rec.confidence === 'string' ? Number(rec.confidence) : NaN;
      if (!Number.isFinite(n)) return null;
      confidence = Math.max(0, Math.min(1, n));
    }
    edges.push({
      from_type: fromType,
      from_slug: fromSlug,
      to_type: toType,
      to_slug: toSlug,
      relationship: rel,
      confidence,
      metadata: isPlainObject(rec.metadata) ? (rec.metadata as Record<string, unknown>) : undefined,
    });
  }

  return { nodes, edges };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringField(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  return trimmed;
}
