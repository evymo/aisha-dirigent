/**
 * Unit tests for lib/subscriber.ts (Phase 13 WP 13.4).
 *
 * Covers:
 *   - WATCHED_TABLES allowlist contains the 4 expected tables
 *   - isPayloadRelevant: positive (watched table), negative (random
 *     table), null-safe (missing fields)
 *   - buildContextChangedMessage produces JSON with type + envelope
 *   - RealtimeSubscriber.register + unregister updates size()
 *   - register-returned unregister() is idempotent
 *   - __injectForTests fans payload out to registered clients
 *   - Fan-out is capped at MAX_REFRESHES_PER_TICK
 *   - Non-relevant payload does NOT trigger onChange
 *
 * The Redis-subscribe + RPC-refresh paths are exercised via integration
 * tests against live containers (out of scope here — vitest in this
 * service is unit-only).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  WATCHED_TABLES,
  DB_CHANGES_CHANNEL,
  MAX_REFRESHES_PER_TICK,
  isPayloadRelevant,
  buildContextChangedMessage,
  RealtimeSubscriber,
  __resetRealtimeSubscriberForTests,
  type ConnectedClient,
  type DbChangePayload,
} from "../lib/subscriber.js";
import type { WorkspaceContextEnvelope } from "../lib/envelope.js";

const EMPTY_ENVELOPE: WorkspaceContextEnvelope = {
  user_id: "11111111-2222-3333-4444-555555555555",
  workspace_id: null,
  generated_at: "2026-05-20T10:00:00Z",
  is_privileged: false,
  stories: [],
  active_runs: [],
  pending_approvals: [],
  recent_audit: [],
  deploy_state: [],
};

function makeClient(id: string, calls?: DbChangePayload[]): ConnectedClient {
  return {
    id,
    onChange: async (payload) => {
      calls?.push(payload);
    },
  };
}

beforeEach(() => {
  __resetRealtimeSubscriberForTests();
});

describe("WATCHED_TABLES allowlist", () => {
  it("includes the 4 plan-spec tables", () => {
    expect(WATCHED_TABLES.has("public.partner_stories")).toBe(true);
    expect(WATCHED_TABLES.has("public.ai_runs")).toBe(true);
    expect(WATCHED_TABLES.has("public.ai_pending_approvals")).toBe(true);
    expect(WATCHED_TABLES.has("public.coolify_app_slots")).toBe(true);
  });

  it("does NOT include unrelated tables (regression guard)", () => {
    // audit_journal is intentionally excluded — append-only ledger,
    // not workspace state. Avoids fan-out storms.
    expect(WATCHED_TABLES.has("public.audit_journal")).toBe(false);
    // chat_messages is downstream of ai_runs; covered indirectly.
    expect(WATCHED_TABLES.has("public.chat_messages")).toBe(false);
  });

  it("channel name uses event-worker convention (ws:db_changes)", () => {
    expect(DB_CHANGES_CHANNEL).toBe("ws:db_changes");
  });

  it("MAX_REFRESHES_PER_TICK is bounded (DoS guard)", () => {
    expect(MAX_REFRESHES_PER_TICK).toBeGreaterThan(0);
    expect(MAX_REFRESHES_PER_TICK).toBeLessThanOrEqual(100);
  });
});

describe("isPayloadRelevant", () => {
  it("returns true for a watched table", () => {
    expect(
      isPayloadRelevant({
        table: "partner_stories",
        schema: "public",
        type: "UPDATE",
      }),
    ).toBe(true);
  });

  it("returns false for an unwatched table", () => {
    expect(
      isPayloadRelevant({
        table: "audit_journal",
        schema: "public",
        type: "INSERT",
      }),
    ).toBe(false);
  });

  it("defaults schema to public when missing", () => {
    expect(
      isPayloadRelevant({ table: "ai_runs", type: "UPDATE" }),
    ).toBe(true);
  });

  it("returns false for an empty payload (no table)", () => {
    expect(isPayloadRelevant({})).toBe(false);
  });

  it("does NOT match cross-schema tables of the same name", () => {
    // Defence against an attacker creating a same-named table in
    // another schema and getting events fan-out for free.
    expect(
      isPayloadRelevant({ table: "partner_stories", schema: "auth" }),
    ).toBe(false);
  });
});

describe("buildContextChangedMessage", () => {
  it("emits valid JSON with type=context_changed + envelope", () => {
    const msg = buildContextChangedMessage(EMPTY_ENVELOPE);
    const parsed = JSON.parse(msg) as { type: string; envelope: unknown };
    expect(parsed.type).toBe("context_changed");
    expect(parsed.envelope).toEqual(EMPTY_ENVELOPE);
  });

  it("does NOT leak PII patterns (envelope schema already PII-safe)", () => {
    const msg = buildContextChangedMessage(EMPTY_ENVELOPE);
    expect(msg).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/);
    expect(msg).not.toMatch(/\beyJ[A-Za-z0-9._-]+/); // JWT
    expect(msg).not.toMatch(/\bBearer\s+/i);
  });
});

describe("RealtimeSubscriber.register / unregister", () => {
  it("register adds + size() reflects new count", () => {
    const subscriber = new RealtimeSubscriber();
    expect(subscriber.size()).toBe(0);
    subscriber.register(makeClient("a"));
    expect(subscriber.size()).toBe(1);
    subscriber.register(makeClient("b"));
    expect(subscriber.size()).toBe(2);
  });

  it("returned unregister() removes the client", () => {
    const subscriber = new RealtimeSubscriber();
    const unregisterA = subscriber.register(makeClient("a"));
    subscriber.register(makeClient("b"));
    expect(subscriber.size()).toBe(2);
    unregisterA();
    expect(subscriber.size()).toBe(1);
  });

  it("unregister() is idempotent (safe to call twice)", () => {
    const subscriber = new RealtimeSubscriber();
    const unregister = subscriber.register(makeClient("a"));
    unregister();
    unregister();
    expect(subscriber.size()).toBe(0);
  });
});

describe("RealtimeSubscriber fan-out behavior", () => {
  it("fans relevant payload out to all registered clients", async () => {
    const subscriber = new RealtimeSubscriber();
    const callsA: DbChangePayload[] = [];
    const callsB: DbChangePayload[] = [];
    subscriber.register(makeClient("a", callsA));
    subscriber.register(makeClient("b", callsB));
    await subscriber.__injectForTests(
      JSON.stringify({ table: "partner_stories", schema: "public", type: "UPDATE" }),
    );
    expect(callsA).toHaveLength(1);
    expect(callsB).toHaveLength(1);
    expect(callsA[0].table).toBe("partner_stories");
  });

  it("ignores payload for an unwatched table — no onChange call", async () => {
    const subscriber = new RealtimeSubscriber();
    const calls: DbChangePayload[] = [];
    subscriber.register(makeClient("a", calls));
    await subscriber.__injectForTests(
      JSON.stringify({ table: "audit_journal", schema: "public", type: "INSERT" }),
    );
    expect(calls).toHaveLength(0);
  });

  it("ignores malformed JSON payload (no throw)", async () => {
    const subscriber = new RealtimeSubscriber();
    const calls: DbChangePayload[] = [];
    subscriber.register(makeClient("a", calls));
    await subscriber.__injectForTests("not json");
    expect(calls).toHaveLength(0);
  });

  it("caps fan-out at MAX_REFRESHES_PER_TICK", async () => {
    const subscriber = new RealtimeSubscriber();
    const seen: Array<number> = [];
    for (let i = 0; i < MAX_REFRESHES_PER_TICK + 5; i++) {
      const idx = i;
      subscriber.register({
        id: "c-" + String(i),
        onChange: async () => {
          seen.push(idx);
        },
      });
    }
    await subscriber.__injectForTests(
      JSON.stringify({ table: "ai_runs", schema: "public", type: "UPDATE" }),
    );
    expect(seen.length).toBeLessThanOrEqual(MAX_REFRESHES_PER_TICK);
  });

  it("swallows per-client onChange errors (other clients still notified)", async () => {
    const subscriber = new RealtimeSubscriber();
    const goodCalls: DbChangePayload[] = [];
    subscriber.register({
      id: "broken",
      onChange: async () => {
        throw new Error("boom");
      },
    });
    subscriber.register(makeClient("good", goodCalls));
    await subscriber.__injectForTests(
      JSON.stringify({ table: "ai_runs", schema: "public", type: "UPDATE" }),
    );
    expect(goodCalls).toHaveLength(1);
  });
});
