/**
 * Gate test: no-hardcoded-deployment-config
 *
 * Catches the systemic anti-pattern where deployment-specific identifiers
 * (server URLs, registry hosts, Coolify app UUIDs, realm names) live as
 * literal fallbacks or hardcoded constants in committed files — instead
 * of being sourced from env / `config/` SoT at cold-start time.
 *
 * User principle (2026-05-26, strengthened): "zadny fallbacky uz necheme,
 * vse musi jit z env. Frontend/backend/experimental adresy taky do env. Repo musi
 * byt maximalne a jedine dynamicke kvuli nasazeni stacku v nove
 * implementaci s jinym ucelem." → repo = pure templates, NOTHING
 * deployment-specific (host, realm, registry, UUID, email).
 *
 * Patterns enforced (each in its own sub-test for granular reporting):
 *   1. No `frontend.id3a.cz` / `experimental.id3a.cz` (backend is allowed in
 *      `*.backend.id3a.cz` per-server domain convention) as a literal
 *      fallback value `${VAR:-https://frontend.id3a.cz}` or bare URL.
 *   2. No `cache.aisha.guru` / `npm.id3a.cz` / `repo.id3a.cz` /
 *      `sentry.id3a.cz` as `:-` defaults or bare URLs in scripts.
 *   3. No 24-char Coolify-UUID-shaped string `[a-z0-9]{24,25}` as a
 *      hardcoded constant in scripts (Coolify regenerates these per
 *      cold-start; use `scripts/lib/coolify-resolve-uuid.{sh,mjs}`).
 *   4. No `/realms/aisha` literal path — should use
 *      `/realms/${KEYCLOAK_REALM}` so the realm name is operator-defined.
 *   5. **STRICT**: No `${VAR:-anything-deployment-specific}` fallbacks
 *      anywhere in scripts/services/. Use `${VAR:?VAR required}`
 *      (fail-fast) instead. Deployment-specific means: contains a TLD
 *      (`.cz`, `.guru`, `.com`, `.network`), a `https?://` prefix, or
 *      matches a host-like pattern. Structural defaults (port numbers,
 *      log levels, schema lists) are still allowed.
 *
 * Scope:
 *   - scripts/, services/, packages/, mobile-app/, extensions/,
 *     docker-compose.coolify-*.yml, .forgejo/workflows/
 *   - EXCLUDED: trash/, packages/insight/, archive/, docs/, *.md,
 *     coolify/servers.json (SoT catalog), config/profiles/*.json (SoT),
 *     config/domains.env (SoT), test mocks, package-lock.json
 *
 * This gate is **expected to FAIL on the initial cleanup branch** — it
 * is the spec for what "no deployment-specific config in git" means.
 * The fix is to replace each finding with proper env sourcing.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Paths legit to contain deployment-specific values (SoT catalogs +
 *  templates + frozen archives + docs). */
const ALLOWED_PATHS: ReadonlyArray<RegExp> = [
  /^trash\//,
  /^archive\//,
  /^packages\/insight\//,
  /^node_modules\//,
  /^dist\//,
  /^\.git\//,
  /^docs\//,
  /\.md$/,
  /\.lock$/,
  /package-lock\.json$/,
  /\.png$|\.jpg$|\.svg$|\.ico$|\.pdf$/,
  // SoT catalogs — values are intentional here, scripts read from them
  // Private instance seed overlay — deployment-OWN data layer by design
  // (upstream ships it empty / as a private submodule; this fork commits its
  // own overlay deliberately — see docs/planning/zadani/WP-09-boundary-hardening.md).
  // Values like the fork's own repo_url belong here, not in env.
  /^aisha\/db\/seed\/instance\//,
  /^coolify\/servers\.json$/,
  /^config\/servers\.json$/,
  /^config\/profiles\/.+\.json$/,
  /^config\/domains\.env$/,
  /^config\/coolify-environments\.env$/,
  /^config\/external-secrets\.required\.env$/,
  /^config\/local-presets\.mjs$/,
  // Instance overlay — the surface shells' equivalent of config/profiles/*.json.
  // The shells are compiled against <overlay>/app.config.json (issuer, PostgREST
  // URL, OIDC client) at build time, so concrete values are the whole point of
  // the directory; that is the channel the split rule sends them to. `_default`
  // is deliberately NOT excluded: it is the template every fork starts from, and
  // a deployment value there would propagate to all of them.
  /^instances\/(?!_default\/)[^/]+\//,
  /\.env\.[^/]+\.example$/,
  // `*.env.example` and `*.json.example` files — reference values for forks
  // to copy + customise. They INTENTIONALLY contain the AISHA upstream
  // deploy hostnames so an integrator has a working starting point. The
  // matching `*.env` / `*.json` files ship template-only (empty / null), so
  // deployment-specific values stay entirely on the operator side.
  /\.env\.example$/,
  /\.json\.example$/,
  // Operator-local Claude permission allowlist — tracked per memory rule
  // but operator-specific (URLs they explicitly approved for their own
  // machine), not deployment-config that ships with the stack.
  /^\.claude\/settings\.local\.json$/,
  // Test fixtures / mocks
  /__tests__\//,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /^src\/tests\/gates\//, // gate tests document what they catch
  // The audit/cleanup gate itself
  /^src\/tests\/gates\/no-hardcoded-deployment-config\.gate\.test\.ts$/,
];

function isAllowed(path: string): boolean {
  return ALLOWED_PATHS.some((re) => re.test(path));
}

function listTrackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\n').filter((p) => p.length > 0 && !isAllowed(p));
}

interface Finding {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

function scanLines(path: string, scanner: (line: string, i: number) => Finding | null): Finding[] {
  let content: string;
  try {
    content = readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return [];
  }
  const out: Finding[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const f = scanner(lines[i], i + 1);
    if (f) out.push({ ...f, file: path });
  }
  return out;
}

function isComment(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith('//') ||
    t.startsWith('#') ||
    t.startsWith('*') ||
    t.startsWith('/*') || // /**, /*, JSDoc opening
    t.startsWith('<!--')
  );
}

function isDocPlaceholderHost(line: string): boolean {
  // Doc strings often use placeholder hosts that aren't real deployment targets.
  return (
    line.includes('example.com') ||
    line.includes('example.org') ||
    line.includes('kc.example.com')
  );
}

/**
 * Ratchet baseline — current violation counts the cleanup is driving to zero.
 * Each future PR may only DECREASE these counts. Update the JSON when
 * landing a cleanup PR that fixes additional items.
 */
const BASELINE_PATH = join(ROOT, 'src/tests/gates/no-hardcoded-deployment-config.baseline.json');
interface Baseline {
  frontend_or_experimental_url_literals: number;
  infra_url_defaults_in_scripts: number;
  coolify_uuid_strings: number;
  realm_path_literals: number;
  deployment_value_fallbacks: number;
  registry_host_literals: number;
}
function loadBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}
function ratchetCheck(rule: keyof Baseline, currentCount: number, label: string): void {
  const baseline = loadBaseline()[rule];
  if (currentCount > baseline) {
    throw new Error(
      `Regression in ${rule}: baseline=${baseline}, current=${currentCount}. ` +
        `Either fix the new offending sites OR (only if intentional) update the baseline.\n${label}`,
    );
  }
  // Note: we don't require count to DROP — that's the operator's prerogative.
  // The gate prevents BACKSLIDES while iterative PRs ratchet down.
}

describe('no-hardcoded-deployment-config — repo must be template-only, values from env / SoT', () => {
  const files = (() => {
    if (!existsSync(join(ROOT, '.git'))) return [];
    return listTrackedFiles();
  })();

  it('no `frontend.id3a.cz` or `experimental.id3a.cz` as literal fallback default', () => {
    const findings: Finding[] = [];
    for (const f of files) {
      findings.push(
        ...scanLines(f, (line, lineno) => {
          if (isComment(line)) return null;
          // Match: ${VAR:-https://frontend.id3a.cz...} or bare https://frontend.id3a.cz / https://experimental.id3a.cz
          // (backend.id3a.cz is allowed as it's the per-server subdomain convention)
          const m = line.match(
            /(?:\$\{[A-Z_][A-Z0-9_]*:-)?(https?:\/\/(?:frontend|experimental)\.id3a\.cz[^"'`\s)}]*)/,
          );
          if (m) {
            return {
              file: '',
              line: lineno,
              rule: 'hardcoded-frontend-or-experimental-url',
              snippet: line.trim().slice(0, 140),
            };
          }
          return null;
        }),
      );
    }
    const msg =
      findings.length > 0
        ? `Found ${findings.length} hardcoded frontend.id3a.cz / experimental.id3a.cz literal(s).\n` +
          findings.map((f) => `  ${f.file}:${f.line} — ${f.snippet}`).join('\n')
        : '';
    ratchetCheck('frontend_or_experimental_url_literals', findings.length, msg);
  });

  it('no `cache.aisha.guru` / `npm.id3a.cz` / `repo.id3a.cz` / `sentry.id3a.cz` as `:-` defaults in scripts', () => {
    // We allow these in `image: cache.aisha.guru/...` and Dockerfile `FROM cache.aisha.guru/...`
    // (they're build-time substitutions handled by compose env). But NOT as
    // shell `:- ` defaults in scripts.
    const findings: Finding[] = [];
    const scriptFiles = files.filter((f) => f.startsWith('scripts/'));
    for (const f of scriptFiles) {
      findings.push(
        ...scanLines(f, (line, lineno) => {
          if (isComment(line)) return null;
          const m = line.match(
            /\$\{[A-Z_][A-Z0-9_]*:-(https?:\/\/(?:cache\.aisha\.guru|npm\.id3a\.cz|repo\.id3a\.cz|sentry\.id3a\.cz)[^}]*)\}/,
          );
          if (m) {
            return {
              file: '',
              line: lineno,
              rule: 'hardcoded-infra-url-default',
              snippet: line.trim().slice(0, 140),
            };
          }
          return null;
        }),
      );
    }
    const msg =
      findings.length > 0
        ? `Found ${findings.length} hardcoded infra URL default(s) in scripts.\n` +
          findings.map((f) => `  ${f.file}:${f.line} — ${f.snippet}`).join('\n')
        : '';
    ratchetCheck('infra_url_defaults_in_scripts', findings.length, msg);
  });

  it('no hardcoded Coolify app UUID strings (24 lowercase-alphanum chars in mjs/sh)', () => {
    // Coolify v4 UUIDs are 24 chars (lowercase a-z + 0-9), generated at app
    // creation. Hardcoding them in scripts means cold-start --wipe breaks
    // those scripts. Use scripts/lib/coolify-resolve-uuid.{sh,mjs} to fetch
    // by name at runtime.
    const findings: Finding[] = [];
    const scriptFiles = files.filter(
      (f) => (f.startsWith('scripts/') || f.startsWith('deploy/')) &&
        (f.endsWith('.mjs') || f.endsWith('.sh') || f.endsWith('.yml')),
    );
    for (const f of scriptFiles) {
      // The resolve-uuid lib itself documents the UUID shape — skip
      if (f.includes('coolify-resolve-uuid')) continue;
      findings.push(
        ...scanLines(f, (line, lineno) => {
          if (isComment(line)) return null;
          // Quoted 24-char alphanum string. Avoid base64-ish strings with
          // uppercase/+/=/_ — Coolify v4 UUIDs are strictly [a-z0-9].
          const m = line.match(/(['"])([a-z0-9]{24})\1/);
          if (m) {
            // Skip if it's not in a credential-like context — e.g. file
            // names, hashes. We focus on suspicious assignments and
            // function args. Quick heuristic: assignment, call arg,
            // object literal value.
            const ctx = line.trim();
            if (
              ctx.includes('uuid:') ||
              ctx.includes('UUID') ||
              /=\s*['"][a-z0-9]{24}['"]/.test(ctx) ||
              /\b(redeploy|deploy|patch|fetchEnvs)\(/.test(ctx)
            ) {
              return {
                file: '',
                line: lineno,
                rule: 'hardcoded-coolify-uuid',
                snippet: ctx.slice(0, 140),
              };
            }
          }
          return null;
        }),
      );
    }
    const msg =
      findings.length > 0
        ? `Found ${findings.length} hardcoded Coolify-UUID-shaped string(s) in scripts.\n` +
          findings.map((f) => `  ${f.file}:${f.line} — ${f.snippet}`).join('\n')
        : '';
    ratchetCheck('coolify_uuid_strings', findings.length, msg);
  });

  it('no hardcoded `/realms/aisha` path (must use ${KEYCLOAK_REALM})', () => {
    const findings: Finding[] = [];
    for (const f of files) {
      // Only check active code files (excluding seed SQL with embedded docs)
      if (!/(\.ts|\.tsx|\.mjs|\.js|\.sh|\.yml|\.yaml|\.json|\.py)$/.test(f)) continue;
      // Allow keycloak/aisha-realm.json (it IS the realm definition; the
      // realm name "aisha" inside it is the structural identity, not a
      // hardcoded reference). But not other files.
      if (f === 'keycloak/aisha-realm.json') continue;
      findings.push(
        ...scanLines(f, (line, lineno) => {
          if (isComment(line)) return null;
          if (isDocPlaceholderHost(line)) return null;
          // Match `/realms/aisha` NOT preceded by `${...REALM...}` substitution
          // The `aisha` literal must be followed by a word boundary (slash, end-of-string, etc).
          if (line.includes('/realms/aisha') && !line.includes('${KEYCLOAK_REALM') && !line.includes('${REALM')) {
            // Skip if it's clearly a comment or template-variable definition
            if (line.match(/\/realms\/aisha(\b|\/|$)/)) {
              return {
                file: '',
                line: lineno,
                rule: 'hardcoded-realm-path',
                snippet: line.trim().slice(0, 140),
              };
            }
          }
          return null;
        }),
      );
    }
    const msg =
      findings.length > 0
        ? `Found ${findings.length} hardcoded \`/realms/aisha\` path(s).\n` +
          findings.map((f) => `  ${f.file}:${f.line} — ${f.snippet}`).join('\n')
        : '';
    ratchetCheck('realm_path_literals', findings.length, msg);
  });

  it('STRICT: no `${VAR:-<deployment-specific-value>}` fallbacks anywhere — use require_env / ${VAR:?...}', () => {
    // Per user directive 2026-05-26: "zadny fallbacky uz necheme, vse musi
    // jit z env." Deployment-specific = anything containing a TLD or a
    // URL prefix or a host-like pattern. Structural fallbacks (port=3000,
    // log-level=info, schema-list=public,storage) remain OK.
    //
    // Scope: scripts/, services/, compose files. Not config/ (SoT
    // templates), not docs/, not tests.
    const findings: Finding[] = [];
    const scopeFiles = files.filter(
      (f) =>
        (f.startsWith('scripts/') ||
          f.startsWith('services/') ||
          f.startsWith('docker-compose') ||
          f.startsWith('Dockerfile')) &&
        !f.endsWith('.test.ts') &&
        !f.endsWith('.test.mjs') &&
        !f.endsWith('.spec.ts'),
    );

    // Pattern: ${VAR:-VALUE} where VALUE looks deployment-specific.
    // We match in two passes to keep regex tractable.
    const deploymentTldRe =
      /\$\{[A-Z_][A-Z0-9_]*:-([^}]*?\b(?:id3a\.cz|aisha\.guru|aisha\.network|mesh\.aisha\.network|mesh\.aisha\.internal|evymo\.com|alquist\.ai)[^}]*?)\}/;
    const httpUrlRe = /\$\{[A-Z_][A-Z0-9_]*:-(https?:\/\/[^}]+)\}/;

    for (const f of scopeFiles) {
      findings.push(
        ...scanLines(f, (line, lineno) => {
          if (isComment(line)) return null;
          const m1 = line.match(deploymentTldRe);
          const m2 = line.match(httpUrlRe);
          const hit = m1 ?? m2;
          if (hit) {
            // Composite-template fallback: `${VAR:-https://${OTHER_VAR}}` —
            // the default value itself is built from OTHER_VAR templates and
            // contains NO literal deployment values. These are legitimate
            // composite defaults (e.g. KEYCLOAK_URL fallback constructed
            // from KEYCLOAK_DOMAIN). Skip them.
            const captured = hit[1] ?? '';
            if (captured.includes('${')) return null;
            // Localhost defaults (`http://127.0.0.1:port`, `http://localhost:port`)
            // and Docker Desktop host bridge (`http://host.docker.internal:port`)
            // are local-dev / in-container loopbacks, not deployment-specific.
            if (
              /^http:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|host\.docker\.internal)(:|\/|$)/.test(captured)
            ) {
              return null;
            }
            // Intra-stack Docker service DNS names (`http://postgrest:3000`,
            // `http://minio:9000`, `http://aisha-gateway:3001` etc.) — no
            // dots in the hostname means it's a compose service name resolved
            // by Docker embedded DNS within the same compose project. These
            // are tightly coupled to the compose file (which IS the SoT for
            // service names), so they're legitimate non-deployment defaults.
            if (
              /^http:\/\/[a-z][a-z0-9-]*(:[0-9]+)?(\/|$)/.test(captured)
            ) {
              return null;
            }
            return {
              file: '',
              line: lineno,
              rule: 'fallback-default-for-deployment-value',
              snippet: line.trim().slice(0, 140),
            };
          }
          return null;
        }),
      );
    }
    let msg = '';
    if (findings.length > 0) {
      const byFile = new Map<string, number>();
      for (const f of findings) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
      const topFiles = [...byFile.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([f, n]) => `  ${f}: ${n}`);
      const sample = findings.slice(0, 25).map((f) => `  ${f.file}:${f.line} — ${f.snippet}`);
      msg =
        `Found ${findings.length} \`\${VAR:-<deployment-value>}\` fallback(s).\n\n` +
        `Top files:\n${topFiles.join('\n')}\n\n` +
        `Sample of findings (first 25):\n${sample.join('\n')}`;
    }
    ratchetCheck('deployment_value_fallbacks', findings.length, msg);
  });

  it('no hardcoded private-registry / forge host (`npm.id3a.cz` / `repo.id3a.cz`) as a VALUE in shipping code', () => {
    // The private Verdaccio + Forgejo hosts are deployment infra — they must
    // come from VERDACCIO_URL / FORGEJO_URL (or rendered template placeholders),
    // never be baked into package.json publishConfig, Dockerfile npmrc, .npmrc
    // files, config templates, or service code. (2026-06-10: user directive
    // "ani repo ani verdaccio nechceme hardcoded".)
    //
    // Out of scope (already excluded via ALLOWED_PATHS): docs, *.example,
    // gate tests themselves (which legitimately enumerate the banned host as a
    // ban-pattern / lockfile-resolution security allowlist), and lockfiles
    // (npm writes the resolved registry host into package-lock.json — that is
    // a function of which registry the install used, not committed config).
    const HOST_VALUE = /(?:npm\.id3a\.cz|repo\.id3a\.cz)/;
    const findings: Finding[] = [];
    for (const f of files) {
      findings.push(
        ...scanLines(f, (line, lineno) => {
          if (isComment(line)) return null;
          if (isDocPlaceholderHost(line)) return null;
          // 2026-07-03: submodule pins are repo topology, not runtime config —
          // git cannot resolve .gitmodules URLs from env, and the previous
          // value was equally a hardcoded host (github.com), just a public one.
          // The insight submodule is pinned to the aisha fork on the project
          // forge (user decision; narrow carve-out from the 2026-06-10
          // "no hardcoded forge host" directive — everything else stays
          // hard-zero). Shape is governed by public-oss-boundary.gate.test.ts.
          if (f === '.gitmodules' && /^\s*url\s*=/.test(line)) return null;
          if (!HOST_VALUE.test(line)) return null;
          return {
            file: '',
            line: lineno,
            rule: 'hardcoded-registry-or-forge-host',
            snippet: line.trim().slice(0, 140),
          };
        }),
      );
    }
    const msg =
      findings.length > 0
        ? `Found ${findings.length} hardcoded registry/forge host literal(s) — source from VERDACCIO_URL / FORGEJO_URL or a rendered template placeholder.\n` +
          findings.map((f) => `  ${f.file}:${f.line} — ${f.snippet}`).join('\n')
        : '';
    ratchetCheck('registry_host_literals', findings.length, msg);
  });
});
