/**
 * PKI Placeholder Substitution Gate
 *
 * Enforces that every `__PKI_*__` placeholder in the OpenXPKI config tree
 * has a corresponding substitution step in `pki-init`'s inline command in
 * `docker-compose.coolify-pki.yml`.
 *
 * Why this gate exists (2026-05-11 cold-start failure):
 *   `openxpki-config/config.d/realm.tpl/rpc/generic.yaml` contained the
 *   literal `hmac: __PKI_RPC_HMAC__`. The pki-init substitution loop ran
 *   `find /rendered/config.d/realm` (no slash, no `.tpl`), so it only
 *   scanned the `realm/` subtree — and `realm.tpl/` is a sibling, not a
 *   descendant. The placeholder survived the deploy. OpenXPKI then read
 *   the literal string as the expected HMAC; every signature pki-bridge
 *   sent mismatched; pki-bridge re-raised the OpenXPKI error as HTTP 500.
 *   Symptoms: netbird `pki-init` log → `pki-bridge /v1/issue failed:
 *   curl: (22) The requested URL returned error: 500`, with no signal
 *   that the failure was placeholder-substitution rather than auth or
 *   network.
 *
 *   The drift was undetectable at compose-parse time and only surfaced
 *   at runtime under the very specific scenario "cross-stack RPC cert
 *   issuance + per-realm rpc/generic.yaml absent (template fallback)".
 *
 * What's checked:
 *   1. Enumerate every `__PKI_*__` placeholder in the OpenXPKI config
 *      source tree (`openxpki-config/`).
 *   2. For each unique placeholder, assert that
 *      `docker-compose.coolify-pki.yml`'s pki-init `command:` block
 *      contains a substitution step that targets it (sed/awk replacing
 *      that exact token).
 *   3. Assert pki-init's substitution scan path is `/rendered/config.d`
 *      (or broader), NOT `/rendered/config.d/realm` (which misses
 *      `realm.tpl/`).
 *
 *   Together these guarantee a fresh cold-start cannot ship a config
 *   tree with unresolved placeholders into OpenXPKI runtime.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PKI_COMPOSE = join(ROOT, "docker-compose.coolify-pki.yml");
const OPENXPKI_CONFIG_DIR = join(ROOT, "openxpki-config");

const PLACEHOLDER_RE = /__PKI_[A-Z][A-Z0-9_]*__/g;
const YAML_RE = /\.ya?ml$/i;

function walkYaml(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory missing — caller treats empty walk as zero placeholders;
    // the test that needs the dir will fail explicitly.
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkYaml(full, acc);
    else if (YAML_RE.test(e)) acc.push(full);
  }
  return acc;
}

function collectPlaceholders(): Set<string> {
  const found = new Set<string>();
  for (const file of walkYaml(OPENXPKI_CONFIG_DIR)) {
    const content = readFileSync(file, "utf-8");
    for (const m of content.matchAll(PLACEHOLDER_RE)) {
      found.add(m[0]);
    }
  }
  return found;
}

describe("PKI Placeholder Substitution — pki-init covers every __PKI_*__ token", () => {
  test("openxpki-config tree contains at least one placeholder (gate is meaningful)", () => {
    const placeholders = collectPlaceholders();
    expect(
      placeholders.size,
      "openxpki-config/ has no __PKI_*__ placeholders — gate is no-op. Either the templates moved or the substitution model changed; update this gate accordingly.",
    ).toBeGreaterThan(0);
  });

  test("every __PKI_*__ placeholder has a sed/awk substitution in pki-init", () => {
    const placeholders = collectPlaceholders();
    const composeContent = readFileSync(PKI_COMPOSE, "utf-8");

    const missing: string[] = [];
    for (const p of placeholders) {
      // Look for the placeholder appearing inside a sed or awk command.
      // We accept either `sed -i "s|PLACEHOLDER|..."` or `awk -v ... gsub(/PLACEHOLDER/, ...)`.
      const sedRe = new RegExp(`sed[^\\n]*${p.replace(/_/g, "_")}`);
      const awkRe = new RegExp(`gsub\\(/${p.replace(/_/g, "_")}/`);
      if (!sedRe.test(composeContent) && !awkRe.test(composeContent)) {
        missing.push(p);
      }
    }

    expect(
      missing,
      [
        "Placeholders present in openxpki-config/ but NOT substituted by pki-init:",
        ...missing.map((p) => `  - ${p}`),
        "",
        "Every __PKI_*__ token must be replaced before OpenXPKI starts —",
        "otherwise it ships into the runtime config and breaks HMAC validation,",
        "database connection, vault key derivation, or whichever subsystem owns",
        "that token. Add a sed/awk step to `pki-init`'s command block in",
        "docker-compose.coolify-pki.yml.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("RPC HMAC substitution scans the whole config.d tree (not just realm/)", () => {
    const composeContent = readFileSync(PKI_COMPOSE, "utf-8");

    // The buggy pattern: `find /rendered/config.d/realm -name 'generic.yaml'`
    // scans only the `realm/` subtree and misses `realm.tpl/`. That's how the
    // 2026-05-11 cold-start regression slipped in. Reject this exact form.
    expect(
      composeContent,
      "pki-init MUST NOT use `find /rendered/config.d/realm -name 'generic.yaml' ...` for HMAC substitution — that path misses `realm.tpl/` (sibling, not descendant). OpenXPKI falls back to realm.tpl/rpc/generic.yaml when per-realm rpc/generic.yaml is absent, leaving the literal `__PKI_RPC_HMAC__` placeholder in runtime config → HMAC mismatch → HTTP 500 on every cert request. Use `/rendered/config.d` (or list both paths).",
    ).not.toMatch(/find\s+\/rendered\/config\.d\/realm\s+-name/);

    // Positive assertion: the substitution must scan the full config.d
    // tree (top-level `config.d`, with `/realm/` or `/realm.tpl/` only
    // ever appearing inside the -path filter, never as the start path).
    // Accept `find /rendered/config.d -name ...` or equivalent.
    expect(
      composeContent,
      "pki-init must scan the FULL config.d tree for __PKI_RPC_HMAC__ substitution (find /rendered/config.d -name 'generic.yaml' -path '*/rpc/*'). The single-line `find /rendered/config.d ` (immediately followed by -name) is the canonical form.",
    ).toMatch(/find\s+\/rendered\/config\.d\s+-name/);
  });

  test("pki-init verifies no placeholder survives substitution (hard-fail)", () => {
    // Even with the right find scope, a typo or new placeholder could slip
    // through. pki-init must scan the rendered tree after substitution and
    // exit non-zero if any __PKI_*__ remains — otherwise the failure mode
    // is silent (OpenXPKI starts with literal placeholder as config value).
    const composeContent = readFileSync(PKI_COMPOSE, "utf-8");

    expect(
      composeContent,
      "pki-init MUST end the substitution block with a verification grep that exits the container if any `__PKI_*__` placeholder remains. Mirror the pattern in docker-compose.coolify-pki.yml after the HMAC sed loop.",
    ).toMatch(/grep[^\n]*__PKI_[\s\S]+?exit\s+1/);
  });

  test("OpenXPKI RPC HMAC is generated by cold-start and pushed to Coolify env", () => {
    const coldStart = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");
    const secretsGenerator = readFileSync(join(ROOT, "scripts/generate-secrets.mjs"), "utf-8");
    const deployInit = readFileSync(join(ROOT, "scripts/coolify-deploy-init.sh"), "utf-8");
    const composeContent = readFileSync(PKI_COMPOSE, "utf-8");

    expect(
      secretsGenerator,
      "generate-secrets.mjs must generate/preserve OPENXPKI_RPC_HMAC as the source-of-truth stack secret.",
    ).toMatch(/emit\('OPENXPKI_RPC_HMAC',\s+pg\('OPENXPKI_RPC_HMAC',\s+\(\) => hex\(32\)\)\)/);
    expect(
      coldStart,
      "aisha-cold-start.sh must call the source-of-truth generator before persisting .env.coolify.",
    ).toContain("scripts/generate-secrets.mjs");
    expect(
      coldStart,
      ".env.coolify must persist OPENXPKI_RPC_HMAC so wipe/redeploy keeps OpenXPKI and pki-bridge aligned.",
    ).toContain("OPENXPKI_RPC_HMAC=${OPENXPKI_RPC_HMAC}");
    expect(
      deployInit,
      "coolify-deploy-init.sh must push OPENXPKI_RPC_HMAC into the aisha-pki app env.",
    ).toContain('set_coolify_env "$local_uuid" "OPENXPKI_RPC_HMAC"');
    expect(
      composeContent,
      "pki-init must fail fast if OPENXPKI_RPC_HMAC is missing; it must not generate an independent runtime HMAC.",
    ).toMatch(/FATAL: OPENXPKI_RPC_HMAC env not set[\s\S]+exit 1/);
    expect(composeContent).not.toMatch(/OPENXPKI_RPC_HMAC="\$\(openssl rand -hex 32\)"/);
    expect(composeContent).not.toContain("rpc-hmac.key");
    expect(composeContent).not.toContain("pki-shared");
  });

  test("pki-init bash-local vars use $$VAR escape, not $VAR (docker compose interpolation trap)", () => {
    // Hard-learned 2026-05-11: docker compose interpolates BOTH `${VAR}` and
    // `$VAR` references in the `command:` field AT PARSE TIME, using its own
    // env (NOT the container's runtime env). Bash-local variables (assigned
    // inside the script) are unknown to compose → substituted with empty
    // string BEFORE the container script runs. Symptom: pki-init renders an
    // empty or wrong HMAC into OpenXPKI config and pki-bridge cert issuance
    // fails with HMAC mismatch / backend error.
    //
    // Fix: every reference to a bash-local variable must use `$$VAR` /
    // `$${VAR}` (docker compose unescapes `$$` → `$`, then bash interprets).
    // Pattern is already established by the pki-renewer block in this file.
    //
    // This gate parses the command blocks of pki-init + pki-server and
    // asserts no unescaped reference to a script-local var remains.
    const composeContent = readFileSync(PKI_COMPOSE, "utf-8");

    // Names of vars known to be assigned/read inside script bodies and still
    // require escaping when referenced in compose command blocks.
    // Adding a new bash-local var? Add it here AND escape every reference.
    const BASH_LOCAL_VARS = [
      "OPENXPKI_RPC_HMAC", // pki-init: env secret used by sed/verification
      "SUBST_COUNT",       // pki-init: file count
      "DAEMON_PID",        // pki-server: openxpkid background PID
      "WAITED",            // pki-server: socket wait counter
      "BOOTSTRAP_RC",      // pki-server: realm bootstrap exit code
    ];

    // Pull only the command-block heredoc content (lines under `command:`
    // up to the next sibling YAML key). Block ends at the next 4-space-indent
    // sibling, the next top-level key, or absolute end-of-file.
    //
    // NOTE: do NOT use `$` (end-of-line) in the lookahead — `gm` flag makes
    // `$` match end-of-LINE, causing the lazy quantifier to stop after just
    // the first content line of the block. Use `\\$(?![\\s\\S])` for true
    // end-of-string.
    const commandBlocks = composeContent.match(
      /^\s+command:\s*\n[\s\S]+?(?=\n {4}[a-z]\w*:|\n[a-z]\w*:|\$(?![\s\S]))/gm,
    ) ?? [];
    expect(
      commandBlocks.length,
      "expected at least one `command:` heredoc block in docker-compose.coolify-pki.yml",
    ).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const block of commandBlocks) {
      for (const v of BASH_LOCAL_VARS) {
        // Skip the explicit ASSIGNMENT line (VAR=$(...) or VAR=$!) and any
        // line inside a literal comment (#). Look only for substitution
        // references: `${VAR}` or `$VAR` followed by non-identifier char.
        // Patterns to flag (unescaped):
        //   ${VAR}      ${VAR:-...}   $VAR\s   $VAR}   $VAR]
        // Patterns to accept:
        //   VAR=...     (assignment)
        //   $$VAR       $${VAR}       (escaped — compose passes literal $)
        //   $(... VAR ...)   inside `$((...))` arithmetic (no $ prefix needed)
        const lines = block.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // skip comments
          if (/^\s*#/.test(line)) continue;
          // skip pure assignment lines (LHS = RHS, no $ prefix on LHS)
          if (new RegExp(`^\\s*${v}=`).test(line)) continue;

          // Detect `$VAR` or `${VAR}` that is NOT preceded by `$` (escape).
          // Use lookbehind: `(?<!\$)\$\{?VAR\b`
          const unescaped = new RegExp(
            `(?<!\\$)\\$\\{?${v}(\\}|:-|:\\?|\\b)`,
          );
          if (unescaped.test(line)) {
            violations.push(
              `  line ${i + 1}: ${v} reference not escaped → "${line.trim().slice(0, 100)}"`,
            );
          }
        }
      }
    }

    expect(
      violations,
      [
        "Bash-local variable references in docker-compose.coolify-pki.yml",
        "command scripts are NOT escaped — docker compose will interpolate",
        "them with EMPTY STRING at parse time, breaking pki-init's HMAC",
        "write (0-byte file) and pki-server's daemon wait/cleanup.",
        "",
        "Use $$VAR (or $${VAR}) instead of $VAR / ${VAR} for any variable",
        "assigned INSIDE the script. Compose passes the literal $; bash",
        "then resolves it from the in-container shell.",
        "",
        "Violations:",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });
});
