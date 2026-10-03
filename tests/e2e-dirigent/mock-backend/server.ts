/**
 * Mock AISHA backend for e2e tests.
 *
 * Implements the subset of endpoints the supervisor surfaces actually call:
 *
 *   POST /rpc/mcp_get_claude_hook_bindings  → returns DEFAULT_BINDINGS or override
 *   POST /rpc/dirigent_drain_nudges         → drains NUDGE_QUEUE (FIFO, atomic)
 *   POST /dirigent/dispatch                 → returns canned per-event response
 *
 * Test control endpoints (NOT in real backend):
 *
 *   POST /__test__/configure-bindings  { bindings: HookBinding[] }
 *   POST /__test__/configure-dispatch  { event: string, response: DispatchResponse }
 *   POST /__test__/queue-nudge         { ...Nudge }
 *   POST /__test__/reset               → restores DEFAULT_*, clears queue + counters
 *   GET  /__test__/call-log            → returns ordered list of all dispatched events
 *
 * Listens on PORT (default 3030). No auth — runs only in test isolation.
 */

import Fastify from "fastify";
import { DEFAULT_BINDINGS, type HookBinding } from "./fixtures/bindings.js";
import {
  DEFAULT_DISPATCH,
  type DispatchResponse,
} from "./fixtures/dispatch.js";
import { NUDGE_QUEUE, type Nudge } from "./fixtures/nudges.js";

// ── Mutable state (test isolation via /__test__/reset) ────────────────────

let currentBindings: HookBinding[] = [...DEFAULT_BINDINGS];
let currentDispatch: Record<string, DispatchResponse> = { ...DEFAULT_DISPATCH };
const callLog: Array<{ ts: string; path: string; body: unknown }> = [];

function resetState() {
  currentBindings = [...DEFAULT_BINDINGS];
  currentDispatch = { ...DEFAULT_DISPATCH };
  NUDGE_QUEUE.length = 0;
  callLog.length = 0;
}

function logCall(path: string, body: unknown) {
  callLog.push({ ts: new Date().toISOString(), path, body });
}

// ── Server ────────────────────────────────────────────────────────────────

const app = Fastify({
  logger: { level: process.env.MOCK_BACKEND_LOG_LEVEL ?? "warn" },
});

// Health (compose healthcheck + readiness gate)
app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

// ── Production-shape endpoints ────────────────────────────────────────────

app.post("/rpc/mcp_get_claude_hook_bindings", async (req) => {
  logCall("/rpc/mcp_get_claude_hook_bindings", req.body);
  return currentBindings;
});

app.post("/rpc/dirigent_drain_nudges", async (req) => {
  logCall("/rpc/dirigent_drain_nudges", req.body);
  const body = (req.body ?? {}) as { p_limit?: number };
  const limit = body.p_limit ?? 10;
  const drained = NUDGE_QUEUE.splice(0, limit);
  return drained;
});

app.post("/dirigent/dispatch", async (req) => {
  logCall("/dirigent/dispatch", req.body);
  const body = (req.body ?? {}) as { event?: string };
  const event = body.event ?? "unknown";
  return currentDispatch[event] ?? { additionalContext: "" };
});

// PostgREST-shape error for unknown RPCs (deterministic 404)
app.post("/rpc/:fn", async (req, reply) => {
  reply.code(404);
  return { code: "PGRST202", message: `Could not find function ${req.params}` };
});

// ── Test control endpoints (only on this mock; NOT in real backend) ───────

app.post("/__test__/configure-bindings", async (req) => {
  const body = req.body as { bindings: HookBinding[] };
  currentBindings = body.bindings;
  return { ok: true, count: currentBindings.length };
});

app.post("/__test__/configure-dispatch", async (req) => {
  const body = req.body as {
    event: string;
    response: DispatchResponse;
  };
  currentDispatch[body.event] = body.response;
  return { ok: true, event: body.event };
});

app.post("/__test__/queue-nudge", async (req) => {
  const nudge = req.body as Nudge;
  NUDGE_QUEUE.push({
    ...nudge,
    id: nudge.id ?? `nudge-${Date.now()}`,
    created_at: nudge.created_at ?? new Date().toISOString(),
  });
  return { ok: true, queue_depth: NUDGE_QUEUE.length };
});

app.post("/__test__/reset", async () => {
  resetState();
  return { ok: true };
});

app.get("/__test__/call-log", async () => callLog);

// ── Bootstrap ─────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3030);
const HOST = process.env.HOST ?? "0.0.0.0";

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
     
    console.log(`mock-backend listening on http://${HOST}:${PORT}`);
  })
  .catch((err) => {
     
    console.error(err);
    process.exit(1);
  });
