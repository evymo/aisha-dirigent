/**
 * Cold-start HEREDOC binding gate.
 *
 * Catches the failure mode that bit us on 2026-05-16 (commit 0b28a15d):
 * a bare `${VAR}` reference in the `.env.coolify`-generating HEREDOC of
 * `scripts/aisha-cold-start.sh` whose value source (config/domains.env)
 * had been removed. Under `set -uo pipefail` the HEREDOC aborts mid-flush,
 * `.env.coolify` is half-written, and downstream preflight fails with
 * cryptic "required variable X is missing" against a totally different
 * compose file. The original error one screen up (`unbound variable`) is
 * easy to miss.
 *
 * This gate enforces, statically:
 *
 *   For every `${VAR}` reference in the cold-start HEREDOC body
 *   (the block between `cat > "$TMP_ENV" <<HEADER` and `^HEADER$`),
 *   ONE of these must be true:
 *
 *     1. The reference itself supplies a default — `${VAR:-…}` or
 *        `${VAR:=…}` or `${VAR:?…}`. Bash never throws on these even
 *        under `set -u`.
 *
 *     2. `scripts/generate-secrets.mjs` emits the key (an
 *        `emit('VAR', …)` or `emit('VAR_PREFIX_…', …)` line).
 *
 *     3. `scripts/lib/derive-domains.mjs --shell` emits the key
 *        (we run the resolver in cloud-multi mode and parse `KEY=…` lines).
 *
 *     4. The key is on the curated allow-list of "set earlier in the
 *        script body" or "loaded from .env-prod-backup" — vars the cold-
 *        start guarantees are present in the shell by the time it reaches
 *        the HEREDOC.
 *
 * If a reference satisfies none of the four, this test fails with the
 * exact var name, telling you to either add a `:-default` or hook it
 * into one of the upstream sources.
 *
 * Reads only files (plus one subprocess for the resolver). No network,
 * no Docker. Suitable for pre-push.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const COLD_START = "scripts/aisha-cold-start.sh";
const GENERATE_SECRETS = "scripts/generate-secrets.mjs";
const DOMAINS_ENV = "config/domains.env";
const IMAGE_VERSIONS_ENV = "config/image-versions.env";

/**
 * Vars the cold-start script sets or sources BEFORE the HEREDOC executes.
 * Curated allow-list — keep narrow. If a var moves into generate-secrets
 * or the resolver, REMOVE it from here.
 *
 * Sources (verified by reading `scripts/aisha-cold-start.sh` 2026-05-16):
 *   - `.env-prod-backup` is sourced near top → all keys defined there
 *   - bash builtin / system env: `HOME`, `USER`, etc.
 *   - flag-driven local vars: `DRY_RUN`, `PRESERVE_STATEFUL_SECRETS`, …
 *   - Phase B late-bind: `ANON_KEY`, `SERVICE_ROLE_KEY` (filled by inline-
 *     init in core stack BEFORE the second env-doctor heal pass — but the
 *     HEREDOC at line 640 writes them out as empty placeholders, which is
 *     acceptable: empty != unbound, bash `set -u` accepts empty values.
 *     So these ARE bound by the time the HEREDOC fires; they're empty,
 *     not unset.)
 */
const ALLOWLIST_EXTERNAL = new Set<string>([
  // .env-prod-backup canonical names (verified by `grep -oE "^[A-Z_]+=" .env-prod-backup`)
  "ANTHROPIC_API_KEY",
  "APPLE_AUTH_KEY",
  "APPLE_BUNDLE_ID",
  "APPLE_KEY_ID",
  "APPLE_SERVICES_ID",
  "APPLE_TEAM_ID",
  "COOLIFY_API_TOKEN",
  "COOLIFY_BASE_URL",
  "COOLIFY_ENVIRONMENT",
  "COOLIFY_PROJECT_UUID",
  "COOLIFY_SERVER_UUID_BACKEND",
  "COOLIFY_SERVER_UUID_BUILD",
  "COOLIFY_SERVER_UUID_FRONTEND",
  "COOLIFY_SERVER_UUID_EXPERIMENTAL",
  "COOLIFY_URL",
  "COOLIFY_WEBHOOK_SECRET_FORGEJO",
  "COOLIFY_API_KEY", // alias of COOLIFY_API_TOKEN — set in alias step
  "FORGEJO_TOKEN",   // alias of FORGEJO_API_TOKEN
  "FORGEJO_API_TOKEN",
  // Verdaccio (private registry, $VERDACCIO_URL) auth — 23 services that depend on @aisha/security
  // pass this through as Docker build-arg. Sourced from operator's
  // .env-prod-backup; cold-start emits it in the HEREDOC + REGEN_KEYS regex
  // preserves it. See feat(cold-start): propagate VERDACCIO_TOKEN as build-time
  // env to 23 @aisha/security consumers (commit 96d15aec).
  "VERDACCIO_TOKEN",
  "VERDACCIO_URL",
  "DEEPL_API_KEY",
  "EVYMO_MCP_TOKEN",
  "EVYMO_MCP_URL",
  "GITHUB_WEBHOOK_SECRET",
  "GOOGLE_AI_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_PROJECT_ID",
  "GOOGLE_PROJECT_NUMBER",
  "LLM_GW_API_KEY",
  "MCP_TOKEN",
  "OPENAI_API_KEY",
  // Variables explicitly assigned in the script body BEFORE the HEREDOC.
  // Search anchors: `grep -nE "^[A-Z_]+=" scripts/aisha-cold-start.sh`
  // and ensure they're set before line 640.
  "ADDITIONAL_REDIRECT_URLS",
  "ALLOWED_ORIGINS",
  "ANON_KEY",
  "SERVICE_ROLE_KEY",
  "AISHA_ANON_KEY",
  "AISHA_SERVICE_KEY",
  "AISHA_BACKEND_ANON_KEY",
  "AISHA_BACKEND_SERVICE_KEY",
  "AISHA_BACKEND_URL",
  "AISHA_API_URL",
  "AISHA_DB_URL",
  "BROKER_TOKEN_SECRET",
  "POSTGREST_SERVICE_TOKEN",
  "KC_CLIENT_SECRET",
  "RABBITMQ_USER",
  "RABBITMQ_PASS",
  "LIVEKIT_API_KEY",
  "SYNAPSE_FORM_SECRET",
  "SYNAPSE_MACAROON_SECRET",
  "SYNAPSE_REGISTRATION_SECRET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "NOCODB_DB_PASSWORD",
  "VITE_AISHA_BACKEND_ANON_KEY",
  "VITE_AISHA_BACKEND_PUBLISHABLE_KEY",
  "VITE_AISHA_GATEWAY_KEY",
  "VITE_REQUIRE_AISHA_BACKEND_ENV",
  "VITE_AISHA_BACKEND_URL",
  "VITE_API_URL",
  "VITE_KC_URL",
  "VITE_KC_AUTHORITY",
  "VITE_KC_CLIENT_ID",
  "VITE_AUTH_REDIRECT_URI",
  "VITE_AUTH_POST_LOGOUT_URI",
  "VITE_PUBLIC_SITE_URL",
  "VITE_AISHA_GATEWAY_URL",
  "VITE_REQUIRE_AISHA_ENV",
  "VITE_SENTRY_DSN",
  "VITE_WEB_PUSH_VAPID_PUBLIC_KEY",
  "LOGFLARE_RELEASE_COOKIE",
  "REALTIME_DB_ENC_KEY",
  "PUBLIC_SITE_URL",
  "AISHA_LLM_GATEWAY_URL",
  // Per-instance mesh isolation — derived from APP_NAME_PREFIX in the script body
  // (indented, inside the writer fn) just before the HEREDOC; the primary `aisha`
  // instance keeps port 33073, other namespaces get a deterministic unique port.
  "NETBIRD_MESH_PORT",
  "NETBIRD_NS",
  // Compose-defaults vars (matches `${VAR:-fallback}` pattern but bash also
  // sees them set by 3rd-party sources via .env-prod-backup):
  "RESEND_API_KEY",
  "NETBIRD_API_TOKEN",
  "SENTRY_URL",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SENTRY_AUTH_TOKEN",
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "TELEGRAM_BOT_TOKEN",
  "COSMOS_SIGNER_MNEMONIC",
  "REGISTRY_PROXY_USERNAME",
  "REGISTRY_PROXY_PASSWORD",
  "COHERE_API_KEY",
  // Set by scripts/coolify-mesh-sync.mjs in cold-start step 5 (peer discovery
  // → CORE_MESH_IP env propagated to Coolify env). At the HEREDOC point it
  // resolves to empty string if unset, which is acceptable.
  "CORE_MESH_IP",
  // Cluster service endpoints — operator sets in .env-prod-backup; cold-start
  // emits them in the HEREDOC bare (no default) so empty value propagates to
  // Coolify env and the runtime stack can detect "unconfigured" at boot time.
  // Iter 10 cleanup removed in-script `*.aisha.guru` defaults to keep the
  // repo template-only.
  "INSIGHT_OPENAI_ENDPOINT",
  "MAESTRO_URL",
  "PKI_BRIDGE_URL",
  "BG_ACTIVE_HOST",
  "STUDIO_DOMAIN_DIRECT",
  "VERDACCIO_URL",
]);

/**
 * Parse `^KEY=…` assignments from config/domains.env (a bash-sourceable file).
 * Skips comments / blank lines. The script sources this file before the
 * HEREDOC, so every key here is bound (even if its value is itself
 * `${OTHER}` — bash performs late substitution, the binding still exists).
 */
function parseDomainsEnv(src: string): Set<string> {
  const out = new Set<string>();
  for (const raw of src.split("\n")) {
    const line = raw.replace(/^\s+/, "");
    if (line.startsWith("#") || line === "") continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Extract the HEREDOC body between `cat > "$TMP_ENV" <<HEADER` and a lone `HEADER` line. */
function extractHeredoc(script: string): string {
  const startRe = /cat > "\$TMP_ENV" <<HEADER\n/;
  const startMatch = script.match(startRe);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(
      "HEREDOC start anchor `cat > \"$TMP_ENV\" <<HEADER` not found in cold-start script",
    );
  }
  const after = script.slice(startMatch.index + startMatch[0].length);
  const endRe = /^HEADER$/m;
  const endMatch = after.match(endRe);
  if (!endMatch || endMatch.index === undefined) {
    throw new Error("HEREDOC end anchor `^HEADER$` not found after start");
  }
  return after.slice(0, endMatch.index);
}

/**
 * Extract every `${VAR}` reference that does NOT supply a default
 * (i.e. excludes `${VAR:-…}`, `${VAR:=…}`, `${VAR:?…}`, `${VAR:+…}`,
 * `${VAR#…}`, `${VAR%…}`, `${VAR/…}`).
 *
 * Returns the unique set of variable names.
 */
function extractBareRefs(body: string): Set<string> {
  // Match `${NAME}` where NAME is [A-Z_][A-Z0-9_]* and the closing brace
  // comes IMMEDIATELY after the name (no `:-`, no slicing operators).
  const re = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
  const out = new Set<string>();
  for (const m of body.matchAll(re)) {
    out.add(m[1]);
  }
  return out;
}

/** Pull every `emit('NAME', …)` and `emit("NAME", …)` from generate-secrets.mjs. */
function parseGenerateSecretsEmits(src: string): Set<string> {
  const re = /emit\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g;
  const out = new Set<string>();
  for (const m of src.matchAll(re)) {
    out.add(m[1]);
  }
  return out;
}

/** Run derive-domains.mjs --shell --profile=cloud-multi, parse KEY=value emits. */
function runResolverGetKeys(): Set<string> {
  const stdout = execFileSync(
    "node",
    [
      "scripts/lib/derive-domains.mjs",
      "--shell",
      "--profile=cloud-multi",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, MESH_ENABLED: "false" },
    },
  );
  const out = new Set<string>();
  for (const line of stdout.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m) out.add(m[1]);
  }
  return out;
}

describe("Cold-start HEREDOC bindings", () => {
  it("every bare `${VAR}` reference in the HEREDOC has a binding source", () => {
    const script = read(COLD_START);
    const generateSecrets = read(GENERATE_SECRETS);
    const heredoc = extractHeredoc(script);
    const refs = extractBareRefs(heredoc);

    const fromSecrets = parseGenerateSecretsEmits(generateSecrets);
    const fromResolver = runResolverGetKeys();
    const fromDomainsEnv = parseDomainsEnv(read(DOMAINS_ENV));
    // config/image-versions.env is `set -a; source ...; set +a`'d before the
    // HEREDOC (verified line ~344 of aisha-cold-start.sh) so every IMAGE_X
    // declared in it is bound by the time the HEREDOC fires.
    const fromImageVersions = parseDomainsEnv(read(IMAGE_VERSIONS_ENV));

    const unbound: string[] = [];
    for (const v of refs) {
      if (fromSecrets.has(v)) continue;
      if (fromResolver.has(v)) continue;
      if (fromDomainsEnv.has(v)) continue;
      if (fromImageVersions.has(v)) continue;
      if (ALLOWLIST_EXTERNAL.has(v)) continue;
      unbound.push(v);
    }

    expect(
      unbound,
      [
        "Bare `${VAR}` references in the cold-start HEREDOC have no binding source.",
        "Under `set -uo pipefail` these abort the HEREDOC mid-flush, leaving",
        ".env.coolify half-written. Add a `:-default` to the ref, or hook the",
        "var into one of: scripts/generate-secrets.mjs (emit()),",
        "scripts/lib/derive-domains.mjs (services.json + profile),",
        "config/domains.env (declared assignment), or the ALLOWLIST_EXTERNAL",
        "set in this test (with a comment).",
        "",
        "Unbound refs:",
        ...unbound.sort().map((v) => `  - \${${v}}`),
      ].join("\n"),
    ).toEqual([]);
  });

  it("the HEREDOC anchor pair exists and is unambiguous (regression: refactor safety)", () => {
    const script = read(COLD_START);
    const startCount =
      (script.match(/cat > "\$TMP_ENV" <<HEADER\n/g) ?? []).length;
    const endCount = (script.match(/^HEADER$/gm) ?? []).length;
    expect(
      startCount,
      "Expected exactly ONE `cat > \"$TMP_ENV\" <<HEADER` block — if it splits or moves, update this gate",
    ).toBe(1);
    // End count can include the start's HEADER label and matching closer. The
    // start matches `<<HEADER\n` (with the newline). The end matches `^HEADER$`
    // which also matches the start's word boundary if we're not careful — but
    // because start matches `<<HEADER\n` not `^HEADER$`, the only `^HEADER$`
    // match is the actual end. Assert exactly 1.
    expect(
      endCount,
      "Expected exactly ONE `^HEADER$` closing line — multiple closes indicate split HEREDOCs",
    ).toBe(1);
  });

  it("the resolver emits every legacy_env_var declared in profiles (sanity)", () => {
    // Ensures changes to profile JSON don't silently drop legacy emissions
    // that the HEREDOC depends on (LLM_GATEWAY_DOMAIN, OPENCLAW_DOMAIN).
    const fromResolver = runResolverGetKeys();
    expect(fromResolver).toContain("LLM_GATEWAY_DOMAIN");
    expect(fromResolver).toContain("OPENCLAW_DOMAIN");
    expect(fromResolver).toContain("API_DOMAIN"); // fallback target for MCP_KNOWLEDGE_DOMAIN
  });
});
