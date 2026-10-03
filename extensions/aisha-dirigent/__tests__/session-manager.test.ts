/**
 * session-manager.test.ts — Work phase tracking & session lifecycle.
 *
 * Tests: setWorkPhase, clearWorkPhase, getWorkPhaseLabel,
 *        onSessionStateChanged event, session state transitions.
 *
 * Uses vi.resetModules() for clean singleton state per test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../src/mcp-client", () => ({
  callN8nAgent: vi.fn(async () => null),
}));

vi.mock("../src/auth", () => ({
  getAuthState: vi.fn(() => ({
    isAuthenticated: false,
    userId: null,
    email: null,
    accessToken: null,
  })),
}));

vi.mock("../src/story-context", () => ({
  resolveStoryContext: vi.fn(async () => ({
    storyId: null,
    storyTitle: null,
    environment: null,
  })),
}));

// ── Fresh import helper ──────────────────────────────────────────────

async function freshSessionManager() {
  vi.resetModules();
  return import("../src/session-manager");
}

// ── Tests ────────────────────────────────────────────────────────────

describe("initSession + basic lifecycle", () => {
  beforeEach(() => vi.resetModules());

  it("creates session with idle status", async () => {
    const sm = await freshSessionManager();
    const session = await sm.initSession();
    expect(session.id).toBeTruthy();
    expect(session.status).toBe("idle");
    expect(session.workPhase).toBeNull();
    expect(session.domain).toBe("general");
  });

  it("getSessionSync returns session after init", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    const session = sm.getSessionSync();
    expect(session).not.toBeNull();
    expect(session!.id).toBeTruthy();
  });
});

describe("setWorkPhase", () => {
  beforeEach(() => vi.resetModules());

  it("sets status to working and phase to routing", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    sm.setWorkPhase("routing");
    const session = sm.getSessionSync()!;
    expect(session.status).toBe("working");
    expect(session.workPhase).toBe("routing");
  });

  it("sets all fields with full arguments", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    sm.setWorkPhase("edge", "processing recap", "llama3.2", "edge");
    const session = sm.getSessionSync()!;
    expect(session.status).toBe("working");
    expect(session.workPhase).toBe("edge");
    expect(session.statusDetail).toBe("processing recap");
    expect(session.activeModel).toBe("llama3.2");
    expect(session.activeTier).toBe("edge");
  });

  it("updates lastActivityAt", async () => {
    const sm = await freshSessionManager();
    const original = await sm.initSession();
    const beforeActivity = original.lastActivityAt;
    // Wait a tiny bit for time to advance
    await new Promise((r) => setTimeout(r, 5));
    sm.setWorkPhase("backend");
    const session = sm.getSessionSync()!;
    expect(session.lastActivityAt).not.toBe(beforeActivity);
  });
});

describe("clearWorkPhase", () => {
  beforeEach(() => vi.resetModules());

  it("resets to idle with all phase fields null", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    sm.setWorkPhase("edge", "recap", "llama3.2", "edge");
    sm.clearWorkPhase();
    const session = sm.getSessionSync()!;
    expect(session.status).toBe("idle");
    expect(session.workPhase).toBeNull();
    expect(session.statusDetail).toBeNull();
    expect(session.activeModel).toBeNull();
    expect(session.activeTier).toBeNull();
  });
});

describe("getWorkPhaseLabel", () => {
  beforeEach(() => vi.resetModules());

  it("returns 'idle' when no phase set", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    expect(sm.getWorkPhaseLabel()).toBe("idle");
  });

  it("returns phase name when no detail", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    sm.setWorkPhase("routing");
    expect(sm.getWorkPhaseLabel()).toBe("routing");
  });

  it("returns 'phase: detail' when detail is set", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    sm.setWorkPhase("edge", "processing recap");
    expect(sm.getWorkPhaseLabel()).toBe("edge: processing recap");
  });

  it("returns 'idle' after clearWorkPhase", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    sm.setWorkPhase("backend");
    sm.clearWorkPhase();
    expect(sm.getWorkPhaseLabel()).toBe("idle");
  });
});

describe("onSessionStateChanged", () => {
  beforeEach(() => vi.resetModules());

  it("fires on setWorkPhase", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    const listener = vi.fn();
    sm.onSessionStateChanged(listener);
    sm.setWorkPhase("routing");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status: "working", workPhase: "routing" }),
    );
  });

  it("fires on clearWorkPhase", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    sm.setWorkPhase("edge");
    const listener = vi.fn();
    sm.onSessionStateChanged(listener);
    sm.clearWorkPhase();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status: "idle", workPhase: null }),
    );
  });

  it("fires on initSession (session creation)", async () => {
    const sm = await freshSessionManager();
    const listener = vi.fn();
    sm.onSessionStateChanged(listener);
    await sm.initSession();
    expect(listener).toHaveBeenCalled();
  });
});

describe("session state transitions", () => {
  beforeEach(() => vi.resetModules());

  it("idle → working → idle cycle", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    expect(sm.getSessionSync()!.status).toBe("idle");

    sm.setWorkPhase("routing");
    expect(sm.getSessionSync()!.status).toBe("working");

    sm.clearWorkPhase();
    expect(sm.getSessionSync()!.status).toBe("idle");
  });

  it("multiple phase transitions", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();

    sm.setWorkPhase("routing");
    expect(sm.getWorkPhaseLabel()).toBe("routing");

    sm.setWorkPhase("edge", "processing recap", "llama3.2", "edge");
    expect(sm.getWorkPhaseLabel()).toBe("edge: processing recap");

    sm.setWorkPhase("backend", "evaluating", "gpt-4o", "cloud");
    expect(sm.getWorkPhaseLabel()).toBe("backend: evaluating");

    sm.clearWorkPhase();
    expect(sm.getWorkPhaseLabel()).toBe("idle");
  });
});

describe("resetSession", () => {
  beforeEach(() => vi.resetModules());

  it("creates new session with fresh ID", async () => {
    const sm = await freshSessionManager();
    const first = await sm.initSession();
    const second = await sm.resetSession();
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("idle");
    expect(second.workPhase).toBeNull();
  });
});

describe("recordTurn", () => {
  beforeEach(() => vi.resetModules());

  it("records conversation turn and returns it in getRecentHistory", async () => {
    const sm = await freshSessionManager();
    await sm.initSession();
    sm.recordTurn("user prompt", "aisha response", "code_review", true);
    const history = sm.getRecentHistory();
    expect(history).toHaveLength(1);
    expect(history[0].user).toBe("user prompt");
    expect(history[0].aisha).toBe("aisha response");
    expect(history[0].intent).toBe("code_review");
    expect(history[0].ok).toBe(true);
  });
});
