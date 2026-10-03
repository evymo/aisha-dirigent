/**
 * Extension Architecture Gate Test
 *
 * Static analysis of the aisha-dirigent VS Code extension source code.
 * Validates structure, patterns, security and code hygiene without needing
 * the VS Code runtime environment.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const EXT_SRC = path.resolve(__dirname, "../../../extensions/aisha-dirigent/src");
const EXT_ROOT = path.resolve(EXT_SRC, "..");

/** Read extension source file as string. */
function readExt(filename: string): string {
  return fs.readFileSync(path.join(EXT_SRC, filename), "utf-8");
}

function readRoot(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../../..", relPath), "utf-8");
}

/** All expected extension modules. */
const EXPECTED_MODULES = [
  "extension.ts",
  "participant.ts",
  "session-manager.ts",
  "mcp-client.ts",
  "workspace.ts",
  "story-context.ts",
  "tree-view.ts",
  "status-bar.ts",
  "auto-flow.ts",
  "aisha-push.ts",
  "aisha-context-sync.ts",
];

describe("Extension Architecture", () => {
  describe("VS Code cloud support", () => {
    it("package declares remote-friendly extensionKind", () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, "package.json"), "utf-8"));
      expect(pkg.extensionKind).toEqual(["workspace", "ui"]);
    });

    it("public bootstrap config carries all required endpoint keys", () => {
      // public/.well-known/app-config.json is a runtime artifact during local
      // cold-start and may already be rendered from env. The static contract for
      // placeholders lives in app-config.template.json below; here we only
      // assert the public stub/rendered file keeps the expected shape.
      const appConfig = JSON.parse(readRoot("public/.well-known/app-config.json"));
      for (const key of [
        "aisha_url",
        "keycloak_url",
        "matrix_homeserver_url",
        "matrix_service_url",
        "mcp_url",
        "orchestration_url",
        "web_url",
      ]) {
        expect(appConfig[key], `${key} missing from app-config.json`).toMatch(/^https?:\/\//);
      }
      expect(appConfig.keycloak_url).toContain("/realms/");
      expect(appConfig.matrix_service_url).toContain("/functions/v1/matrix-token-exchange");
      expect(appConfig.mcp_url).toContain("/functions/v1/mcp-knowledge-server");
    });

    it("app-config.template.json mirrors the stub structure with ${VAR} placeholders", () => {
      const template = JSON.parse(readRoot("public/.well-known/app-config.template.json"));
      expect(template.aisha_url).toBe("https://${API_DOMAIN_PUBLIC}");
      expect(template.keycloak_url).toBe("https://${KEYCLOAK_DOMAIN}/realms/${KEYCLOAK_REALM}");
      expect(template.matrix_homeserver_url).toBe("https://${MATRIX_DOMAIN}");
      expect(template.matrix_service_url).toBe("https://${API_DOMAIN_PUBLIC}/functions/v1/matrix-token-exchange");
      expect(template.mcp_url).toBe("https://${API_DOMAIN_PUBLIC}/functions/v1/mcp-knowledge-server");
      expect(template.orchestration_url).toBe("https://${DIRIGENT_DOMAIN}");
      expect(template.web_url).toBe("https://${APP_DOMAIN}");
    });

    it("gateway routes Matrix token exchange to cross-stack container name", () => {
      const gatewayRoutes = readRoot("services/gateway/src/routes/functions.ts");
      const coreCompose = readRoot("docker-compose.coolify.yml");
      // Invariant je SMĚR, ne adresa: gateway posílá matrix operace na
      // svc-matrix v jiném stacku, a compose mu tu adresu dodává. Konkrétní
      // jméno se SKLÁDÁ z identity instance — pinovat literál `aisha-…` by
      // znamenalo hlídat jméno JEDNÉ instance a rozbít každou jinou.
      // (svc-matrix slyší jen na `${APP_NAME_PREFIX}-svc-matrix`; naměřeno
      // 2026-08-13, že literál v compose byl pro forky mrtvá adresa.)
      // ⛔ 2026-08-19: tady stál literál `svc-matrix:3026` — brána PŘEDEPISOVALA
      // hardcode, který jsme zrušili. Vlastnost: routa vede přes matrixUpstream()
      // a helper je fail-closed nad MATRIX_SERVICE_URL (adresa se NEHÁDÁ, nosí ji
      // compose jako http://${APP_NAME_PREFIX}-svc-matrix:3026 — viz řádky níže).
      expect(gatewayRoutes).toMatch(/matrix-token-exchange[\s\S]{0,200}matrixUpstream\(\)/);
      expect(gatewayRoutes).toMatch(/function matrixUpstream[\s\S]{0,300}MATRIX_SERVICE_URL/);
      expect(coreCompose).toMatch(/MATRIX_SERVICE_URL:\s*http:\/\/\$\{APP_NAME_PREFIX[^}]*\}-svc-matrix:3026/);
      expect(coreCompose).toMatch(/SVC_MATRIX_URL:\s*http:\/\/\$\{APP_NAME_PREFIX[^}]*\}-svc-matrix:3026/);
    });

    it("bootstrap persists Keycloak and Matrix cloud endpoints", () => {
      const bootstrap = readExt("bootstrap.ts");
      expect(bootstrap).toContain("profiles[profileName].keycloakUrl = config.keycloak_url");
      expect(bootstrap).toContain("profiles[profileName].matrixUrl = config.matrix_homeserver_url");
      expect(bootstrap).toContain("profiles[profileName].matrixServiceUrl = config.matrix_service_url");
      expect(bootstrap).toContain("profiles[profileName].orchestrationUrl = config.orchestration_url");
    });

    it("Keycloak aisha-app accepts VS Code PKCE callback variants", () => {
      const realm = JSON.parse(readRoot("keycloak/aisha-realm.json"));
      const client = (realm.clients ?? []).find((candidate: { clientId?: string }) => candidate.clientId === "aisha-app");

      expect(client?.redirectUris).toEqual(expect.arrayContaining([
        "vscode://aisha.aisha-dirigent/did-authenticate",
        "vscode://aisha.aisha-dirigent/did-authenticate/",
        "vscode-insiders://aisha.aisha-dirigent/did-authenticate",
        "vscode-insiders://aisha.aisha-dirigent/did-authenticate/",
        "https://vscode.dev/redirect*",
        "https://insiders.vscode.dev/redirect*",
      ]));
    });
  });

  describe("Module existence", () => {
    for (const mod of EXPECTED_MODULES) {
      it(`${mod} exists`, () => {
        const filePath = path.join(EXT_SRC, mod);
        expect(fs.existsSync(filePath), `Missing extension module: ${mod}`).toBe(true);
      });
    }
  });

  describe("Code hygiene", () => {
    for (const mod of EXPECTED_MODULES) {
      const filePath = path.join(EXT_SRC, mod);
      if (!fs.existsSync(filePath)) continue;
      const content = readExt(mod);

      it(`${mod} — no console.log()`, () => {
        // Extension should use vscode.window.show*Message or OutputChannel
        const matches = content.match(/\bconsole\.log\b/g);
        expect(matches, `Found console.log in ${mod}`).toBeNull();
      });

      it(`${mod} — no hardcoded secrets`, () => {
        // Check for patterns that look like API keys or tokens
        const secretPatterns = [
          /(?:key|token|secret|password)\s*[:=]\s*["'][A-Za-z0-9+/=]{20,}["']/gi,
          /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT pattern
        ];
        for (const pattern of secretPatterns) {
          const match = content.match(pattern);
          expect(match, `Possible hardcoded secret in ${mod}: ${match?.[0]?.substring(0, 30)}`).toBeNull();
        }
      });

      it(`${mod} — no @ts-ignore`, () => {
        const matches = content.match(/@ts-ignore/g);
        expect(matches, `Found @ts-ignore in ${mod} — use @ts-expect-error`).toBeNull();
      });

      it(`${mod} — has module JSDoc`, () => {
        expect(content, `${mod} should have a module-level JSDoc comment`).toMatch(
          /\/\*\*[\s\S]*?\*\s*@module/,
        );
      });
    }
  });

  describe("Security patterns", () => {
    it("mcp-client.ts — uses Bearer token auth", () => {
      const content = readExt("mcp-client.ts");
      expect(content).toContain("Authorization");
      expect(content).toContain("Bearer");
    });

    it("mcp-client.ts — has request timeout", () => {
      const content = readExt("mcp-client.ts");
      expect(content).toMatch(/AbortSignal\.timeout/);
    });

    it("mcp-client.ts — truncates error messages in UI", () => {
      const content = readExt("mcp-client.ts");
      // Should not display raw server responses — truncate them
      expect(content).toMatch(/\.substring\(0,\s*\d+\)/);
    });

    it("session-manager.ts — persists to .aisha/ (not root)", () => {
      const content = readExt("session-manager.ts");
      expect(content).toContain(".aisha");
      expect(content).toContain("session.json");
    });

    it("participant.ts — does not expose secrets in stream output", () => {
      const content = readExt("participant.ts");
      // participant should not log tokens, keys, or passwords
      expect(content).not.toMatch(/stream\.markdown.*(?:token|key|password|secret)/i);
    });
  });

  describe("Chat command coverage", () => {
    it("all package.json commands have handlers in participant.ts", () => {
      const pkgPath = path.resolve(EXT_SRC, "../package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const participant = readExt("participant.ts");

      const chatParticipants = pkg.contributes?.chatParticipants ?? [];
      const commands: string[] = [];
      for (const cp of chatParticipants) {
        for (const cmd of cp.commands ?? []) {
          commands.push(cmd.name);
        }
      }

      expect(commands.length).toBeGreaterThan(0);

      // COMMAND_HANDLERS map should contain each command (quoted or unquoted key)
      for (const cmd of commands) {
        expect(
          participant,
          `Missing handler for command '${cmd}' in participant.ts COMMAND_HANDLERS`,
        ).toMatch(new RegExp(`(?:["']${cmd}["']|\\b${cmd}\\b)\\s*:`));
      }
    });
  });

  describe("Import structure", () => {
    it("participant.ts imports from mcp-client and session-manager", () => {
      const content = readExt("participant.ts");
      expect(content).toMatch(/from\s+["']\.\/mcp-client["']/);
      expect(content).toMatch(/from\s+["']\.\/session-manager["']/);
    });

    it("session-manager.ts imports from mcp-client", () => {
      const content = readExt("session-manager.ts");
      expect(content).toMatch(/from\s+["']\.\/mcp-client["']/);
    });

    it("extension.ts is the entrypoint that imports key modules", () => {
      const content = readExt("extension.ts");
      expect(content).toMatch(/from\s+["']\.\/participant["']/);
      expect(content).toMatch(/from\s+["']\.\/session-manager["']/);
      expect(content).toMatch(/from\s+["']\.\/mcp-client["']/);
    });
  });

  describe("Ring buffer implementation", () => {
    it("session-manager.ts has MAX_HISTORY constant", () => {
      const content = readExt("session-manager.ts");
      const match = content.match(/const\s+MAX_HISTORY\s*=\s*(\d+)/);
      expect(match, "MAX_HISTORY constant not found").not.toBeNull();
      const maxHistory = parseInt(match![1], 10);
      expect(maxHistory).toBeGreaterThanOrEqual(5);
      expect(maxHistory).toBeLessThanOrEqual(100);
    });

    it("session-manager.ts ring buffer uses shift()", () => {
      const content = readExt("session-manager.ts");
      // Ring buffer pattern: push + shift when over max
      expect(content).toMatch(/\.push\(/);
      expect(content).toMatch(/\.shift\(\)/);
    });
  });

  describe("Error handling", () => {
    it("mcp-client.ts — callMcpTool has try-catch", () => {
      const content = readExt("mcp-client.ts");
      // Extract callMcpTool function and verify it has try-catch
      const fnMatch = content.match(/async function callMcpTool[\s\S]*?^}/m);
      expect(fnMatch).not.toBeNull();
      expect(fnMatch![0]).toContain("try");
      expect(fnMatch![0]).toContain("catch");
    });

    it("mcp-client.ts — callN8nAgent has try-catch", () => {
      const content = readExt("mcp-client.ts");
      const fnMatch = content.match(/async function callN8nAgent[\s\S]*?^}/m);
      expect(fnMatch).not.toBeNull();
      expect(fnMatch![0]).toContain("try");
      expect(fnMatch![0]).toContain("catch");
    });

    it("participant.ts — handleChatRequest has top-level try-catch", () => {
      const content = readExt("participant.ts");
      const fnMatch = content.match(/async function handleChatRequest[\s\S]*?^}/m);
      expect(fnMatch).not.toBeNull();
      expect(fnMatch![0]).toContain("try");
      expect(fnMatch![0]).toContain("catch");
    });
  });

  describe("Intent detection coverage", () => {
    it("participant.ts covers all expected intents", () => {
      const content = readExt("participant.ts");
      const expectedIntents = [
        "debug",
        "test_strategy",
        "compliance",
        "delivery",
        "estimate",
        "knowledge",
        "code_review",
        "general",
      ];

      for (const intent of expectedIntents) {
        expect(
          content,
          `Missing intent handling for '${intent}'`,
        ).toContain(`"${intent}"`);
      }
    });
  });
});
