/**
 * RAG baseline non-regression test (Step 0 → applied to Steps 1, 3, 5).
 *
 * Scaffolded now; activates when:
 *   - `aisha/baselines/rag_eval_baseline_v1.json` is pinned (follow-up PR
 *     after first 7 days of nightly batches accumulate stable data)
 *   - AISHA_SKIP_ONLINE != '1' (online mode — uses live DB via RPC)
 *
 * Failure semantics:
 *   For each (context_profile_slug × embedding_model) bucket in the pinned
 *   baseline, compare against current `fn_get_rag_baseline()` output. Fail
 *   if `faithfulness_avg` dropped by more than DELTA (default 0.03) OR if
 *   the bucket is missing entirely from current output (suggests the eval
 *   pipeline silently stopped recording — worse than a metric drop).
 *
 * This is the regression gate Step 1 (contextual retrieval) and Step 3
 * (embedding model migration) measure against. Don't disable; fix the
 * underlying change.
 *
 * Online mode resolution:
 *   process.env.POSTGREST_URL              — base URL
 *   process.env.POSTGREST_SERVICE_TOKEN    — service-role JWT
 *   process.env.AISHA_SKIP_ONLINE          — set to '1' to skip
 *
 * Offline mode (AISHA_SKIP_ONLINE=1 OR no pinned baseline OR no env):
 *   The test still runs but only validates the baseline JSON shape (Zod).
 *   This protects against the pinned file being corrupted; the actual
 *   comparison is deferred until online.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { RagBaselineSchema } from '@/schemas/rpcResponseSchemas';

const BASELINE_PATH = resolve(process.cwd(), 'aisha/baselines/rag_eval_baseline_v1.json');
const DELTA_THRESHOLD = 0.03;

// Pinned baseline JSON shape — array of RagBaseline rows + provenance.
const PinnedBaselineFileSchema = z.object({
  version: z.literal(1),
  pinned_at: z.string(),
  pinned_by: z.string(),
  description: z.string().optional(),
  rows: z.array(RagBaselineSchema),
});

type PinnedBaselineFile = z.infer<typeof PinnedBaselineFileSchema>;

function hasPinnedBaseline(): boolean {
  return existsSync(BASELINE_PATH);
}

function loadPinnedBaseline(): PinnedBaselineFile {
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  return PinnedBaselineFileSchema.parse(raw);
}

async function fetchCurrentBaseline(): Promise<z.infer<typeof RagBaselineSchema>[]> {
  const url = process.env.POSTGREST_URL;
  const token = process.env.POSTGREST_SERVICE_TOKEN;
  if (!url || !token) {
    throw new Error('POSTGREST_URL / POSTGREST_SERVICE_TOKEN required for online regression check');
  }
  const res = await fetch(`${url.replace(/\/+$/, '')}/rpc/fn_get_rag_baseline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      p_profile_slug: null,
      p_embedding_model: null,
      p_period_hours: 168,
    }),
  });
  if (!res.ok) {
    throw new Error(`fn_get_rag_baseline returned ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('fn_get_rag_baseline did not return an array');
  }
  return data.map((row) => RagBaselineSchema.parse(row));
}

function bucketKey(row: { context_profile_slug: string | null; embedding_model: string }): string {
  return `${row.context_profile_slug ?? '(null)'}|${row.embedding_model}`;
}

describe('RAG baseline non-regression', () => {
  it('pinned baseline file is valid (Zod schema) when present', () => {
    if (!hasPinnedBaseline()) {
      // Scaffold mode — no pinned baseline yet. Mark as passing with a clear note.
      // This becomes a real assertion after the pinning PR.
      expect(hasPinnedBaseline()).toBe(false);
      return;
    }
    expect(() => loadPinnedBaseline()).not.toThrow();
  });

  const skipOnline = process.env.AISHA_SKIP_ONLINE === '1' || !hasPinnedBaseline();
  const itOnline = skipOnline ? it.skip : it;

  itOnline('current faithfulness_avg has not regressed > 0.03 from pinned baseline', async () => {
    const pinned = loadPinnedBaseline();
    const current = await fetchCurrentBaseline();

    const pinnedByBucket = new Map(pinned.rows.map((r) => [bucketKey(r), r]));
    const currentByBucket = new Map(current.map((r) => [bucketKey(r), r]));

    const regressions: Array<{ bucket: string; pinned: number; current: number | null; delta: number | null }> = [];
    const missing: string[] = [];

    for (const [bucket, pinnedRow] of pinnedByBucket) {
      const currentRow = currentByBucket.get(bucket);
      if (!currentRow) {
        missing.push(bucket);
        continue;
      }
      if (pinnedRow.faithfulness_avg === null) continue;
      if (currentRow.faithfulness_avg === null) {
        regressions.push({ bucket, pinned: pinnedRow.faithfulness_avg, current: null, delta: null });
        continue;
      }
      const delta = currentRow.faithfulness_avg - pinnedRow.faithfulness_avg;
      if (delta < -DELTA_THRESHOLD) {
        regressions.push({
          bucket,
          pinned: pinnedRow.faithfulness_avg,
          current: currentRow.faithfulness_avg,
          delta,
        });
      }
    }

    if (missing.length > 0 || regressions.length > 0) {
      const lines: string[] = [];
      if (missing.length > 0) {
        lines.push(`MISSING buckets (pinned but no current data): ${missing.join(', ')}`);
      }
      if (regressions.length > 0) {
        for (const r of regressions) {
          lines.push(
            `REGRESSION in ${r.bucket}: pinned=${r.pinned}, current=${r.current}, delta=${r.delta}`,
          );
        }
      }
      throw new Error(`RAG baseline regression detected:\n${lines.join('\n')}`);
    }

    expect(regressions).toHaveLength(0);
    expect(missing).toHaveLength(0);
  });
});
