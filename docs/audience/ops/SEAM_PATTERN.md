# The Seam — integration-boundary pattern (engineering)

How the broker connects an external data source (source-api, and any future
source) to the aisha audience module as a **first-class architectural boundary**,
not an ad-hoc integration. Canonical name: **Anti-Corruption Layer (ACL)**.

## Why "seam", not "integration"

- An **integration** is "I connected two systems" — implicit, brittle, breaks
  silently when either side changes.
- A **seam** is "I defined a versioned boundary that tolerates independent
  evolution of both sides." When the source changes, the seam either keeps
  working (change is contract-compatible) or **fails loud at the boundary** —
  never silently three layers downstream as an empty dashboard.

The audience module on aisha is meant to be a template for N future sources, so the boundary
must be a reusable seam, not a source one-off.

## Nine properties of a well-built seam

| # | Property | Status | Where |
|---|---|---|---|
| 1 | **Contract, not coupling** — depend on a declared contract, not implicit foreign-schema knowledge | ✅ | `contracts/source-contract.ts` |
| 2 | **ACL isolation** — foreign vocabulary never leaks past the broker; one place holds the source schema | ✅ | `SOURCE_CONTRACT` + `clients/source-pg.ts` queries |
| 3 | **Bi-temporal cursor** — source event-time vs ingest-time; overlap window for late arrivals | ✅ | `scheduler.ts` `CURSOR_OVERLAP_MS` |
| 4 | **Drift detection (canary)** — assert the contract before reading; refuse to write on hard drift | ✅ | `contracts/drift-canary.ts` |
| 5 | **Idempotency + at-least-once** — tolerate replay (lets the overlap window be safe) | ✅ | `external_id` dedup + `ON CONFLICT` upsert |
| 6 | **Backpressure / circuit breaking** | ✅ | scheduler circuit breaker + 120s timeout |
| 7 | **Observability AT the seam** — drift status + row-delta anomaly surfaced | ✅ | `/sync/scheduler/status` → `state.contractOk`, `lastDriftSummary`, `rowDeltaAnomaly` |
| 8 | **Least-privilege blast radius** | ✅ | readonly role (source) ↔ EXECUTE-only RPC (aisha) |
| 9 | **Provider-independence** — contract + canary generic, reusable per source | ✅ | `SourceContract` shape + generic `verifyContract()` |

## The drift canary (property 4)

The change-resilience guard. Runs at **startup** (`server.ts`) and **before every
sync tick** (`scheduler.ts` `runOnceInternal`) and on **manual `/sync/run`**.

Three drift modes:
- **MISSING TABLE / MISSING COLUMN** → *hard drift*. The broker refuses to sync:
  doesn't advance the cursor, doesn't write zeros over good aisha data, throws
  `ContractDriftError`, records it, opens the circuit on repeat. Manual route
  returns 409 (override with `?force=true`).
- **TYPE MISMATCH** → *soft drift*. Warn and proceed (varchar↔text etc. are
  benign; a genuinely breaking type change surfaces as a query error which the
  scheduler already records).

Why this matters: without the canary, a source rename `last_activity →
last_active_at` makes queries return NULL → engagement collapses to zero → no
error → the marketer's dashboard silently shows everyone as inactive. The canary
converts that silent data-corruption into a loud, actionable failure **at the
seam**.

```
source schema drift
   → canary (before read)
   → hard drift detected
   → DON'T advance cursor, DON'T write zeros
   → log + record + (repeat) open circuit
   → /sync/scheduler/status shows contractOk=false, lastDriftSummary="..."
```

## The cursor overlap window (property 3)

The seam crosses two clocks: the source's **event time** (`last_activity`) and
the broker's **ingest time** (`computed_at`). The cursor advances on ingest time
but filters on event time. An update that arrives with a *backdated* event time
between syncs would be missed by a strict cursor.

Fix: re-scan a small overlap (`CURSOR_OVERLAP_MS = 5min`) before the last cursor
position. The idempotent upsert (property 5) absorbs the redundant rows
harmlessly — the overlap is cheap *precisely because* ingestion is idempotent.

## Adding a new source (the payoff)

Because the contract + canary + cursor + idempotency + observability are generic,
a new source (Salesforce, HubSpot) needs only:

1. A `SourceContract` declaring its tables/columns (like `SOURCE_CONTRACT`).
2. A client with the source-specific aggregation SQL (like `source-pg.ts`) +
   a `verifyContract()` method that calls the generic canary with its contract.
3. A `source_slug` for its row in `audience_broker_sync_state`.

Everything else — drift detection, cursor discipline, circuit breaking,
least-privilege, seam metrics — is inherited. That is the difference between a
reusable seam and a per-source integration.

## What the canary does NOT cover

- **Semantic drift** — a column keeps its name+type but changes *meaning*
  (e.g. `last_activity` starts counting background pings). The canary can't see
  this; the **row-delta anomaly** metric (property 7) is the weak signal —
  a sudden jump/drop in fetched rows warrants a human look.
- **Provider-side deletes** — a hard-deleted source row leaves a stale aisha
  aggregate (we only upsert, never delete). Acceptable for engagement metrics
  (they decay); revisit if exact deletes matter.
