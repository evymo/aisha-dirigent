/**
 * Tests for webview-security.ts and webview CSP hardening.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendWebPath, buildFrameSrcCsp, getNonce, sanitizeWebviewFrameUrl } from "../src/webview-security";

const mockGetDirigentConfig = vi.fn(() => ({
  aishaUrl: "http://127.0.0.1:57421",
  anonKey: "test-anon",
  mcpUrl: "",
  n8nTriggerUrl: "",
  storyId: "",
  expertiseLevel: "intermediate",
  instanceLabel: "",
  activeProfile: "local",
  profiles: {
    local: {
      dashboardUrl: "http://127.0.0.1:8090",
    },
  },
  dashboardUrl: "http://127.0.0.1:8090",
}));

vi.mock("../src/config", () => ({
  getDirigentConfig: (...args: unknown[]) => mockGetDirigentConfig(...args),
  onConfigChanged: vi.fn(() => ({ dispose: () => {} })),
}));

vi.mock("../src/story-context", () => ({
  resolveStoryContext: vi.fn().mockResolvedValue({ storyId: null }),
}));

vi.mock("../src/resource-tracker", () => ({
  recordChildProcess: vi.fn(),
}));

import { DashboardViewProvider } from "../src/dashboardView";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, "..");

describe("webview-security.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDirigentConfig.mockReturnValue({
      aishaUrl: "http://127.0.0.1:57421",
      anonKey: "test-anon",
      mcpUrl: "",
      n8nTriggerUrl: "",
      storyId: "",
      expertiseLevel: "intermediate",
      instanceLabel: "",
      activeProfile: "local",
      profiles: {
        local: {
          dashboardUrl: "http://127.0.0.1:8090",
        },
      },
      dashboardUrl: "http://127.0.0.1:8090",
    });
  });

  it("generates CSP nonces with the expected alphabet and length", () => {
    expect(getNonce()).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it("sanitizes iframe URLs before HTML/CSP use", () => {
    expect(sanitizeWebviewFrameUrl(" https://example.test/dashboard/ ")).toBe("https://example.test/dashboard");
    expect(sanitizeWebviewFrameUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeWebviewFrameUrl("https://user:pass@example.test")).toBe("");
    expect(sanitizeWebviewFrameUrl('https://example.test/" onload="alert(1)')).toBe("");
  });

  it("builds frame-src from sanitized origins only", () => {
    expect(buildFrameSrcCsp([
      "https://example.test/dashboard",
      "https://example.test/other",
      "http://127.0.0.1:8090/admin",
      'https://evil.test/" onload="alert(1)',
    ])).toBe("https://example.test http://127.0.0.1:8090");
    expect(buildFrameSrcCsp(["javascript:alert(1)"])).toBe("about:blank");
  });

  it("appends paths only to sanitized http(s) bases", () => {
    expect(appendWebPath("https://example.test/base", "/admin/mission-control")).toBe(
      "https://example.test/admin/mission-control",
    );
    expect(appendWebPath('https://example.test/" onclick="alert(1)', "/admin")).toBe("");
  });

  it("renders dashboard webview without raw unsafe CSP or postMessage wildcard", () => {
    mockGetDirigentConfig.mockReturnValue({
      aishaUrl: "http://127.0.0.1:57421",
      anonKey: "test-anon",
      mcpUrl: "",
      n8nTriggerUrl: "",
      storyId: "",
      expertiseLevel: "intermediate",
      instanceLabel: "",
      activeProfile: "local",
      profiles: {
        local: {
          dashboardUrl: 'https://evil.test/" onload="alert(1)',
        },
      },
      dashboardUrl: 'https://evil.test/" onload="alert(1)',
    });

    const view = {
      webview: {
        cspSource: "vscode-webview://test",
        options: {},
        html: "",
        postMessage: vi.fn(async () => true),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      onDidChangeVisibility: () => ({ dispose: () => {} }),
    };

    const provider = new DashboardViewProvider({ fsPath: "/test" } as never);
    provider.resolveWebviewView(
      view as never,
      {} as never,
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as never,
    );

    expect(view.webview.html).toMatch(/Content-Security-Policy/);
    expect(view.webview.html).toMatch(/nonce-[A-Za-z0-9]{32}/);
    expect(view.webview.html).toContain("<style nonce=");
    expect(view.webview.html).toContain("<script nonce=");
    expect(view.webview.html).not.toContain("unsafe-inline");
    expect(view.webview.html).not.toContain('https://evil.test/" onload="alert(1)');
    expect(view.webview.html).not.toContain('postMessage(e.data, "*")');
  });

  it("keeps extension webviews on nonce-based CSP", () => {
    const sourceFiles = [
      "src/setup-panel/SetupPanel.ts",
      "src/dashboard-panel/DashboardPanel.ts",
      "src/dashboardView.ts",
      "src/story-chat-view.ts",
      "src/story-panel-provider.ts",
    ];

    for (const relativePath of sourceFiles) {
      const source = fs.readFileSync(path.join(extensionRoot, relativePath), "utf8");
      expect(source, relativePath).not.toContain("unsafe-inline");
      expect(source, relativePath).toContain("nonce");
    }
  });
});
