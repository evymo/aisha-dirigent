#!/usr/bin/env node
// =============================================================================
// capture-baseline.mjs — Phase 12 WP 0.5 baseline capture
// =============================================================================
// Queries the production observability stack (Langfuse trace API + Prometheus)
// and writes a dated baseline snapshot to:
//
//   docs/perf/BASELINE_<YYYY-MM-DD>.md   — human-readable summary
//   docs/perf/baseline-<YYYY-MM-DD>.json — machine-readable structured
//
// Every subsequent Phase 12 WP (1.1 SSE, 1.2 PG tuning, 2.1 cache, 3.1 Qwen3,
// 4.1 critic loop, etc.) references this JSON for "before" numbers in their
// acceptance criteria. Without baseline = unmeasured ROI claims = ship blind.
//
// Per Phase 12 §-1.12 R1: Langfuse is the sole traces backend (Tempo
// eliminated). This script queries the Langfuse trace API rather than Tempo.
//
// SAFETY
// ------
// - Read-only HTTP fetches against Langfuse + Prometheus. No shell out.
// - No PII captured — only IDs, timestamps, counts, percentiles.
// - Postgres pg_stat_statements is captured via Prometheus (postgres_exporter
//   surfaces it as `pg_stat_statements_*` metrics — no direct psql shell-out).
// - Partial failure tolerant: if Langfuse is unreachable, captures Prometheus
//   only and notes the gap in the report.
//
// USAGE
// -----
//   node scripts/observability/capture-baseline.mjs
//
//   # Override the snapshot date (testing / backfill):
//   BASELINE_DATE=2026-05-20 node scripts/observability/capture-baseline.mjs
//
//   # Dry-run (queries everything, writes nothing):
//   BASELINE_DRY_RUN=1 node scripts/observability/capture-baseline.mjs
//
// ENV CONTRACT
// ------------
//   LANGFUSE_HOST            — http://langfuse-server:3000 (in-cluster default)
//   LANGFUSE_PUBLIC_KEY      — for Langfuse API Basic auth
//   LANGFUSE_SECRET_KEY      — for Langfuse API Basic auth
//   PROMETHEUS_URL           — http://prometheus:9090 (in-cluster default)
//   BASELINE_DATE            — override snapshot date (default: today UTC)
//   BASELINE_OUTPUT_DIR      — override output directory (default: docs/perf)
//   BASELINE_TRACE_SAMPLE    — number of recent traces to sample (default: 1000)
//   BASELINE_DRY_RUN         — '1' to skip writing files
// =============================================================================
import { writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const env = {
  langfuseHost: process.env.LANGFUSE_HOST ?? 'http://langfuse-server:3000',
  langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
  langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
  prometheusUrl: process.env.PROMETHEUS_URL ?? 'http://prometheus:9090',
  baselineDate:
    process.env.BASELINE_DATE ?? new Date().toISOString().slice(0, 10),
  outputDir:
    process.env.BASELINE_OUTPUT_DIR ?? join(REPO_ROOT, 'docs', 'perf'),
  traceSample: Number(process.env.BASELINE_TRACE_SAMPLE ?? '1000'),
  dryRun: process.env.BASELINE_DRY_RUN === '1',
};

const REPORT = {
  meta: {
    captured_at: new Date().toISOString(),
    baseline_date: env.baselineDate,
    trace_sample_size: env.traceSample,
    sources: {
      langfuse: env.langfuseHost,
      prometheus: env.prometheusUrl,
    },
  },
  kpis: {
    ttft_p95_ms: null,
    total_latency_p95_ms: null,
    postgres_rpc_p95_ms: null,
    embedding_p95_ms: null,
    retrieval_p95_ms: null,
    cache_hit_ratio_pct: null,
    llm_tokens_per_second: null,
    service_count: null,
    aitg_gate_pass_ratio: null,
    rag_faithfulness_evidence_strict: null,
    data_egress_llm_pct: null,
    critical_cves_open: null,
  },
  langfuse: {
    queryable: false,
    traces_sampled: 0,
    notes: [],
  },
  prometheus: {
    queryable: false,
    queries: {},
    notes: [],
  },
  workspaces: {
    note: 'Service count derived from filesystem scan of services/svc-*/Dockerfile presence — informational.',
    deployed_services: 0,
    detected: [],
  },
};

const log = (...args) => console.log('[baseline]', ...args);
const warn = (...args) => console.warn('[baseline:WARN]', ...args);

// ---------------------------------------------------------------------------
// Langfuse trace API
// ---------------------------------------------------------------------------
async function captureLangfuse() {
  if (!env.langfusePublicKey || !env.langfuseSecretKey) {
    REPORT.langfuse.notes.push(
      'LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set; skipping Langfuse capture.',
    );
    return;
  }
  const token = Buffer.from(
    `${env.langfusePublicKey}:${env.langfuseSecretKey}`,
  ).toString('base64');
  const auth = `Basic ${token}`;
  try {
    const url = `${env.langfuseHost.replace(/\/+$/, '')}/api/public/traces?limit=${env.traceSample}&orderBy=timestamp.desc`;
    const res = await fetch(url, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      REPORT.langfuse.notes.push(
        `Langfuse API ${res.status}: ${await res.text().catch(() => '(empty)')}`,
      );
      return;
    }
    const data = await res.json();
    REPORT.langfuse.queryable = true;
    REPORT.langfuse.traces_sampled = Array.isArray(data.data)
      ? data.data.length
      : 0;
    REPORT.langfuse.notes.push(
      'Span percentile aggregation TBD — Langfuse API requires per-trace observation fetch. Use Langfuse UI for ad-hoc percentile review; aggregator script lands in WP 0.5b.',
    );
  } catch (err) {
    REPORT.langfuse.notes.push(`Langfuse capture failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Prometheus
// ---------------------------------------------------------------------------
const PROM_QUERIES = {
  http_p95_ms:
    'histogram_quantile(0.95, sum by (le, route, service) (rate(aisha_request_duration_ms_bucket[24h])))',
  rpc_p95_ms:
    'histogram_quantile(0.95, sum by (le, rpc, service) (rate(aisha_rpc_duration_ms_bucket[24h])))',
  rps_top:
    'topk(10, sum by (service) (rate(aisha_request_duration_ms_count[5m])))',
  pg_conn_count: 'pg_stat_activity_count',
  pg_top_queries:
    'topk(10, pg_stat_statements_total_time_seconds)',
  pg_cache_hit_ratio:
    '100 * sum(rate(pg_stat_database_blks_hit[5m])) / (sum(rate(pg_stat_database_blks_hit[5m])) + sum(rate(pg_stat_database_blks_read[5m])))',
};

async function captureProm() {
  const url = env.prometheusUrl.replace(/\/+$/, '');
  let any = false;
  for (const [name, query] of Object.entries(PROM_QUERIES)) {
    try {
      const r = await fetch(
        `${url}/api/v1/query?query=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!r.ok) {
        REPORT.prometheus.notes.push(`${name}: HTTP ${r.status}`);
        continue;
      }
      const data = await r.json();
      REPORT.prometheus.queries[name] = data.data;
      any = true;
    } catch (err) {
      REPORT.prometheus.notes.push(`${name}: ${err.message}`);
    }
  }
  REPORT.prometheus.queryable = any;
}

// ---------------------------------------------------------------------------
// Service facts (filesystem scan, no shell)
// ---------------------------------------------------------------------------
async function captureWorkspaceFacts() {
  try {
    const servicesDir = join(REPO_ROOT, 'services');
    const entries = await readdir(servicesDir);
    const deployed = [];
    for (const name of entries) {
      if (!name.startsWith('svc-') && name !== 'gateway' && name !== 'ws-gateway' && name !== 'storage-auth' && name !== 'event-worker') {
        continue;
      }
      const dockerfilePath = join(servicesDir, name, 'Dockerfile');
      // Detect Dockerfile presence by attempting stat; fall through silently
      // when the file is missing (workspace-only packages without an image),
      // and only re-throw genuine I/O errors so they bubble to the caller.
      try {
        await stat(dockerfilePath);
        deployed.push(name);
      } catch (statErr) {
        if (statErr.code !== 'ENOENT') throw statErr;
      }
    }
    REPORT.workspaces.deployed_services = deployed.length;
    REPORT.workspaces.detected = deployed;
  } catch (err) {
    REPORT.workspaces.note += ` (scan failed: ${err.message})`;
  }
}

// ---------------------------------------------------------------------------
// Markdown report renderer
// ---------------------------------------------------------------------------
function renderMarkdown() {
  const d = env.baselineDate;
  const lf = REPORT.langfuse.queryable ? '✅ queryable' : '❌ unreachable';
  const prom = REPORT.prometheus.queryable ? '✅ queryable' : '❌ unreachable';

  const promQueriesSummary = Object.entries(REPORT.prometheus.queries)
    .map(([k, v]) => {
      const count = v?.result?.length ?? 0;
      return `  - \`${k}\` → ${count} time-series`;
    })
    .join('\n') || '  _(no successful Prometheus queries)_';

  return `# Performance Baseline — Snapshot ${d}

> Captured by \`scripts/observability/capture-baseline.mjs\` at ${REPORT.meta.captured_at}.
> Every subsequent Phase 12 WP (SSE, PG tuning, caching, embeddings, critic loop) MUST
> reference this baseline JSON for "before" numbers in its acceptance criteria.

## Source availability

| Source | Status |
|---|---|
| Langfuse trace API | ${lf} |
| Prometheus | ${prom} |
| Postgres metrics (via postgres_exporter on Prometheus) | derived from Prom |
| Service-count facts | ${REPORT.workspaces.deployed_services} services with Dockerfile |

## KPI baseline (Phase 12 §0.4 — fill from captured data)

| Metric | Baseline (${d}) | 90-day target |
|---|---|---|
| TTFT p95 (chat) | ${REPORT.kpis.ttft_p95_ms ?? 'TBD — see notes'} | < 300 ms |
| Total latency p95 (10-token reply) | ${REPORT.kpis.total_latency_p95_ms ?? 'TBD'} | 1500 ms |
| Postgres RPC p95 | ${REPORT.kpis.postgres_rpc_p95_ms ?? 'TBD'} | < 50 ms |
| Embedding latency p95 | ${REPORT.kpis.embedding_p95_ms ?? 'TBD'} | 10-20 ms |
| Retrieval p95 (hybrid+contextual) | ${REPORT.kpis.retrieval_p95_ms ?? 'TBD'} | < 150 ms |
| Cache hit ratio (Redis) | ${REPORT.kpis.cache_hit_ratio_pct ?? '0%'} | ≥ 50 % |
| LLM tokens/sec/user | ${REPORT.kpis.llm_tokens_per_second ?? 'TBD'} | 80+ |
| Service count | ${REPORT.workspaces.deployed_services} | ≤ 20 |
| AITG gate pass | ${REPORT.kpis.aitg_gate_pass_ratio ?? '32/32'} | 32/32 maintained |
| RAG faithfulness (evidence_strict) | ${REPORT.kpis.rag_faithfulness_evidence_strict ?? 'TBD'} | ≥ 0.85 |
| Data egress LLM/embed | ${REPORT.kpis.data_egress_llm_pct ?? '~100%'} | < 10 % |
| Open critical CVEs (Trivy) | ${REPORT.kpis.critical_cves_open ?? 'TBD'} | 0 |

## Captured Prometheus queries

${promQueriesSummary}

## Capture procedure

1. Verify Phase 12 WP 0.1 OTel instrumentation is live on all services (gate
   \`wp-0-1-otel-bootstrap.gate.test.ts\` green).
2. Wait until Phase 12 WP 0.2 (Loki + Prometheus + Grafana) is deployed and
   has at least 24 h of recorded data.
3. Drive synthetic traffic: as admin, run 50× "chat with knowledge" workflow
   to populate Langfuse + Prometheus with representative spans.
4. Wait 5 minutes (Prometheus scrape interval grace) then run:
   \`\`\`
   node scripts/observability/capture-baseline.mjs
   \`\`\`
5. Manually fill any \`TBD\` KPI cells from the corresponding source UI:
   - TTFT / total latency → Langfuse UI percentile filter on \`chat.turn\` traces
   - Postgres RPC p95 → Grafana "Postgres" dashboard (WP 0.2 dashboard)
   - Embedding latency → Langfuse \`embedding.generate\` span p95
   - RAG faithfulness → \`SELECT AVG(faithfulness) FROM rag_eval_runs WHERE profile_id = (SELECT id FROM context_profiles WHERE name='evidence_strict') AND run_ts > NOW() - INTERVAL '7 days';\`
   - Open critical CVEs → \`mc cat aisha/sbom-artifacts/<latest>.cdx.json | grep -c '"severity":"critical"'\` (post WP 3.8)

## Notes from this run

### Langfuse
${REPORT.langfuse.notes.length === 0 ? '_(no notes)_' : REPORT.langfuse.notes.map((n) => `- ${n}`).join('\n')}

### Prometheus
${REPORT.prometheus.notes.length === 0 ? '_(no notes)_' : REPORT.prometheus.notes.map((n) => `- ${n}`).join('\n')}

### Detected services
${REPORT.workspaces.detected.length === 0 ? '_(none detected)_' : REPORT.workspaces.detected.map((s) => `- \`${s}\``).join('\n')}

## Refresh cadence

- Re-capture at the end of every phase (Phase 0/1/2/3/4) → \`POST_PHASE_<N>_${d}.md\`.
- Old snapshots are NOT deleted — dated-snapshot pattern from Phase 11 docs.

---

_Machine-readable JSON: \`baseline-${d}.json\` (in same directory)._
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log(`Capturing baseline for ${env.baselineDate}`);
  log(`Langfuse: ${env.langfuseHost}`);
  log(`Prometheus: ${env.prometheusUrl}`);

  await Promise.allSettled([
    captureLangfuse(),
    captureProm(),
    captureWorkspaceFacts(),
  ]);

  if (env.dryRun) {
    log('Dry-run: not writing files');
    console.log(JSON.stringify(REPORT, null, 2));
    return;
  }

  await mkdir(env.outputDir, { recursive: true });
  const jsonPath = join(env.outputDir, `baseline-${env.baselineDate}.json`);
  const mdPath = join(
    env.outputDir,
    `BASELINE_${env.baselineDate}.md`,
  );
  await writeFile(jsonPath, JSON.stringify(REPORT, null, 2));
  await writeFile(mdPath, renderMarkdown());

  log(`Wrote ${jsonPath}`);
  log(`Wrote ${mdPath}`);
  if (
    !REPORT.langfuse.queryable &&
    !REPORT.prometheus.queryable
  ) {
    warn(
      'Both Langfuse and Prometheus unreachable. Baseline file written with placeholders only.',
    );
    warn(
      'Run again from inside the cluster (e.g. via Coolify task) once Phase 0 stack is live.',
    );
  }
}

main().catch((err) => {
  console.error('[baseline:FATAL]', err);
  process.exit(1);
});
