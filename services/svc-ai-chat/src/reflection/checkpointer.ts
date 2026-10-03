import { updateRow, rpc } from './postgrest.js';
import { estimateCostUsd } from '../lib/costAggregator.js';
import type { RunCheckpoint, RunRecord } from './types.js';

/**
 * Postgres-backed checkpointer.
 * State lives in ai_runs.metadata.checkpoint. Each node transition writes
 * an atomic UPDATE so that crashes can resume from last completed node.
 */

export async function loadRun(runId: string): Promise<RunRecord | null> {
  const rows = await rpc<RunRecord[]>('fn_get_run', { p_run_id: runId }).catch(() => null);
  if (Array.isArray(rows) && rows.length > 0) return rows[0];

  // Fallback: PostgREST direct select via filter (requires GRANT SELECT on ai_runs to service_role)
  const url = new URL('/ai_runs', 'http://placeholder');
  const queryRes = await fetchAiRun(runId);
  return queryRes;
}

async function fetchAiRun(runId: string): Promise<RunRecord | null> {
  const { reflectionConfig: config } = await import('./config.js');
  const res = await fetch(
    `${config.postgrestUrl}/ai_runs?id=eq.${encodeURIComponent(runId)}&select=*`,
    {
      headers: {
        Authorization: `Bearer ${config.postgrestServiceToken}`,
        Accept: 'application/json',
      },
    },
  );
  if (!res.ok) return null;
  const arr = (await res.json()) as RunRecord[];
  return arr[0] ?? null;
}

export async function saveCheckpoint(
  runId: string,
  checkpoint: RunCheckpoint,
  status?: RunRecord['status'],
): Promise<void> {
  // Read current metadata, merge checkpoint, write back atomically.
  // PostgREST doesn't support JSONB deep merge directly; we re-read then write.
  // For atomicity, we use RPC if available, else accept best-effort.
  const run = await fetchAiRun(runId);
  if (!run) throw new Error(`Run ${runId} not found while checkpointing`);

  const metadata = { ...run.metadata, checkpoint };

  const patch: Record<string, unknown> = { metadata };
  if (status) patch.status = status;
  if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'blocked') {
    patch.finished_at = new Date().toISOString();
  }

  await updateRow('ai_runs', { id: runId }, patch);
}

export async function appendCost(
  runId: string,
  delta: {
    usd?: number;
    tokens_input?: number;
    tokens_output?: number;
    /** Prompt-cache READ tokens (Anthropic cache_read_input_tokens) — billed at the cached rate (odysseus G1). */
    tokens_cache_read?: number;
    /** Prompt-cache WRITE/creation tokens — billed at the write rate. */
    tokens_cache_write?: number;
    provider?: string;
    model?: string;
  },
): Promise<void> {
  const run = await fetchAiRun(runId);
  if (!run) return;

  const cacheRead = delta.tokens_cache_read ?? 0;
  const cacheWrite = delta.tokens_cache_write ?? 0;

  // USD is the canonical metric persisted under `total_usd` (the key the reader,
  // the board aggregate, and finish_ai_run all expect). When the caller doesn't
  // supply an explicit cost, derive it from tokens × model pricing so reflection
  // runs persist real dollars instead of zero. Prompt-cache read/write tokens are
  // billed at the cached/write rate so cache hits show the real (~−90 %) savings.
  const usd =
    delta.usd ??
    estimateCostUsd(delta.model ?? '', delta.tokens_input ?? 0, delta.tokens_output ?? 0, {
      read: cacheRead,
      write: cacheWrite,
    });

  const current = (run.cost_total_json ?? {}) as Record<string, number>;
  const merged: Record<string, number> = {
    total_usd: (current.total_usd ?? 0) + usd,
    tokens_input: (current.tokens_input ?? 0) + (delta.tokens_input ?? 0),
    tokens_output: (current.tokens_output ?? 0) + (delta.tokens_output ?? 0),
  };
  // Only persist cache counters once they actually occur, to avoid churning the
  // JSON for every legacy (non-cached) call.
  if (cacheRead || current.tokens_cache_read) {
    merged.tokens_cache_read = (current.tokens_cache_read ?? 0) + cacheRead;
  }
  if (cacheWrite || current.tokens_cache_write) {
    merged.tokens_cache_write = (current.tokens_cache_write ?? 0) + cacheWrite;
  }

  await updateRow('ai_runs', { id: runId }, { cost_total_json: merged });
}
