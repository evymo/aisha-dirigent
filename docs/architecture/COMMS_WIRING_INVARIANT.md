# Comms-wiring self-consistency invariant

**Invariant:** every cross-component communication binding has both a producer
and a consumer. A Postgres channel that is `NOTIFY`-ed must be `LISTEN`-ed; a
channel that is `LISTEN`-ed must be `NOTIFY`-ed; a statically-named Redis
subscription must have a publisher.

## Why this exists

AISHA's event fabric is wired by **name** across three unrelated source trees:

| Binding side | Where it lives | Form |
|---|---|---|
| Postgres NOTIFY producers | `aisha/db/sql/**` | `pg_notify('<chan>', …)` in SQL functions |
| Postgres LISTEN consumers | `services/event-worker/src/config.ts` | the `pgChannels: […]` array (the only runtime LISTENer) |
| Redis channels | the services | inline string literals / prefix constants |

Nothing type-checks those names against each other. A channel can be emitted
with **no listener** (the `NOTIFY` is dropped by Postgres) or listened-for with
**no emitter** (a dead subscription that never fires) and every unit test still
passes. This is the class of "silently dead wire" the 2026-07 application-flow
map surfaced ([`APPLICATION_FLOW_MAP.md`](./APPLICATION_FLOW_MAP.md)): the DB
emits 8 NOTIFY channels, event-worker LISTENs on 5, and their intersection is a
single channel — `agent_run_queued`.

Prose docs that record this rot the moment code changes. So the knowledge is
moved into a **script that fails CI**.

## How it is enforced

- **Scanner** — [`scripts/lib/comms-wiring.mjs`](../../scripts/lib/comms-wiring.mjs)
  derives the current binding graph from source (SoT trees only, never `dist/`)
  and intersects producers with consumers.
- **Baseline** — [`config/comms-wiring.baseline.json`](../../config/comms-wiring.baseline.json)
  enumerates every *known* orphan with a `tracking` reference and a `reason`.
- **Gate** — `src/tests/gates/comms-wiring-consistency.gate.test.ts` holds the
  scan against the baseline **in both directions**:
  - a **new** orphan not in the baseline → **fail** ("wire it, or record it with
    a tracking reference"). Drift is caught by a script, not a reviewer's
    attention span.
  - a baselined orphan that is **no longer** orphaned → **fail** (it got wired,
    so the baseline must shrink). The debt **ratchets down**; it never silently
    lingers.
  - every binding the baseline names must still resolve to real source (no stale
    paths / renamed channels).

## Working with the gate

- **You wired a channel** (added the missing producer/consumer): remove its entry
  from the baseline. The gate will otherwise fail — that is the ratchet working.
- **You added a new channel** and cannot wire both ends in this change: add a
  baseline entry with a real `tracking` reference (an issue / a `NEXT_STEPS.md`
  item) and a `reason`. Silencing a break with no reason defeats the gate.
- **The gate reports a stale entry**: the cited file no longer emits/listens the
  channel — fix the path or drop the entry.

## Scope and the wider dead-wire program

This gate covers the **name-orphan** class (producer/consumer set mismatch). The
flow map also records **transport** failures that are not name-orphans and are
tracked separately in [`../remediation/NEXT_STEPS.md`](../remediation/NEXT_STEPS.md)
(P0-C): the `pg_net → n8n / edge-fn` bridge is inert (extension unprovisioned +
base-URL GUCs unset), and the browser realtime rail (B8) is broken at the
protocol/frame layer between `@aisha/api-core`, `ws-gateway`, and the gateway
realtime route. Fixing those is the remediation program; this gate makes sure no
*new* dead wire is added while that work proceeds.
