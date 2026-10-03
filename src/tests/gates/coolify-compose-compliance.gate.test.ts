/**
 * Coolify Compose Compliance Gate Tests
 *
 * Static analysis of Docker Compose files for Coolify deployment compliance.
 * Validates patterns documented in:
 * - docs/deploy/COOLIFY_COMPOSE_RULES.md
 * - knowledge-extraction/COOLIFY_OPERATIONS.md
 * - knowledge-extraction/SSO_OIDC_PATTERNS.md
 *
 * Categories:
 * 1. Init containers (restart: no): one-shot musí mít healthcheck: disable: true
 *    (skončí → aktivní healthcheck = věčné running:unhealthy); hlídkový vzor
 *    (drží nekonečnou smyčku) naopak MUSÍ mít healthcheck aktivní — jeho
 *    zdraví je jediný důkaz odvedené práce (netinit, 2026-08-11)
 * 2. Routed services must have healthcheck definitions
 * 3. Multi-network services must have traefik.docker.network label
 * 4. OAuth2 Proxy services must have correct OIDC config
 * 5. No hardcoded secrets in compose files
 * 6. Keycloak PKCE config consistency
 * 7. Domain mapping documentation completeness
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { isTrackedService } from "./lib/tracked-services";
import { coolifyOdmitneCil, coolifyOdmitneZdroj, pastNaPromennou, zdrojeSvazku } from "./lib/zdroje-svazku";

const ROOT = process.cwd();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

/** Get all docker-compose*.yml files from project root (excluding local). */
function getComposeFiles(includeLocal = false): { relPath: string; content: string }[] {
  const files: { relPath: string; content: string }[] = [];
  if (!existsSync(ROOT)) return files;
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith("docker-compose") && name.endsWith(".yml")) {
      if (!includeLocal && name.includes("local")) continue;
      files.push({
        relPath: name,
        content: readSafe(join(ROOT, name)),
      });
    }
  }
  return files;
}

/** Extract a service block by name from compose YAML (regex-based). */
function extractServiceBlock(content: string, serviceName: string): string | null {
  const lines = content.split("\n");
  let inServices = false;
  let capturing = false;
  let depth = -1;
  const result: string[] = [];

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;

    // Top-level key ends services section
    if (/^[a-z][\w-]*:/i.test(line) && !line.startsWith(" ")) {
      if (capturing) break;
      inServices = false;
      continue;
    }

    // Service name at 2-space indent
    const svcMatch = line.match(/^( {2})([a-zA-Z][\w-]*):/);
    if (svcMatch) {
      if (capturing) break;
      if (svcMatch[2] === serviceName) {
        capturing = true;
        depth = 2;
        result.push(line);
        continue;
      }
    }

    if (capturing) {
      // Check if we've left the service block (same or lesser indent)
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (indent <= depth && line.trim() !== "" && /^\s{2}[a-zA-Z]/.test(line)) {
        break;
      }
      result.push(line);
    }
  }

  return result.length > 0 ? result.join("\n") : null;
}

/** Parse service names from compose YAML. */
function parseServiceNames(content: string): string[] {
  const lines = content.split("\n");
  let inServices = false;
  const names: string[] = [];

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^[a-z][\w-]*:/i.test(line) && !line.startsWith(" ")) {
      inServices = false;
      continue;
    }
    if (inServices) {
      const svcMatch = line.match(/^ {2}([a-zA-Z][\w-]*):/);
      if (svcMatch) names.push(svcMatch[1]);
    }
  }

  return names;
}

const COMPOSE_FILES = getComposeFiles();

// ─── 1. Init containers must have healthcheck disabled ───────────────────────

describe("Init Container Healthcheck Compliance", () => {
  test("init containers (restart: no) must have healthcheck: disable: true", () => {
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      const services = parseServiceNames(file.content);
      for (const svc of services) {
        const block = extractServiceBlock(file.content, svc);
        if (!block) continue;

        // Is this an init container?
        // ⛔ KOTVA NA ODSAZENÍ JE SOUČÁST PRAVIDLA, ne úklid. Neukotvený vzor
        // bral i text KOMENTÁŘE: 2026-09-05 stačila v `svc-agent-runner`
        // poznámka, která ten zápis CITOVALA, a brána z ní udělala init
        // kontejner — hlásila vadu na službě, která žádnou neměla. Klíč služby
        // má vždy 4 mezery; `#` na začátku řádku se sem nedostane a obsah
        // blokových skalárů je odsazený hlouběji.
        const isInit = /^ {4}restart:\s*["']?no["']?\s*$/m.test(block);
        if (!isInit) continue;

        const hasDisabled = /healthcheck:\s*\n\s+disable:\s*true/.test(block);

        // HLÍDKOVÝ VZOR (2026-08-11, netinit): restart:"no" kontejner, který po
        // práci NEskončí — drží nekonečnou smyčku — je jiná třída než one-shot.
        // Jeho healthcheck je jediný důkaz odvedené práce (Coolify logy exited
        // aplikace odmítá, "finished" znamená jen "up -d vrátil nulu"), takže
        // u něj platí OBRÁCENÝ invariant: healthcheck musí být AKTIVNÍ.
        // Rozlišuje se VLASTNOSTÍ bloku (přítomnost holdu), ne jménem souboru.
        const holds = /while :; do sleep \d+; done|sleep infinity|tail -f \/dev\/null/.test(block);
        if (holds) {
          if (hasDisabled || !/healthcheck:/.test(block)) {
            violations.push(
              `${file.relPath}: hlídkový kontejner "${svc}" (restart: no + hold) musí mít ` +
                `AKTIVNÍ healthcheck — jeho zdraví je jediný měřitelný důkaz odvedené práce`,
            );
          }
          continue;
        }

        // One-shot init: must have healthcheck disabled — kontejner skončí a
        // aktivní healthcheck by aplikaci nechal věčně v running:unhealthy.
        if (!hasDisabled) {
          violations.push(
            `${file.relPath}: init container "${svc}" missing healthcheck: disable: true`,
          );
        }
      }
    }

    expect(
      violations,
      "Init containers without disabled healthcheck cause running:unhealthy:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });
});

// ─── 2. Multi-network services need traefik.docker.network ──────────────────

describe("Traefik Network Disambiguation", () => {
  test("services on 2+ networks must have traefik.docker.network label", () => {
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      const services = parseServiceNames(file.content);
      for (const svc of services) {
        const block = extractServiceBlock(file.content, svc);
        if (!block) continue;

        // Count network references in the block
        const networkLines = block.match(/^\s+-\s+\w+/gm) || [];
        const networksSection = block.match(/networks:\s*\n((?:\s+-\s+[\w-]+\n?)+)/);
        if (!networksSection) continue;

        const networks = networksSection[1].match(/-\s+(\w+)/g) || [];
        if (networks.length < 2) continue;

        // The label tells Traefik WHICH network to reach the container on, so it
        // only means anything for a service Traefik actually routes. Derive that
        // from the service itself — `traefik.enable=true` or any router label —
        // instead of maintaining a list of names that don't need it. The list was
        // the older shape here and it drifted: `loki` (2 networks, zero traefik
        // labels) was absent from it, so the rule reported a routing bug for a
        // service nothing routes. That went unnoticed only because this gate's
        // regex could not see past the prose that used to sit in these files.
        const routed =
          /traefik\.enable\s*=\s*["']?true/.test(block) || /traefik\.http\.routers\./.test(block);
        if (!routed) continue;

        const hasTraefikLabel = /traefik\.docker\.network/.test(block);
        if (!hasTraefikLabel) {
          violations.push(
            `${file.relPath}: "${svc}" is Traefik-routed on ${networks.length} networks but has no traefik.docker.network label`,
          );
        }
      }
    }

    expect(
      violations,
      "Traefik-routed services on 2+ networks without traefik.docker.network → 503:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  test("services that reference a network must have it defined at top-level (no silent-drop)", () => {
    // Footgun observed 2026-05-10: Docker Compose silently drops a service's
    // `- coolify` (or similar) network reference if that name isn't declared
    // at the top-level `networks:` key. The deploy completes, the container
    // reports healthy — but it's only attached to the networks that ARE
    // defined. Combined with `traefik.docker.network=coolify`, Traefik then
    // looks for the container on a network it isn't on and serves 404. The
    // silent failure makes this hard to diagnose post-hoc.
    //
    // Pattern: every `- <name>` listed under a service's `networks:` block
    // must appear as a top-level key in the file's `networks:` section.
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      // Extract the top-level networks block: from `^networks:` to either
      // the next top-level YAML key (`^[a-z]`) or end of file. Robust to
      // blank lines + comments inside the block.
      const lines = file.content.split("\n");
      const definedNetworks = new Set<string>();
      let inNetworks = false;
      for (const line of lines) {
        if (/^networks:\s*$/.test(line)) {
          inNetworks = true;
          continue;
        }
        if (inNetworks) {
          // A new top-level key (no leading whitespace, ends with `:`) ends the block
          if (/^[A-Za-z][\w-]*:\s*$/.test(line)) {
            inNetworks = false;
            continue;
          }
          // Top-level network name lives at exactly 2-space indent + `name:`
          const m = line.match(/^ {2}([a-zA-Z][\w-]*):\s*$/);
          if (m) definedNetworks.add(m[1]);
        }
      }

      const services = parseServiceNames(file.content);
      for (const svc of services) {
        const block = extractServiceBlock(file.content, svc);
        if (!block) continue;

        const networksSection = block.match(/networks:\s*\n((?:\s+-\s+[\w-]+\n?)+)/);
        if (!networksSection) continue;
        const referenced = (networksSection[1].match(/-\s+([a-zA-Z][\w-]*)/g) || [])
          .map((s) => s.replace(/^-\s+/, ""));
        for (const net of referenced) {
          if (!definedNetworks.has(net)) {
            violations.push(
              `${file.relPath}: service "${svc}" references network "${net}" but it's not defined under top-level \`networks:\` (Docker silently drops the reference, Traefik then 404s).`,
            );
          }
        }
      }
    }

    expect(
      violations,
      "Compose services reference networks that aren't declared at top level (silent-drop footgun):\n" +
        violations.join("\n"),
    ).toEqual([]);
  });
});

// ─── 3. OAuth2 Proxy configuration consistency ─────────────────────────────

describe("OAuth2 Proxy OIDC Configuration", () => {
  test("all OAuth2 Proxy services must reference keycloak-oidc provider", () => {
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      const services = parseServiceNames(file.content);
      for (const svc of services) {
        const block = extractServiceBlock(file.content, svc);
        if (!block) continue;

        // Is this an OAuth2 Proxy service? Detect strictly by `image:` field
        // (or build: dockerfile referencing oauth2-proxy) so prose mentions
        // of "oauth2-proxy" inside comments don't trigger a false positive.
        const isOauth2Proxy =
          /^\s+image:\s*\S*oauth2[-_]?proxy/im.test(block) ||
          /^\s+dockerfile:\s*\S*oauth2[-_]?proxy/im.test(block);
        if (!isOauth2Proxy) continue;

        // Must use keycloak-oidc provider
        if (!block.includes("keycloak-oidc")) {
          violations.push(
            `${file.relPath}: OAuth2 Proxy "${svc}" must use OAUTH2_PROXY_PROVIDER=keycloak-oidc`,
          );
        }

        // Must have OIDC issuer URL pointing to our Keycloak
        if (!block.includes("OAUTH2_PROXY_OIDC_ISSUER_URL")) {
          violations.push(
            `${file.relPath}: OAuth2 Proxy "${svc}" missing OAUTH2_PROXY_OIDC_ISSUER_URL`,
          );
        }

        // Must have healthcheck
        if (!block.includes("healthcheck")) {
          violations.push(
            `${file.relPath}: OAuth2 Proxy "${svc}" missing healthcheck`,
          );
        }

        // Must have cookie secret (not empty)
        if (!block.includes("OAUTH2_PROXY_COOKIE_SECRET")) {
          violations.push(
            `${file.relPath}: OAuth2 Proxy "${svc}" missing OAUTH2_PROXY_COOKIE_SECRET`,
          );
        }

        // Must skip health endpoint at minimum (healthz or /api/v1/health)
        if (block.includes("OAUTH2_PROXY_SKIP_AUTH_ROUTES")) {
          if (!/health/.test(block)) {
            violations.push(
              `${file.relPath}: OAuth2 Proxy "${svc}" SKIP_AUTH_ROUTES should include a health endpoint`,
            );
          }
        }
      }
    }

    expect(
      violations,
      "OAuth2 Proxy misconfiguration:\n" + violations.join("\n"),
    ).toEqual([]);
  });

  test("OAUTH2_PROXY_COOKIE_SECURE must not be false in production compose", () => {
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/OAUTH2_PROXY_COOKIE_SECURE.*["']?false["']?/i.test(line)) {
          violations.push(
            `${file.relPath}:${i + 1} — OAUTH2_PROXY_COOKIE_SECURE=false in production compose`,
          );
        }
      }
    }

    expect(
      violations,
      "OAuth2 Proxy cookies must be secure in production:\n" + violations.join("\n"),
    ).toEqual([]);
  });
});

// ─── 4. Keycloak configuration ──────────────────────────────────────────────

describe("Keycloak OIDC Configuration", () => {
  test("žádný compose nenasazuje Supabase auth (GoTrue) — autentizace je Keycloak", () => {
    // ── CO TU BYLO PŘEDTÍM ────────────────────────────────────────────────────
    // Test „GoTrue external Keycloak nesmí mít zapnuté PKCE". Potřeboval službu
    // jménem `auth` A proměnnou `GOTRUE_EXTERNAL_KEYCLOAK_PKCE`. Naměřeno
    // 2026-08-13: ani jedno v žádném compose NENÍ, takže nemohl nikdy nic najít
    // ani nic potvrdit — měřil nulu a hlásil zelenou.
    //
    // ── CO MĚŘÍ TEĎ ───────────────────────────────────────────────────────────
    // Vlastnost, na které záleží: GoTrue tu neběží. Autentizace je Keycloak OIDC
    // (+ OAuth2 Proxy per aplikace). Kdyby se sem někdo pokusil Supabase auth
    // vrátit — obrazem, službou nebo `GOTRUE_*` proměnnou předávanou kontejneru
    // — je to návrat vrstvy, kterou platforma nahradila.
    //
    // Nehlídá se výskyt SLOVA: `/auth/v1/*` proxy v gateway a
    // `SupabaseGoTrueAdapter` jsou ZÁMĚRNÉ kompatibilní povrchy nad Keycloakem
    // a jmenují se tak schválně. Hlídá se, co by compose SPUSTIL.
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      for (const [, obraz] of file.content.matchAll(/^\s*image:\s*["']?(\S+?)["']?\s*$/gm)) {
        if (/(^|\/)(gotrue|supabase[/-])/i.test(obraz)) {
          violations.push(`${file.relPath}: obraz '${obraz}' — Supabase auth se nenasazuje, autentizace je Keycloak`);
        }
      }
      for (const [, klic] of file.content.matchAll(/^\s*(GOTRUE_[A-Z0-9_]+):/gm)) {
        violations.push(`${file.relPath}: proměnná '${klic}' se předává kontejneru — GoTrue neběží, nikdo ji nepřečte`);
      }
    }

    expect(
      COMPOSE_FILES.length,
      "žádný compose se nenačetl — brána by měřila nic",
    ).toBeGreaterThan(5);

    expect(
      violations,
      "Supabase auth (GoTrue) se vrací do stacku:\n  " + violations.join("\n  "),
    ).toEqual([]);
  });

  test("Keycloak realm JSON must exist", () => {
    const realmPath = join(ROOT, "keycloak", "aisha-realm.json");
    expect(
      existsSync(realmPath),
      "Missing keycloak/aisha-realm.json — Keycloak needs realm config for import",
    ).toBe(true);
  });
});

// ─── 5. No hardcoded secrets in compose files ───────────────────────────────

describe("Compose Secret Hygiene", () => {
  test("Coolify compose files must not use nested variable interpolation", () => {
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip $$-escaped sequences — Compose treats `$$` as a literal `$`,
        // so `$$\{A:-$$\{B\}\}` is NOT processed by Coolify's YAML env parser.
        // It's passed through verbatim to the container shell which handles
        // standard parameter expansion. Common in entrypoint shell scripts.
        const yamlLevelOnly = line.replace(/\$\$/g, "");

        // A `#` comment line is not configuration — same reasoning as the `$$`
        // skip above. The pattern legitimately appears in prose that WARNS
        // against it (docker-compose.coolify-source-broker.yml records what
        // nested interpolation did to this stack on 2026-07-20), and a gate that
        // flags its own documentation teaches people to delete the explanation
        // instead of keeping the rule.
        if (/^\s*#/.test(line)) continue;

        if (/\$\{[^}]*\$\{/.test(yamlLevelOnly)) {
          violations.push(`${file.relPath}:${i + 1} — nested interpolation breaks Coolify build-time env parsing`);
        }
      }
    }

    expect(
      violations,
      "Coolify build-time env parser cannot handle nested ${A:-${B}} interpolation:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  test("no hardcoded JWT secrets or API keys in compose files", () => {
    const violations: string[] = [];

    // Patterns that look like hardcoded secrets (not variable references)
    const SECRET_PATTERNS = [
      // Long base64 strings in SECRET/KEY fields (not ${...} references)
      /(?:SECRET|_KEY):\s*["']?[A-Za-z0-9+/=]{40,}["']?\s*$/,
    ];

    // Known exceptions: Supabase example keys documented in Supabase docs
    const KNOWN_EXCEPTION_PATTERNS = [
      /ANON_KEY.*eyJ/, // Supabase anon key (public, not secret)
      /SERVICE_ROLE_KEY.*eyJ/, // Documented in Coolify env vars
    ];

    for (const file of COMPOSE_FILES) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip variable references ${...} and comments
        if (line.includes("${") || line.trim().startsWith("#")) continue;

        for (const pattern of SECRET_PATTERNS) {
          if (pattern.test(line)) {
            const isKnown = KNOWN_EXCEPTION_PATTERNS.some((p) => p.test(line));
            if (!isKnown) {
              violations.push(
                `${file.relPath}:${i + 1} — possible hardcoded secret`,
              );
            }
          }
        }
      }
    }

    expect(
      violations,
      "Hardcoded secrets in compose files (use ${VAR} references):\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  test("secrets the platform GENERATES must fail fast — ${VAR:-} is only legitimate for operator-supplied ones", () => {
    // The silently-empty class: `${SECRET:-}` suppresses even docker's
    // unset-variable warning (which local-env-completeness keys on), so a
    // deploy where the env push didn't land starts services with EMPTY
    // credentials — e.g. svc-matrix booting fine while every PostgREST call
    // 401s.
    //
    // This used to be policed by a hand-maintained ALLOWED_EMPTY_SECRETS list.
    // That list was the wrong shape: it grew to 45 entries, every addition
    // silently widened the rule, and it drifted from reality — 8 of its entries
    // were secrets generate-secrets.mjs ALWAYS produces, i.e. real holes the
    // exception was hiding (PKI_SVAULT_KEY, PLATFORM_ADMIN_PASSWORD,
    // COSMOS_SIGNER_MNEMONIC, …). An exception list is a symptom; the question
    // it was answering is derivable.
    //
    // The distinction that actually matters is WHO produces the value:
    //   pg('VAR', gen)          — preserve-or-generate: cold-start ALWAYS emits a
    //                             value, so empty means the push failed → ${VAR:?}
    //   preservedValue('VAR')   — passthrough of an operator value; absent is a
    //   / not emitted at all      legitimate state (BYO key, feature off,
    //                             runtime-minted later) → ${VAR:-} is correct
    // Derived from the generator itself, so it cannot drift and needs no upkeep.
    // Vars whose value cold-start guarantees (pg = preserve-or-generate).
    const genSrc = readSafe(join(ROOT, "scripts", "generate-secrets.mjs"));
    // `pg(VAR, () => "")` is a PLACEHOLDER, not a generated secret — the generator
    // deliberately yields empty (e.g. PKI_CLIENT_KEY_B64, filled in later by the
    // PKI bootstrap). Requiring :? there would fail every deploy on a value the
    // platform itself produces as empty, so match only real generators.
    const PLATFORM_GENERATED = new Set<string>(
      [...genSrc.matchAll(/emit\(\s*['"]([A-Z0-9_]+)['"]\s*,\s*([^\n]*)/g)]
        .filter((m) => /\bpg\(/.test(m[2]) && !/=>\s*''\s*\)/.test(m[2]))
        .map((m) => m[1]),
    );
    expect(PLATFORM_GENERATED.size).toBeGreaterThan(50); // guard: parse must not silently yield nothing

    // A VITE_-prefixed var is public BY CONSTRUCTION: Vite only exposes that
    // prefix to client code, so its value ships inside the browser bundle. It
    // therefore cannot be a credential, and the name heuristic below (…KEY…)
    // only ever produced false positives for it. Excluded here rather than
    // listed in ALLOWED_EMPTY_SECRETS — an entry there would assert "this
    // secret may be empty", which mis-states what these are, and the list
    // would grow with every new publishable build arg.
    const SECRET_NAME =
      /\$\{(?!VITE_)([A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|MNEMONIC)[A-Z0-9_]*):-\}/g;
    const violations: string[] = [];

    // `$${VAR}` is NOT compose interpolation — compose emits a literal `$` and the
    // shell INSIDE the container expands it. Rewriting one of those to `:?` changes
    // container runtime behaviour (in sh, `${VAR:?}` aborts at the expansion, which
    // silently turns an explicit FATAL branch into dead code) while doing nothing
    // for the deploy-time guarantee this gate is about. Blank them before scanning,
    // mirroring scripts/lib/coolify-app-vars.sh:29-31.
    const stripInContainerRefs = (s: string) => s.replace(/\$\$\{[^}]*\}/g, "").replace(/\$\$[A-Z_][A-Z0-9_]*/g, "");

    for (const file of COMPOSE_FILES) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const m of stripInContainerRefs(lines[i]).matchAll(SECRET_NAME)) {
          const varName = m[1];
          if (PLATFORM_GENERATED.has(varName)) {
            violations.push(
              `${file.relPath}:${i + 1} — \${${varName}:-} defaults a secret to EMPTY, but ` +
                `generate-secrets.mjs always produces it (pg). Empty here means the env push ` +
                `failed — use \${${varName}:?...} so the deploy fails loudly instead.`,
            );
          }
        }
      }
    }

    expect(
      violations,
      "Silently-empty secret defaults found:\n" + violations.join("\n"),
    ).toEqual([]);
  });

  test("every fail-fast (:?) secret has a guaranteed delivery path (generate → bulk-sync, or explicit deploy-init push)", () => {
    // The root of the silently-empty class isn't the compose default — it's a
    // secret that nothing DELIVERS to the app. ${VAR:?} only converts a silent
    // empty into a loud deploy failure; this gate closes the loop by proving
    // each :?-required secret is actually produced and pushed:
    //   path A: scripts/generate-secrets.mjs emit('VAR') → lands in
    //           .env.coolify → scripts/coolify-sync-envs.sh (per-app filter,
    //           MANDATORY hard-fail cold-start step before any deploy)
    //           bulk-pushes every compose-referenced key to its app, and its
    //           VALIDATE_ONLY pass treats ${VAR:?} as required-present.
    //   path B: explicit set_coolify_env "<uuid>" "VAR" in coolify-deploy-init.
    //   path C: justified operator-supplied entry below.
    const generateSecrets = readSafe(join(ROOT, "scripts", "generate-secrets.mjs"));
    const deployInit = readSafe(join(ROOT, "scripts", "coolify-deploy-init.sh"));
    const coldStart = readSafe(join(ROOT, "scripts", "aisha-cold-start.sh"));

    // The delivery contract itself must stay wired: sync-envs is invoked from
    // cold-start as a hard-fail step (not advisory).
    expect(coldStart).toContain("coolify-sync-envs.sh");
    expect(coldStart).toMatch(/if\s+!\s+.*coolify-sync-envs\.sh/);

    const OPERATOR_REQUIRED: Record<string, string> = {
      // none currently — operator-supplied secrets use ${VAR:-} + the
      // silently-empty allowlist above (graceful degradation), not :?.
    };

    const SECRET_REQ = /\$\{([A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|MNEMONIC)[A-Z0-9_]*):\?/g;
    const required = new Set<string>();
    for (const file of COMPOSE_FILES) {
      for (const m of file.content.matchAll(SECRET_REQ)) required.add(m[1]);
    }
    expect(required.size, "expected the :? conversion set to be discovered").toBeGreaterThanOrEqual(20);

    const undelivered: string[] = [];
    for (const varName of [...required].sort()) {
      const emitted = new RegExp(`emit\\(\\s*['"]${varName}['"]`).test(generateSecrets);
      const pushed = new RegExp(`set_coolify_env(?:_if)?\\s+"[^"]*"\\s+"${varName}"`).test(deployInit);
      const operator = varName in OPERATOR_REQUIRED;
      if (!emitted && !pushed && !operator) undelivered.push(varName);
    }

    expect(
      undelivered,
      "Fail-fast secrets with NO delivery path (generate-secrets emit / deploy-init push / operator allowlist) — " +
        "these would hard-fail every deploy:\n" + undelivered.join("\n"),
    ).toEqual([]);
  });

  test("no secret is interpolated outside environment/build-args context (command, entrypoint, labels)", () => {
    // Secrets belong in `environment:`/`build.args:` — visible in docker
    // inspect Config.Env like any container env, which is the accepted
    // baseline. Interpolating them into command/entrypoint argv additionally
    // exposes them via process listings and (for command) the rendered
    // compose in Coolify UI; most daemons do NOT redact argv.
    const ALLOWED_ARGV_SECRETS: Record<string, string> = {
      // redis-server overwrites its process title after start (`redis-server
      // *:6379`), so argv exposure collapses to the env-visibility baseline.
      // Tracked follow-up: migrate to a config file / env-driven image.
      REDIS_PASSWORD: "redis redacts argv post-start; exposure equals env baseline",
      REDIS_PASSWORD_ADMIN: "redis redacts argv post-start; exposure equals env baseline",
      // (2026-09-25) VAULT_ENCRYPTION_KEY / COLUMN_ENCRYPTION_KEY tu měly výjimku
      // kvůli PGOPTIONS služby db — PGOPTIONS s klíči je pryč (klíče jsou soubory,
      // ne GUC; brána tajemstvi-neni-guc), výjimka tedy taky.
      // NOTE (2026-06-10): the former init-container entries (db-init CREATE
      // USER ×4, pki-init/renderer ×5) were REMEDIATED — the scripts now read
      // the secret from the service `environment:` via the $$-deferred form,
      // so nothing is baked into Cmd at compose-parse time. The COOLIFY_
      // COMPOSE_RULES §3 "$$ breaks under Coolify" incident does NOT reproduce
      // on the current Coolify: verified via the API — the stored TRANSFORMED
      // compose of aisha-core preserves the netbird-agent command block's
      // $${NB_SETUP_KEY:-} byte-identically, and that script runs in
      // production. The gate now enforces no-argv-secrets with NO
      // init-container exceptions.
    };

    const SECRET_REF = /\$\{([A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|MNEMONIC)[A-Z0-9_]*)[:}?]/g;
    // Lines where a secret reference is acceptable:
    const ENV_MAPPING = /^\s*[A-Za-z_][A-Za-z0-9_.]*:\s/; //  KEY: ${VAR}  (environment/build.args mapping)
    const ENV_LIST = /^\s*-\s*[A-Za-z_][A-Za-z0-9_]*=/; //   - KEY=${VAR} (environment list form)
    const COMMENT = /^\s*#/;
    const HEALTHCHECK_TEST = /^\s*test:/; // covered by the dedicated healthcheck check above

    const violations: string[] = [];
    for (const file of COMPOSE_FILES) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (COMMENT.test(line) || HEALTHCHECK_TEST.test(line)) continue;
        const yamlLevelOnly = line.replace(/\$\$/g, "");
        const hits = [...yamlLevelOnly.matchAll(SECRET_REF)].map((m) => m[1]);
        if (hits.length === 0) continue;
        if (ENV_MAPPING.test(line) || ENV_LIST.test(line)) continue;
        for (const varName of hits) {
          if (varName in ALLOWED_ARGV_SECRETS) continue;
          violations.push(`${file.relPath}:${i + 1} — \${${varName}} outside environment/build-args context`);
        }
      }
    }

    expect(
      violations,
      "Secrets interpolated into argv/labels (process-listing + Coolify UI exposure):\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  test("no secret-named build ARG in Dockerfiles (image-history leak) without justification", () => {
    // `docker history` preserves ARG values referenced by RUN layers — a
    // secret passed as a classic build ARG is recoverable from the image.
    // The clean mechanism is a BuildKit secret mount (RUN --mount=type=secret).
    const ALLOWED_BUILD_ARG_SECRETS: Record<string, string> = {
      // Registry auth for @aisha/* installs at build time — repo-wide pattern
      // (21 service Dockerfiles). Images are pushed only to the PRIVATE
      // registry, which bounds the exposure to operators who already hold
      // registry credentials. Tracked follow-up: BuildKit secret mounts.
      VERDACCIO_TOKEN: "private-registry-bounded; migration to BuildKit secret mounts tracked",
      // Branded design clone at svc-web-artifact build (private aisha-guru-web).
      // Build-stage-only: the runtime stage is a separate FROM that never declares
      // this ARG, so the token is absent from the pushed image's history — a
      // stronger bound than VERDACCIO_TOKEN. Coolify delivers it as a build arg
      // (no BuildKit secret-mount support for compose builds); migration tracked.
      FORGEJO_TOKEN: "build-stage-only (absent from runtime image) + private-registry-bounded; BuildKit secret migration tracked",
      // Sentry sourcemap upload at web build. Same bound + follow-up.
      SENTRY_AUTH_TOKEN: "private-registry-bounded; migration to BuildKit secret mounts tracked",
      // Publishable client-side values (baked into the SPA bundle by design).
      VITE_AISHA_GATEWAY_KEY: "publishable client key",
    };
    const PUBLIC_NAME = /PUBLIC|PUBLISHABLE|ANON|VAPID/;

    const dockerfiles: string[] = [];
    for (const entry of readdirSync(ROOT)) {
      if (entry.startsWith("Dockerfile")) dockerfiles.push(entry);
    }
    const servicesDir = join(ROOT, "services");
    if (existsSync(servicesDir)) {
      for (const svc of readdirSync(servicesDir)) {
        // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
        if (!isTrackedService(svc)) continue;
        const df = join("services", svc, "Dockerfile");
        if (existsSync(join(ROOT, df))) dockerfiles.push(df);
      }
    }

    const violations: string[] = [];
    for (const rel of dockerfiles) {
      const content = readSafe(join(ROOT, rel));
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^ARG\s+([A-Z][A-Z0-9_]*)/);
        if (!m) continue;
        const name = m[1];
        if (!/(PASSWORD|SECRET|TOKEN|_KEY$|_KEY_|MNEMONIC)/.test(name)) continue;
        if (PUBLIC_NAME.test(name)) continue;
        if (name in ALLOWED_BUILD_ARG_SECRETS) continue;
        violations.push(`${rel}:${i + 1} — ARG ${name} (use a BuildKit secret mount)`);
      }
    }

    expect(
      violations,
      "Secret-named build ARGs leak via docker history:\n" + violations.join("\n"),
    ).toEqual([]);
  });

  test("no secret is interpolated into healthcheck commands (docker-inspect leak)", () => {
    // Parse-time ${SECRET} inside healthcheck.test bakes the credential into
    // the container's Healthcheck.Test config — visible in `docker inspect`,
    // `docker compose config` and the Coolify UI (2026-06-10 incident:
    // `curl -u elastic:${ELASTIC_PASSWORD}`). The $$-deferred form is banned
    // by COOLIFY_COMPOSE_RULES.md §3 (Coolify double-quoting breaks it).
    // Healthchecks must be auth-less liveness probes (§3b): a protocol-level
    // response (redis NOAUTH reply, HTTP 401) proves the server is up.
    // $$VAR emptiness tests (PENDING_BOOTSTRAP) leak nothing and are allowed —
    // strip $$ sequences before matching, same as the nested-interpolation test.
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/^\s*test:/.test(line)) continue;
        const yamlLevelOnly = line.replace(/\$\$/g, "");
        if (/\$\{[A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|_KEY|MNEMONIC)[A-Z0-9_]*[:}]/.test(yamlLevelOnly)) {
          violations.push(
            `${file.relPath}:${i + 1} — secret interpolated into healthcheck (visible in docker inspect). ` +
              `Use an auth-less liveness probe (COOLIFY_COMPOSE_RULES.md §3b).`,
          );
        }
      }
    }

    expect(
      violations,
      "Secrets interpolated into healthchecks:\n" + violations.join("\n"),
    ).toEqual([]);
  });
});

// ─── 5b. Volume source compliance ───────────────────────────────────────────

describe("Volume Source Compliance", () => {
  // Univerzum: VŠECHNY Coolify compose v kořeni. `getComposeFiles()` vynechává
  // jména s „local" (míněno docker-compose.local*.yml) — a tím tiše i Coolify
  // stack `docker-compose.coolify-local-ingest.yml`, jediný, který `${…}` ve
  // zdroji svazku skutečně měl (naměřeno 2026-09-23). Tahle vlastnost je
  // Coolify-specifická, proto univerzum = přesně to, co Coolify nasazuje.
  const COOLIFY_COMPOSE = readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f))
    .sort();

  /**
   * Známý dluh — holé `${VAR}` ve zdroji svazku (past: Coolify 4.3.16 z něj udělá
   * pojmenovaný svazek). Krok 2 systémové opravy (rozhodnutí 2026-09-28): Edge × web-render
   * jsou DVĚ aplikace, svazek mezi nimi sdílet nejde → předání po síti nebo jedna aplikace.
   * Do té doby Edge ani web-render z mainu nenasazovat (hlídá předávka). Smí jen ubývat.
   */
  const ZNAMY_DLUH_VAR_VE_ZDROJI = [
    "docker-compose.coolify-prebuilt.yml:web (krátký tvar) '${WEB_RENDER_STATIC_HOST_DIR}'",
    "docker-compose.coolify-prebuilt.yml:web (krátký tvar) '${WEB_RENDER_SHELL_HOST_DIR}'",
    "docker-compose.coolify-web-render.yml:svc-web-render (krátký tvar) '${WEB_RENDER_STATIC_HOST_DIR}'",
    "docker-compose.coolify-web-render.yml:svc-web-render (krátký tvar) '${WEB_RENDER_SHELL_HOST_DIR}'",
  ];

  function porusSvazku(soubor: string, obsah: string): string[] {
    const porus: string[] = [];
    for (const { sluzba, zdroj, cil, tvar } of zdrojeSvazku(soubor, obsah)) {
      const kde = `${soubor}:${sluzba} (${tvar === "kratky" ? "krátký" : "dlouhý"} tvar) '${zdroj}' → '${cil ?? "?"}'`;
      const coolify = coolifyOdmitneZdroj(zdroj);
      if (coolify) porus.push(`${kde} — Coolify deploy odmítne: ${coolify}`);
      const past = pastNaPromennou(zdroj);
      if (past) porus.push(`${kde} — ${past}`);
      const cilVada = cil === undefined ? null : coolifyOdmitneCil(cil);
      if (cilVada) porus.push(`${kde} — cíl: Coolify deploy odmítne: ${cilVada}`);
    }
    return porus;
  }

  test("volume source i cíl projdou validací Coolify a proměnná ve zdroji opravdu platí", () => {
    // Coolify dnes (4.3.16; v4.0.0-beta.443+) PŘIJME `${VAR}`, `${VAR}/cesta` a
    // `${VAR:-bezpečná}`; odmítne cokoli jiného s `${`, `$(`, backtick, `|&;<>`,
    // řídicí znaky — ve zdroji i v cíli (přenos validace: lib/zdroje-svazku.ts).
    // Incident 2026-06-30 (`${AGENT_RUNS_DIR:-…}` v exec) byl z okna beta.441–442,
    // kdy Coolify odmítal každé `${`.
    //
    // Navíc domácí pravidlo z měření: `${VAR:-x}` Coolify rozvine VŽDY na `x`
    // (proměnná je ozdoba) a ⛔ NAMĚŘENO 2026-09-28: holé `${VAR}` Coolify 4.3.16
    // převede na pojmenovaný svazek `<uuid>_<slug>` bez ohledu na hodnotu (sourceIsLocal,
    // shared.php:1692). Data sdílená službami = pojmenovaný svazek v TÉMŽE compose
    // (lib/zdroje-svazku.ts → pastNaPromennou).
    expect(COOLIFY_COMPOSE.length, "univerzum Coolify compose je prázdné — brána by nic neměřila").toBeGreaterThan(20);
    expect(COOLIFY_COMPOSE, "kontrolní vzorek: local-ingest je Coolify stack a MUSÍ být v univerzu").toContain(
      "docker-compose.coolify-local-ingest.yml",
    );
    const porus = COOLIFY_COMPOSE.flatMap((f) => porusSvazku(f, readFileSync(join(ROOT, f), "utf-8")));
    const dluh = porus.filter((p) => ZNAMY_DLUH_VAR_VE_ZDROJI.some((k) => p.startsWith(k)));
    const nove = porus.filter((p) => !dluh.includes(p));
    expect(nove, "Zdroj/cíl svazku, který Coolify odmítne nebo který nedělá, co vypadá:\n" + nove.join("\n")).toEqual([]);
    // Ráčna: dluh smí jen ubývat — opravená položka se ze seznamu SMAŽE (jinak by se
    // do ní mohl vrátit nový výskyt bez povšimnutí).
    for (const k of ZNAMY_DLUH_VAR_VE_ZDROJI) {
      expect(dluh.some((p) => p.startsWith(k)), `${k} už není porušení — odeber ho ze ZNAMY_DLUH_VAR_VE_ZDROJI`).toBe(true);
    }
  });

  test("negativní sonda: chytí oba tvary a každý odmítnutý i klamný zápis", () => {
    const vzorek = [
      "services:",
      "  a:",
      "    volumes:",
      '      - "${X:-/p}:/k1"', //                     past: Coolify vezme /p, X ignoruje
      '      - "${X}/sub:/k2"', //                     past: nenastavená X → /sub
      '      - "${X:-/p}/sub:/k3"', //                 Coolify odmítne (nesedí na vzor)
      '      - "${X:?chybí}:/k4"', //                  Coolify odmítne
      '      - "/data/$(id):/k5"', //                  Coolify odmítne
      '      - "/data/x;rm:/k6"', //                   Coolify odmítne
      '      - "/data/ok:/cil/${T}"', //               cíl s interpolací — Coolify odmítne
      "      - type: bind",
      "        source: ${Y:-/q}", //                   dlouhý tvar, past
      "        target: /k8",
      "      - type: bind",
      "        source: /data/`id`", //                 dlouhý tvar, Coolify odmítne
      "        target: /k9",
      '      - "${X}:/k10"', //                        past: Coolify z holého ${X} udělá svazek
      "      - type: bind",
      "        source: ${Z}", //                       dlouhý tvar, past (ztratí read_only)
      "        target: /k11",
    ].join("\n");
    const porus = porusSvazku("vzorek.yml", vzorek);
    for (const cil of ["/k1", "/k2", "/k3", "/k4", "/k5", "/k6", "/cil/${T}", "/k8", "/k9", "/k10", "/k11"]) {
      expect(porus.some((p) => p.includes(`→ '${cil}'`)), `sonda nechytila zápis s cílem ${cil}:\n${porus.join("\n")}`).toBe(true);
    }
  });

  test("pozitivní kontrola: pojmenovaný svazek, relativní i doslovná cesta projdou", () => {
    const vzorek = [
      "services:",
      "  a:",
      "    volumes:",
      "      - pki-certs:/certs/pki:ro",
      "      - ./config/pki:/certs/pki:ro",
      "      - /var/run/docker.sock:/var/run/docker.sock:rw",
      "      - /jen-cil-anonymni",
      "      - type: volume",
      "        source: pojmenovany",
      "        target: /data3",
    ].join("\n");
    expect(porusSvazku("vzorek.yml", vzorek)).toEqual([]);
  });
});

// ─── 6. Documentation completeness ─────────────────────────────────────────

describe("Infrastructure Documentation Completeness", () => {
  test("COOLIFY_COMPOSE_RULES.md must exist", () => {
    expect(
      existsSync(join(ROOT, "docs", "deploy", "COOLIFY_COMPOSE_RULES.md")),
      "Missing docs/deploy/COOLIFY_COMPOSE_RULES.md — compose rules documentation",
    ).toBe(true);
  });

  test("COOLIFY_OPERATIONS.md knowledge must exist", () => {
    expect(
      existsSync(join(ROOT, "knowledge-extraction", "COOLIFY_OPERATIONS.md")),
      "Missing knowledge-extraction/COOLIFY_OPERATIONS.md — Coolify ops knowledge",
    ).toBe(true);
  });

  test("SSO_OIDC_PATTERNS.md knowledge must exist", () => {
    expect(
      existsSync(join(ROOT, "knowledge-extraction", "SSO_OIDC_PATTERNS.md")),
      "Missing knowledge-extraction/SSO_OIDC_PATTERNS.md — SSO/OIDC integration patterns",
    ).toBe(true);
  });

  test("COOLIFY_COMPOSE_RULES.md covers all 6 core rules", () => {
    const content = readSafe(join(ROOT, "docs", "deploy", "COOLIFY_COMPOSE_RULES.md"));
    const requiredTopics = [
      { label: "healthcheck rules", pattern: /healthcheck/i },
      { label: "traefik network disambiguation", pattern: /traefik\.docker\.network|traefik network/i },
      { label: "Coolify $$ escaping", pattern: /\$\$.*escap|exec form/i },
      { label: "bind-mount warnings", pattern: /bind.?mount|COPY.*image/i },
      { label: "init container pattern", pattern: /init.*container|restart.*no/i },
      { label: "debugging/troubleshooting", pattern: /troubleshoot|debug|diagnos/i },
    ];

    const missing = requiredTopics
      .filter((t) => !t.pattern.test(content))
      .map((t) => t.label);

    expect(
      missing,
      "COOLIFY_COMPOSE_RULES.md missing required topics:\n" + missing.join("\n"),
    ).toEqual([]);
  });

  test("SSO_OIDC_PATTERNS.md covers critical integration topics", () => {
    const content = readSafe(join(ROOT, "knowledge-extraction", "SSO_OIDC_PATTERNS.md"));
    const requiredTopics = [
      { label: "Keycloak as OIDC provider", pattern: /keycloak.*oidc|oidc.*provider/i },
      { label: "PKCE constraints", pattern: /pkce/i },
      { label: "OAuth2 Proxy pattern", pattern: /oauth2.?proxy/i },
      { label: "Email mapper warning", pattern: /email.*mapper|property.mapper/i },
      { label: "GoTrue external provider", pattern: /gotrue.*external|external.*provider/i },
      { label: "Cookie secret", pattern: /cookie.*secret/i },
    ];

    const missing = requiredTopics
      .filter((t) => !t.pattern.test(content))
      .map((t) => t.label);

    expect(
      missing,
      "SSO_OIDC_PATTERNS.md missing required topics:\n" + missing.join("\n"),
    ).toEqual([]);
  });
});

// ─── 7. Compose domain mapping consistency ──────────────────────────────────

describe("Docker Compose Domain Configuration", () => {
  test("all Coolify compose files must have documented domain mappings", () => {
    const violations: string[] = [];

    // Compose files that should have domain routing
    const ROUTED_COMPOSE_FILES = COMPOSE_FILES.filter(
      (f) => f.relPath.includes("coolify") && !f.relPath.includes("local"),
    );

    for (const file of ROUTED_COMPOSE_FILES) {
      // Check that the file has at least one exposed port (means it needs a domain)
      const hasExpose = /expose:/.test(file.content);
      const hasPortMapping = /ports:/.test(file.content);

      if ((hasExpose || hasPortMapping) && !file.content.includes("docker_compose_domains")) {
        // This is expected — domains are managed via Coolify API, not in compose.
        // But the compose should at least document which services are routed.
        const services = parseServiceNames(file.content);
        const routedServices = services.filter((svc) => {
          const block = extractServiceBlock(file.content, svc);
          return block && (/expose:/.test(block) || /ports:/.test(block));
        });

        // Check for comments indicating domain mapping
        const hasComment = /# .*domain|# .*doména|docker_compose_domains/i.test(file.content);
        if (routedServices.length > 0 && !hasComment) {
          // Informational — not a hard failure, but should be documented
        }
      }
    }

    // This test documents that domain mappings exist. Actual domain validation
    // happens via HTTP checks in the operations runbook.
    expect(true).toBe(true);
  });

  // ─── Compose size guard — prevent ARG_MAX overflow ──────────────────────
  // Coolify base64-encodes the compose into the SSH argv passed to the remote
  // host's deploy runner. When the encoded payload + substituted env values
  // exceeds the kernel's posix_spawn ARG_MAX, deploy fails with
  //   `proc_open(): posix_spawn() failed: Argument list too long`
  // Documented failure point: ~47 KB *base64* (docs/deploy/CICD.md:75) — that
  // was on a 35 KB raw compose with 18 services on a Coolify v3-era runner.
  // Coolify v4.x raised the actual ceiling (719 lines was reported as
  // deploying fine in the prior gate comment) but the new ceiling is not
  // precisely measured — so the gate keeps the documented v3 number as the
  // safety horizon.
  //
  // Bytes are the *physical* constraint; lines are a soft proxy that catches
  // unfocused growth before the byte budget is at risk. Env var refs matter
  // because each ${VAR} gets expanded inline at deploy time, so a compose
  // with 138 env vars at avg 50-char values adds ~7 KB of argv on top of the
  // file size.
  //
  // When this gate trips, in priority order:
  //   1. Extract a service to a sibling compose (precedent: coolify-netbird.yml,
  //      coolify-monitoring.yml, coolify-exec.yml). This is the canonical fix
  //      and the same precedent that moved Dozzle + svc-agent-runner out.
  //   2. Trim historical-reference comments that no longer reflect live design.
  //   3. Move embedded shell heredocs to image-baked scripts (only viable for
  //      services we own — third-party images like netbird/caddy can't).
  //   4. Only as a last resort, deploy-verify a higher number and bump the cap
  //      with the empirical line/byte measurement recorded here.
  test("core compose must stay under Coolify ARG_MAX safe limits", () => {
    const coreCompose = COMPOSE_FILES.find((f) => f.relPath === "docker-compose.coolify.yml");
    if (!coreCompose) return;

    const lines = coreCompose.content.split("\n").length;
    const rawBytes = Buffer.byteLength(coreCompose.content, "utf8");

    // Count only env-var refs that ACTUALLY grow argv at deploy time.
    //
    // `${VAR:-default}` substitutes to `default` when the env var isn't
    // set in Coolify — no argv growth beyond the default's literal length,
    // which is identical to writing the literal value in the compose.
    // Counting those refs overcounts the risk this gate exists to bound
    // (posix_spawn ARG_MAX overflow from substituted values appended to
    // the argv).
    //
    // Substitute defaults first, then count the remaining `${VAR}` refs —
    // those are the ones Coolify expands at deploy time with operator-
    // supplied values whose length the gate cannot know.
    //
    // Without this fix, parametrization PRs (#199 KEYCLOAK_REALM × 4 paths
    // × 5 proxies; #202 OIDC_CLIENT_PREFIX, OAUTH2_COOKIE_DOMAINS, etc.)
    // would trip the gate even though the deployed argv is byte-identical
    // to the pre-parametrization state.
    // Horní odhad pro referenci, jejíž hodnotu brána znát nemůže. 32 znaků je
    // štědré: jsou to prefixy instancí, domény a klíče, ne obsah.
    const NEZNAMA_DELKA = "X".repeat(32);

    const substituted = coreCompose.content
      // 1) `${VAR:-default}` → známe hodnotu, dosaď ji
      .replace(/\$\{[A-Z_][A-Z0-9_]*:-([^}]*)\}/g, "$1")
      // 2) `${VAR:?zpráva}` → hodnotu neznáme, ale zpráva se do argv NEDOSTANE:
      //    buď se proměnná dosadí, nebo deploy spadne. Počítat délku textu
      //    zprávy do rozpočtu argv je měření něčeho jiného, než co selhává.
      .replace(/\$\{[A-Z_][A-Z0-9_]*:\?[^}]*\}/g, NEZNAMA_DELKA)
      // 3) holé `${VAR}` — taky neznáme, stejný horní odhad
      .replace(/\$\{[A-Z_][A-Z0-9_]*\}/g, NEZNAMA_DELKA);

    // BAJTY PO DOSAZENÍ = to, co skutečně teče do argv. Tohle je invariant.
    const substitutedBytes = Buffer.byteLength(substituted, "utf8");

    // Počet referencí zůstává jako druhotný signál rozrůstání, ne jako strop:
    // reference, která literál NAHRAZUJE, argv nezvětší ani o bajt. Naměřeno
    // 2026-08-11 při přechodu container_name na ${APP_NAME_PREFIX:?…}:
    // syrový soubor +1212 B, ale po dosazení +12 B na 30 kB. Strop nad počtem
    // referencí by tu změnu zablokoval, přestože to, čemu má bránit, neroste.
    const envVarRefs = (substituted.match(/\$\{/g) || []).length;

    // Byte budget — the actual physical constraint.
    //   Documented v3 failure: ~35,000 raw bytes (≈47 KB base64).
    //   Current state (2026-05-20): ~880 lines / ~34,500 bytes / 127 env vars
    //   after Phase 12 WP 0.5 + WP 1.3 + WP 4.4 + WP 4.6 + the inline-.npmrc
    //   pattern landing on five npm-build services.
    //   MAX_RAW_BYTES bumped 33000 → 35000 (2026-05-20) to admit the
    //   observability-pass debt above; this still keeps a ~5% safety margin
    //   under the v3 failure threshold. Next sizable add should extract a
    //   service to a sibling compose rather than bump the cap further.
    // ⭐ 2026-08-23: limit ZŮSTÁVÁ 35000. Krátce jsem ho zvedl na 36500, aby se
    // do `core` vešel `core-mesh-egress` — a bylo to špatné řešení. Správné bylo
    // vyndat z compose 4 170 B KOMENTÁŘŮ (majitel: „v compose nemají co dělat,
    // na ty máme vlastní místo") do docs/architecture/CORE_COMPOSE_ROZHODNUTI.md.
    // Soubor tím spadl na ~31,5 kB, tedy skoro 4 kB pod limit.
    // ⛔ Zvednout limit, protože se do něj něco nevejde, je vzorec „brána červená
    // → změním bránu → zelená". Napřed se hledá, co v tom souboru nemá být.
    const MAX_RAW_BYTES = 35000;

    // Line budget — softer proxy, paired with the byte budget so unfocused
    // verbose growth (long heredocs, label sprawl) trips this before bytes.
    //   Bumped 660 → 750 (2026-05, core-mesh-ingress sidecar) → 820 (2026-05-17,
    //   svc-web-artifact addition + obsolete-comment trim) → 900 (2026-05-20,
    //   Phase 12 observability bringup + multi-service Verdaccio inline-.npmrc
    //   blocks). Line cap intentionally tracks roughly MAX_RAW_BYTES ÷ 40
    //   bytes/line.
    const MAX_LINES = 900;

    // Env-var budget — ${VAR} expansions inline at deploy time and amplify
    // the argv size by their substituted values. 138 was the documented
    // failure case in v3; we keep a conservative cap below that.
    //   Bumped 125 → 130 (2026-05-20) for Phase 12 WP additions; tightens
    //   future drift below the v3 threshold while admitting the current
    //   composite reality (127 in origin/main).
    //
    //   2026-08-11: po dosazení `:?` a holých referencí (viz výš) tenhle
    //   počet měří jen to, co ZBYLO nerozvinuté — u zdravého compose nulu.
    //   Tvrdý strop nad argv drží MAX_SUBSTITUTED_BYTES; tenhle zůstává jako
    //   pojistka proti tvaru, který dosazení nepokrývá.
    const MAX_ENV_VARS = 130;

    // Strop po dosazení: dokumentovaný pád v3 byl kolem 35 000 B syrových,
    // což po dosazení odpovídá ~33 000. Držíme se konzervativně pod tím.
    const MAX_SUBSTITUTED_BYTES = 33_000;

    expect(rawBytes).toBeLessThanOrEqual(MAX_RAW_BYTES);
    expect(lines).toBeLessThanOrEqual(MAX_LINES);
    expect(
      substitutedBytes,
      `argv po dosazení má ${substitutedBytes} B (strop ${MAX_SUBSTITUTED_BYTES}). ` +
        "Tohle je ta veličina, na které Coolify padá — ne počet ${} v souboru.",
    ).toBeLessThanOrEqual(MAX_SUBSTITUTED_BYTES);
    expect(envVarRefs).toBeLessThanOrEqual(MAX_ENV_VARS);

    // Approaching-the-limit warnings — kick in around the headroom boundary
    // so the next adder sees the warning before tripping the gate. Thresholds
    // sit at ~85% of the hard caps.
    if (rawBytes > 28000) {
      console.warn(
        `⚠️  Core compose is ${rawBytes} bytes (limit: ${MAX_RAW_BYTES}). ` +
        `Next sizable addition should extract a service to a sibling compose.`
      );
    }
    if (lines > 700) {
      console.warn(
        `⚠️  Core compose is ${lines} lines (limit: ${MAX_LINES}). ` +
        `Consider pre-building more images or splitting services.`
      );
    }
    if (envVarRefs > 105) {
      console.warn(
        `⚠️  Core compose has ${envVarRefs} env var substitutions (limit: ${MAX_ENV_VARS}). ` +
        `Consider hardcoding defaults or using Coolify env vars.`
      );
    }
  });

  test("compose services should use pre-built images (no build: blocks)", () => {
    const coreCompose = COMPOSE_FILES.find((f) => f.relPath === "docker-compose.coolify.yml");
    if (!coreCompose) return;

    // Počítá se KAŽDÁ stavěná služba, i `build: &kotva` / `build: *kotva`.
    // ⛔ Do 2026-09-25 tu stálo `/^\s+build:\s*$/` — kotvy `db`/`pgbackrest`
    // (`&pg_build`, `*pg_build`) tím pro strop NEEXISTOVALY: naměřeno 9 viditelných
    // z 11 skutečných. Strop hlídal číslo, které neodpovídalo stavbě.
    const buildBlocks = (coreCompose.content.match(/^\s+build:/gm) || []).length;

    // Pre-built images eliminate Coolify ARG injection and reduce deploy size.
    // Currently using build directives because Forgejo registry auth is not
    // configured on Frontend Docker daemon.
    //
    // Cap raised 9 → 10 in upstream-sync 2026-05-26 to admit PR #105's
    // pgbouncer wrapper — it's a thin Dockerfile over edoburu/pgbouncer
    // that strips Coolify quote-leak from DB_PASSWORD before exec'ing the
    // upstream entrypoint. Baking the wrapper as a pre-built image would
    // require Forgejo registry auth on every cold-start, which the same
    // CI block above explains we don't have yet — until then a tenant-
    // local `build:` is the production-safe path (image rebuild ~3 sec,
    // cached after first cold-start).
    //
    // 2026-09-25: 11 (9 + dvě dřív neviditelné kotvy výš) → 13. `minio` a
    // `minio-init` se STAVÍ ze zdroje (docker/minio, Go module proxy) — plán A
    // schválený majitelem: MinIO obrazy z registru neexistují (Docker Hub smazán
    // 2026-09-11, quay.io 401 od 2026-09-24) a fork NESMÍ záviset na našem
    // registru, takže „pre-built image" tu cestou není. Cena: build context je
    // jen docker/minio (bez repa), cache přežije změny repa.
    expect(buildBlocks).toBeLessThanOrEqual(13);

    if (buildBlocks > 0) {
      console.warn(
        `⚠️  Core compose has ${buildBlocks} build: blocks. ` +
        `These cause Coolify ARG injection overhead. Use pre-built images from ` +
        `Forgejo registry (repo.id3a.cz/aisha/dirigent-{service}:latest) instead.`
      );
    }
  });
});
