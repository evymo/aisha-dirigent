/**
 * cold-start-hardening.gate.test.ts
 *
 * Regression gate for AISHA cold-start hardening (Steps 1–12, Apr 2026).
 *
 * Asserts the existence and key invariants of the orchestration scripts that
 * make a fresh deploy on Coolify reproducible without manual intervention:
 *
 *   - scripts/aisha-cold-start.sh       — top-level orchestrator
 *   - scripts/preflight-compose.sh      — env-vs-compose validator
 *   - scripts/smoke-keycloak.sh         — KC readiness gate
 *   - scripts/smoke-netbird.sh          — NetBird control-plane readiness gate
 *   - scripts/aisha-env-doctor.mjs      — authoritative env contract
 *   - scripts/aisha-redeploy.mjs        — wave-based redeploy orchestrator
 *   - scripts/netbird-bootstrap.sh      — KC-gated NetBird provisioning
 *
 * Removing or renaming any of these MUST update the orchestrator and this gate.
 * The gate is intentionally string-level (no shell exec) so it stays portable
 * across CI environments without docker / curl.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel: string): boolean => existsSync(join(ROOT, rel));

describe("Cold-start hardening (regression gate)", () => {
  test("all hardening scripts exist and are non-empty", () => {
    const required = [
      "scripts/aisha-cold-start.sh",
      "scripts/preflight-compose.sh",
      "scripts/smoke-keycloak.sh",
      "scripts/smoke-netbird.sh",
      "scripts/aisha-env-doctor.mjs",
      "scripts/aisha-redeploy.mjs",
      "scripts/netbird-bootstrap.sh",
    ];
    for (const rel of required) {
      expect(exists(rel), `missing ${rel}`).toBe(true);
      expect(statSync(join(ROOT, rel)).size, `${rel} is empty`).toBeGreaterThan(0);
    }
  });

  test("cold-start orchestrator wires all phased smoke + preflight gates", () => {
    const sh = read("scripts/aisha-cold-start.sh");

    // Step 2b — preflight compose validation BEFORE create.
    expect(sh).toContain("scripts/preflight-compose.sh");
    expect(sh).toMatch(/PREFLIGHT[\s\S]*preflight-compose\.sh/);

    // Step 6a — Keycloak gate via smoke script (no ad-hoc curl loop).
    expect(sh).toContain("scripts/smoke-keycloak.sh");
    // The old inline loop hit `realms/master/.well-known/...` directly with
    // curl. Smoke gate now owns that responsibility.
    expect(sh).not.toMatch(/curl[^\n]*realms\/master\/\.well-known/);

    // Step 6b — NetBird gate before bootstrap.
    expect(sh).toContain("scripts/smoke-netbird.sh");

    // env-doctor heal pass remains.
    expect(sh).toContain("scripts/aisha-env-doctor.mjs");
  });

  test("cold-start hard-fails on real infra failures; n8n WF_* deploy is in-cluster + verify-only", () => {
    const sh = read("scripts/aisha-cold-start.sh");

    // Real infra failures MUST NOT end in a success banner. Od 2026-09-13 se ale
    // NEZASTAVUJE uprostřed: selhání, které nebrání dalším krokům, se zapíše do
    // NEDOKONCENO, běh dokončí zbytek (n8n, smoke, embed, úklid, restart validace)
    // a na konci skončí nenulou. Dřív `exit 1` u n8n/smoke přeskočil vše po něm.
    expect(
      sh,
      "n8n readiness timeout must be recorded as incomplete (not a WARN that ends in success).",
    ).toMatch(/nedokonceno "n8n \(\$\{N8N_APP\}\) není zdravý/);
    expect(
      sh,
      "post-deploy smoke failures must be recorded as incomplete, not downgraded to WARN.",
    ).toMatch(/nedokonceno "\$\{SMOKE_FAILED\} smoke test/);
    const souhrn = sh.slice(sh.indexOf('step "7. SUMMARY"'));
    expect(souhrn, "závěrečný krok nečte NEDOKONCENO").toMatch(/if \[ "\$\{#NEDOKONCENO\[@\]\}" -gt 0 \]; then[\s\S]*?exit 1\s*\n\s*fi/);
    expect(
      souhrn.indexOf("exit 1"),
      "banner úspěchu se nesmí vypsat dřív, než se rozhodne o NEDOKONCENO",
    ).toBeLessThan(souhrn.indexOf("Cold-start dokončen"));

    // n8n bootstrap (klíč → credentials → workflows) běží IN-CLUSTER v jednorázovém
    // kontejneru `<prefix>-n8n--workflow-init` (n8n 1.79 blokuje mint klíče zvenku).
    // Hostitel si ho NEMINTUJE; čte VERDIKT, který init zapíše přes auditní RPC
    // (dřív hostitel ověřoval jen s klíčem, který nemá → vždy „Host verify skipped").
    expect(
      sh,
      "Step 6 must read the in-cluster bootstrap verdict, not host-mint a key.",
    ).toMatch(/integration_service_logs[\s\S]*?action=eq\.bootstrap/);
    expect(sh, "hláška musí jmenovat skutečný kontejner s identitou instance").toContain("${APP_NAME_PREFIX}-n8n--workflow-init");
    expect(sh).not.toContain("frontend--n8n--workflow-init");
  });

  test("aisha-redeploy stops immediately on terminal deployment failure", () => {
    const js = read("scripts/aisha-redeploy.mjs");

    expect(
      js,
      "Coolify deployment status `failed` or `cancelled` is terminal; waiting for wave timeout cannot recover it.",
    ).toMatch(/deploymentStatus === "failed" \|\| deploymentStatus === "cancelled"[\s\S]*?return \{ ok: false, statuses, resolvedClasses, deploymentFailures \}/);
    expect(
      js,
      "terminal deployment failures must not be hidden behind FINISHED_GRACE_S polling.",
    ).not.toMatch(/deploymentFailures\.length > 0 && allDeploysTerminal/);
  });

  test("preflight-compose covers every Coolify compose file", () => {
    const sh = read("scripts/preflight-compose.sh");
    // Default file glob picks up every docker-compose.coolify*.yml.
    expect(sh).toMatch(/docker-compose\.coolify\*\.yml/);
    // Validates against .env.coolify (single source of truth).
    expect(sh).toContain(".env.coolify");
    // Uses `docker compose config -q` (parse-only, no side effects).
    expect(sh).toMatch(/docker compose .*config -q/);
  });

  test("smoke-keycloak asserts well-known + JWKS, not just root 200", () => {
    const sh = read("scripts/smoke-keycloak.sh");
    expect(sh).toContain(".well-known/openid-configuration");
    expect(sh).toContain("protocol/openid-connect/certs");
    // Honours TIMEOUT_SECONDS env.
    expect(sh).toMatch(/TIMEOUT_SECONDS:?-?\d+/);
  });

  test("smoke-netbird detects Coolify SPA fallthrough on management API", () => {
    const sh = read("scripts/smoke-netbird.sh");
    expect(sh).toContain("/api/peers");
    // Must reject text/html on /api/* (means SPA caught the request).
    expect(sh).toMatch(/text\/html|content-type/i);
    // Acceptable codes: 401/403 (auth-protected, but routed to mgmt).
    expect(sh).toMatch(/401|403/);
  });

  test("netbird-bootstrap is gated by smoke-keycloak before provisioning", () => {
    const sh = read("scripts/netbird-bootstrap.sh");
    expect(sh).toContain("scripts/smoke-keycloak.sh");
    // Provides explicit bypass env so emergency unblocks remain auditable.
    expect(sh).toMatch(/SKIP_KEYCLOAK_GATE/);
  });

  test("env-doctor declares all Coolify-critical secrets", () => {
    const sh = read("scripts/aisha-env-doctor.mjs");
    // CRITICAL_KEYS must include the boot-blocking secrets discovered during
    // cold-start hardening (Steps 5, 9, 10).
    const required = [
      "JWT_SECRET",
      "POSTGRES_PASSWORD",
      "VAULT_ENCRYPTION_KEY",
      "PKI_DB_PASSWORD",
      "PKI_DB_ROOT_PASSWORD",
      "PKI_OIDC_SECRET",
      "PKI_SVAULT_KEY",
      "PKI_COOKIE_SECRET",
      "NETBIRD_MGMT_SECRET",
    ];
    for (const key of required) {
      expect(sh, `aisha-env-doctor.mjs missing CRITICAL key ${key}`).toContain(key);
    }
  });

  test("aisha-redeploy preserves the messaging KNOWN_BROKEN history comment (now removed from set)", () => {
    const js = read("scripts/aisha-redeploy.mjs");
    // 2026-05-10: aisha-messaging removed from KNOWN_BROKEN per user
    // confirmation that Docker default address pool was already extended
    // to 3 CIDR ranges long ago. The history comment must stay so future
    // operators recognize an address-pool regression (different symptom)
    // vs. a brand-new failure mode.
    expect(
      js,
      "history comment must reference the original address-pool root cause (so address-pool regressions are recognized as such)",
    ).toMatch(/fix-docker-network-pools|address pool|address-pool/i);
  });

  test("PostgREST uses HMAC JWT_SECRET (not JWKS) — Step 5 contract", () => {
    const core = read("docker-compose.coolify.yml");
    // PostgREST must boot with PGRST_JWT_SECRET (HMAC). JWKS at gateway only.
    expect(core).toContain("PGRST_JWT_SECRET");
    expect(core).toMatch(/PGRST_JWT_SECRET[^\n]*JWT_SECRET/);
  });

  test("cold-start DEFERS the destroy until after generate+validate (validate-before-destroy)", () => {
    const sh = read("scripts/aisha-cold-start.sh");

    const idxPreflight = sh.indexOf("scripts/preflight-compose.sh");
    const idxStep2c = sh.indexOf('step "2c. EXECUTE DEFERRED WIPE');
    const idxStep3 = sh.indexOf('step "3. CREATE COOLIFY APPLICATIONS');

    // Ordering invariant: enumerate (1) → generate (2) → preflight (2b) →
    // destroy (2c) → create (3). The destroy must come AFTER validation and
    // BEFORE create, so a failed generate/validate aborts with the old platform
    // still intact (no wiped-but-undeployed; incident 2026-05-31).
    expect(idxStep2c, "Step 2c (deferred wipe) marker present").toBeGreaterThan(-1);
    expect(idxStep2c, "deferred wipe must run AFTER compose preflight").toBeGreaterThan(idxPreflight);
    expect(idxStep3, "create must run AFTER the deferred wipe").toBeGreaterThan(idxStep2c);

    // The ONE destructive applications-DELETE in the whole orchestrator must live
    // inside wipe_orphan_apps() (invoked only from Step 2c — after validation).
    // No inline DELETE may survive in the Step 1 decision flow.
    const fnStart = sh.indexOf("wipe_orphan_apps() {");
    const fnEnd = sh.indexOf("EXISTING_SCOPED=");
    // UPŘESNĚNO 2026-08-11 (táž úprava jako v cold-start-dry-run-safety).
    // Dřív se počítala VŠECHNA DELETE volání a vyžadovalo se přesně jedno.
    // Počet ale neměří nebezpečnost: úklid warmup aplikací žádná data nemaže
    // (warmup nemá volumes — doběhne a uvolní docker.sock). Nebezpečná je
    // jen purge, která maže VOLUMES nájemníka, a ta musí zůstat jediná
    // a uvnitř wipe_orphan_apps.
    //
    // Hledá se `${delete_qs}`, ne literál `delete_volumes=true`: query string se
    // staví do proměnné, takže literál na tom řádku NENÍ a hledat ho znamená
    // najít nulu a myslet si, že purge zmizela.
    const purges = [...sh.matchAll(/coolify_api DELETE "\/applications\/\$\{uuid\}\$\{delete_qs\}"/g)];
    expect(purges.length, "právě jedna DESTRUKTIVNÍ purge (delete_volumes)").toBe(1);
    const deleteIdx = purges[0].index ?? -1;
    expect(deleteIdx, "purge je uvnitř wipe_orphan_apps").toBeGreaterThan(fnStart);
    expect(deleteIdx, "purge je uvnitř wipe_orphan_apps").toBeLessThan(fnEnd);

    // Step 1's decision block (AFTER the wipe_orphan_apps definition) only
    // AUTHORISES the wipe via WIPE_PENDING and keeps the pre-wipe TLD guard.
    const step1Decision = sh.slice(
      sh.indexOf('if [ -n "$EXISTING" ]; then'),
      sh.indexOf('step "2. GENERATE FRESH SECRETS'),
    );
    expect(step1Decision, "Step 1 authorises the deferred wipe via WIPE_PENDING").toContain("WIPE_PENDING=1");
    expect(step1Decision, "pre-wipe TLD guard preserved").toContain("PRE-WIPE GUARD");
    expect(step1Decision, "Step 1 must not DELETE inline").not.toMatch(/coolify_api DELETE "\/applications/);

    // Step 2c invokes the destroy only when a wipe is pending.
    const step2cBody = sh.slice(idxStep2c, idxStep3);
    // Komentář ani fail-closed `|| exit 1` mezi rozhodnutím a voláním není vada —
    // měří se POŘADÍ, ne bílé znaky. Doslovné sousedství tu dřív rozbilo přidání
    // obojího (2026-08-13), přestože obojí bylo posílení.
    expect(step2cBody).toMatch(
      /if \[ "\$WIPE_PENDING" = "1" \]; then(?:\s*\n\s*#[^\n]*)*\s*\n\s*wipe_orphan_apps/,
    );
  });

  test("wipe_orphan_apps destroys by shared prefix, verifies per-UUID, honours dry-run + keep-volumes", () => {
    const sh = read("scripts/aisha-cold-start.sh");

    // Multi-instance isolation: a NAMED instance (APP_NAME_PREFIX != aisha) wipes
    // ONLY its own ^${APP_NAME_PREFIX}- so it can never delete a co-tenant's apps
    // + volumes. The legacy aisha-/evymo-/bare-aisha/n8n cleanup applies ONLY to
    // the upstream aisha default (or the explicit AISHA_WIPE_INCLUDE_LEGACY=1 opt-in).
    // The legacy sweep is the `aisha` DEFAULT branch only …
    expect(sh).toContain("APP_NAME_PREFIX_RE='^aisha-|^evymo-|^aisha$|^n8n$'");
    // … a named instance gets its OWN prefix and nothing else.
    expect(sh).toContain('APP_NAME_PREFIX_RE="^${APP_NAME_PREFIX}-"');
    // Větev se vybírá podle identity — a ta se do ní NESMÍ dosazovat. Sonda proto
    // měří VLASTNOST (test bez defaultu), ne konkrétní znění: dřív tu stálo
    // `${APP_NAME_PREFIX:-aisha}` a brána pinovala doslovně JEHO, takže položila
    // změnu, která invariant ZPŘÍSNILA — `:-aisha` odsud odstranila. Trestat
    // zlepšení je horší než mlčet: učí to obcházet bránu.
    // Proč zrovna tady: tenhle výraz vybírá regex, podle kterého se MAŽE. Tichý
    // default by na cizí instanci zvolil legacy větev a smazal upstream stack.
    const vetevPodleIdentity = sh.match(/if \[ "\$\{APP_NAME_PREFIX[^}]*\}" = "aisha" \]/);
    expect(vetevPodleIdentity, "brána nemá co měřit — větev podle identity v skriptu chybí").not.toBeNull();
    expect(
      vetevPodleIdentity![0],
      "rozsah wipe se vybírá podle identity, takže se do ní nesmí dosazovat žádný default",
    ).not.toMatch(/:-/);
    // The actual safety property, asserted directly: a named instance must NEVER
    // get the legacy alternation appended to its own prefix. The combined form
    // below is what shipped before cb365425 — under it a differently-named wipe also
    // matched ^aisha-, i.e. a fork's cold-start would destroy the UPSTREAM stack's
    // apps and volumes. It must not come back.
    expect(sh, "a named instance must not inherit the legacy ^aisha- sweep").not.toContain(
      'APP_NAME_PREFIX_RE="^${APP_NAME_PREFIX}-|^aisha-|^evymo-|^aisha$|^n8n$"',
    );

    const fnStart = sh.indexOf("wipe_orphan_apps() {");
    expect(fnStart, "wipe_orphan_apps function defined").toBeGreaterThan(-1);
    const fnBody = sh.slice(fnStart, sh.indexOf("EXISTING_SCOPED="));

    // Enumerates by the shared prefix regex (not a hardcoded duplicate).
    expect(fnBody).toContain("$APP_NAME_PREFIX_RE");
    // Per-UUID verify: poll each app until it disappears from the API.
    expect(fnBody).toContain('coolify_api GET "/applications/$uuid"');
    // Dry-run is non-destructive (preview + return before any DELETE).
    expect(fnBody).toMatch(/DRY_RUN" = "1"[\s\S]*?return 0/);
    // Volume purge toggle preserved.
    expect(fnBody).toContain("delete_volumes=true");
    // Empty-array guard for bash 3.2 + set -u (no "${arr[@]}" before a count check).
    expect(fnBody).toMatch(/\$\{#_uuids\[@\]\}" -eq 0/);
  });

  test("--skip-orphan-cleanup flag is wired as a wipe escape hatch", () => {
    const sh = read("scripts/aisha-cold-start.sh");
    expect(sh).toContain("--skip-orphan-cleanup) SKIP_ORPHAN_CLEANUP=1");
    // When set with --wipe, it must prevent the deferred destroy (WIPE_PENDING
    // stays 0) and warn the operator about the create conflict.
    expect(sh).toMatch(/SKIP_ORPHAN_CLEANUP" = "1"[\s\S]*?will NOT be destroyed/);
  });
});
