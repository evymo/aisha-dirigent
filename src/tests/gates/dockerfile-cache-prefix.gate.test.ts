/**
 * Dockerfile Cache Prefix Gate
 *
 * AISHA stack uses `aisha-registry` as a Docker Hub pull-through cache
 * (cache.aisha.guru). All Dockerfile `FROM` directives that reference
 * Docker Hub images MUST use the cache prefix to avoid:
 *   1. Docker Hub unauthenticated rate limits (429 toomanyrequests)
 *   2. Network egress when image is already cached locally
 *   3. Build failures during cold-start when many images pull in parallel
 *
 * Pattern: FROM cache.aisha.guru/library/<lib>:<tag>      (for library images)
 *          FROM cache.aisha.guru/<user>/<repo>:<tag>      (for non-library)
 *
 * Allowed exceptions (registries that are NOT Docker Hub):
 *   - quay.io/* — Red Hat registry (different rate limits)
 *   - ghcr.io/* — GitHub Container Registry
 *   - mcr.microsoft.com/* — Microsoft Container Registry (official Playwright etc.)
 *   - registry:2 — special: aisha-registry itself (used to BUILD the cache)
 *   - cache.aisha.guru/* — already routed via cache
 *   - ${VAR_NAME} — runtime build-arg image overrides
 *   - <stage>             — multi-stage build references (FROM deps AS X)
 *
 * Discovered: 2026-05-09 cold-start --wipe failed at aisha-core build with
 *   `pgvector/pgvector:pg17: 429 Too Many Requests` because Dockerfiles
 *   referenced docker.io directly instead of cache.aisha.guru.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();

/**
 * Read the project's canonical pull-through cache host from
 * `config/domains.env` (`REGISTRY_DOMAIN=...`). Fork operators set this
 * to their own cache hostname (e.g., cheers fork uses a different value);
 * the gate accepts whatever the live project config declares — no
 * hardcoded `cache.aisha.guru` in the test code.
 *
 * This satisfies the "dynamic per project" principle: each fork's gate
 * reads its own cache host from its own checkout's config — zero shared
 * hardcoded assumption about which fork is being linted.
 */
function getProjectRegistryHost(): string {
  // Iter 14/15: config/domains.env is template-only (empty values); the
  // reference deploy contract lives in .example. Read from .env first; if
  // REGISTRY_DOMAIN is empty there (template), fall back to .env.example.
  // This gate verifies that Dockerfile FROMs either use the project's cache
  // host OR an env-var prefix — both paths are valid after iter 13.
  const candidates = [
    join(ROOT, "config/domains.env"),
    join(ROOT, "config/domains.env.example"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    const cfg = readFileSync(cfgPath, "utf-8");
    const m = cfg.match(/^REGISTRY_DOMAIN=([^\s#]+)/m);
    if (m && m[1].trim().length > 0) return m[1].trim();
  }
  throw new Error(
    "REGISTRY_DOMAIN missing from both config/domains.env and config/domains.env.example — " +
    "must declare the project's pull-through cache host in the .example file " +
    "(operator overrides via env / their own domains.env overlay)."
  );
}

const REGISTRY_HOST = getProjectRegistryHost();

// Patterns for direct images that bypass cache for legitimate reasons —
// EXCLUDING the project's cache host (built dynamically from config).
const DIRECT_IMAGE_ALLOWLIST: RegExp[] = [
  /^quay\.io\//,
  /^ghcr\.io\//,
  /^gcr\.io\//,
  /^mcr\.microsoft\.com\//,            // Microsoft Container Registry — not Docker Hub, no anon rate limits (e.g. official Playwright image)
  /^dock\.mau\.dev\//,
  /^registry\.gitlab\.com\//,
  /^registry:2\b/,                    // pull-through cache image itself
  /^\$\{[A-Z_][A-Z0-9_]*\}/,          // build-arg variable: ${REGISTRY_PROXY}, ${IMAGE_X}, ${NETBIRD_BASE_IMAGE} etc.
  // Multi-stage references (no slash, no colon, looks like alias):
  /^[a-z][a-z0-9-]*$/,                // e.g. "deps", "builder", "patcher"
  /^[a-z][a-z0-9-]* AS /i,            // also handle inline AS
];

/**
 * Escape a hostname for safe use in a RegExp.
 */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROJECT_CACHE_PATTERN = new RegExp(`^${escapeForRegex(REGISTRY_HOST)}/`);

function isAllowedDirectImage(image: string): boolean {
  if (PROJECT_CACHE_PATTERN.test(image)) return true;
  return DIRECT_IMAGE_ALLOWLIST.some((re) => re.test(image));
}

function findDockerfiles(): string[] {
  // Use git ls-files for speed (only tracked files, indexed)
  try {
    const out = execFileSync("git", [
      "ls-files",
      "*Dockerfile*",
    ], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("/node_modules/") && !f.startsWith("node_modules/"))
      .filter((f) => !f.includes("/trash/") && !f.startsWith("trash/"))
      .filter((f) => !f.includes("/legacy/") && !f.startsWith("legacy/"))
      .filter((f) => !f.includes("legacy-"))                  // legacy-* dirs
      .filter((f) => existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).isFile());
  } catch {
    return [];
  }
}

interface FromDirective {
  file: string;
  line: number;
  image: string;
  raw: string;
}

function parseFromDirectives(file: string): FromDirective[] {
  const abs = join(ROOT, file);
  const content = readFileSync(abs, "utf-8");
  const lines = content.split("\n");
  const directives: FromDirective[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("FROM ")) continue;
    // Parse "FROM [--platform=$X] <image>[:tag] [AS <stage>]"
    let rest = line.substring(5).trim();
    // Strip --platform=... flag if present
    rest = rest.replace(/^--platform=\S+\s+/, "");
    // Take first token as image
    const image = rest.split(/\s+/)[0];
    directives.push({ file, line: i + 1, image, raw: line });
  }
  return directives;
}

describe("Dockerfile Cache Prefix Gate", () => {
  const dockerfiles = findDockerfiles();

  test("at least 10 Dockerfiles found (sanity check)", () => {
    expect(
      dockerfiles.length,
      `Expected to find Dockerfiles via git ls-files; got ${dockerfiles.length}.\n` +
      `If this regressed, check git ls-files '*Dockerfile*' output manually.`,
    ).toBeGreaterThan(10);
  });

  test("all Dockerfile FROM directives use cache.aisha.guru or allowed registry", () => {
    const violations: string[] = [];

    for (const file of dockerfiles) {
      const directives = parseFromDirectives(file);
      for (const d of directives) {
        if (isAllowedDirectImage(d.image)) continue;

        violations.push(
          `${d.file}:${d.line}  ${d.raw}\n` +
          `      → use 'cache.aisha.guru/library/${d.image}' (library) or ` +
          `'cache.aisha.guru/${d.image}' (non-library namespace)`,
        );
      }
    }

    expect(
      violations.length,
      `Found ${violations.length} Dockerfile FROM directive(s) that bypass aisha-registry cache:\n` +
      violations.slice(0, 30).join("\n") +
      (violations.length > 30 ? `\n  …and ${violations.length - 30} more.` : "") +
      "\n\nAll Docker Hub images MUST use cache.aisha.guru prefix to avoid rate limits.\n" +
      "Allowed exceptions: quay.io/*, ghcr.io/*, cache.aisha.guru/*, registry:2, ${VAR}, multi-stage aliases",
    ).toBe(0);
  });
});

/**
 * DRUHÁ POLOVINA TÉŽE VLASTNOSTI: prefix `${REGISTRY_PROXY}` ve FROM je jen
 * SLIB. Test výš ho přijme (`${VAR}` je na allowlistu) — ale když volající
 * `docker build` build-arg nepředá, dosadí se prázdno a obraz jde přímo na
 * Docker Hub. Dockerfile je pak „v pořádku" a build stejně padá na 429.
 *
 * ⛔ NAMĚŘENO 2026-09-13 na upstream PR #955: „Cold-start: apply" padl po 43 s
 * na `pgvector/pgvector:pg17: 429 Too Many Requests`, ještě před první SQL —
 * `ci.yml` stavěl `infra/postgres/Dockerfile` bez `--build-arg REGISTRY_PROXY`.
 *
 * Měří se VOLÁNÍ, ne soubor: první měření („zmiňuje soubor REGISTRY_PROXY?")
 * pustilo `run-av-integration.mjs`, který proměnnou jmenuje jen v komentáři a
 * build-arg nepředával.
 *
 * Univerzum se hledá: sledované workflowy a skripty, v nich každé `docker build`
 * (shell i `docker(["build", …])` z Node). Volání, jehož `-f` míří na Dockerfile
 * BEZ `ARG REGISTRY_PROXY`, nic předávat nemusí; dynamickou cestu brána neumí
 * vyhodnotit, a proto předání vyžaduje.
 */
interface BuildVolani {
  soubor: string;
  radek: number;
  text: string;
  dockerfile: string | null;
}

const JE_BUILD = [
  /\bdocker\s+(?:buildx\s+)?build\b/,
  /\bdocker["'`]?\s*,\s*\[\s*["'`]build["'`]/,
  /\bdocker\(\s*\[\s*["'`]build["'`]/,
];

function stavitelskeSoubory(): string[] {
  const out = execFileSync("git", ["ls-files", ".forgejo/workflows", "scripts"], {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .split("\n")
    .filter((f) => /\.(ya?ml|sh|mjs|cjs|js)$/.test(f))
    .filter((f) => !/\.test\.(mjs|cjs|js|ts)$/.test(f));
}

/** Logické řádky: shellové pokračování `\` se slije s dalším řádkem. */
function logickeRadky(obsah: string): { radek: number; text: string }[] {
  const radky = obsah.split("\n");
  const out: { radek: number; text: string }[] = [];
  for (let i = 0; i < radky.length; i++) {
    const start = i;
    let text = radky[i];
    while (/\\\s*$/.test(text) && i + 1 < radky.length) {
      text = text.replace(/\\\s*$/, " ") + radky[++i];
    }
    out.push({ radek: start + 1, text });
  }
  return out;
}

function buildVolani(): BuildVolani[] {
  const volani: BuildVolani[] = [];
  for (const soubor of stavitelskeSoubory()) {
    const abs = join(ROOT, soubor);
    if (!existsSync(abs)) continue;
    for (const { radek, text } of logickeRadky(readFileSync(abs, "utf-8"))) {
      const t = text.trim();
      if (t.startsWith("#") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) continue;
      if (!JE_BUILD.some((re) => re.test(t))) continue;
      // Hláška, která o buildu jen MLUVÍ, není build.
      if (/^(echo|printf|console\.(log|error|warn))\b/.test(t)) continue;
      const f = t.match(/-f["'`]?\s*,?\s*["'`]?([^\s"'`,\]]+)/);
      volani.push({ soubor, radek, text: t, dockerfile: f ? f[1] : null });
    }
  }
  return volani;
}

/** Deklaruje cílový Dockerfile ARG REGISTRY_PROXY? `null` = nejde vyhodnotit. */
function deklarujeProxy(dockerfile: string | null): boolean | null {
  if (!dockerfile) return null;
  const cesta = dockerfile.replace(/^(\$ROOT|\$\{ROOT\}|\$GITHUB_WORKSPACE|\$\{GITHUB_WORKSPACE\})\//, "");
  if (cesta.includes("$")) return null;
  const abs = join(ROOT, cesta);
  if (!existsSync(abs)) return null;
  return /^\s*ARG\s+REGISTRY_PROXY\b/m.test(readFileSync(abs, "utf-8"));
}

describe("volající docker build předává REGISTRY_PROXY", () => {
  const volani = buildVolani();

  test("brána najde stavitele obrazů (univerzum není prázdné)", () => {
    // Prázdné univerzum by dalo zelenou bez jediného měření.
    expect(volani.length, "žádné `docker build` ve workflowech ani skriptech — detektor je slepý").toBeGreaterThanOrEqual(5);
    expect(
      volani.some((v) => deklarujeProxy(v.dockerfile) === true),
      "žádné volání nemíří na Dockerfile s ARG REGISTRY_PROXY — vlastnost by se neměřila",
    ).toBe(true);
  });

  test("build Dockerfilu s ARG REGISTRY_PROXY ho předává", () => {
    const porusujici = volani
      .filter((v) => deklarujeProxy(v.dockerfile) !== false)
      .filter((v) => !/REGISTRY_PROXY|registryProxyBuildArgs\(/.test(v.text))
      .map((v) => `${v.soubor}:${v.radek}  ${v.text.slice(0, 160)}  [-f ${v.dockerfile ?? "?"}]`);
    expect(
      porusujici,
      `docker build bez REGISTRY_PROXY — FROM \${REGISTRY_PROXY}… se dosadí prázdně a obraz jde na Docker Hub (429):\n` +
        porusujici.join("\n") +
        `\n\nShell (CI): bash scripts/ci/registry-proxy-guard.sh && docker build --build-arg REGISTRY_PROXY="$REGISTRY_PROXY" …` +
        `\nShell (lokálně): docker build \${REGISTRY_PROXY:+--build-arg REGISTRY_PROXY="$REGISTRY_PROXY"} …` +
        `\nNode: docker(["build", ...registryProxyBuildArgs(), …]) ze scripts/lib/registry-proxy.mjs`,
    ).toEqual([]);
  });
});
