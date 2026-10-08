/**
 * Unit tests for the IdeBridge orchestrator — Phase 13 WP 13.3.
 *
 * Covers:
 *   - backoffDelayMs bounded by RECONNECT_BACKOFF_SECONDS schedule + jitter
 *   - IDE_DEFAULT_OUTPUT_PATH covers all 4 supported IDEs
 *   - syncOnce: REST fetch → safeWrite path
 *   - outputPath override + default
 *
 * Full WS lifecycle (reconnect-with-backoff, 4001 retry, 4003 stop) is
 * exercised via integration tests against a live svc-ide-context — out
 * of scope for this unit suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  IdeBridge,
  IDE_DEFAULT_OUTPUT_PATH,
  SUPPORTED_IDES,
  RECONNECT_BACKOFF_SECONDS,
  JITTER_RATIO,
  PING_INTERVAL_MS,
  backoffDelayMs,
  type BridgeLogger,
  type SupportedIde,
} from "../bridge.js";

const silentLogger: BridgeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aisha-ide-bridge-test-"));
});
// Bez úklidu zůstával adresář po KAŽDÉM testu (naměřeno 2026-10-02: 2 214 v $TMPDIR).
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("backoffDelayMs", () => {
  it("first attempt delay drawn from RECONNECT_BACKOFF_SECONDS[0] = 1s", () => {
    // With rand=0.5 → jitter=0; pure base
    const delay = backoffDelayMs(0, () => 0.5);
    expect(delay).toBe(1000);
  });

  it("delays escalate up to the cap at the last entry (30s)", () => {
    const cap = RECONNECT_BACKOFF_SECONDS[RECONNECT_BACKOFF_SECONDS.length - 1];
    const d10 = backoffDelayMs(10, () => 0.5);
    expect(d10).toBe(cap * 1000);
  });

  it("delays stay non-negative even at the low end of jitter", () => {
    for (let i = 0; i < RECONNECT_BACKOFF_SECONDS.length; i++) {
      const d = backoffDelayMs(i, () => 0); // min jitter
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it("jitter is bounded by ±JITTER_RATIO * base", () => {
    const base = RECONNECT_BACKOFF_SECONDS[3]; // 8s
    const maxJitter = base * JITTER_RATIO * 1000;
    for (let i = 0; i < 30; i++) {
      const d = backoffDelayMs(3, Math.random);
      expect(d).toBeGreaterThanOrEqual(Math.round(base * 1000 - maxJitter));
      expect(d).toBeLessThanOrEqual(Math.round(base * 1000 + maxJitter));
    }
  });

  it("PING_INTERVAL_MS = 30s (caps idle WS lifetime ahead of NAT timeouts)", () => {
    expect(PING_INTERVAL_MS).toBe(30_000);
  });
});

describe("IDE_DEFAULT_OUTPUT_PATH covers all 4 IDEs", () => {
  it.each(SUPPORTED_IDES)("ide=%s has a default output path", (ide) => {
    expect(IDE_DEFAULT_OUTPUT_PATH[ide as SupportedIde]).toBeDefined();
    expect(IDE_DEFAULT_OUTPUT_PATH[ide as SupportedIde].length).toBeGreaterThan(0);
  });

  it("default paths look sane", () => {
    expect(IDE_DEFAULT_OUTPUT_PATH["claude-code"]).toBe("CLAUDE.md");
    expect(IDE_DEFAULT_OUTPUT_PATH.cursor).toBe(".cursorrules");
    expect(IDE_DEFAULT_OUTPUT_PATH.copilot).toBe(".github/copilot-instructions.md");
    expect(IDE_DEFAULT_OUTPUT_PATH.jetbrains).toBe(".idea/aisha-ai-prompt-config.json");
  });
});

describe("IdeBridge.outputPath()", () => {
  it("returns the IDE default when no override", () => {
    const bridge = new IdeBridge({
      serviceUrl: "https://example.test",
      ide: "claude-code",
      rootDir: tmpRoot,
      tokenProvider: async () => "test-token",
    });
    expect(bridge.outputPath()).toBe("CLAUDE.md");
  });

  it("honors the operator override", () => {
    const bridge = new IdeBridge({
      serviceUrl: "https://example.test",
      ide: "claude-code",
      rootDir: tmpRoot,
      outputPath: "custom/PATH.md",
      tokenProvider: async () => "test-token",
    });
    expect(bridge.outputPath()).toBe("custom/PATH.md");
  });
});

describe("IdeBridge.syncOnce()", () => {
  it("fetches REST + writes file via writer override", async () => {
    const fetchedBody = "<!-- AISHA-MANAGED-START -->\nfresh\n<!-- AISHA-MANAGED-END -->\n<!-- USER-CUSTOM-START -->\n<!-- USER-CUSTOM-END -->\n";
    const writes: Array<{ outputPath: string; newContent: string }> = [];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => fetchedBody,
    } as unknown as Response);

    const bridge = new IdeBridge({
      serviceUrl: "https://example.test",
      ide: "claude-code",
      workspaceId: "ws-1",
      rootDir: tmpRoot,
      tokenProvider: async () => "tok-abc",
      fetchImpl: mockFetch as unknown as typeof fetch,
      writer: (opts) => {
        writes.push({ outputPath: opts.outputPath, newContent: opts.newContent });
        return {
          outcome: "written",
          absolutePath: path.join(opts.rootDir, opts.outputPath),
          preservedUserSection: false,
          treatedAsUserOwned: false,
        };
      },
      logger: silentLogger,
    });

    const result = await bridge.syncOnce();
    expect(result.outcome).toBe("written");
    expect(writes).toHaveLength(1);
    expect(writes[0].outputPath).toBe("CLAUDE.md");
    expect(writes[0].newContent).toBe(fetchedBody);

    // Verify the fetched URL + Authorization header shape
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(String(callArgs[0])).toContain("/instructions/claude-code");
    expect(String(callArgs[0])).toContain("workspace=ws-1");
    const init = callArgs[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok-abc" });
  });

  it("throws when fetch returns non-2xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    } as unknown as Response);

    const bridge = new IdeBridge({
      serviceUrl: "https://example.test",
      ide: "cursor",
      rootDir: tmpRoot,
      tokenProvider: async () => "tok",
      fetchImpl: mockFetch as unknown as typeof fetch,
      logger: silentLogger,
    });

    await expect(bridge.syncOnce()).rejects.toThrow(/Instructions fetch failed: 403/);
  });
});

describe("IdeBridge.lastBackoffMs() exposed for diagnostics", () => {
  it("starts at 0 before any reconnect", () => {
    const bridge = new IdeBridge({
      serviceUrl: "https://example.test",
      ide: "claude-code",
      rootDir: tmpRoot,
      tokenProvider: async () => "tok",
    });
    expect(bridge.lastBackoffMs()).toBe(0);
  });
});

describe("Privacy guard (per feedback_agent_on_user_machine_safety.md)", () => {
  it("syncOnce sends ONLY workspace_id + token — no file path / repo content", async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    const mockFetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      captured.push({ url: String(url), init });
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "<!-- AISHA-MANAGED-START -->\n<!-- AISHA-MANAGED-END -->\n",
      } as unknown as Response);
    });

    const bridge = new IdeBridge({
      serviceUrl: "https://example.test",
      ide: "claude-code",
      workspaceId: "ws-99",
      rootDir: tmpRoot,
      tokenProvider: async () => "tok",
      fetchImpl: mockFetch as unknown as typeof fetch,
      writer: () => ({
        outcome: "written",
        absolutePath: "/x/CLAUDE.md",
        preservedUserSection: false,
        treatedAsUserOwned: false,
      }),
      logger: silentLogger,
    });
    await bridge.syncOnce();

    expect(captured).toHaveLength(1);
    // URL contains workspace_id ONLY (no rootDir, no outputPath)
    expect(captured[0].url).toContain("ws-99");
    expect(captured[0].url).not.toContain(tmpRoot);
    expect(captured[0].url).not.toContain("CLAUDE.md");
    // Body should be absent for a GET
    expect(captured[0].init.body).toBeUndefined();
  });
});
