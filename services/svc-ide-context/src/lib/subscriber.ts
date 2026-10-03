/**
 * Realtime subscriber for IDE context — Phase 13 WP 13.4.
 *
 * Subscribes to the existing `ws:db_changes` Redis channel published by
 * `event-worker` (per Phase 12 realtime fabric). When a row changes in
 * one of the watched tables (partner_stories, ai_runs,
 * ai_pending_approvals, coolify_app_slots), invokes each connected WS
 * client's `onChange()` callback — the route layer owns the RPC
 * re-fetch + the actual `ws.send()` call.
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  aisha-shared-redis DB 3                                 │
 *   │      ↑ SUBSCRIBE 'ws:db_changes'                         │
 *   │  ┌─────────────────────────────────────────────────┐    │
 *   │  │  RealtimeSubscriber (this module)               │    │
 *   │  │   - watches 4 tables (allowlist)                │    │
 *   │  │   - clientRegistry: Map<wsId, ConnectedClient>  │    │
 *   │  │   - onChange callback owned by /subscribe route │    │
 *   │  └─────────────────────────────────────────────────┘    │
 *   │      ↓ client.onChange(payload) → route refetches + sends │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Per-client filter happens in the route's onChange handler via
 * `get_workspace_context()` (RLS-enforced; admin/staff/participant).
 * If the user can't see the changed row, the envelope returned is
 * unchanged and no event fires.
 *
 * NO PII in events — envelope is Zod-validated PII-safe upstream.
 *
 * Rollback: AISHA_SHARED_REDIS_DISABLED=true → subscriber falls into
 * passive mode (no notifications dispatched). WS clients still receive
 * the initial envelope on connect but no live updates.
 */
import type { Redis } from "ioredis";
import { createNamespacedRedis } from "@aisha/cache-redis/client";
import type { WorkspaceContextEnvelope } from "./envelope.js";

/** Tables whose changes can mutate a workspace envelope. */
export const WATCHED_TABLES = new Set([
  "public.partner_stories",
  "public.ai_runs",
  "public.ai_pending_approvals",
  "public.coolify_app_slots",
]);

/** Shared Redis channel — event-worker publishes here for ALL db_changes. */
export const DB_CHANGES_CHANNEL = "ws:db_changes";

/** Cap fan-out work so a hot-loop INSERT storm can't DoS the process. */
export const MAX_REFRESHES_PER_TICK = 50;

export interface DbChangePayload {
  table?: string;
  schema?: string;
  type?: "INSERT" | "UPDATE" | "DELETE";
  record?: Record<string, unknown>;
  old_record?: Record<string, unknown>;
}

export interface ConnectedClient {
  /** Stable ID for registry lookups (UUID generated per connection). */
  id: string;
  /**
   * Called when a relevant change arrives. The callback owns the RPC
   * re-fetch + the actual `ws.send()`. Must not throw — errors are
   * swallowed at the subscriber layer to keep other clients responsive.
   */
  onChange: (payload: DbChangePayload) => Promise<void>;
}

/**
 * Decides whether a db_changes notification could plausibly affect a
 * given workspace envelope. Cheap pre-filter; full RLS check happens in
 * the RPC re-fetch.
 */
export function isPayloadRelevant(payload: DbChangePayload): boolean {
  const tableKey = `${payload.schema ?? "public"}.${payload.table ?? ""}`;
  return WATCHED_TABLES.has(tableKey);
}

/** Format an outbound WS event message. NO PII per envelope schema. */
export function buildContextChangedMessage(envelope: WorkspaceContextEnvelope): string {
  return JSON.stringify({
    type: "context_changed",
    envelope,
  });
}

export class RealtimeSubscriber {
  private readonly clients = new Map<string, ConnectedClient>();
  private redis: Redis | null = null;
  private started = false;

  /** Start the subscriber. Idempotent; safe to call once at boot. */
  async start(logger: { info: (msg: unknown) => void; error: (msg: unknown) => void }): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.redis = createNamespacedRedis({
      db: 3,
      connectionName: "svc-ide-context-subscriber",
    });
    if (this.redis === null) {
      logger.info(
        "Redis disabled — WS subscribe falls back to passive (initial envelope only)",
      );
      return;
    }
    await this.redis.connect();
    await this.redis.subscribe(DB_CHANGES_CHANNEL);
    this.redis.on("message", (channel, rawPayload) => {
      if (channel !== DB_CHANGES_CHANNEL) return;
      this.handleNotification(rawPayload).catch((err: unknown) => {
        logger.error({ err, channel });
      });
    });
    logger.info({ channel: DB_CHANGES_CHANNEL, watched: Array.from(WATCHED_TABLES) });
  }

  /** Shut down — closes Redis + clears the client registry. */
  async stop(): Promise<void> {
    this.clients.clear();
    if (this.redis !== null) {
      await this.redis.unsubscribe(DB_CHANGES_CHANNEL).catch(() => undefined);
      await this.redis.quit().catch(() => undefined);
      this.redis = null;
    }
    this.started = false;
  }

  /** Register a connected client. Returns an unregister function. */
  register(client: ConnectedClient): () => void {
    this.clients.set(client.id, client);
    return () => {
      this.clients.delete(client.id);
    };
  }

  /** Current connected client count (for /health introspection + tests). */
  size(): number {
    return this.clients.size;
  }

  /** Manually inject a payload — test-only hook (real Redis pushes via SUBSCRIBE). */
  async __injectForTests(rawPayload: string): Promise<void> {
    await this.handleNotification(rawPayload);
  }

  /**
   * Process a single notification from `ws:db_changes`. For every
   * registered client whose workspace could be affected, invoke their
   * `onChange()` callback.
   */
  private async handleNotification(rawPayload: string): Promise<void> {
    let parsed: DbChangePayload;
    try {
      parsed = JSON.parse(rawPayload) as DbChangePayload;
    } catch {
      return; // Malformed payload; event-worker already warned
    }
    if (!isPayloadRelevant(parsed)) return;

    // Fan-out — cap to MAX_REFRESHES_PER_TICK so a row-update storm in
    // partner_stories doesn't trigger N client refreshes in a tight
    // loop. Excess clients see the next notification instead.
    const clients = Array.from(this.clients.values()).slice(0, MAX_REFRESHES_PER_TICK);
    await Promise.allSettled(
      clients.map((c) =>
        c.onChange(parsed).catch(() => undefined),
      ),
    );
  }
}

/** Module-level singleton — server.ts creates ONE subscriber + reuses. */
let singleton: RealtimeSubscriber | null = null;

export function getRealtimeSubscriber(): RealtimeSubscriber {
  if (singleton === null) {
    singleton = new RealtimeSubscriber();
  }
  return singleton;
}

/** Test-only: reset the singleton (so tests can start with a clean state). */
export function __resetRealtimeSubscriberForTests(): void {
  singleton = null;
}
