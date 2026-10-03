/**
 * Tests for bootstrap.ts — cloud bootstrap config persistence.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";

vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const bootstrapPayload = {
  aisha_url: "https://api.aisha.guru",
  anon_key: "anon-public-key",
  keycloak_url: "https://auth.aisha.guru/realms/aisha",
  mcp_url: "https://api.aisha.guru/functions/v1/mcp-knowledge-server",
  orchestration_url: "https://dirigent.aisha.guru",
  n8n_trigger_url: "https://api.aisha.guru/admin/n8n-trigger",
  web_url: "https://web.aisha.guru",
  matrix_homeserver_url: "https://matrix.backend.id3a.cz",
  matrix_service_url: "https://api.aisha.guru/functions/v1/matrix-token-exchange",
};

describe("bootstrap.ts", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => bootstrapPayload,
    })) as typeof fetch;

    const vscode = await import("vscode");
    (vscode.workspace as unknown as { workspaceFolders: Array<{ uri: { fsPath: string } }> }).workspaceFolders = [
      { uri: { fsPath: "/workspace" } },
    ];
  });

  it("persists cloud API, Keycloak and Matrix endpoints into active profile", async () => {
    const { ensureBootstrapConfig } = await import("../src/bootstrap");

    const result = await ensureBootstrapConfig("cloud", "https://api.aisha.guru/.well-known/app-config.json");

    expect(result).toMatchObject({
      anonKey: "anon-public-key",
      bootstrapped: true,
      // Canonical field name is aishaUrl — the legacy backend-era alias was
      // removed with the KC migration (and its identifier is repo-banned).
      aishaUrl: "https://api.aisha.guru",
    });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/workspace/.aisha/dirigent.local.json",
      expect.stringContaining('"keycloakUrl": "https://auth.aisha.guru/realms/aisha"'),
      "utf8",
    );
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
    expect(written).toContain('"matrixUrl": "https://matrix.backend.id3a.cz"');
    expect(written).toContain('"matrixServiceUrl": "https://api.aisha.guru/functions/v1/matrix-token-exchange"');
    expect(written).toContain('"mcpUrl": "https://api.aisha.guru/functions/v1/mcp-knowledge-server"');
    expect(written).toContain('"orchestrationUrl": "https://dirigent.aisha.guru"');
    expect(written).toContain('"n8nTriggerUrl": "https://api.aisha.guru/admin/n8n-trigger"');
    expect(written).toContain('"webUrl": "https://web.aisha.guru"');
  });
});