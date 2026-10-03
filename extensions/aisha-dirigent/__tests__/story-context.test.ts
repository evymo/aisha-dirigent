/**
 * Tests for story-context.ts — browse vs active story separation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config", () => ({
  getDirigentConfig: vi.fn(() => ({
    storyId: "",
    aishaUrl: "",
    anonKey: "",
    mcpUrl: "",
    n8nTriggerUrl: "",
    expertiseLevel: "expert",
    instanceLabel: "",
    activeProfile: "local",
    profiles: {},
  })),
}));

async function freshStoryContext() {
  vi.resetModules();
  return import("../src/story-context");
}

describe("story-context.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("browse story context", () => {
    it("getBrowseStoryId returns null initially", async () => {
      const { getBrowseStoryId } = await freshStoryContext();
      expect(getBrowseStoryId()).toBeNull();
    });

    it("setBrowseStoryId sets and gets browse story", async () => {
      const { getBrowseStoryId, setBrowseStoryId } = await freshStoryContext();
      setBrowseStoryId("story-browse-123");
      expect(getBrowseStoryId()).toBe("story-browse-123");
    });

    it("setBrowseStoryId(null) clears browse story", async () => {
      const { getBrowseStoryId, setBrowseStoryId } = await freshStoryContext();
      setBrowseStoryId("story-browse-123");
      setBrowseStoryId(null);
      expect(getBrowseStoryId()).toBeNull();
    });

    it("browse story is independent of active story context", async () => {
      const { getBrowseStoryId, setBrowseStoryId, resolveStoryContext } = await freshStoryContext();
      setBrowseStoryId("browse-999");

      // Active story context resolves from config/file, not browse
      const ctx = await resolveStoryContext();
      expect(ctx.storyId).toBeNull(); // no config storyId set
      expect(ctx.source).toBe("none");
      expect(getBrowseStoryId()).toBe("browse-999");
    });
  });

  describe("resolveStoryContext", () => {
    it("returns none when no config and no file", async () => {
      const { resolveStoryContext } = await freshStoryContext();
      const ctx = await resolveStoryContext();
      expect(ctx.source).toBe("none");
      expect(ctx.storyId).toBeNull();
    });

    it("returns config source when storyId is set", async () => {
      vi.resetModules();
      const { getDirigentConfig } = await import("../src/config");
      (getDirigentConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        storyId: "config-story-456",
        aishaUrl: "",
        anonKey: "",
        mcpUrl: "",
        n8nTriggerUrl: "",
        expertiseLevel: "expert",
        instanceLabel: "",
        activeProfile: "local",
        profiles: {},
      });

      const { resolveStoryContext } = await import("../src/story-context");
      const ctx = await resolveStoryContext();
      expect(ctx.source).toBe("config");
      expect(ctx.storyId).toBe("config-story-456");
    });
  });

  describe("session story precedence", () => {
    it("getSessionStoryId returns null initially", async () => {
      const { getSessionStoryId } = await freshStoryContext();
      expect(getSessionStoryId()).toBeNull();
    });

    it("session story takes precedence over config", async () => {
      vi.resetModules();
      const { getDirigentConfig } = await import("../src/config");
      (getDirigentConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        storyId: "config-story-456",
        aishaUrl: "",
        anonKey: "",
        mcpUrl: "",
        n8nTriggerUrl: "",
        expertiseLevel: "expert",
        instanceLabel: "",
        activeProfile: "local",
        profiles: {},
      });

      const { resolveStoryContext, setSessionStoryId } = await import("../src/story-context");

      // Set session override
      setSessionStoryId("session-story-789");

      const ctx = await resolveStoryContext();
      expect(ctx.source).toBe("session");
      expect(ctx.storyId).toBe("session-story-789");
    });

    it("clearing session story falls back to config", async () => {
      vi.resetModules();
      const { getDirigentConfig } = await import("../src/config");
      (getDirigentConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        storyId: "config-story-456",
        aishaUrl: "",
        anonKey: "",
        mcpUrl: "",
        n8nTriggerUrl: "",
        expertiseLevel: "expert",
        instanceLabel: "",
        activeProfile: "local",
        profiles: {},
      });

      const { resolveStoryContext, setSessionStoryId } = await import("../src/story-context");

      setSessionStoryId("session-story-789");
      setSessionStoryId(null); // Clear session

      const ctx = await resolveStoryContext();
      expect(ctx.source).toBe("config");
      expect(ctx.storyId).toBe("config-story-456");
    });

    it("session story is independent of browse story", async () => {
      const { resolveStoryContext, setSessionStoryId, setBrowseStoryId, getBrowseStoryId } =
        await freshStoryContext();

      setSessionStoryId("session-active");
      setBrowseStoryId("browse-panel");

      const ctx = await resolveStoryContext();
      expect(ctx.source).toBe("session");
      expect(ctx.storyId).toBe("session-active");
      expect(getBrowseStoryId()).toBe("browse-panel");
    });
  });

  describe("onStoryChanged event", () => {
    it("fires when setSessionStoryId changes value", async () => {
      const { setSessionStoryId, onStoryChanged } = await freshStoryContext();
      const handler = vi.fn();
      onStoryChanged(handler);

      setSessionStoryId("story-A");
      expect(handler).toHaveBeenCalledWith("story-A");

      setSessionStoryId("story-B");
      expect(handler).toHaveBeenCalledWith("story-B");
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("does not fire when setSessionStoryId sets same value", async () => {
      const { setSessionStoryId, onStoryChanged } = await freshStoryContext();
      const handler = vi.fn();
      onStoryChanged(handler);

      setSessionStoryId("story-A");
      setSessionStoryId("story-A"); // same value
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("fires with null when clearing session story", async () => {
      const { setSessionStoryId, onStoryChanged } = await freshStoryContext();
      const handler = vi.fn();
      onStoryChanged(handler);

      setSessionStoryId("story-A");
      setSessionStoryId(null);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith(null);
    });
  });
});
