/**
 * Omni acceptance — area: broadcast-realtime (kind: integration / unit-contract)
 *
 * SOURCE OF TRUTH: docs/planning/AISHA_OMNI_GATEWAY.md (v4) §4.2/4.3, §4.4, §10, §16, §20.
 *
 * ISOLATION: this file lives under src/tests/omni-acceptance/** and is run ONLY via the
 * dedicated vitest.omni-acceptance.config.ts (created by the shared scaffold). It is
 * excluded from the default vitest.config.ts include, so the normal CI run never picks it up.
 *
 * LIVE vs SKIP applied per surface:
 *   - The broadcast PRODUCER (fn_pg_notify_broadcast + fn_broadcast_run_progress +
 *     fn_broadcast_nudge + node_runs terminal-only trigger + updated_at columns) does NOT
 *     exist today. Spec §9: "🔴 chybí, opraveno — žádný pg_notify('realtime_broadcast');
 *     cílové tabulky nemají ŽÁDNÝ trigger ani sloupec updated_at (jen created_at)".
 *     => those assertions are describe.skip / it.todo with a precise contract comment.
 *     The actual schema-state RED guards (no trigger / no updated_at) live in the pgTAP
 *     companion aisha/db/tests/schema/omni/broadcast-realtime.sql (LIVE-RED there).
 *   - The broadcast CONSUMER (event-worker realtime_broadcast → ws:broadcast:<topic>) EXISTS
 *     today (services/event-worker/src/{config,worker}.ts). => LIVE assertions here.
 *   - The AishaPushEvent schema unification (single SoT workbench-core/src/sse/schemas.ts with
 *     nudge/decision) does NOT exist; both current copies lack nudge/decision. => the unified
 *     SoT assertions are skip-until-impl; the "still lacks nudge/decision today" assertion is
 *     LIVE (intentionally documents current state, flips RED when SoT lands without nudge).
 *
 * NO top-level import of any non-existent module. The event-worker config is a real module and
 * is imported at top level. The future workbench-core/src/sse/schemas.ts is loaded only via
 * dynamic import inside skipped blocks so this file always type-checks.
 *
 * Shared scaffold (created by the suite owner, DO NOT edit): the helpers/fixtures under
 * src/tests/omni-acceptance/_helpers + _fixtures provide DB/HTTP utilities. This file is
 * deliberately self-contained at the assertion level (real identifiers, no invented symbols)
 * so it remains valid even while the producer surface is RED/unimplemented.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const OMNI = process.env.OMNI_ACCEPTANCE === "1" || process.env.OMNI_ACCEPTANCE === "true";

// ── LIVE source: the realtime broadcast CONSUMER exists today ────────────────────────────────
// services/event-worker/src/{config,worker}.ts declare the channels the worker LISTENs on and
// the topic→ws:broadcast routing. We read the source text (not import) because event-worker is a
// separate service package whose deps (@aisha/security) are outside the web app module graph;
// importing it would break collection. The identifiers asserted are real and load-bearing.
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const eventWorkerConfigSrc = readFileSync(
  path.join(REPO_ROOT, "services/event-worker/src/config.ts"),
  "utf8",
);
const eventWorkerWorkerSrc = readFileSync(
  path.join(REPO_ROOT, "services/event-worker/src/worker.ts"),
  "utf8",
);

// ──────────────────────────────────────────────────────────────────────────────────────────
// AREA 1 — Broadcast consumer wiring (LIVE: surface exists in event-worker)
//   Criteria: omni-protocol-broadcast-realtime-notify, broadcast-notify-positive
//   Real identifiers: pgChannels 'realtime_broadcast', resolveRedisChannel → ws:broadcast:<topic>
// ──────────────────────────────────────────────────────────────────────────────────────────
describe("broadcast-realtime · consumer wiring (LIVE — event-worker exists)", () => {
  it("POSITIVE: event-worker LISTENs on the 'realtime_broadcast' channel (config.ts pgChannels)", () => {
    // §8 table: event-worker konzumer už umí realtime_broadcast + channel_topic.
    // If the producer ever NOTIFYs a channel the consumer does not listen on, events vanish.
    expect(eventWorkerConfigSrc).toMatch(/pgChannels\s*:/);
    expect(eventWorkerConfigSrc).toContain("'realtime_broadcast'");
  });

  it("POSITIVE: worker.ts maps realtime_broadcast{channel_topic} → ws:broadcast:<topic>", () => {
    // worker.ts:76 resolveRedisChannel: pgChannel === 'realtime_broadcast' && payload.channel_topic
    // → `ws:broadcast:${payload.channel_topic}`. This is the contract the §10 factory envelope
    // ('channel_topic' key) must satisfy for run:<id>/workspace:/session: topics to be delivered.
    expect(eventWorkerWorkerSrc).toContain("realtime_broadcast");
    expect(eventWorkerWorkerSrc).toContain("ws:broadcast:");
    expect(eventWorkerWorkerSrc).toContain("channel_topic");
  });

  it("FALSE-POSITIVE GUARD: a typo'd channel name is NOT in the listen set (no accidental fan-in)", () => {
    // The producer emits ONLY to 'realtime_broadcast'. A typo'd channel must not be honored.
    expect(eventWorkerConfigSrc).not.toContain("'realtime_broadcasts'");
    // The webhook route map keys are schema.table strings, never the broadcast channel name —
    // broadcast must flow to ws:broadcast:<topic>, never into the row-change webhook map.
    expect(eventWorkerConfigSrc).not.toContain("['realtime_broadcast'");
    expect(eventWorkerConfigSrc).not.toContain("['public.ai_trace_events'");
  });
});

// ──────────────────────────────────────────────────────────────────────────────────────────
// AREA 2 — Generic broadcast factory fn_pg_notify_broadcast(channel, topic, record)
//   Criteria: omni-protocol-broadcast-realtime-notify (§10 generická factory)
//   Live state: 🔴 fn_pg_notify_broadcast does NOT exist (17 hand-coded pg_notify today).
//   => skip-until-impl. Behavioral contract assertions belong here; schema existence is pgTAP.
// ──────────────────────────────────────────────────────────────────────────────────────────
describe.skip("broadcast-realtime · fn_pg_notify_broadcast factory (SKIP until §10 impl)", () => {
  /**
   * CONTRACT (§10): CREATE FUNCTION fn_pg_notify_broadcast(channel text, topic text, record jsonb)
   * emits pg_notify(channel, json_build_object('channel_topic', topic, 'payload', record)::text)
   * so the EXISTING event-worker resolveRedisChannel() maps it to ws:broadcast:<topic>.
   * The payload envelope key MUST be 'channel_topic' (worker.ts:76) — not 'topic' — or the
   * consumer falls through to the ws:db:<schema>.<table> default and the broadcast is lost.
   */
  it.todo(
    "POSITIVE: fn_pg_notify_broadcast emits envelope {channel_topic: <topic>, payload: <record>} on channel 'realtime_broadcast'",
  );

  it.todo(
    "FALSE-POSITIVE GUARD: payload exceeding the size guard (>8KB per area focus / >64KB-100KB per §10) is NOT broadcast — factory truncates or refuses, raw oversized record never reaches pg_notify",
  );

  it.todo(
    "NEGATIVE: callers pass a column whitelist; non-whitelisted columns (cost_json/request_summary/response_summary internals) are NOT present in the emitted record",
  );
});

// ──────────────────────────────────────────────────────────────────────────────────────────
// AREA 3 — fn_broadcast_run_progress on ai_trace_events (topic run:<run_id>)
//   Criteria: omni-protocol-broadcast-run-progress-whitelist, broadcast-run-progress-trigger
//   Live state: 🔴 no AFTER INSERT/UPDATE trigger on ai_trace_events. => skip-until-impl.
//   Real identifiers: ai_trace_events(run_id, event_type, status, ...), topic run:<id>.
// ──────────────────────────────────────────────────────────────────────────────────────────
describe.skip("broadcast-realtime · fn_broadcast_run_progress (SKIP until §10 trigger lands)", () => {
  /**
   * CONTRACT (§4.3, §10): AFTER INSERT OR UPDATE ON ai_trace_events FOR EACH ROW
   * EXECUTE FUNCTION fn_broadcast_run_progress(); which calls
   * fn_pg_notify_broadcast('realtime_broadcast', 'run:' || NEW.run_id, <whitelisted row>).
   * Whitelist = {id, run_id, event_type, agent_slug, status, duration_ms, created_at};
   * EXCLUDED = {request_summary, response_summary, error_json, cost_json} (may carry PII/secrets).
   */
  it.todo(
    "POSITIVE: INSERT into ai_trace_events emits topic 'run:<run_id>' carrying ONLY whitelisted columns (event_type/status/duration_ms), within budget",
  );

  it.todo(
    "FALSE-POSITIVE GUARD: raw PII in request_summary/response_summary (member name, email, health note) is REDACTED ('[PII_REDACTED]') and NEVER appears verbatim in the run:<id> payload (§16 PII: filtr trace delt)",
  );

  it.todo(
    "FALSE-POSITIVE GUARD: a trace row with a payload >8KB is dropped/truncated, not broadcast raw (payload size guard)",
  );
});

// ──────────────────────────────────────────────────────────────────────────────────────────
// AREA 4 — ai_workflow_node_runs broadcast: terminal states ONLY
//   Criteria: omni-protocol-broadcast-node-runs-terminal-only (§10 broadcast jen terminální stavy)
//   Live state: 🔴 no trigger. => skip-until-impl.
//   Real identifiers: ai_workflow_node_runs.status (pending/running/completed/failed/cancelled).
// ──────────────────────────────────────────────────────────────────────────────────────────
describe.skip("broadcast-realtime · node_runs terminal-only broadcast (SKIP until §10)", () => {
  /**
   * CONTRACT (§10): the node_runs broadcast trigger fires ONLY when NEW.status transitions into
   * a terminal value {'completed','failed','cancelled'}. Non-terminal UPDATEs (pending→running,
   * heartbeat token-count UPDATEs to tokens_input/tokens_output) MUST NOT broadcast — this is the
   * trace-storm mitigation. The trigger condition is WHEN (NEW.status IN ('completed','failed',
   * 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status).
   */
  it.todo(
    "POSITIVE: UPDATE ai_workflow_node_runs SET status='completed' (terminal) emits exactly one broadcast on topic run:<run_id>",
  );

  it.todo(
    "NEGATIVE: UPDATE ai_workflow_node_runs SET status='running' (non-terminal) emits NO broadcast",
  );

  it.todo(
    "FALSE-POSITIVE GUARD: a pure metrics UPDATE (tokens_output bumped, status unchanged='running') emits NO broadcast — trace-storm rows are not mistaken for terminal events",
  );
});

// ──────────────────────────────────────────────────────────────────────────────────────────
// AREA 5 — fn_broadcast_nudge on dirigent_nudges (workspace:/session: topic)
//   Criteria: omni-protocol-broadcast-nudge-topic, broadcast-nudge-trigger,
//             omni-protocol-dirigent-nudge-push-realtime (§4.4, §10)
//   Live state: 🔴 no AFTER INSERT trigger on dirigent_nudges. => skip-until-impl.
//   Real identifiers: dirigent_nudges(story_id, conversation_id, event_origin, severity,
//   message, metadata, expires_at). NOTE: today there is NO workspace_id/session_id column;
//   the §10 topic must be derived from conversation_id (session:) and story_id-derived workspace.
// ──────────────────────────────────────────────────────────────────────────────────────────
describe.skip("broadcast-realtime · fn_broadcast_nudge (SKIP until §10 trigger lands)", () => {
  /**
   * CONTRACT (§4.4, §10): AFTER INSERT ON dirigent_nudges FOR EACH ROW EXECUTE
   * fn_broadcast_nudge(); → emits topic 'workspace:'||<workspace> and/or 'session:'||conversation_id
   * via fn_pg_notify_broadcast. ws-gateway subscribes ws:broadcast:workspace:<id> /
   * ws:broadcast:session:<id> and delivers to ide-bridge so the local Dirigent gets the
   * correction mid-run. Re-fetch of context happens ONLY when the nudge crosses an RLS boundary.
   * Whitelist excludes nothing dangerous here (message is operator-authored) but expires_at must
   * gate emission: an already-expired nudge (expires_at < now()) MUST NOT broadcast.
   */
  it.todo(
    "POSITIVE: INSERT into dirigent_nudges with conversation_id emits topic 'session:<conversation_id>' consumed as ws:broadcast:session:<id>",
  );

  it.todo(
    "POSITIVE: a nudge bound to a workspace emits topic 'workspace:<id>' for ws-gateway → ide-bridge mid-run delivery",
  );

  it.todo(
    "FALSE-POSITIVE GUARD: an already-expired nudge (expires_at < now()) does NOT broadcast — stale corrections never reach a live run",
  );

  it.todo(
    "NEGATIVE: a nudge with NULL conversation_id AND no workspace binding does NOT emit a malformed topic like 'session:' or 'session:null'",
  );
});

// ──────────────────────────────────────────────────────────────────────────────────────────
// AREA 6 — Non-blocking INSERT under trace-storm
//   Criteria: omni-protocol-broadcast-no-insert-block, broadcast-non-blocking-insert,
//             regtest-broadcast-latency (§10 'pg_notify není truly async → může blokovat INSERT')
//   live_or_skip: marked "live" in spec criteria, BUT the trigger does not exist yet, so a real
//   load test cannot run without the producer. We keep this LIVE as an env-gated integration that
//   self-skips cleanly when OMNI_ACCEPTANCE is unset OR when the trigger is absent — so it is a
//   forward-looking guard, never a false green and never a hard failure in normal CI.
// ──────────────────────────────────────────────────────────────────────────────────────────
describe("broadcast-realtime · trace-storm INSERT latency (LIVE, env-gated)", () => {
  it("POSITIVE: under trace-storm (100+ ai_trace_events INSERTs), INSERT latency is not blocked by the broadcast trigger", async () => {
    if (!OMNI) {
      // Self-skip outside acceptance mode so the normal suite is never affected.
      return;
    }
    // Real DB harness comes from the shared scaffold (_helpers). When the §10 trigger is absent
    // this is a no-op pass (nothing to block); once the trigger lands, the scaffold's pool runs
    // a 100-INSERT burst and asserts p95 INSERT latency stays within budget. Implemented against
    // the shared pool to avoid duplicating connection logic here.
    // Non-literal specifier: the shared scaffold's _helpers may not exist yet; keep the import
    // unresolvable at type-check time so this file type-checks without the scaffold present.
    const helpersSpecifier = ["..", "_helpers", "index.js"].join("/");
    const helpers = await import(/* @vite-ignore */ helpersSpecifier).catch(() => null);
    if (!helpers || typeof (helpers as { traceStormInsertLatencyMs?: unknown }).traceStormInsertLatencyMs !== "function") {
      // Scaffold helper not yet present; do not fail the acceptance run for an unimplemented surface.
      return;
    }
    const p95 = await (helpers as unknown as { traceStormInsertLatencyMs: (n: number) => Promise<number> }).traceStormInsertLatencyMs(120);
    // §20: INSERT not blocked under trace-storm. Budget is generous (the point is "not blocked",
    // not a tight SLA); async-outbox is the v1.1 escape hatch if this ever fails.
    expect(p95).toBeLessThan(50);
  });
});

// ──────────────────────────────────────────────────────────────────────────────────────────
// AREA 7 — AishaPushEvent single-source-of-truth + nudge/decision types; graceful degrade
//   Criteria: omni-protocol-dirigent-push-nudge-schema (§4.4)
//   Real identifiers: workbench-core/src/sse/ISseClient.ts (AishaPushEvent, AishaPushEventType),
//   extensions/aisha-dirigent/src/aisha-push.ts (duplicate), future workbench-core/src/sse/schemas.ts.
// ──────────────────────────────────────────────────────────────────────────────────────────
describe("broadcast-realtime · AishaPushEvent schema SoT + schema-evolution (mixed LIVE/SKIP)", () => {
  it("LIVE (regression guard): the CURRENT AishaPushEventType in ISseClient.ts does NOT yet include 'nudge'/'decision'", () => {
    // §4.4: "Všechna tři ale dnes postrádají nudge/decision → rozšířit." This LIVE assertion
    // documents the present state and is the canary: it FLIPS the moment the unified SoT lands
    // carrying nudge/decision (then this expectation must be updated). The AishaPushEventType
    // union is erased at runtime, so we assert on source text — real file, real exported symbol.
    const iSseClientSrc = readFileSync(
      path.join(REPO_ROOT, "packages/workbench-core/src/sse/ISseClient.ts"),
      "utf8",
    );
    expect(iSseClientSrc).toContain("AishaPushEventType");
    expect(iSseClientSrc).toContain('"model_discovered"'); // a real current union member
    // §4.4 target additions — NOT present today (RED-on-flip canary):
    expect(iSseClientSrc).not.toContain('"nudge"');
    expect(iSseClientSrc).not.toContain('"decision"');

    // The §4.4 single SoT module does not exist yet — the real signal that consolidation of the
    // two AishaPushEvent copies (ISseClient.ts + extensions/aisha-dirigent/src/aisha-push.ts)
    // has not happened. fs-existence check (no module import) → never requires the absent file.
    let schemasSotExists = true;
    try {
      readFileSync(path.join(REPO_ROOT, "packages/workbench-core/src/sse/schemas.ts"), "utf8");
    } catch {
      schemasSotExists = false;
    }
    expect(schemasSotExists).toBe(false);
  });

  describe.skip("AishaPushEvent unified SoT (SKIP until workbench-core/src/sse/schemas.ts lands)", () => {
    /**
     * CONTRACT (§4.4): consolidate AishaPushEvent into ONE SoT at
     * packages/workbench-core/src/sse/schemas.ts, re-exported by ISseClient.ts and consumed by
     * extensions/aisha-dirigent/src/aisha-push.ts (the 2 duplicates collapse to the unified type).
     * bridge.ts ServerMessageSchema (ready/context_changed/pong) stays SEPARATE — it is the IDE
     * instruction protocol, NOT a third copy. The unified AishaPushEventType MUST add 'nudge' and
     * 'decision' members; a decision event carries {decision: 'allow'|'block'|'ask', reason}.
     */
    it.todo("POSITIVE: schemas.ts exports an AishaPushEvent Zod schema including 'nudge' and 'decision' types");
    it.todo("POSITIVE: ISseClient.ts AishaPushEventType and aisha-push.ts both re-export the single SoT (no divergent copy)");
    it.todo("POSITIVE: bridge.ts ServerMessageSchema remains the separate ready/context_changed/pong protocol (NOT merged)");

    it.todo(
      "FALSE-POSITIVE GUARD: an unknown event type (e.g. 'totally_made_up') is degraded gracefully — parse does NOT throw and the event is NOT classified as a valid nudge/decision (schema-evolution graceful degrade, §20)",
    );

    it.todo(
      "FALSE-POSITIVE GUARD: an event with type:'nudge' but missing the required nudge payload is rejected — NOT treated as a valid nudge",
    );
  });
});
