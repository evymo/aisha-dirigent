/**
 * Gate: env-doctor-contract-coverage
 *
 * Ensures every environment variable referenced in a Coolify compose file
 * WITHOUT a fallback default is registered in one of the two generated
 * .env.coolify sources. "Required" means either:
 *   - `${VAR}`        — bare reference, empty if unset
 *   - `${VAR:?msg}`   — hard-required, compose ABORTS the deploy if unset
 * Both forms MUST be satisfiable on a fresh `--wipe` cold-start. Forms that
 * carry their own value are NOT required:
 *   - `${VAR:-default}` / `${VAR:=default}` — fallback value supplied inline
 *   - `${VAR:+alt}`                          — alternate only when VAR is set
 *
 * The `${VAR:?msg}` form is the STRONGEST required contract (it fails the
 * deploy loudly), so it must never be exempt from coverage. An earlier regex
 * silently ignored `:?` references entirely — this gate now treats them as
 * required.
 *
 * Registered in one of the two generated .env.coolify sources:
 *
 *   1. scripts/aisha-env-doctor.mjs  — auto-generated on every cold-start wipe
 *   2. scripts/aisha-cold-start.sh   — HEREDOC-written generated env
 *
 * Why this matters:
 *   A var referenced without a default is REQUIRED at deploy time. If it is not
 *   in neither generated .env.coolify source it will be missing on a fresh
 *   `--wipe` cold-start. A contract entry of kind `external` is not enough:
 *   env-doctor intentionally does not write missing external keys.
 *
 * Canonical failure: GRAFANA_ADMIN_PASSWORD + POSTGRES_EXPORTER_PASSWORD were
 *   used in docker-compose.coolify-observability.yml but never added to the
 *   contract (2026-05-20). Discovered at cold-start time, not at PR review time.
 *
 * Known-dynamic exclusions: vars that are legitimately NOT in either source
 *   because they are injected by the container runtime (NetBird process IDs,
 *   mesh discovery outputs, Coolify-injected labels, shell loop vars, etc.).
 *   Any addition to this set MUST be justified in the comment next to it.
 */
import { describe, it, expect } from "vitest";
import { buildTopology, formatShellExports } from "../../../scripts/lib/derive-domains.mjs";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const COMPOSE_DIR = ROOT;
const COLD_START = path.join(ROOT, "scripts/aisha-cold-start.sh");
const ENV_DOCTOR = path.join(ROOT, "scripts/aisha-env-doctor.mjs");
const IMAGE_VERSIONS = path.join(ROOT, "config/image-versions.env");

/**
 * Vars that are intentionally NOT in the env-doctor contract or image-versions.env.
 * Each has a reason comment. Keep alphabetically sorted.
 */
const KNOWN_DYNAMIC = new Set([
  // Blue-green switch runtime — set by aisha-redeploy.mjs per-deploy
  "BG_ACTIVE_HOST", "BG_SLOT",
  // Svazek drop lane — doručuje ho coolify-deploy-init.sh, ne cold-start.
  //
  // Jméno je `<uuid apky local-ingest>_ingest-out`, tedy zjistitelné jen ze ŽIVÉ
  // Coolify (deploy-init si uuid resolvuje a klíč nastaví na apce brokeru).
  // env-doctor ho odvodit nemůže a "external" by lhal: compose ho vyžaduje
  // (`:?`), takže „operátor to smí nechat prázdné" neplatí.
  //
  // Bez něj si compose dřív fallbackem založil svazek CIZÍ instance a drop lane
  // tiše netekla — broker zdravý, trigger ok, `ingested: 0`. Změřit lze
  // `node scripts/ingest-drop-seam-report.mjs`.
  "LOCAL_INGEST_OUT_VOLUME",
  // Coolify-injected labels on every container (not a cold-start secret)
  "COOLIFY_API_TOKEN", "COOLIFY_BRANCH", "COOLIFY_FQDN", "COOLIFY_RESOURCE_UUID", "COOLIFY_URL",
  // Container PID/state vars used inside entrypoint scripts (shell-local)
  "DAEMON_PID", "NB_PID", "WAITED",
  // Shell loop counters/sentinels in entrypoint scripts — not env vars
  "SUBST_COUNT", "VAR",
  // netbird-internal-tls caddy entrypoint — shell-local knobs that pick the
  // Caddyfile's auto_https mode + tls directive (explicit AISHA PKI cert vs
  // `tls internal` bootstrap). Set by the command script, never by cold-start.
  "GLOBAL_AUTO_HTTPS", "TLS_DIRECTIVE",
  // Mesh runtime — populated by scripts/coolify-mesh-sync.mjs AFTER NetBird enrols
  "CORE_MESH_IP", "MESH_MODE",
  // NetBird container runtime vars — set by NetBird agent itself or bootstrap script
  "NB_CONFIG_FILE", "NB_FORCE_REENROLL", "NB_HOSTNAME",
  "NB_MANAGEMENT_URL", "NB_SETUP_KEY", "NB_SSL_TRUST_BUNDLE",
  // NetBird TLS certs — base64 blobs written by pki-renewer (consumer_for) to
  // Coolify env at runtime; the vault must NOT carry them (klice-renewera-mimo-trezor.gate)
  "NETBIRD_INTERNAL_CERT_B64", "NETBIRD_INTERNAL_KEY_B64",
  // Operational one-shot flags (set by operator per-deploy, empty = default behaviour)
  "AISHA_DB_FORCE_BASELINE_RESET",
  "RENEW_INTERVAL_HOURS", "RENEW_SERVICES", "RENEW_THRESHOLD_DAYS",
  // svc-source-broker — consumed ONLY by the optional `source-broker` federation
  // stack (docker-compose.coolify-source-broker.yml), whose Coolify app is
  // provisioned only when SOURCE_API_URL is set. These are per-tenant/operator
  // federation config supplied via the domains overlay or Coolify env (the
  // source endpoints, the mantra handshake, the broker domain, and the aisha db
  // URL the broker connects to), plus the generate-secrets-emitted webhook HMAC.
  // Not part of the core cold-start contract because the broker is opt-in.
  "BROKER_DOMAIN", "POSTGRES_URL", "SOURCE_API_URL", "SOURCE_AUTH_HANDSHAKE_IN",
  "SOURCE_AUTH_HANDSHAKE_OUT", "SOURCE_PG_URL", "SOURCE_WEBHOOK_HMAC_SECRET",
]);

/**
 * Extract all parameter-expansion references from a string and classify them.
 *
 * Required (must be satisfiable on a fresh cold-start):
 *   - `${VAR}`       bare reference
 *   - `${VAR:?msg}`  hard-required (compose aborts the deploy if unset)
 *
 * With-default (carry their own value, not required):
 *   - `${VAR:-default}` / `${VAR:=default}` inline fallback
 *   - `${VAR:+alt}`                          alternate only when VAR is set
 */
function extractComposeVars(content: string): { required: Set<string>; withDefault: Set<string> } {
  const required = new Set<string>();
  const withDefault = new Set<string>();
  // Capture the optional operator (`:-`, `:=`, `:+`, `:?`) so we can classify.
  //
  // `(?<!\$)` — v Compose je `$$` ESCAPOVANÝ literál `$`: compose ho neinterpoluje
  // a předá ho shellu uvnitř kontejneru. `$${VAR}` tedy NENÍ compose proměnná a
  // nesmí se počítat mezi „required". Bez tohohle lookbehindu brána hlásila
  // MODEL_MESH_INGRESS_ROUTES jako nekrytou, přestože ji derivace vydává
  // (cloud-multi) A compose ji na svém jediném skutečném výskytu deklaruje
  // s defaultem (`${MODEL_MESH_INGRESS_ROUTES:-}`); „nekryté" výskyty byly ty
  // uvnitř `command:` shellu — tedy runtime čtení proměnné, ne její požadavek.
  // Falešný nález se opravuje v DETEKTORU, ne whitelistem: whitelist by tuhle
  // třídu (každý stack s mesh-ingress shellem) musel obcházet znovu a znovu.
  for (const match of content.matchAll(/(?<!\$)\$\{([A-Z][A-Z0-9_]*)(:[-=+?][^}]*)?\}/g)) {
    const name = match[1];
    const op = match[2]; // e.g. ":-default", ":=default", ":+alt", ":?msg", or undefined
    if (op && (op.startsWith(":-") || op.startsWith(":=") || op.startsWith(":+"))) {
      withDefault.add(name);
    } else {
      // Bare `${VAR}` or hard-required `${VAR:?msg}` — both must be provided.
      required.add(name);
    }
  }
  return { required, withDefault };
}

function extractHeredoc(script: string): string {
  const startRe = /cat > "\$TMP_ENV" <<HEADER\n/;
  const startMatch = script.match(startRe);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error("HEREDOC start anchor not found in scripts/aisha-cold-start.sh");
  }
  const after = script.slice(startMatch.index + startMatch[0].length);
  const endMatch = after.match(/^HEADER$/m);
  if (!endMatch || endMatch.index === undefined) {
    throw new Error("HEREDOC end anchor not found in scripts/aisha-cold-start.sh");
  }
  return after.slice(0, endMatch.index);
}

function extractEnvAssignments(content: string): Set<string> {
  const keys = new Set<string>();
  for (const match of content.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) {
    keys.add(match[1]);
  }
  return keys;
}

describe("env-doctor contract coverage — compose vars must be registered", () => {
  // ── Load authoritative sources ──────────────────────────────────────────
  const coldStartSrc = fs.existsSync(COLD_START)
    ? fs.readFileSync(COLD_START, "utf8")
    : "";
  const doctorSrc = fs.existsSync(ENV_DOCTOR)
    ? fs.readFileSync(ENV_DOCTOR, "utf8")
    : "";
  const imageVersionsSrc = fs.existsSync(IMAGE_VERSIONS)
    ? fs.readFileSync(IMAGE_VERSIONS, "utf8")
    : "";

  // Keys declared in env-doctor by kind. `external` is warning-only and does
  // not add an empty key, so external-only coverage is still a missing
  // .env.coolify binding for compose validation.
  const contractKeys = new Set<string>();
  const contractKinds = new Map<string, string>();
  for (const m of doctorSrc.matchAll(/^\s*\["([A-Z][A-Z0-9_]+)",\s*"([a-z-]+)"/gm)) {
    contractKeys.add(m[1]);
    contractKinds.set(m[1], m[2]);
  }

  const heredocKeys = coldStartSrc ? extractEnvAssignments(extractHeredoc(coldStartSrc)) : new Set<string>();

  // Klíče, které vydává DERIVACE. env-doctor je od 2026-07-29 doručuje všechny
  // (pass 0), i když je CONTRACT nevyjmenovává — právě proto, aby se ty dva
  // ručně udržované seznamy nemohly rozejít. Bez tohohle zdroje by brána
  // hlásila jako nekryté i klíče, které se ve skutečnosti doručí VŽDY, a nutila
  // by je dopisovat do CONTRACT ručně — tedy zpět k tomu seznamu, který se
  // rozchází.
  // ZÁMĚRNĚ jen VÝCHOZÍ profil, ne sjednocení přes všechny.
  //
  // Zkusil jsem to sjednotit (2026-07-30) a byl to špatný pákový bod: klíč, který
  // vydá jen `cloud-multi`, na `cloud-single` instanci OPRAVDU chybí — započítat
  // ho jako „generovaný" znamená zamaskovat skutečnou mezeru. Brána má být
  // přísná; falešný nález se opravuje v DETEKTORU (viz lookbehind na `$$`
  // v extractComposeVars), ne rozšířením toho, co se počítá za pokryté.
  const derivedKeys = new Set<string>();
  try {
    const topo = buildTopology({ meshEnabled: true });
    for (const line of formatShellExports(topo).split("\n")) {
      const m = line.match(/^([A-Z][A-Z0-9_]+)=/);
      if (m) derivedKeys.add(m[1]);
    }
  } catch {
    // Derivace bez profilu/TLD neprojde — pak se prostě nezapočítá a brána je
    // PŘÍSNĚJŠÍ, ne mírnější. Tiché zmírnění by bylo horší než falešný nález.
  }

  // Keys declared in image-versions.env
  const imageKeys = new Set<string>();
  for (const m of imageVersionsSrc.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)) {
    imageKeys.add(m[1]);
  }

  // ── Collect compose files (standalone only — skip overlays) ────────────
  const composeFiles = fs
    .readdirSync(COMPOSE_DIR)
    .filter(
      (f) =>
        /^docker-compose\.coolify.*\.yml$/.test(f) &&
        !f.endsWith(".netseg.yml") &&
        !f.endsWith(".overlay.yml"),
    )
    .map((f) => path.join(COMPOSE_DIR, f));

  it("env-doctor contract has entries (non-empty sanity check)", () => {
    expect(contractKeys.size, "env-doctor contract must not be empty").toBeGreaterThan(100);
  });

  it("image-versions.env has IMAGE_* entries (non-empty sanity check)", () => {
    expect(imageKeys.size, "config/image-versions.env must not be empty").toBeGreaterThan(5);
  });

  it("cold-start HEREDOC has generated env entries (non-empty sanity check)", () => {
    expect(heredocKeys.size, "cold-start HEREDOC must declare generated .env.coolify keys").toBeGreaterThan(100);
  });

  it("every required compose var (no :-default) is generated, non-external contract, or known-dynamic", () => {
    const unregistered: string[] = [];

    for (const f of composeFiles) {
      const content = fs.readFileSync(f, "utf8");
      const { required } = extractComposeVars(content);

      for (const varName of required) {
        const contractKind = contractKinds.get(varName);
        if (
          heredocKeys.has(varName) ||
          derivedKeys.has(varName) ||
          (contractKind !== undefined && contractKind !== "external") ||
          KNOWN_DYNAMIC.has(varName)
        ) {
          continue;
        }
        unregistered.push(`${path.basename(f)}: ${varName}`);
      }
    }

    expect(
      unregistered,
      `Compose vars without :-default that are NOT written by cold-start, ` +
        `not generated by a non-external env-doctor contract, and not KNOWN_DYNAMIC:\n` +
        unregistered.map((s) => `  - ${s}`).join("\n") +
        `\n\nFix: add the var to scripts/aisha-cold-start.sh HEREDOC, or to ` +
        `scripts/aisha-env-doctor.mjs with a kind that writes a key ` +
        `(secret/static/alias/placeholder). If it is truly a runtime-only var ` +
        `(set by a container entrypoint, never by cold-start), add it to KNOWN_DYNAMIC ` +
        `in this gate with a justification comment.`,
    ).toHaveLength(0);
  });
});
