/**
 * OWASP DISCOVERY gate — find gaps proactively across the orchestrator.
 *
 * Philosophy: every OWASP control here is expressed as an executable
 * specification. The test FAILS when the codebase violates the spec —
 * surfacing real gaps that humans miss in review. Unlike the umbrella gate
 * which checks adoption, this one *discovers* problems by scanning code.
 *
 * Discovery domains:
 *   - A10: raw `fetch(externalUrl)` without `safeFetch` (SSRF risk)
 *   - A09: `console.log/error/warn` instead of `safeError`/`safeWarn` (PII leakage)
 *   - A07: inline `jose.jwtVerify` outside `@aisha/security/jwt`
 *   - A02: weak `requireSecret`-bypass patterns (`process.env.X ?? 'changeme'`)
 *   - A01/A09: SECURITY DEFINER SQL functions without REVOKE/GRANT/search_path
 *   - A05: bare `cors()` registrations with wildcard origin
 *
 * Each test emits the offending file paths so the developer sees exactly
 * where to fix. Known gaps live in `OWASP_DISCOVERY_BASELINE` — a single
 * source of "already-known issues being tracked" — keep this list short and
 * shrinking. Adding a NEW file to baseline requires citing a ticket.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sqlBezKomentaru } from '../lib/bez-komentaru';

const PROJECT_ROOT = process.cwd();

/**
 * Files already known to violate one or more discovery rules — each entry
 * is tracked elsewhere and intentionally exempt. The list is the single
 * record of "acknowledged debt"; new violations must NOT be added here
 * without a ticket reference in the description.
 */
const OWASP_DISCOVERY_BASELINE = {
  // Files allowed to call raw fetch() because they implement transport for
  // @aisha/security itself, or are non-orchestrator code (mobile/extensions).
  rawFetch: new Set<string>([
    'packages/security/src/audit.ts',           // implements the audit transport
    'packages/security/src/ssrf.ts',            // implements the SSRF guard
    'packages/security/src/__tests__/audit.test.ts',
    'packages/security/src/__tests__/ssrf.test.ts',
    'services/svc-ai-chat/src/postgrest.ts',    // implements the rpc transport
  ]),
  // Files allowed to use console.* because they are scripts/CLI tools
  // (NOT service runtime code).
  console: new Set<string>([]),
  // Files allowed to use inline jose.jwtVerify because they predate
  // @aisha/security/jwt — track migration via ticket.
  inlineJwtVerify: new Set<string>([
    'services/svc-pki-bridge/src/auth.ts',           // bespoke claim handling for OpenXPKI
    'services/gateway/src/auth/jwt.ts',              // gateway needs decoded payload before plugin scope
    'services/gateway/src/auth/postgrest-jwt.ts',    // PostgREST JWT shape differs from Keycloak
    'services/gateway/src/auth/postgrest-jwt.test.ts',
    'services/svc-agent-runner/src/broker-token.ts', // HS256 service-to-service (not JWKS)
    'services/svc-plugin-system/src/routes/broker.ts', // peer of broker-token.ts
  ]),
};

interface SourceFile {
  rel: string;
  path: string;
  content: string;
}

const INCLUDE_DIRS = ['services', 'packages', 'src'];
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '__tests__',
  'archive',
  'trash',
]);

function walk(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  function visit(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIR_NAMES.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        visit(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(entry)) continue;
      const rel = relative(PROJECT_ROOT, full);
      out.push({ rel, path: full, content: readFileSync(full, 'utf8') });
    }
  }
  for (const d of INCLUDE_DIRS) visit(join(root, d));
  return out;
}

function stripCommentsAndStrings(src: string): string {
  // Strings FIRST so `https://...` inside a literal isn't mis-parsed as a
  // `// comment`. Then strip comments. Then re-run string strip in case the
  // first pass missed nested cases.
  return src
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*\n/g, '\n')
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
}

const allFiles = walk(PROJECT_ROOT);

/**
 * A10 baseline rationale (architectural decision — 2026-05-16):
 *
 * The 13 baselined config-derived fetches (postgrest.ts × 5 services,
 * gateway proxy routes, internal mesh callees) are NOT migrated to safeFetch
 * because:
 *   - URL is constructed from `config.postgrestUrl` / `config.aiChatUrl` /
 *     other env-injected constants, NOT from user input.
 *   - The destination set is bounded by the deployment topology
 *     (Coolify networks + Traefik routing), not by request payloads.
 *   - SSRF risk requires attacker-controlled URL; these have none.
 *
 * The baseline IS the documentation: `OWASP_DISCOVERY_BASELINE.rawFetch` +
 * `PROXY_ROUTING_FILES` are reviewed during quarterly security audit.
 * New entries require explicit ticket reference. The bounded size check
 * (`baseline is bounded — every entry is documented`) prevents drift.
 */

describe('OWASP discovery — A10 raw fetch() to untrusted destinations', () => {
  test('fetch() with attacker-controlled URL goes through safeFetch', () => {
    // Tainted-URL detection: flag fetches where the URL token is a plain
    // identifier (not config-derived, not literal) AND the surrounding scope
    // mentions request-payload sources. This focuses the gate on real SSRF
    // risk while leaving internal-mesh proxies (whose URL is built from a
    // server-side routing table) untouched.
    const TAINT_HINTS = /\b(req\.body|req\.query|req\.params|payload|endpoint_url|webhookUrl|userUrl)\b/;

    // Files that pass URLs constructed from server-side config / a fixed
    // routing table (NOT from user request). Each entry is tracked for
    // safeFetch-wrapping but is not a runtime SSRF risk because the URL set
    // is bounded by orchestrator env / DB-stored allowlists, not by an
    // attacker. Migration target: wrap each in `safeFetch` with the existing
    // host allowlist semantics preserved (see OWASP_ORCHESTRATOR.md).
    const PROXY_ROUTING_FILES = new Set<string>([
      // Gateway proxies — URL from ROUTE_TABLE / config
      'services/gateway/src/routes/admin.ts',
      'services/gateway/src/routes/functions.ts',
      'services/gateway/src/routes/intranet.ts',
      'services/gateway/src/routes/realtime.ts',
      // Service-to-service proxies — URL from config
      'services/svc-github-app/src/routes/webhook-bridge.ts',
      'services/svc-ai-chat/src/routes/chat.ts',          // evalUrl from config
      'services/svc-aisha-kronos-shim/src/lib/ragnarok-proxy.ts',
      'services/svc-blockchain/src/routes/gov-read.ts',   // cosmosUrl from config
      'services/svc-fio-bank/src/routes/sync.ts',         // fioUrl from config
      'services/svc-mcp-knowledge/src/routes/maestro.ts',
      'services/svc-mcp-knowledge/src/routes/ragnarok.ts',
      'services/svc-mcp-knowledge/src/lib/embed-dispatcher.ts', // baseUrl from resolveRagBackend → ai_provider_registry.endpoint_url (DB-bounded)
      'services/svc-pki-bridge/src/auth.ts',              // jwks fetch
      'services/svc-pki-bridge/src/openxpki-rpc.ts',
      'services/svc-pki-bridge/src/routes/diag.ts',       // probeOpenxpkiRpc — config-derived openxpkiRpcUrl (moved from server.ts, M-D6)
      'services/svc-push/src/lib/fcm.ts',                 // sa.token_uri from FCM SA file
      // PostgREST transports — URL from config.postgrestUrl
      'services/svc-mcp-knowledge/src/postgrest.ts',
      'services/svc-ide-context/src/postgrest.ts',
      // Shared API client — URL passed by caller (gateway proxy is its consumer)
      'packages/api-core/src/index.ts',
      // Reflection nodes — endpoint from internal audit pipeline
      'services/svc-ai-chat/src/reflection/nodes/openclaw.ts',
    ]);

    const violators: { file: string; sample: string }[] = [];
    for (const f of allFiles) {
      if (OWASP_DISCOVERY_BASELINE.rawFetch.has(f.rel)) continue;
      if (PROXY_ROUTING_FILES.has(f.rel)) continue;
      if (f.rel.includes('/__tests__/') || f.rel.includes('/tests/')) continue;
      if (/safeFetch|createSsrfGuard/.test(f.content)) continue;
      if (!TAINT_HINTS.test(f.content)) continue;

      const stripped = stripCommentsAndStrings(f.content);
      const matches = [...stripped.matchAll(/(?<![.\w])fetch\s*\(\s*([^,)\n]+)/g)];
      for (const m of matches) {
        const arg = m[1].trim();
        if (arg === '""' || arg === '') continue;
        if (/^config\./.test(arg) || /^\$\{config\./.test(arg)) continue;
        // Skip TS type signatures: `fetch(url: string, init?: RequestInit)`.
        if (/:\s*(string|URL|RequestInit|Promise)/i.test(arg)) continue;
        violators.push({ file: f.rel, sample: arg.slice(0, 60) });
        break;
      }
    }
    expect(
      violators,
      `fetch() with attacker-controlled URL — route through safeFetch:\n${violators
        .map((v) => `  - ${v.file}: fetch(${v.sample}…)`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

describe('OWASP discovery — A09 console.* leakage in service runtime', () => {
  test('no service runtime code uses console.log / console.error / console.warn', () => {
    // Scripts (services/*/scripts/) are developer tooling — one-shot CLI
    // tools that run outside the request hot path. They legitimately use
    // console for human-readable output. Runtime code under src/ must NOT.
    const violators: string[] = [];
    for (const f of allFiles) {
      const inService = f.rel.startsWith('services/') && f.rel.includes('/src/');
      const inSecurityPkg = f.rel.startsWith('packages/security/src/');
      if (!inService && !inSecurityPkg) continue;
      if (OWASP_DISCOVERY_BASELINE.console.has(f.rel)) continue;
      const stripped = stripCommentsAndStrings(f.content);
      if (/console\.(log|error|warn|debug|info)\s*\(/.test(stripped)) {
        violators.push(f.rel);
      }
    }
    expect(
      violators,
      `Files using console.* — use safeError/safeWarn/safeInfo from @aisha/security:\n${violators
        .map((v) => `  - ${v}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

describe('OWASP discovery — A07 inline jose.jwtVerify', () => {
  test('no service uses raw jose.jwtVerify outside @aisha/security/jwt', () => {
    const violators: string[] = [];
    for (const f of allFiles) {
      if (!f.rel.startsWith('services/')) continue;
      if (OWASP_DISCOVERY_BASELINE.inlineJwtVerify.has(f.rel)) continue;
      const stripped = stripCommentsAndStrings(f.content);
      if (/\bjwtVerify\s*\(/.test(stripped) && !/@aisha\/security/.test(f.content)) {
        violators.push(f.rel);
      }
    }
    expect(
      violators,
      `Files calling jose.jwtVerify directly — use createJwtVerifier from @aisha/security:\n${violators
        .map((v) => `  - ${v}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

describe('OWASP discovery — A02 weak secret fallbacks', () => {
  test('no `process.env.X ?? "changeme|password|secret|...|fallback"` patterns', () => {
    const weakWords = ['changeme', 'password', '12345', 'admin', 'secret-key', 'demo'];
    const violators: { file: string; match: string }[] = [];
    for (const f of allFiles) {
      // Skip the gate test files themselves — they contain the regex as test data.
      if (f.rel.startsWith('src/tests/gates/')) continue;
      const stripped = f.content;
      for (const word of weakWords) {
        const re = new RegExp(`process\\.env\\.[A-Z_0-9]+\\s*(?:\\?\\?|\\|\\|)\\s*['"]${word}['"]`, 'i');
        const m = stripped.match(re);
        if (m) violators.push({ file: f.rel, match: m[0] });
      }
    }
    expect(
      violators,
      `Weak secret fallbacks found — use requireSecret() from @aisha/security:\n${violators
        .map((v) => `  - ${v.file}: ${v.match}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

describe('OWASP discovery — A05 wildcard CORS', () => {
  test('no service registers CORS with origin: "*" (credentialed routes)', () => {
    const violators: string[] = [];
    for (const f of allFiles) {
      if (!f.rel.startsWith('services/')) continue;
      const stripped = f.content;
      // Match patterns like `origin: '*'` or `origin: "*"` inside a CORS registration.
      // We accept exact `*` only — wildcard subdomain patterns in `cors.ts` use a function.
      if (/origin\s*:\s*['"]\*['"]/.test(stripped)) {
        violators.push(f.rel);
      }
    }
    expect(
      violators,
      `Services with wildcard CORS — use buildCorsOptions from @aisha/security:\n${violators
        .map((v) => `  - ${v}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

describe('OWASP discovery — A01/A09 SQL SECURITY DEFINER hygiene', () => {
  test('every SECURITY DEFINER function declares SET search_path TO \'public\'', () => {
    // search_path attack is the canonical SECURITY DEFINER exploit (CVE class):
    // attacker creates a function in their schema, manipulates search_path, and
    // the DEFINER function calls the attacker's function with elevated privs.
    // SET search_path is the only defence. Trigger functions are NOT exempt.
    const sqlDir = join(PROJECT_ROOT, 'aisha/db/sql/functions');
    const files = readdirSync(sqlDir).filter((f) => f.endsWith('.sql'));
    const violators: string[] = [];
    for (const file of files) {
      // ⛔ BRÁNA SE PTÁ SQL, NE KOMENTÁŘŮ (naměřeno 2026-09-03, třetí výskyt
      // téže třídy po xss-client-storage a auth-security). `get_block_data.sql`
      // je `security invoker`, ale nese komentář vysvětlující, proč restricted
      // blok nesmí brát parametry od klienta „nad SECURITY DEFINER zdrojem" —
      // a ten se četl jako deklarace.
      const sql = sqlBezKomentaru(readFileSync(join(sqlDir, file), 'utf8'));
      if (!/SECURITY\s+DEFINER/i.test(sql)) continue;
      // Přijatý tvar: `'public'` na začátku, nebo zpevněný `'pg_catalog', 'public', …` (definer funkce
      // trezoru a tajemství — pg_catalog výslovně první, pg_temp poslední; brána definer-trezoru-search-path).
      if (!/SET\s+search_path\s+TO\s+('pg_catalog'\s*,\s*)?'public'/i.test(sql)) violators.push(file);
    }
    expect(
      violators,
      `SECURITY DEFINER without SET search_path — search-path-attack risk:\n${violators
        .map((v) => `  - ${v}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('every SECURITY DEFINER function has REVOKE ALL FROM PUBLIC', () => {
    // REVOKE ALL is mandatory regardless of intended callers. It strips the
    // PostgreSQL default of "all authenticated roles can call any function"
    // and forces an explicit GRANT (or "no GRANT" = owner-only). A function
    // without REVOKE ALL is callable by anon by default — that's the bug.
    //
    // GRANT EXECUTE is OPTIONAL: many functions are intentional internal
    // helpers callable only from other SECURITY DEFINER functions via the
    // postgres role. Look for `REVOKE ALL ... FROM PUBLIC` followed by either
    // a GRANT line OR a comment that documents the owner-only intent.
    const sqlDir = join(PROJECT_ROOT, 'aisha/db/sql/functions');
    const files = readdirSync(sqlDir).filter((f) => f.endsWith('.sql'));
    const violators: string[] = [];
    for (const file of files) {
      const sql = readFileSync(join(sqlDir, file), 'utf8');
      if (!/SECURITY\s+DEFINER/i.test(sql)) continue;
      if (/RETURNS\s+trigger\b/i.test(sql)) continue;
      // Match REVOKE ALL ON FUNCTION ... FROM (any list ending in) PUBLIC.
      // `FROM anon, PUBLIC` is stricter than `FROM PUBLIC` (also revokes anon).
      if (!/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]+?FROM\s+(?:\w+\s*,\s*)*PUBLIC\b/i.test(sql)) {
        violators.push(file);
      }
    }
    expect(
      violators,
      `SECURITY DEFINER without REVOKE ALL FROM PUBLIC — callable by anon:\n${violators
        .map((v) => `  - ${v}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

describe('OWASP discovery — A09 baseline drift detection', () => {
  test('baseline is non-empty only for documented reasons', () => {
    // If the baseline grows uncontrollably it stops being meaningful. Cap it
    // here so additions are deliberate.
    const totalBaselined =
      OWASP_DISCOVERY_BASELINE.rawFetch.size +
      OWASP_DISCOVERY_BASELINE.console.size +
      OWASP_DISCOVERY_BASELINE.inlineJwtVerify.size;
    expect(
      totalBaselined,
      'OWASP_DISCOVERY_BASELINE is growing — each new entry must reference a ticket and have a removal plan',
    ).toBeLessThanOrEqual(20);
  });
});
