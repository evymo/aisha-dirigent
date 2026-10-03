/**
 * Ragnarok HTTP proxy klient — shim forwarduje RAG calls přímo na Ragnarok,
 * skipuje Kronos KB metadata layer (AISHA má KB v knowledge_items.story_id +
 * Ragnarok ES, ne v Kronos Mongo).
 */
import { config } from '../config.js';

interface RagnarokRagPayload {
  query: string;
  kb_ids?: string[] | null;
  lang?: string | null;
  return_highlights?: boolean;
  return_matched_chunks?: boolean;
  // Maestro občas posílá k_emb / k_bm25 — Ragnarok přijme top_n_count + sám rozdělí.
  top_n_count?: number;
}

export async function ragnarokRagSync(
  projectId: string,
  payload: RagnarokRagPayload,
  sessionId?: string | null,
): Promise<Record<string, unknown>> {
  const url = `${config.ragnarokUrl}/projects/${encodeURIComponent(projectId)}/nlp/rag/${
    sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
  }`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': config.ragnarokApiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(empty)');
    throw new Error(`Ragnarok rag failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * Stream variant — vrací Web ReadableStream, který shim forwarduje klientovi
 * (Maestro) jako NDJSON pass-through.
 */
export async function ragnarokRagStream(
  projectId: string,
  payload: RagnarokRagPayload,
  sessionId?: string | null,
): Promise<ReadableStream<Uint8Array>> {
  const url = `${config.ragnarokUrl}/projects/${encodeURIComponent(projectId)}/nlp/rag/stream${
    sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
  }`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': config.ragnarokApiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) {
    const text = res.body ? await res.text().catch(() => '(empty)') : '(no body)';
    throw new Error(`Ragnarok rag stream failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.body;
}
