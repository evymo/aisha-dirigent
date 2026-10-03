/**
 * @file claude-overlay-runtime.gate.test.ts
 * End-to-end functional test for the generated Dirigent advisory hooks.
 *
 * Unlike the drift test (which checks committed bytes), this test actually
 * INVOKES the committed shell hooks via execFile and asserts their runtime
 * behaviour matches the contract:
 *   1. Hook fires (writes advisory text to stdout) when input matches the pattern.
 *   2. Hook stays silent when input doesn't match (just exits 0).
 *   3. Hook exits 0 in BOTH cases — never blocks.
 *   4. Hook respects the 45s cooldown gate.
 *
 * Run: npm run test:gates
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync, ExecFileSyncOptions } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import path from "path";
import os from "os";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOK_DIR = path.join(REPO_ROOT, ".claude", "hooks");

/**
 * Per-test sandbox: own session id + own /tmp dir so cooldown files don't
 * collide across tests and don't leak past the run.
 */
let sandbox: { sessionId: string; tmpDir: string };

beforeEach(() => {
  sandbox = {
    sessionId: `test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tmpDir: mkdtempSync(path.join(os.tmpdir(), "aisha-overlay-test-")),
  };
});

afterEach(() => {
  // Clean cooldown files this test may have created in /tmp
  try {
    execFileSync("sh", ["-c", `rm -f /tmp/aisha-advise-*-${sandbox.sessionId}`]);
  } catch {
    // best-effort
  }
  try {
    rmSync(sandbox.tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

/** Invoke a hook with the given CLAUDE_HOOK_TOOL_INPUT. Returns { stdout, exitCode }. */
function runHook(
  hookName: string,
  toolInput: object | string,
): { stdout: string; exitCode: number } {
  const input = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput);
  const opts: ExecFileSyncOptions = {
    env: {
      ...process.env,
      CLAUDE_HOOK_TOOL_INPUT: input,
      CLAUDE_SESSION_ID: sandbox.sessionId,
    },
    encoding: "utf-8",
  };
  try {
    const stdout = execFileSync(path.join(HOOK_DIR, hookName), [], opts);
    return { stdout: stdout.toString(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: Buffer | string };
    return {
      stdout: e.stdout?.toString() ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("AISHA Dirigent Claude Overlay — Runtime Behaviour", () => {
  describe("rpc-only hook (regex from claude_hook_bindings)", () => {
    it("fires on .from('users').select() in TS file", () => {
      const result = runHook("aisha-advise-rpc.sh", {
        file_path: "src/api/users.ts",
        new_string: 'const data = await apiClient.from("users").select("id");',
      });
      expect(result.exitCode).toBe(0); // advisory: always exit 0
      expect(result.stdout).toContain("AISHA Advisor");
      expect(result.stdout).toContain("rpc-only");
      expect(result.stdout).toContain("RPC-Only:");
    });

    it("stays silent on refactor TOWARD rpc (no .from match)", () => {
      const result = runHook("aisha-advise-rpc.sh", {
        file_path: "src/api/users.ts",
        new_string: 'const data = await apiClient.rpc("get_users", { p_limit: 10 });',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("does NOT emit decision:deny/block (advisory-only invariant)", () => {
      const result = runHook("aisha-advise-rpc.sh", {
        file_path: "src/api/users.ts",
        new_string: 'apiClient.from("users").select("*");',
      });
      expect(result.stdout).not.toContain('"decision"');
      expect(result.stdout).not.toContain('"deny"');
      expect(result.stdout).not.toContain('"block"');
    });

    it("respects 45s cooldown — second invocation in same session is silent", () => {
      const input = {
        file_path: "src/api/users.ts",
        new_string: 'apiClient.from("users").select("id");',
      };
      const first = runHook("aisha-advise-rpc.sh", input);
      expect(first.stdout).toContain("AISHA Advisor");

      const second = runHook("aisha-advise-rpc.sh", input);
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toBe("");
    });
  });

  describe("no-console hook", () => {
    it("fires on console.log in .ts file", () => {
      const result = runHook("aisha-advise-console.sh", {
        file_path: "src/services/foo.ts",
        new_string: 'console.log("debug");',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("AISHA Advisor");
      expect(result.stdout).toContain("no-console");
    });

    it("exits 0 and stays advisory regardless of file type (MVP — no file-extension filter in claude_hook_bindings yet)", () => {
      // The MVP schema has no file_extensions column. When that lands as a
      // future iteration of claude_hook_bindings, this test gets stricter:
      //   expect(result.stdout).toBe("");
      // Today it must at minimum stay advisory (exit 0, no decision:deny).
      const result = runHook("aisha-advise-console.sh", {
        file_path: "README.md",
        new_string: "Example: `console.log(value)`",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('"decision"');
    });
  });

  describe("no-any hook", () => {
    it("fires on `as any` cast", () => {
      const result = runHook("aisha-advise-any.sh", {
        new_string: "const x = something as any;",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("any");
      expect(result.stdout).toContain("AISHA Advisor");
    });

    it("fires on `: any` annotation", () => {
      const result = runHook("aisha-advise-any.sh", {
        new_string: "function foo(x: any): void {}",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("AISHA Advisor");
    });

    it("stays silent on `unknown` (the correct alternative)", () => {
      const result = runHook("aisha-advise-any.sh", {
        new_string: "function foo(x: unknown): void {}",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  describe("ts-ignore hook", () => {
    it("fires on @ts-ignore comment", () => {
      const result = runHook("aisha-advise-ts-ignore.sh", {
        new_string: "// @ts-ignore\nconst x: number = 'wrong';",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("AISHA Advisor");
      expect(result.stdout).toContain("ts-ignore");
    });

    it("stays silent on @ts-expect-error (the correct alternative)", () => {
      const result = runHook("aisha-advise-ts-ignore.sh", {
        new_string: "// @ts-expect-error: legacy lib not typed\nconst x: number = legacyFn();",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  describe("select-star hook", () => {
    it('fires on .select("*")', () => {
      const result = runHook("aisha-advise-select-star.sh", {
        new_string: 'await apiClient.from("users").select("*");',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("AISHA Advisor");
      expect(result.stdout).toContain("select-star");
    });

    it('stays silent on .select("id, email") with explicit columns', () => {
      const result = runHook("aisha-advise-select-star.sh", {
        new_string: 'await apiClient.from("users").select("id, email");',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  describe("bash-risk hook (static heuristic)", () => {
    it("warns on git push --force to main", () => {
      const result = runHook("aisha-advise-bash-risk.sh", {
        command: "git push --force origin main",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("AISHA Advisor");
      expect(result.stdout).toContain("force");
    });

    it("warns on --no-verify bypass", () => {
      const result = runHook("aisha-advise-bash-risk.sh", {
        command: "git commit -m 'fix' --no-verify",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--no-verify");
    });

    /**
     * ⛔ DOPLNĚNO 2026-08-10. Větev nad tímhle hlídala jen `--no-verify`, takže
     * `HUSKY=0` procházela bez povšimnutí — a je to TÁŽ věc jiným vchodem:
     * vypne pre-commit i pre-push. Starší zápisy v repu ji dokonce doporučovaly
     * jako řešení dlouhého hooku; to je zaznamenaná CHYBA, ne recept.
     */
    it("warns on HUSKY=0 (the other way to disable the same hooks)", () => {
      const result = runHook("aisha-advise-bash-risk.sh", {
        command: "HUSKY=0 git commit -m 'fix'",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("HUSKY=0");
    });

    it("warns on `git commit -n` (short form of --no-verify)", () => {
      const result = runHook("aisha-advise-bash-risk.sh", {
        command: "git commit -m 'fix' -n",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("-n");
    });

    /**
     * ⚠️ Záporné tvrzení, bez kterého by šlo to výš „splnit" plošným hledáním
     * `-n`: u `git push` znamená `-n` DRY-RUN, tedy pravý opak rizika.
     * Poplach nad zkouškou nasucho by hook naučil ignorovat.
     */
    it("stays silent on `git push -n` — that is --dry-run, not --no-verify", () => {
      const result = runHook("aisha-advise-bash-risk.sh", {
        command: "git push -n origin main",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("--no-verify");
      expect(result.stdout).not.toContain("HUSKY=0");
    });

    it("stays silent on benign git status", () => {
      const result = runHook("aisha-advise-bash-risk.sh", {
        command: "git status --short",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  describe("aisha-supervisor-relay.mjs (Vrstva 2 HTTP relay)", () => {
    // The relay script POSTs to the dirigent-supervisor edge fn. We verify
    // ONLY the cold-start parity here (no AISHA_MCP_TOKEN / no AISHA_GATEWAY_URL
    // = silent exit 0); end-to-end with a live edge fn is covered separately
    // when the service is deployed.
    //
    // Node script (not bash + curl) because aisha-self-tooling.gate forbids
    // shell-out to network commands in .sh hooks.

    function runRelay(
      event: string,
      env: Record<string, string> = {},
    ): { stdout: string; exitCode: number } {
      const opts: ExecFileSyncOptions = {
        env: { ...process.env, ...env },
        encoding: "utf-8",
      };
      try {
        const stdout = execFileSync(
          "node",
          [path.join(HOOK_DIR, "aisha-supervisor-relay.mjs"), event],
          opts,
        );
        return { stdout: stdout.toString(), exitCode: 0 };
      } catch (err: unknown) {
        const e = err as { status?: number; stdout?: Buffer | string };
        return {
          stdout: e.stdout?.toString() ?? "",
          exitCode: e.status ?? 1,
        };
      }
    }

    it("exits 0 silently when AISHA_MCP_TOKEN is missing (cold start)", () => {
      const result = runRelay("session_start", {
        AISHA_MCP_TOKEN: "",
        AISHA_GATEWAY_URL: "https://api.test.example",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("exits 0 silently when AISHA_GATEWAY_URL is missing (cold start)", () => {
      const result = runRelay("stop", {
        AISHA_MCP_TOKEN: "dummy",
        AISHA_GATEWAY_URL: "",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("exits 0 silently when both envs are unset (canonical offline mode)", () => {
      // Explicit empty values to override any inherited env from CI
      const result = runRelay("post_tool", {
        AISHA_MCP_TOKEN: "",
        AISHA_GATEWAY_URL: "",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("never emits decision:deny/block (advisory invariant even with envs set)", () => {
      // Point to a non-existent host — curl will fail, hook must still exit 0
      const result = runRelay("post_tool", {
        AISHA_MCP_TOKEN: "dummy",
        AISHA_GATEWAY_URL: "http://127.0.0.1:1", // closed port → connection refused
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('"decision"');
      expect(result.stdout).not.toContain('"deny"');
      expect(result.stdout).not.toContain('"block"');
    });
  });

  describe("Defensive — malformed input", () => {
    it("rpc-only hook handles empty CLAUDE_HOOK_TOOL_INPUT (exit 0, silent)", () => {
      const result = runHook("aisha-advise-rpc.sh", "");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("rpc-only hook handles non-JSON garbage (exit 0, silent or graceful)", () => {
      const result = runHook("aisha-advise-rpc.sh", "<<<not-json>>>");
      expect(result.exitCode).toBe(0);
      // either silent or fails gracefully — never crashes
    });
  });
});
