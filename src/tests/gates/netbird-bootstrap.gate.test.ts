import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

interface RealmClient {
  clientId?: string;
  serviceAccountsEnabled?: boolean;
  protocolMappers?: Array<{
    name?: string;
    protocolMapper?: string;
    config?: Record<string, string>;
  }>;
}

interface RealmJson {
  clients?: RealmClient[];
}

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function parseRealm(): RealmJson {
  return JSON.parse(read("keycloak/aisha-realm.json")) as RealmJson;
}

describe("NetBird bootstrap contract", () => {
  test("bootstrap script manages groups and setup keys through API", () => {
    const bootstrap = read("scripts/netbird-bootstrap.sh");

    for (const required of [
      "/api/groups",
      "/api/setup-keys",
      "client_credentials",
      "NETBIRD_AUTH_SCHEME",
      "NETBIRD_MGMT_SECRET",
      "auto_groups",
      "NETBIRD_STACK_KEY_FRONTEND",
      "NETBIRD_STACK_KEY_BACKEND",
      "NETBIRD_STACK_KEY_INTEGRATION",
      "NETBIRD_STACK_KEY_EXPERIMENTAL",
      "coolify-sync-envs.sh",
    ]) {
      expect(bootstrap, `scripts/netbird-bootstrap.sh missing ${required}`).toContain(required);
    }
  });

  test("cold-start invokes SSO provisioning before NetBird bootstrap", () => {
    const coldStart = read("scripts/aisha-cold-start.sh");
    const provisionIndex = coldStart.indexOf("scripts/provision-sso.sh --prod --keycloak-only");
    const bootstrapIndex = coldStart.indexOf("scripts/netbird-bootstrap.sh");

    expect(provisionIndex, "cold-start must provision Keycloak client secrets").toBeGreaterThan(-1);
    expect(bootstrapIndex, "cold-start must invoke NetBird bootstrap").toBeGreaterThan(-1);
    expect(provisionIndex, "NetBird bootstrap needs netbird-backend secret provisioned first").toBeLessThan(bootstrapIndex);
  });

  test("cold-start stops downstream waves when the dynamic pre-NetBird range or NetBird gates fail", () => {
    const coldStart = read("scripts/aisha-cold-start.sh");

    expect(
      coldStart,
      "The manifest-derived Phase C range must fail closed; otherwise NetBird/downstream waves start on broken PKI/OIDC prerequisites.",
    ).toMatch(/Phase C waves \$\{AISHA_WAVE_PHASE_C_FROM\}-\$\{AISHA_WAVE_PHASE_C_UNTIL\} did not complete[\s\S]*?exit 1/);
    expect(
      coldStart,
      "NetBird smoke failure must be fatal; downstream services depend on a working mesh control plane.",
    ).toMatch(/NetBird mgmt gate failed[\s\S]*?exit 1/);
    expect(
      coldStart,
      "NetBird bootstrap failure must be fatal before mesh peer waves start.",
    ).toMatch(/netbird-bootstrap\.sh failed[\s\S]*?exit 1/);
  });

  test("self-heal: ensure_setup_key_env validates against NetBird API before idempotent skip", () => {
    // The original ensure_setup_key_env() only checked whether the env value was
    // set, so a present-but-invalid key skipped silently and mesh enrollment
    // failed. Self-heal added an API check before the skip.
    //
    // That check originally matched BY NAME, and this gate asserted the matching
    // function's NAME — both of which were wrong, in the same way. NetBird never
    // returns the secret `key` value in list responses, so a name match only says
    // "a key for this role exists", never "the value we hold is that key". A wipe
    // recreates the management DB with fresh keys under the SAME NAMES while the
    // env is deliberately preserved, so the name matched, validation passed, the
    // dead value was kept, and every agent got "setup key is invalid"
    // (measured on tenant 2026-07-21: tenant-potok, tenant-local-ingest, used_times=0).
    //
    // So: assert the PROPERTY — validation is keyed on the stored key's identity
    // — and never the identifier that implements it. A rename must not fail this
    // gate; keeping the name while reverting to name-matching MUST fail it.
    // Behavioural coverage lives in netbird-setup-key-identity.gate.test.ts.
    const bootstrap = read("scripts/netbird-bootstrap.sh");
    expect(bootstrap, "validator must call GET /api/setup-keys").toMatch(/GET\s+"?\/api\/setup-keys/);
    expect(bootstrap, "validator must filter by state=valid and revoked=false").toMatch(/state.*?valid|valid.*?state/);
    expect(bootstrap, "validator must filter revoked=false").toContain("revoked == false");

    // The identity property: the record is selected by the stored id, and that id
    // is persisted next to the value so a later run can do this at all.
    expect(
      bootstrap,
      "validation must select the record by the STORED KEY'S ID, not by its name",
    ).toMatch(/select\(\(\.id[^)]*\)\s*==\s*\$id/);
    expect(
      bootstrap,
      "the key's id must be persisted alongside the value, or the next run cannot verify it",
    ).toMatch(/upsert_env_file\s+"\$id_key"/);
    expect(
      bootstrap,
      "a stored value with no id is unverifiable and must regenerate, never assume-good",
    ).toMatch(/-z "\$existing_id"/);

    expect(bootstrap, "auto-regenerate path must trigger when api_valid=0 and FORCE not set").toContain("auto-regenerating (self-heal)");
    expect(bootstrap, "regeneration counter must increment on success").toContain("SETUP_KEYS_REGENERATED=$((SETUP_KEYS_REGENERATED + 1))");
    expect(bootstrap, "redeploy logic must trigger when any key regenerated").toMatch(/SETUP_KEYS_REGENERATED.*?-gt 0/);
  });

  test("deploy-init runs NetBird self-heal before per-stack env propagation", () => {
    // Pre-deploy validation hook: every Coolify deploy first validates that
    // NetBird setup keys are still valid; if any are invalid, regenerate
    // them so the propagated env values are usable. Without this hook, a
    // revoked/missing key would deploy stale env → mesh enrollment fail.
    const deployInit = read("scripts/coolify-deploy-init.sh");
    expect(deployInit, "deploy-init must invoke netbird-bootstrap for self-heal").toContain("netbird-bootstrap.sh");
    expect(deployInit, "self-heal must run BEFORE the per-stack deployment loop").toMatch(
      /NetBird setup key self-heal[\s\S]*?STACK DEPLOYMENT LOOP/,
    );
    expect(deployInit, "self-heal hook must be skippable via NETBIRD_SELFHEAL_SKIP for fresh installs").toContain("NETBIRD_SELFHEAL_SKIP");
  });

  test("runner správu meshe nevolá — klíč běhu se nerazí (2026-10-06, majitel „síť zavřít“ = volba A)", () => {
    // Dřív tu brána hlídala, JAK runner volá správu NetBirdu (Keycloak Bearer, auto_groups)
    // kvůli klíči pro každý běh. Klíč žádný obraz nepoužil, jen ležel v prostředí kontejneru
    // pluginu; volba A ho ruší i s pověřením runneru ke správě meshe. Invariant se proto
    // obrací: runner nemá klienta správy meshe ani NETBIRD_* pověření. Tvar kontejneru běhu
    // a uzavřenost sítě běhů hlídá `beh-kontejneru-tvar.gate.test.ts`.
    const config = read("services/svc-agent-runner/src/config.ts");
    expect(existsSync(join(ROOT, "services/svc-agent-runner/src/netbird-client.ts"))).toBe(false);
    expect(config).not.toMatch(/process\.env\.NETBIRD_/);
  });

  test("netbird-backend service account emits netbird audience", () => {
    const realm = parseRealm();
    const backend = realm.clients?.find((client) => client.clientId === "netbird-backend");

    expect(backend, "netbird-backend client missing from realm import").toBeDefined();
    expect(backend?.serviceAccountsEnabled, "netbird-backend must use service account auth").toBe(true);

    const audienceMapper = backend?.protocolMappers?.find(
      (mapper) => mapper.protocolMapper === "oidc-audience-mapper" && mapper.config?.["included.custom.audience"] === "netbird",
    );
    expect(audienceMapper, "netbird-backend access token must include aud=netbird").toBeDefined();
  });
});
