const MAX_CHARS_PER_CHUNK = 8000;

/*
 * ⛔ Tenhle soubor se do 2026-09-13 jmenoval `openai-embeddings.ts` a nesl
 * `generateEmbeddings()` — backendKind natvrdo 'openai' a model z
 * `EMBEDDING_MODEL ?? 'text-embedding-3-small'` (1536 rozměrů). Zapisoval přitom do
 * `expert_rules.content_embedding` a `agent_memories.embedding`, které jsou
 * vector(1024): dráha pravidel tedy nemohla projít NIKDY a cold-start krok 6b na ní
 * závisel. Embedding teď vybírá resolver prostoru (embed-query-in-space.ts,
 * prostor v1) — týž, jakým se embeduje korpus i dotaz. Zůstává jen skládání textu.
 */

/**
 * Compose embedding text for an expert rule.
 */
export function composeRuleEmbeddingText(rule: {
  title: string;
  summary: string;
  body_markdown: string;
  ai_instructions: string | null;
  ai_context_tags: string[] | null;
}): string {
  const parts: string[] = [];
  parts.push(`# ${rule.title}`);
  parts.push(rule.summary);
  if (rule.ai_instructions) parts.push(`AI Instructions: ${rule.ai_instructions}`);
  if (rule.ai_context_tags?.length) parts.push(`Tags: ${rule.ai_context_tags.join(', ')}`);

  const remaining = MAX_CHARS_PER_CHUNK - parts.reduce((s, p) => s + p.length, 0) - 100;
  if (remaining > 500 && rule.body_markdown) {
    parts.push(rule.body_markdown.slice(0, remaining));
  }

  return parts.join('\n\n');
}
