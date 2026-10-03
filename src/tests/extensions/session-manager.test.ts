/**
 * Extension Session Manager — Unit tests for session logic.
 *
 * Tests ring buffer behavior, UUID generation, session payload
 * building, and directive application from session-manager.ts.
 *
 * Uses extracted logic pattern to avoid vscode module dependency.
 *
 * @module
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types — mirrored from session-manager.ts
// ---------------------------------------------------------------------------

type SessionDomain =
  | "frontend"
  | "backend"
  | "database"
  | "testing"
  | "devops"
  | "security"
  | "i18n"
  | "general";

interface AishaSession {
  id: string;
  domain: SessionDomain;
  currentTask: string | null;
  status: "active" | "idle" | "blocked" | "completed";
  workspace: string;
  label: string;
  startedAt: string;
  lastActivityAt: string;
}

interface ConversationTurn {
  ts: string;
  user: string;
  aisha: string;
  intent?: string;
  ok: boolean;
}

interface SessionDirective {
  domain?: SessionDomain;
  current_task?: string;
  status?: AishaSession["status"];
  orchestration_note?: string;
  cross_session?: Array<{
    target_domain: string;
    message: string;
  }>;
}

// ---------------------------------------------------------------------------
// Extracted logic — ring buffer + UUID + directive + payload
// ---------------------------------------------------------------------------

const MAX_HISTORY = 20;

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function createSession(
  workspace: string = "/test/project",
): AishaSession {
  const folderName = workspace.split("/").pop() ?? "workspace";
  return {
    id: uuid(),
    domain: "general",
    currentTask: null,
    status: "active",
    workspace,
    label: folderName,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  };
}

class RingBuffer {
  private history: ConversationTurn[] = [];
  private maxHistory: number;

  constructor(maxHistory: number = MAX_HISTORY) {
    this.maxHistory = maxHistory;
  }

  recordTurn(
    userPrompt: string,
    aishaResponse: string | undefined,
    intent: string | undefined,
    ok: boolean,
  ): void {
    const summary = aishaResponse
      ? aishaResponse.substring(0, 300) +
        (aishaResponse.length > 300 ? "…" : "")
      : "(no response)";

    this.history.push({
      ts: new Date().toISOString(),
      user: userPrompt.substring(0, 200),
      aisha: summary,
      intent,
      ok,
    });

    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  getRecentHistory(): ConversationTurn[] {
    return [...this.history];
  }

  get length(): number {
    return this.history.length;
  }
}

function applyDirective(
  session: AishaSession,
  directive: SessionDirective,
): AishaSession {
  const updated = { ...session };
  if (directive.domain) updated.domain = directive.domain;
  if (directive.current_task !== undefined)
    updated.currentTask = directive.current_task;
  if (directive.status) updated.status = directive.status;
  return updated;
}

// ---------------------------------------------------------------------------
// Source parity
// ---------------------------------------------------------------------------

describe("Source parity", () => {
  const sourcePath = path.resolve(
    __dirname,
    "../../../extensions/aisha-dirigent/src/session-manager.ts",
  );
  const source = fs.readFileSync(sourcePath, "utf-8");

  it("MAX_HISTORY matches source", () => {
    const match = source.match(/const\s+MAX_HISTORY\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(MAX_HISTORY);
  });

  it("UUID format matches source pattern", () => {
    expect(source).toContain(
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',
    );
  });

  it("recordTurn truncation limits match source", () => {
    // Response truncation at 300 chars
    expect(source).toContain("substring(0, 300)");
    // User prompt truncation at 200 chars
    expect(source).toContain("substring(0, 200)");
  });
});

// ---------------------------------------------------------------------------
// UUID generation
// ---------------------------------------------------------------------------

describe("uuid()", () => {
  it("generates valid UUID v4 format", () => {
    const id = uuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    expect(ids.size).toBe(100);
  });

  it("always has version 4 marker", () => {
    for (let i = 0; i < 50; i++) {
      const id = uuid();
      expect(id[14]).toBe("4");
    }
  });

  it("has correct variant bits (8, 9, a, or b)", () => {
    for (let i = 0; i < 50; i++) {
      const id = uuid();
      expect("89ab").toContain(id[19]);
    }
  });
});

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

describe("createSession()", () => {
  it("creates session with general domain", () => {
    const session = createSession();
    expect(session.domain).toBe("general");
  });

  it("extracts folder name from workspace path", () => {
    const session = createSession("/Users/dev/projects/my-app");
    expect(session.label).toBe("my-app");
  });

  it("uses pop() result for empty path (nullish coalescing only catches null/undefined)", () => {
    const session = createSession("");
    // "".split("/").pop() === "" — not null/undefined, so ?? doesn't trigger
    expect(session.label).toBe("");
  });

  it("has active status", () => {
    const session = createSession();
    expect(session.status).toBe("active");
  });

  it("has null currentTask", () => {
    const session = createSession();
    expect(session.currentTask).toBeNull();
  });

  it("has ISO timestamp for startedAt", () => {
    const session = createSession();
    expect(() => new Date(session.startedAt)).not.toThrow();
    expect(new Date(session.startedAt).toISOString()).toBe(session.startedAt);
  });
});

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

describe("RingBuffer", () => {
  let buffer: RingBuffer;

  beforeEach(() => {
    buffer = new RingBuffer(5); // Small buffer for testing
  });

  it("starts empty", () => {
    expect(buffer.getRecentHistory()).toHaveLength(0);
  });

  it("records turns", () => {
    buffer.recordTurn("Hello", "Hi there", "general", true);
    expect(buffer.length).toBe(1);
    const history = buffer.getRecentHistory();
    expect(history[0].user).toBe("Hello");
    expect(history[0].aisha).toBe("Hi there");
    expect(history[0].intent).toBe("general");
    expect(history[0].ok).toBe(true);
  });

  it("evicts oldest when over max capacity", () => {
    for (let i = 0; i < 7; i++) {
      buffer.recordTurn(`msg-${i}`, `resp-${i}`, undefined, true);
    }
    expect(buffer.length).toBe(5);
    const history = buffer.getRecentHistory();
    expect(history[0].user).toBe("msg-2"); // 0 and 1 evicted
    expect(history[4].user).toBe("msg-6");
  });

  it("truncates long user prompts at 200 chars", () => {
    const longPrompt = "x".repeat(300);
    buffer.recordTurn(longPrompt, "ok", undefined, true);
    const history = buffer.getRecentHistory();
    expect(history[0].user.length).toBe(200);
  });

  it("truncates long Aisha responses at 300 chars with ellipsis", () => {
    const longResponse = "y".repeat(500);
    buffer.recordTurn("q", longResponse, undefined, true);
    const history = buffer.getRecentHistory();
    expect(history[0].aisha.length).toBe(301); // 300 + "…"
    expect(history[0].aisha.endsWith("…")).toBe(true);
  });

  it("does NOT add ellipsis when response is exactly 300 chars", () => {
    const exactResponse = "z".repeat(300);
    buffer.recordTurn("q", exactResponse, undefined, true);
    const history = buffer.getRecentHistory();
    expect(history[0].aisha).toBe(exactResponse);
  });

  it("handles undefined Aisha response", () => {
    buffer.recordTurn("q", undefined, undefined, false);
    const history = buffer.getRecentHistory();
    expect(history[0].aisha).toBe("(no response)");
    expect(history[0].ok).toBe(false);
  });

  it("returns a copy (not reference) of history", () => {
    buffer.recordTurn("q", "a", undefined, true);
    const h1 = buffer.getRecentHistory();
    const h2 = buffer.getRecentHistory();
    expect(h1).not.toBe(h2);
    expect(h1).toEqual(h2);
  });

  it("has ISO timestamps", () => {
    buffer.recordTurn("q", "a", undefined, true);
    const ts = buffer.getRecentHistory()[0].ts;
    expect(() => new Date(ts)).not.toThrow();
  });

  it("maintains MAX_HISTORY=20 in production config", () => {
    const prodBuffer = new RingBuffer(MAX_HISTORY);
    for (let i = 0; i < 25; i++) {
      prodBuffer.recordTurn(`msg-${i}`, `resp-${i}`, undefined, true);
    }
    expect(prodBuffer.length).toBe(20);
    const history = prodBuffer.getRecentHistory();
    expect(history[0].user).toBe("msg-5");
    expect(history[19].user).toBe("msg-24");
  });
});

// ---------------------------------------------------------------------------
// Directive application
// ---------------------------------------------------------------------------

describe("applyDirective()", () => {
  let session: AishaSession;

  beforeEach(() => {
    session = createSession("/test/workspace");
  });

  it("updates domain", () => {
    const updated = applyDirective(session, { domain: "testing" });
    expect(updated.domain).toBe("testing");
  });

  it("updates current task", () => {
    const updated = applyDirective(session, {
      current_task: "Write unit tests for hooks",
    });
    expect(updated.currentTask).toBe("Write unit tests for hooks");
  });

  it("clears current task with null", () => {
    session.currentTask = "Old task";
    const updated = applyDirective(session, { current_task: null as unknown as string });
    expect(updated.currentTask).toBeNull();
  });

  it("updates status", () => {
    const updated = applyDirective(session, { status: "blocked" });
    expect(updated.status).toBe("blocked");
  });

  it("applies multiple fields at once", () => {
    const updated = applyDirective(session, {
      domain: "backend",
      current_task: "Fix RPC function",
      status: "active",
    });
    expect(updated.domain).toBe("backend");
    expect(updated.currentTask).toBe("Fix RPC function");
    expect(updated.status).toBe("active");
  });

  it("preserves unchanged fields", () => {
    session.label = "my-workspace";
    const updated = applyDirective(session, { domain: "frontend" });
    expect(updated.label).toBe("my-workspace");
    expect(updated.workspace).toBe(session.workspace);
    expect(updated.id).toBe(session.id);
  });

  it("does not mutate original session", () => {
    const originalDomain = session.domain;
    applyDirective(session, { domain: "security" });
    expect(session.domain).toBe(originalDomain);
  });

  it("ignores undefined directive fields", () => {
    const original = { ...session };
    const updated = applyDirective(session, {});
    expect(updated.domain).toBe(original.domain);
    expect(updated.currentTask).toBe(original.currentTask);
    expect(updated.status).toBe(original.status);
  });
});
