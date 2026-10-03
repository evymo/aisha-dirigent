/**
 * v2 Microservice Security Gate Tests
 *
 * Static analysis of all Fastify microservices under `services/svc-*` for
 * security, CORS, auth, and architectural consistency. Replaces the legacy
 * Deno edge-function security gate (previously scanning
 * `trash/legacy-archive/edge-functions-reference`).
 *
 * Checks (v2):
 * 1. Every service has auth middleware (auth.ts or request.user verification)
 * 2. CORS configured via `@fastify/cors` (not inline hand-rolled)
 * 3. No hardcoded secrets or API keys
 * 4. No raw `@supabase/supabase-js` client imports (services use PostgREST helper)
 * 5. No `console.log` of sensitive data (use safe logger)
 * 6. Fastify server entry (`fastify({...})` + `listen`)
 * 7. RPC parameter ordering (alphabetical in `rpcService('fn', { p_* })`)
 *
 * Services are at `services/svc-<name>/src/` with:
 *   - `server.ts`    — Fastify entry
 *   - `auth.ts`      — JWT / API key verification middleware
 *   - `config.ts`    — env reader
 *   - `routes/*.ts`  — route handlers
 *
 * @module
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { isTrackedService } from "./lib/tracked-services";

const PROJECT_ROOT = process.cwd();
const SERVICES_DIR = join(PROJECT_ROOT, "services");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return all service directory names (svc-* + gateway + ws-gateway + event-worker + storage-auth). */
function getServices(): string[] {
  if (!existsSync(SERVICES_DIR)) return [];
  return readdirSync(SERVICES_DIR).filter((name) => {
    if (name.startsWith(".")) return false;
    // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
    if (!isTrackedService(name)) return false;
    const full = join(SERVICES_DIR, name);
    if (!statSync(full).isDirectory()) return false;
    // Must have a src/ directory to be a service
    return existsSync(join(full, "src"));
  });
}

/** Concatenate all .ts files under a directory recursively (skip node_modules, dist). */
function readAllTs(dir: string): string {
  if (!existsSync(dir)) return "";
  const parts: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (entry.isFile() && full.endsWith(".ts")) {
        parts.push(readFileSync(full, "utf-8"));
      }
    }
  };
  walk(dir);
  return parts.join("\n");
}

/**
 * Git-tracked .ts paths under services/ (PROJECT_ROOT-relative), used to tell BASE code (committed,
 * must satisfy the gate universally — forks inherit it) from INSTANCE-injected/untracked .ts (a
 * per-instance overlay module). Returns null when not in a git work-tree (e.g. a CI tarball) — callers
 * then treat everything as base, preserving the legacy behaviour.
 */
let _trackedCache: Set<string> | null | undefined;
function gitTrackedServiceFiles(): Set<string> | null {
  if (_trackedCache !== undefined) return _trackedCache;
  try {
    const out = execFileSync("git", ["ls-files", "--", "services/"], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    _trackedCache = new Set(out.split("\n").filter((l) => l.endsWith(".ts")));
  } catch {
    _trackedCache = null; // not a git work-tree → cannot distinguish; treat all as base
  }
  return _trackedCache;
}

/**
 * Like readAllTs but keeps per-file identity: returns each .ts file's PROJECT_ROOT-relative path and
 * its source (skip node_modules, dist). Lets checks report file:line and classify base vs instance.
 */
function readTsFileList(dir: string): Array<{ rel: string; src: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ rel: string; src: string }> = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (entry.isFile() && full.endsWith(".ts")) {
        const rel = full.startsWith(PROJECT_ROOT + "/") ? full.slice(PROJECT_ROOT.length + 1) : full;
        out.push({ rel, src: readFileSync(full, "utf-8") });
      }
    }
  };
  walk(dir);
  return out;
}

const ALL_SERVICES = getServices();
const SERVICE_SOURCES = new Map<string, string>();
for (const svc of ALL_SERVICES) {
  SERVICE_SOURCES.set(svc, readAllTs(join(SERVICES_DIR, svc, "src")));
}

/**
 * Services that legitimately skip classic auth enforcement because they ARE
 * the auth surface or use alternate verification (HMAC, service tokens, etc.).
 */
const AUTH_EXCEPTIONS = new Set([
  "storage-auth",   // Issues S3 signed URLs for MinIO; internal only
  "event-worker",   // Background worker, internal only (not HTTP-exposed)
]);

/**
 * Services that are internal workers not exposed via public HTTP
 * (do not require CORS).
 */
const CORS_EXEMPT = new Set([
  "event-worker",   // Background job worker
  "storage-auth",   // Internal-only, no browser exposure
]);

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("v2 Microservice Security Gates", () => {
  test("services directory exists and contains multiple services", () => {
    expect(ALL_SERVICES.length).toBeGreaterThan(5);
  });

  describe("Auth enforcement", () => {
    const authPatterns = [
      /import.*from\s+["']\.\/auth(?:\.js)?["']/,
      /import.*from\s+["']\.\.\/auth(?:\.js)?["']/,
      /authenticate|verifyJwt|verifyToken|bearerTokenGuard|bearerHeaderGuard/i,
      /request\.headers\.authorization/i,
      /preHandler\s*:\s*\[?\s*\w*auth/i,
      /verif(?:y|ied).*(?:signatur|hmac|hash)/i,
      /X-N8N-API-KEY|X-MCP-Token/i,
    ];

    for (const svc of ALL_SERVICES) {
      if (AUTH_EXCEPTIONS.has(svc)) continue;

      test(`${svc} has auth enforcement`, () => {
        const src = SERVICE_SOURCES.get(svc) ?? "";
        if (!src) return;
        const hasAuth = authPatterns.some((p) => p.test(src));
        expect(
          hasAuth,
          `Service "${svc}" has NO authentication pattern. ` +
            `Services must verify JWT (auth.ts), API key, or HMAC signature.`,
        ).toBe(true);
      });
    }
  });

  describe("CORS configuration", () => {
    test("HTTP-exposed services register @fastify/cors (not inline)", () => {
      const violations: string[] = [];

      for (const svc of ALL_SERVICES) {
        if (CORS_EXEMPT.has(svc)) continue;
        const src = SERVICE_SOURCES.get(svc) ?? "";
        if (!src) continue;

        const usesFastifyCors = /@fastify\/cors/.test(src);
        const hasInlineCors = /Access-Control-Allow-Origin/i.test(src) && !usesFastifyCors;

        if (hasInlineCors) violations.push(svc);
      }

      expect(
        violations,
        `Services with inline CORS instead of @fastify/cors: ${violations.join(", ")}`,
      ).toEqual([]);
    });

    test("no service defaults CORS origins to wildcard or a hardcoded public host", () => {
      // Contract (2026-06-10 ALLOWED_ORIGINS unification): the SoT for browser
      // origins is ALLOWED_ORIGINS from config/domains.env, pushed per-app by
      // coolify-deploy-init (set_coolify_env_if — skips empty). A service whose
      // env-read DEFAULTS to '*' therefore silently opens CORS to the world in
      // any deploy where the push didn't land; a default with a baked-in public
      // hostname resurrects the hardcoded-domain class the topology resolver
      // removed. Only localhost defaults are acceptable (gateway contract).
      // Note: '*' inside an explicit CORS_ALLOWLIST env VALUE remains a
      // deliberate runtime opt-in handled (and warned about) by
      // @aisha/security buildCorsOriginCheck — this gate only bans '*' and
      // public hosts as the code-side DEFAULT.
      const violations: string[] = [];
      const defaultPatterns: Array<[RegExp, string]> = [
        // env-var ?? / || '*'   (ALLOWED_ORIGINS, CORS_ORIGINS, CORS_ALLOWLIST…)
        [/(?:ALLOWED_ORIGINS|CORS_ORIGINS|CORS_ALLOWLIST)\b[^\n]*(?:\?\?|\|\|)\s*["']\*["']/, "wildcard '*' default"],
        // env-var ?? / || 'https://<public-host>…'
        [/(?:ALLOWED_ORIGINS|CORS_ORIGINS|CORS_ALLOWLIST)\b[^\n]*(?:\?\?|\|\|)\s*["']https?:\/\/(?!localhost|127\.0\.0\.1)[^"']+["']/, "hardcoded public-host default"],
      ];

      for (const svc of ALL_SERVICES) {
        const src = SERVICE_SOURCES.get(svc) ?? "";
        if (!src) continue;
        for (const [pattern, label] of defaultPatterns) {
          if (pattern.test(src)) violations.push(`${svc} (${label})`);
        }
      }

      expect(
        violations,
        `CORS env defaults must be localhost-only (SoT = ALLOWED_ORIGINS from domains.env): ${violations.join(", ")}`,
      ).toEqual([]);
    });
  });

  describe("No hardcoded secrets", () => {
    const secretPatterns = [
      // Long alphanumeric assignment to api_key/secret/password/token
      /(?:api_?key|secret|password|token)\s*=\s*["'][a-zA-Z0-9_-]{20,}["']/i,
      // Bearer token hardcoded
      /Authorization.*Bearer\s+eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
    ];
    const falsePositivePatterns = [/process\.env/, /\$\{.*\}/, /config\./];

    for (const svc of ALL_SERVICES) {
      test(`${svc} has no hardcoded secrets`, () => {
        const src = SERVICE_SOURCES.get(svc) ?? "";
        if (!src) return;

        for (const pattern of secretPatterns) {
          const matches = src.match(pattern);
          if (!matches) continue;
          for (const match of matches) {
            const isFalsePositive = falsePositivePatterns.some((fp) => fp.test(match));
            expect(
              isFalsePositive,
              `Possible hardcoded secret in "${svc}": ${match.substring(0, 60)}...`,
            ).toBe(true);
          }
        }
      });
    }
  });

  describe("Server entry", () => {
    // Background workers don't expose HTTP — they have worker.ts instead of server.ts.
    const WORKER_ONLY = new Set([
      "event-worker",
      // Pure polling worker — no HTTP listener. Loops on get_next_playwright_run
      // RPC and spawns `npx playwright test`. Same shape as event-worker.
      "svc-playwright-runner",
    ]);

    test("every HTTP service has src/server.ts (workers exempt)", () => {
      const missing: string[] = [];
      for (const svc of ALL_SERVICES) {
        if (WORKER_ONLY.has(svc)) continue;
        const entry = join(SERVICES_DIR, svc, "src", "server.ts");
        if (!existsSync(entry)) missing.push(svc);
      }
      expect(
        missing,
        `HTTP services missing src/server.ts: ${missing.join(", ")}`,
      ).toEqual([]);
    });

    test("workers have src/worker.ts entry", () => {
      const missing: string[] = [];
      for (const svc of WORKER_ONLY) {
        if (!ALL_SERVICES.includes(svc)) continue;
        const entry = join(SERVICES_DIR, svc, "src", "worker.ts");
        if (!existsSync(entry)) missing.push(svc);
      }
      expect(
        missing,
        `Workers missing src/worker.ts: ${missing.join(", ")}`,
      ).toEqual([]);
    });

    test("server.ts uses Fastify and listens on a port", () => {
      const violations: string[] = [];
      for (const svc of ALL_SERVICES) {
        if (WORKER_ONLY.has(svc)) continue;
        const entry = join(SERVICES_DIR, svc, "src", "server.ts");
        if (!existsSync(entry)) continue;
        const src = readFileSync(entry, "utf-8");
        const hasFastify = /from\s+["']fastify["']|Fastify\(/.test(src);
        const hasListen = /\.listen\s*\(/.test(src);
        if (!(hasFastify && hasListen)) violations.push(svc);
      }
      expect(
        violations,
        `Services whose server.ts does not set up Fastify+listen: ${violations.join(", ")}`,
      ).toEqual([]);
    });
  });

  describe("No sensitive data in logs", () => {
    test("console.log/error does not contain email/password/token values", () => {
      const violations: string[] = [];
      const sensitiveLogPatterns = [
        /console\.(?:log|error|warn)\s*\([^)]*(?:email|password|secret|token|apiKey|api_key)[^)]*\$\{/i,
        /console\.(?:log|error|warn)\s*\([^)]*\$\{[^}]*(?:email|password|token)\}/i,
      ];

      for (const svc of ALL_SERVICES) {
        const src = SERVICE_SOURCES.get(svc) ?? "";
        if (!src) continue;
        for (const pattern of sensitiveLogPatterns) {
          if (pattern.test(src)) {
            violations.push(svc);
            break;
          }
        }
      }

      expect(
        violations,
        `Services logging sensitive data: ${violations.join(", ")}`,
      ).toEqual([]);
    });
  });

  describe("No raw supabase-js imports", () => {
    test("services do NOT import @supabase/supabase-js (use rpcService helper)", () => {
      const violations: string[] = [];
      for (const svc of ALL_SERVICES) {
        const src = SERVICE_SOURCES.get(svc) ?? "";
        if (!src) continue;
        // Must not import the runtime client — services talk to PostgREST via rpcService()
        if (/from\s+["']@supabase\/supabase-js["']/.test(src)) {
          violations.push(svc);
        }
      }
      expect(
        violations,
        `Services importing @supabase/supabase-js (forbidden in v2): ${violations.join(", ")}`,
      ).toEqual([]);
    });
  });
});

// ===========================================================================
// RPC parameter ordering in services
// ===========================================================================

describe("v2 Service RPC parameter ordering", () => {
  test("rpcService() and rpcUser() calls have alphabetically ordered parameters", () => {
    // Param key order is a CONVENTION (PostgREST matches named args by name, not position \u2014 so
    // reordering keys is behavior-preserving). We classify each offender by layer so the failure
    // routes the fix correctly and so a clean clone (which has only base code) is deterministic:
    //   \u2022 BASE  = file is git-tracked \u2192 committed repo code that MUST satisfy the rule. This is the
    //             universal rule; forks inherit it via upstream merge.
    //   \u2022 INSTANCE = file is untracked \u2192 an instance-injected service module. Per the platform rule
    //             "content in instance via the SQL overlay", instance content should not be service
    //             .ts at all, so such a file is also a layering anomaly \u2014 fix at its source.
    // When not in a git work-tree, tracked == null and everything is treated as BASE (legacy behaviour).
    type Hit = { file: string; line: number; rpcName: string; params: string[] };
    const tracked = gitTrackedServiceFiles();
    const base: Hit[] = [];
    const instance: Hit[] = [];

    for (const svc of ALL_SERVICES) {
      for (const { rel, src } of readTsFileList(join(SERVICES_DIR, svc, "src"))) {
        // rpcService<T>('name', {...}) / rpcService('name', {...}) / rpcUser(...) / legacy .rpc('name', {...})
        const re =
          /(?:\.rpc\(|\brpc(?:Service|User)\s*(?:<[^>]*>)?\s*\()\s*["']([^"']+)["']\s*,\s*\{([^}]+)\}/gs;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          const params = [...m[2].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((x) => x[1]);
          if (params.length < 2) continue;
          const sorted = [...params].sort();
          if (params.every((p, i) => p === sorted[i])) continue;
          const line = src.slice(0, m.index).split("\n").length;
          const hit: Hit = { file: rel, line, rpcName: m[1], params };
          (tracked && !tracked.has(rel) ? instance : base).push(hit);
        }
      }
    }

    const fmt = (v: Hit) =>
      `  ${v.file}:${v.line} rpc("${v.rpcName}"): [${v.params.join(", ")}] should be [${[...v.params].sort().join(", ")}]`;

    // BASE code must be alphabetical \u2014 the universal rule every fork inherits.
    expect(
      base.length,
      `BASE CODE: ${base.length} rpc call(s) with non-alphabetical params \u2014 alphabetize the keys in this repo (behavior-preserving, PostgREST maps args by name):\n${base.map(fmt).join("\n")}`,
    ).toBe(0);

    // INSTANCE-injected (untracked) service .ts \u2014 non-canonical layer. Fix at the source so every instance inherits it.
    expect(
      instance.length,
      `INSTANCE DATA: ${instance.length} rpc call(s) with non-alphabetical params live in UNTRACKED service .ts. Instance content belongs in the SQL overlay, not the service tree \u2014 move it there, or (if it is genuine service logic) commit it to base with alphabetized keys. Fix at the source/generator, not by hand per instance:\n${instance.map(fmt).join("\n")}`,
    ).toBe(0);
  });
});

// ===========================================================================
// MCP Knowledge Server (svc-mcp-knowledge) structural checks
// ===========================================================================

describe("svc-mcp-knowledge — MCP protocol surface", () => {
  const svcDir = join(SERVICES_DIR, "svc-mcp-knowledge", "src");
  const src = existsSync(svcDir) ? readAllTs(svcDir) : "";

  test("service exists", () => {
    expect(existsSync(svcDir), "services/svc-mcp-knowledge/src missing").toBe(true);
  });

  test("exposes search_knowledge capability", () => {
    expect(src).toMatch(/search_knowledge/);
  });

  test("exposes route_task capability or delegates to svc-ai-chat", () => {
    // v2: route_task is implemented in svc-ai-chat (see gateway functions map).
    // svc-mcp-knowledge may expose it as a tool or reference it via gateway routing.
    const aiChatSrc = readAllTs(join(SERVICES_DIR, "svc-ai-chat", "src"));
    expect(
      src.includes("route_task") || aiChatSrc.includes("route_task"),
      "route_task must be callable from either svc-mcp-knowledge or svc-ai-chat",
    ).toBe(true);
  });
});

// ===========================================================================
// Cross-service consistency
// ===========================================================================

describe("Cross-service consistency", () => {
  test("services that use env-driven secrets have an explicit config reader", () => {
    // Pattern: each svc-* should import from './config' (or define its own config).
    const missing: string[] = [];
    for (const svc of ALL_SERVICES) {
      const src = SERVICE_SOURCES.get(svc) ?? "";
      if (!src) continue;
      // If the service reads process.env directly it must have a config module or import config
      const readsEnvDirectly = /process\.env\./.test(src);
      const hasConfig = /from\s+["']\.\.?\/config(?:\.js)?["']/.test(src) ||
        existsSync(join(SERVICES_DIR, svc, "src", "config.ts"));
      if (readsEnvDirectly && !hasConfig) missing.push(svc);
    }
    expect(
      missing,
      `Services reading process.env without a config module: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// VerifiedUser contract — verifyToken() results must use .userId, never .sub
// ===========================================================================
//
// Each service's local verifyToken() (src/auth.ts) remaps the JWT `sub` claim
// onto VerifiedUser.userId and intentionally does NOT expose `.sub`. Reading
// `.sub` off a verifyToken() result is therefore always `undefined` at runtime
// — a silent identity bug that passes RPCs an undefined acting-user id and
// leans on each function's auth.uid() COALESCE fallback. The broken service
// `tsc --noEmit` baseline cannot catch it (it would otherwise be a type error),
// so this static gate is the compensating control.
//
// Detection is:
//   - binding-aware: only flags `.sub` reads on variables assigned from
//     `await verifyToken(...)` (or its local import alias), and
//   - auth-contract-aware: skips services whose verifyToken() return shape
//     legitimately carries a `sub` field (e.g. svc-pki-bridge machine-cert
//     caller — `return { sub, clientId, ... }`).

describe("VerifiedUser contract — no .sub on verifyToken() results", () => {
  /** Recursively list .ts source files under a dir (skip node_modules/dist/tests/*.test.ts/*.d.ts). */
  function listTsFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", "dist", "tests", "__tests__"].includes(entry.name)) continue;
          walk(full);
        } else if (
          entry.isFile() &&
          full.endsWith(".ts") &&
          !full.endsWith(".test.ts") &&
          !full.endsWith(".d.ts")
        ) {
          out.push(full);
        }
      }
    };
    walk(dir);
    return out;
  }

  test("source files read verifyToken() results via .userId, never the dropped .sub", () => {
    const violations: string[] = [];

    for (const svc of ALL_SERVICES) {
      const srcDir = join(SERVICES_DIR, svc, "src");
      const authPath = join(srcDir, "auth.ts");
      // Only services that define the standard verifyToken wrapper in src/auth.ts
      // participate in this contract (others use HMAC/session/raw-claims auth).
      if (!existsSync(authPath)) continue;

      // Auto-skip services whose verifyToken() return literal carries a `sub:`
      // key — those legitimately expose `.sub` on their result.
      const authSrc = readFileSync(authPath, "utf-8");
      if (/\breturn\s*\{[\s\S]*?\bsub\s*:/.test(authSrc)) continue;

      for (const file of listTsFiles(srcDir)) {
        if (file === authPath) continue; // remap site: `userId: payload.sub`
        const src = readFileSync(file, "utf-8");

        // Local name(s) verifyToken is imported as from the auth module.
        const importMatch = src.match(
          /import\s*\{([^}]*)\}\s*from\s*["'][^"']*auth(?:-guard)?(?:\.js)?["']/,
        );
        if (!importMatch) continue;
        const names = importMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /\bverifyToken\b/.test(s))
          .map((s) => {
            const aliased = s.match(/verifyToken\s+as\s+(\w+)/);
            return aliased ? aliased[1] : "verifyToken";
          });
        if (names.length === 0) continue;

        const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        const verifyCall = `await\\s+(?:${escaped.join("|")})\\s*\\(`;
        const rel = file.slice(PROJECT_ROOT.length + 1);

        // (1) Bound variable: `const user = await verifyToken(...)` (or bare
        //     reassignment `user = await ...`). Flag `.sub` / `!.sub` reads.
        const boundVars = new Set<string>();
        for (const m of src.matchAll(new RegExp(`\\b(\\w+)\\s*=\\s*${verifyCall}`, "g"))) {
          boundVars.add(m[1]);
        }
        for (const v of boundVars) {
          if (new RegExp(`\\b${v}\\b\\s*!?\\.\\s*sub\\b`).test(src)) {
            violations.push(`${rel}: '${v}.sub' → use '${v}.userId' (verifyToken drops .sub)`);
          }
        }

        // (2) Destructuring: `const { sub } = await verifyToken(...)` — the
        //     bound-variable check above cannot see this access pattern.
        for (const m of src.matchAll(new RegExp(`\\{([^}]*)\\}\\s*=\\s*${verifyCall}`, "g"))) {
          if (/\bsub\b/.test(m[1])) {
            violations.push(`${rel}: destructured 'sub' from verifyToken() → use 'userId' (verifyToken drops .sub)`);
          }
        }

        // (3) Inline: `(await verifyToken(...)).sub`.
        if (new RegExp(`${verifyCall}[^;]*?\\)\\s*\\)?\\s*!?\\.\\s*sub\\b`).test(src)) {
          violations.push(`${rel}: inline '(await verifyToken(...)).sub' → use '.userId' (verifyToken drops .sub)`);
        }
      }
    }

    expect(
      violations,
      `verifyToken() results that read the dropped .sub field (always undefined at runtime):\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });
});
