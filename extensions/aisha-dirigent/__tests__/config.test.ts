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

    it("returns 'AISHA Cloud' for AISHA platform domains", async () => {
      const { resolveConnectionLabel } = await import("../src/config");
      expect(resolveConnectionLabel("https://api.aisha.guru")).toBe("AISHA Cloud");
      expect(resolveConnectionLabel("https://api.backend.id3a.cz")).toBe("AISHA Cloud");
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
              aishaUrl: "https://api.aisha.guru",
              keycloakUrl: "https://auth.aisha.guru/realms/aisha",
              matrixUrl: "https://matrix.backend.id3a.cz",
              matrixServiceUrl: "https://api.aisha.guru/functions/v1/matrix-token-exchange",
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
              aishaUrl: "https://api.aisha.guru",
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

      const config = getDirigentConfig();

      expect(config.activeProfile).toBe("cloud");
      expect(config.aishaUrl).toBe("https://api.aisha.guru");
      expect(config.anonKey).toBe("prod-anon-key");
      expect(config.keycloakUrl).toBe("https://auth.aisha.guru/realms/aisha");
      expect(config.matrixUrl).toBe("https://matrix.backend.id3a.cz");
      expect(config.matrixServiceUrl).toBe("https://api.aisha.guru/functions/v1/matrix-token-exchange");
    });

    it("deep-merges local profile secrets into tracked profile", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": {
          activeProfile: "cloud",
          profiles: {
            cloud: {
              aishaUrl: "https://api.aisha.guru",
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

      const config = getDirigentConfig();

      // URL from tracked, secrets from local
      expect(config.aishaUrl).toBe("https://api.aisha.guru");
      expect(config.anonKey).toBe("secret-anon");
      expect(config.keycloakUrl).toBe("https://auth.aisha.guru/realms/aisha");
      expect(config.matrixUrl).toBe("https://matrix.backend.id3a.cz");
      expect(config.matrixServiceUrl).toBe("https://api.aisha.guru/functions/v1/matrix-token-exchange");

      // Merged profiles should contain both
      expect(config.profiles.cloud.aishaUrl).toBe("https://api.aisha.guru");
      expect(config.profiles.cloud.anonKey).toBe("secret-anon");
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
              aishaUrl: "https://api.aisha.guru",
              anonKey: "prod-anon-key",
            },
          },
        },
        "dirigent.local.json": {},
      });

      const config = getDirigentConfig();

      expect(config.aishaUrl).toBe("https://api.aisha.guru");
      expect(config.mcpUrl).toBe("https://api.aisha.guru/functions/v1/mcp-knowledge-server");
      expect(config.keycloakUrl).toBe("https://auth.aisha.guru/realms/aisha");
      expect(config.n8nTriggerUrl).toBe("https://api.aisha.guru/admin/n8n-trigger");
      expect(config.bootstrapUrl).toBe("https://api.aisha.guru/.well-known/app-config.json");
      expect(config.webUrl).toBe("https://web.aisha.guru");
      expect(config.orchestrationUrl).toBe("https://dirigent.aisha.guru");
    });

    it("derives public API URL from gateway MCP URL", async () => {
      const { getDirigentConfig } = await loadConfigWith({
        "dirigent.json": {
          activeProfile: "cloud",
          profiles: {
            cloud: {
              mcpUrl: "https://api.backend.id3a.cz/functions/v1/mcp-knowledge-server",
              anonKey: "prod-anon-key",
            },
          },
        },
        "dirigent.local.json": {},
      });

      const config = getDirigentConfig();

      expect(config.aishaUrl).toBe("https://api.backend.id3a.cz");
      expect(config.keycloakUrl).toBe("https://auth.backend.id3a.cz/realms/aisha");
      expect(config.mcpUrl).toBe("https://api.backend.id3a.cz/functions/v1/mcp-knowledge-server");
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
