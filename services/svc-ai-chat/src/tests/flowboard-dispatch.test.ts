import { describe, it, expect, vi, beforeEach } from "vitest";

// Exercise the REAL route-level agent dispatcher (resolveSlotModel -> resolveAvailableModel ->
// journalDispatch -> unifiedChat) directly. The route test mocks the executor wholesale, so this is
// the only place the dispatcher's own wiring — the I1 journal-before-chat ordering and the
// profile->model resolution — is asserted.
vi.mock("../lib/llmRouter.js", () => ({
  resolveAvailableModel: vi.fn((m: string) => ({ model: m, provider: "anthropic" })),
  unifiedChat: vi.fn(async () => ({ text: "agent-output" })),
}));
vi.mock("../lib/dispatchJournal.js", () => ({ journalDispatch: vi.fn(async () => "decision-1") }));
vi.mock("../reflection/soulforge.js", () => ({ resolveSlotModel: vi.fn(() => "claude-haiku-4-20250514") }));

import { dispatchAgent } from "../routes/flowboard-run.js";
import { resolveAvailableModel, unifiedChat } from "../lib/llmRouter.js";
import { journalDispatch } from "../lib/dispatchJournal.js";
import { resolveSlotModel } from "../reflection/soulforge.js";

describe("flowboard dispatchAgent (route-level LLM dispatcher)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("journals the dispatch BEFORE the raw chat (I1: no unjournaled LLM call) and scopes it to the story", async () => {
    const order: string[] = [];
    vi.mocked(journalDispatch).mockImplementation(async () => {
      order.push("journal");
      return "d1";
    });
    vi.mocked(unifiedChat).mockImplementation(async () => {
      order.push("chat");
      return { text: "out" } as Awaited<ReturnType<typeof unifiedChat>>;
    });
    const r = await dispatchAgent({ slug: "knowledge", model: "balanced", prompt: "p", storyId: "story-7" });
    expect(r.text).toBe("out");
    expect(order).toEqual(["journal", "chat"]);
    expect(journalDispatch).toHaveBeenCalledWith(expect.objectContaining({ storyId: "story-7" }));
  });

  it("maps a Soulforge quality PROFILE to a concrete model id before capability-availability remap", async () => {
    await dispatchAgent({ slug: "x", model: "balanced", prompt: "p", storyId: "s1" });
    expect(resolveSlotModel).toHaveBeenCalledWith("ember", "balanced");
    // the profile "balanced" must NEVER reach resolveAvailableModel — the resolved model id does
    expect(resolveAvailableModel).toHaveBeenCalledWith("claude-haiku-4-20250514");
    expect(resolveAvailableModel).not.toHaveBeenCalledWith("balanced");
  });

  it("passes a concrete model id straight through (no slot resolution)", async () => {
    await dispatchAgent({ slug: "x", model: "gpt-4o", prompt: "p", storyId: "s1" });
    expect(resolveSlotModel).not.toHaveBeenCalled();
    expect(resolveAvailableModel).toHaveBeenCalledWith("gpt-4o");
  });
});
