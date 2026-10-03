/**
 * workbench-drainer.test.ts — the CONSUMER side of the PR-J workbench rail.
 *
 * REGRESSION FOCUS: callRpc / api.rpc NEVER throw (they return { data, error }).
 * An earlier version awaited callRpc and IGNORED the result, so a failed
 * complete_workbench_request was silently treated as a success — a completed
 * local run was discarded, the row stayed 'claimed', and nothing was logged.
 * These tests pin the fail-loud contract: claim() and complete() MUST reject on
 * an RPC error, and complete() retries the idempotent RPC before giving up.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────
vi.mock("../src/backend-rpc", () => ({ callRpc: vi.fn() }));
vi.mock("../src/compute-tier", () => ({ resolveEdgeTarget: vi.fn() }));
vi.mock("../src/local-llm-client", () => ({ localChat: vi.fn() }));
vi.mock("../src/auth", () => ({ getAuthState: vi.fn(() => ({ accessToken: "tok" })) }));
vi.mock("../src/safe-logger", () => ({ safeError: vi.fn(), safeInfo: vi.fn() }));

import { RpcWorkbenchQueue, EdgeWorkbenchRunner } from "../src/workbench-drainer";
import { callRpc } from "../src/backend-rpc";
import { resolveEdgeTarget } from "../src/compute-tier";
import { localChat } from "../src/local-llm-client";
import type { WorkbenchExecutionRequest } from "@aisha/workbench-core";

const callRpcMock = callRpc as unknown as Mock;
const resolveEdgeTargetMock = resolveEdgeTarget as unknown as Mock;
const localChatMock = localChat as unknown as Mock;

const row = (over: Partial<WorkbenchExecutionRequest> = {}): WorkbenchExecutionRequest => ({
  id: "r1",
  clow: null,
  request_input: "hello",
  model_id: null,
  provider_slug: null,
  run_id: null,
  story_id: null,
  decision_id: null,
  status: "claimed",
  claimed_by: "sess",
  claimed_at: null,
  enqueued_at: "now",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RpcWorkbenchQueue.claim", () => {
  it("REJECTS (fail-loud) when callRpc reports an error — not a silent empty list", async () => {
    callRpcMock.mockResolvedValue({ data: null, error: "gateway_503", stats: null });
    await expect(new RpcWorkbenchQueue("sess").claim(1)).rejects.toThrow(/workbench_claim_failed: gateway_503/);
  });

  it("returns the claimed rows on success", async () => {
    const rows = [row({ id: "r1" })];
    callRpcMock.mockResolvedValue({ data: rows, error: null, stats: null });
    await expect(new RpcWorkbenchQueue("sess").claim(1)).resolves.toEqual(rows);
    expect(callRpcMock).toHaveBeenCalledWith("claim_pending_workbench_requests", {
      p_limit: 1,
      p_session_id: "sess",
    });
  });

  it("returns [] for genuine 'no pending work' (data null, error null)", async () => {
    callRpcMock.mockResolvedValue({ data: null, error: null, stats: null });
    await expect(new RpcWorkbenchQueue("sess").claim(1)).resolves.toEqual([]);
  });
});

describe("RpcWorkbenchQueue.complete", () => {
  it("resolves on first success and maps every param exactly (alphabetical RPC contract)", async () => {
    callRpcMock.mockResolvedValue({ data: { updated: true }, error: null, stats: null });
    await new RpcWorkbenchQueue("sess").complete({
      requestId: "r1",
      ok: true,
      output: "out",
      latencyMs: 5,
      tokensIn: 2,
      tokensOut: 3,
    });
    expect(callRpcMock).toHaveBeenCalledTimes(1);
    expect(callRpcMock).toHaveBeenCalledWith("complete_workbench_request", {
      p_error: null,
      p_latency_ms: 5,
      p_ok: true,
      p_output: "out",
      p_request_id: "r1",
      p_tokens_in: 2,
      p_tokens_out: 3,
    });
  });

  it("maps a FAILED completion's error + nullable fields", async () => {
    callRpcMock.mockResolvedValue({ data: { updated: true }, error: null, stats: null });
    await new RpcWorkbenchQueue("sess").complete({ requestId: "r2", ok: false, output: null, error: "edge_down" });
    expect(callRpcMock).toHaveBeenCalledWith("complete_workbench_request", {
      p_error: "edge_down",
      p_latency_ms: null,
      p_ok: false,
      p_output: null,
      p_request_id: "r2",
      p_tokens_in: null,
      p_tokens_out: null,
    });
  });

  it("RETRIES a transient failure then succeeds (RPC is idempotent) — result not discarded", async () => {
    callRpcMock
      .mockResolvedValueOnce({ data: null, error: "503", stats: null })
      .mockResolvedValueOnce({ data: { updated: true }, error: null, stats: null });
    const p = new RpcWorkbenchQueue("sess").complete({ requestId: "r3", ok: true, output: "x" });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(callRpcMock).toHaveBeenCalledTimes(2);
  });

  it("REJECTS fail-loud after exhausting retries — never silently drops a completed run", async () => {
    callRpcMock.mockResolvedValue({ data: null, error: "gateway_down", stats: null });
    const p = new RpcWorkbenchQueue("sess").complete({ requestId: "r4", ok: true, output: "x" });
    const expectation = expect(p).rejects.toThrow(/workbench_complete_failed: gateway_down/);
    await vi.runAllTimersAsync();
    await expectation;
    expect(callRpcMock).toHaveBeenCalledTimes(3);
  });
});

describe("EdgeWorkbenchRunner.run", () => {
  it("throws when the local model vanished (engine marks the request failed, not stuck)", async () => {
    resolveEdgeTargetMock.mockReturnValue(null);
    await expect(new EdgeWorkbenchRunner().run(row())).rejects.toThrow();
    expect(localChatMock).not.toHaveBeenCalled();
  });

  it("runs the clow on the local model and returns output + token usage", async () => {
    resolveEdgeTargetMock.mockReturnValue({ endpoint: "http://localhost:11434/v1", model: "llama3" });
    localChatMock.mockResolvedValue({
      content: "answer",
      tokens: { promptTokens: 10, completionTokens: 4 },
      model: "llama3",
      tier: "edge",
      latencyMs: 12,
    });
    const out = await new EdgeWorkbenchRunner().run(row({ request_input: "q", clow: { purpose: "test" } }));
    expect(out).toEqual({ output: "answer", tokensIn: 10, tokensOut: 4 });
  });

  it("throws when the local model call fails (localChat null)", async () => {
    resolveEdgeTargetMock.mockReturnValue({ endpoint: "http://x/v1", model: "m" });
    localChatMock.mockResolvedValue(null);
    await expect(new EdgeWorkbenchRunner().run(row())).rejects.toThrow(/workbench_local_model_error/);
  });
});
