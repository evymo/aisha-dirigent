/**
 * Tests for config.ts — profile merging, deep merge, connection labels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// Mock fs module for controlled test data
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
}));

const WORKSPACE = "/test/workspace";

type MockVscode = {
  __setMockConfig: (key: string, value: unknown) => void;
  __clearMockConfig: () => void;
};

/** Declare the operator's TLD pair on the (fresh) vscode mock. */
async function setTldPair(cloudTLD: string, internalTLD: string) {
  const vscode = (await import("vscode")) as unknown as MockVscode;
  vscode.__setMockConfig("aisha.dirigent.cloudTLD", cloudTLD);
  vscode.__setMockConfig("aisha.dirigent.internalTLD", internalTLD);
}

/**
 * Helper: configure fs mocks for specific files and re-import config module.
 */
async function loadConfigWith(files: Record<string, unknown>) {
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    return Object.keys(files).some((key) => String(p).endsWith(key));
  });
  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    for (const [key, value] of Object.entries(files)) {
      if (String(p).endsWith(key)) {
        return JSON.stringify(value);
      }
    }
    return "{}";
  });

  vi.resetModules();

  // Set workspace folders on the freshly imported vscode mock
  const vscode = await import("vscode");
  (vscode.workspace as Record<string, unknown>).workspaceFolders = [
    { uri: { fsPath: WORKSPACE } },
  ];

  return await import("../src/config");
}

describe("config.ts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveConnectionLabel", () => {
    it("returns 'Local Dev' for localhost", async () => {
      const { resolveConnectionLabel } = await import("../src/config");
      expect(resolveConnectionLabel("http://127.0.0.1:57421")).toBe("Local Dev");
      expect(resolveConnectionLabel("http://localhost:57421")).toBe("Local Dev");
    });

    it("returns 'AISHA Cloud' for the operator's configured TLD pair", async () => {
      const { resolveConnectionLabel } = await import("../src/config");
      const vscode = (await import("vscode")) as unknown as MockVscode;
      vscode.__setMockConfig("aisha.dirigent.cloudTLD", "example.com");
      vscode.__setMockConfig("aisha.dirigent.internalTLD", "internal.example.com");
      try {
        expect(resolveConnectionLabel("https://api.example.com")).toBe("AISHA Cloud");
        expect(resolveConnectionLabel("https://api.internal.example.com")).toBe("AISHA Cloud");
      } finally {
        vscode.__clearMockConfig();
      }
    });

    it("has no built-in hosted domain — without a TLD pair it shows the hostname", async () => {
      const { resolveConnectionLabel } = await import("../src/config");
      expect(resolveConnectionLabel("https://api.aisha.guru")).toBe("api.aisha.guru");
      expect(resolveConnectionLabel("https://api.backend.id3a.cz")).toBe("api.backend.id3a.cz");
    });

    it("returns custom label when instanceLabel is provided", async () => {
      const { resolveConnectionLabel } = await import("../src/config");
      expect(resolveConnectionLabel("http://any.url", "My Custom")).toBe("My Custom");
    });

    it("returns 'Not Connected' for empty URL", async () => {
      const { resolveConnectionLabel } = await import("../src/config");
      expect(resolveConnectionLabel("")).toBe("Not Connected");
    });
  });

  describe("getDirigentConfig — profile merge", () => {
    it("uses local profile when activeProfile=local", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": {
          activeProfile: "local",
          profiles: {
            local: {
              aishaUrl: "http://127.0.0.1:57421",
              anonKey: "local-anon-key",
            },
            cloud: {
              aishaUrl: "https://api.example.com",
              keycloakUrl: "https://auth.example.com/realms/aisha",
              matrixUrl: "https://matrix.internal.example.com",
              matrixServiceUrl: "https://api.example.com/functions/v1/matrix-token-exchange",
            },
          },
          expertiseLevel: "expert",
        },
        "dirigent.local.json": {
          activeProfile: "local",
          profiles: {
            local: { mcpUrl: "http://127.0.0.1:57421/custom-mcp" },
          },
        },
      });

      const config = getDirigentConfig();

      expect(config.activeProfile).toBe("local");
      expect(config.aishaUrl).toBe("http://127.0.0.1:57421");
      expect(config.anonKey).toBe("local-anon-key");
      expect(config.mcpUrl).toBe("http://127.0.0.1:57421/custom-mcp");
    });

    it("uses cloud profile when activeProfile=cloud", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": {
          activeProfile: "local",
          profiles: {
            local: {
              aishaUrl: "http://127.0.0.1:57421",
              anonKey: "local-anon-key",
            },
            cloud: {
              aishaUrl: "https://api.example.com",
            },
          },
        },
        "dirigent.local.json": {
          activeProfile: "cloud",
          profiles: {
            cloud: {
              anonKey: "prod-anon-key",
            },
          },
        },
      });

      // Matrix lives on the internal plane — only the operator's TLD pair says where.
      await setTldPair("example.com", "internal.example.com");
      const config = getDirigentConfig();

      expect(config.activeProfile).toBe("cloud");
      expect(config.aishaUrl).toBe("https://api.example.com");
      expect(config.anonKey).toBe("prod-anon-key");
      expect(config.keycloakUrl).toBe("https://auth.example.com/realms/aisha");
      expect(config.matrixUrl).toBe("https://matrix.internal.example.com");
      expect(config.matrixServiceUrl).toBe("https://api.example.com/functions/v1/matrix-token-exchange");
    });

    it("deep-merges local profile secrets into tracked profile", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": {
          activeProfile: "cloud",
          profiles: {
            cloud: {
              aishaUrl: "https://api.example.com",
            },
          },
        },
        "dirigent.local.json": {
          profiles: {
            cloud: {
              anonKey: "secret-anon",
            },
          },
        },
      });

      await setTldPair("example.com", "internal.example.com");
      const config = getDirigentConfig();

      // URL from tracked, secrets from local
      expect(config.aishaUrl).toBe("https://api.example.com");
      expect(config.anonKey).toBe("secret-anon");
      expect(config.keycloakUrl).toBe("https://auth.example.com/realms/aisha");
      expect(config.matrixUrl).toBe("https://matrix.internal.example.com");
      expect(config.matrixServiceUrl).toBe("https://api.example.com/functions/v1/matrix-token-exchange");

      // Merged profiles should contain both
      expect(config.profiles.cloud.aishaUrl).toBe("https://api.example.com");
      expect(config.profiles.cloud.anonKey).toBe("secret-anon");
    });

    it("defaults to the local stack gateway when nothing is configured", async () => {
      const { getDirigentConfig, DEFAULT_LOCAL_AISHA_URL } = await loadConfigWith({});

      const config = getDirigentConfig();

      expect(DEFAULT_LOCAL_AISHA_URL).toBe("http://localhost:3001");
      expect(config.aishaUrl).toBe("http://localhost:3001");
      expect(config.mcpUrl).toBe("http://localhost:3001/functions/v1/mcp-knowledge-server");
      expect(config.keycloakUrl).toBe("http://localhost:8180/realms/aisha");
    });

    it("an MCP URL alone still wins over the local default", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": { mcpUrl: "https://api.example.com/functions/v1/mcp-knowledge-server" },
      });

      expect(getDirigentConfig().aishaUrl).toBe("https://api.example.com");
    });

    it("derives mcpUrl from aishaUrl when not set", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": {
          activeProfile: "local",
          profiles: {
            local: {
              aishaUrl: "http://127.0.0.1:57421",
              anonKey: "key",
            },
          },
        },
        "dirigent.local.json": {},
      });

      const config = getDirigentConfig();

      expect(config.mcpUrl).toBe(
        "http://127.0.0.1:57421/functions/v1/mcp-knowledge-server",
      );
      expect(config.n8nTriggerUrl).toBe(
        "http://127.0.0.1:57421/admin/n8n-trigger",
      );
    });

    it("uses gateway MCP endpoint and canonical Keycloak for AISHA Cloud", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": {
          activeProfile: "cloud",
          profiles: {
            cloud: {
              aishaUrl: "https://api.example.com",
              anonKey: "prod-anon-key",
            },
          },
        },
        "dirigent.local.json": {},
      });

      const config = getDirigentConfig();

      expect(config.aishaUrl).toBe("https://api.example.com");
      expect(config.mcpUrl).toBe("https://api.example.com/functions/v1/mcp-knowledge-server");
      expect(config.keycloakUrl).toBe("https://auth.example.com/realms/aisha");
      expect(config.n8nTriggerUrl).toBe("https://api.example.com/admin/n8n-trigger");
      expect(config.bootstrapUrl).toBe("https://api.example.com/.well-known/app-config.json");
      expect(config.webUrl).toBe("https://web.example.com");
      expect(config.orchestrationUrl).toBe("https://dirigent.example.com");
    });

    it("derives public API URL from gateway MCP URL", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": {
          activeProfile: "cloud",
          profiles: {
            cloud: {
              mcpUrl: "https://api.internal.example.com/functions/v1/mcp-knowledge-server",
              anonKey: "prod-anon-key",
            },
          },
        },
        "dirigent.local.json": {},
      });

      const config = getDirigentConfig();

      expect(config.aishaUrl).toBe("https://api.internal.example.com");
      expect(config.keycloakUrl).toBe("https://auth.internal.example.com/realms/aisha");
      expect(config.mcpUrl).toBe("https://api.internal.example.com/functions/v1/mcp-knowledge-server");
    });

    it("local.json activeProfile overrides tracked activeProfile", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": {
          activeProfile: "local",
          profiles: {
            local: { aishaUrl: "http://127.0.0.1:57421", anonKey: "l" },
            cloud: { aishaUrl: "https://prod.example.com", anonKey: "p" },
          },
        },
        "dirigent.local.json": {
          activeProfile: "cloud",
        },
      });

      const config = getDirigentConfig();

      expect(config.activeProfile).toBe("cloud");
      expect(config.aishaUrl).toBe("https://prod.example.com");
    });

    it("returns profile names from both files in getAvailableProfiles", async () => {
      const { getAvailableProfiles } = await loadConfigWith({
        "dirigent.json": {
          profiles: {
            local: { aishaUrl: "http://localhost" },
            cloud: { aishaUrl: "https://prod" },
          },
        },
        "dirigent.local.json": {
          profiles: {
            staging: { aishaUrl: "https://staging" },
          },
        },
      });

      const profiles = getAvailableProfiles();

      expect(profiles).toContain("local");
      expect(profiles).toContain("cloud");
      expect(profiles).toContain("staging");
    });
  });
});
