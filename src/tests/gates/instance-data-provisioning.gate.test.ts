/**
 * Implementation data + operator provisioning gate
 *
 * Locks the wipe restore contract:
 *   - prod/private deploys explicitly use profile=instance
 *   - the selected AISHA_IMPLEMENTATION is passed to the compiler
 *   - private implementation hooks are supported without being required
 *   - operator provisioning remains roster/env driven
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { spawnSync } from "child_process";

const ROOT = process.cwd();

function read(rel: string): string {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

const migrateEntrypoint = read("scripts/docker-migrate-entrypoint.sh");
const compileSeed = read("scripts/db/compile-seed.mjs");
const coreCompose = read("docker-compose.coolify.yml");
const coldStart = read("scripts/aisha-cold-start.sh");
const deployInit = read("scripts/coolify-deploy-init.sh");
const provisionOps = read("scripts/db/provision-operators.mjs");

describe("Implementation data fill", () => {
  test("migrate entrypoint defaults production seed profile to instance", () => {
    expect(migrateEntrypoint).toMatch(/AISHA_SEED_PROFILE:-instance/);
  });

  test("migrate entrypoint compiles profile plus selected implementation", () => {
    expect(migrateEntrypoint).toMatch(/SEED_IMPLEMENTATION=/);
    expect(migrateEntrypoint).toMatch(/compile-seed\.mjs/);
    expect(migrateEntrypoint).toMatch(/--profile="\$SEED_PROFILE"/);
    expect(migrateEntrypoint).toMatch(/--implementation="\$SEED_IMPLEMENTATION"/);
  });

  test("compile-seed exposes explicit implementation/private/demo profiles", () => {
    expect(compileSeed).toContain('"platform"');
    expect(compileSeed).toContain('"implementation"');
    expect(compileSeed).toContain('"instance"');
    expect(compileSeed).toContain('"full"');
    expect(compileSeed).toContain("AISHA_IMPLEMENTATION");
  });

  test("private implementation hook is wired with legacy tenant alias", () => {
    expect(migrateEntrypoint).toMatch(/AISHA_IMPLEMENTATION_HOOK/);
    expect(migrateEntrypoint).toMatch(/AISHA_TENANT_HOOK/);
    expect(migrateEntrypoint).toMatch(/IMPLEMENTATION_HOOK=/);
  });
});

describe("Operator provisioning - users restored on wipe", () => {
  test("migrate entrypoint provisions operators, gated on this install's roster", () => {
    expect(migrateEntrypoint).toMatch(/AISHA_OPERATORS/);
    expect(migrateEntrypoint).toMatch(/provision-operators\.mjs --apply/);
  });

  test("provisioning resolves subs over the INTERNAL Keycloak alias", () => {
    // ⛔ NAMĚŘENO 2026-08-19: tady stál PŘESNÝ tvar
    //   `KEYCLOAK_URL="${AISHA_PROVISION_KEYCLOAK_URL:-http://aisha-keycloak:80}"`
    // Brána tedy VYŽADOVALA fallback na Keycloak CIZÍ instance — kdo ho
    // narovnal, shodil ji. Měří se vlastnost: adresa se bere z prostředí a
    // NEOBSAHUJE literál jiné instance.
    expect(migrateEntrypoint, "provisioning musí adresu Keycloaku brát z prostředí").toMatch(
      /KEYCLOAK_URL="\$\{AISHA_PROVISION_KEYCLOAK_URL:-\$\{KEYCLOAK_INTERNAL_URL/,
    );
    expect(migrateEntrypoint, "a nesmí si dosadit jméno cizí instance").not.toMatch(
      /KEYCLOAK_URL="[^"]*aisha-keycloak/,
    );
  });

  test("cold-start re-runs idempotent core migrate after realm import", () => {
    expect(coldStart).toMatch(/aisha-redeploy\.mjs --only=core/);
    expect(coldStart).toMatch(/Restoring operator users/);
    expect(coldStart).toMatch(/OPERATORS_COMPACT.*\|\|.*AISHA_PRIMARY_ADMIN_EMAIL|AISHA_PRIMARY_ADMIN_EMAIL.*\|\|.*OPERATORS_COMPACT/);
  });

  test("provisioning needs no core-compose env hard-listing", () => {
    const migrateBlock = coreCompose.slice(
      coreCompose.indexOf("\n  migrate:"),
      coreCompose.indexOf("\n  db:"),
    );
    expect(migrateBlock).not.toMatch(/AISHA_OPERATORS/);
    expect(migrateBlock).not.toMatch(/KEYCLOAK_ADMIN_PASSWORD/);
  });
});

describe("Cold-start wiring", () => {
  test("cold-start emits seed profile, implementation and hook vars", () => {
    expect(coldStart).toMatch(/AISHA_SEED_PROFILE=\$\{AISHA_SEED_PROFILE:-instance\}/);
    expect(coldStart).toMatch(/AISHA_IMPLEMENTATION=/);
    expect(coldStart).toMatch(/AISHA_IMPLEMENTATION_HOOK=/);
  });

  test("cold-start resolves the roster from the instance-data overlay (config/operators.json fallback)", () => {
    expect(coldStart).toMatch(/OPERATORS_COMPACT=/);
    // The instance-data overlay is the single source of truth: the roster
    // resolution clones AISHA_INSTANCE_DATA_GIT_URL and reads ITS top-level
    // operators.json first (host-side, so the Phase B auto-create pass — which
    // needs KC admin creds only available on the host — sees the same roster the
    // migrate --apply does). Locks in overlay-first so a regression to
    // config-only can't pass. `_roster_json` + the cloned `repo/operators.json`
    // path are unique to that resolution block.
    expect(coldStart).toMatch(/_roster_json\(\)/);
    // ⛔ ZMĚNĚNO 2026-09-20: dosud se tu tvrdilo, že cold-start roster klonuje
    // SÁM (`repo/operators.json` + vlastní `command -v git` větev). Byl to
    // DRUHÝ domov téhož pojmu, a hlavně druhé chování při selhání: profil se
    // při nedostupném overlayi zastaví, roster tiše spadl na
    // `config/operators.json` — instance, která overlay DEKLARUJE, tak mohla
    // dostat operátory odjinud, aniž by se cokoli ohlásilo.
    //
    // Tvrzení proto přešlo z TVARU (vlastní klon) na VLASTNOST: roster se čte
    // z cesty k overlayi, a když ji běh ještě nemá, obstará si ji TÝMŽ
    // `_fetch_instance_overlay`, jaký používá profil. Jeden domov, jedno
    // chování při selhání.
    expect(coldStart).toMatch(/\$\{AISHA_INSTANCE_CONFIG_DIR\}\/operators\.json/);
    expect(
      coldStart,
      "roster-only běh si overlay musí obstarat týmž domovem jako profil",
    ).toMatch(/if \[ -z "\$\{AISHA_INSTANCE_CONFIG_DIR:-\}" \]; then\s*\n\s*_fetch_instance_overlay/);
    expect(
      coldStart,
      "druhý klon téhož overlaye se sem nesmí vrátit",
    ).not.toMatch(/AISHA_INSTANCE_DATA_GIT_URL:-\}"\s*\]\s*&&\s*command -v git/);
    // config/operators.json stays a fallback for installs without an overlay.
    expect(coldStart).toMatch(/config\/operators\.json/);
    expect(coldStart).toMatch(/printf 'AISHA_OPERATORS=%s\\n'/);
  });

  test("provisioning keys are in REGEN_KEYS", () => {
    expect(coldStart).toMatch(/OPERATORS\|PRIMARY_ADMIN_EMAIL\|SEED_PROFILE\|IMPLEMENTATION\|IMPLEMENTATION_HOOK\|TENANT_HOOK/);
  });

  test("deploy-init pushes seed profile, implementation and roster to core app", () => {
    expect(deployInit).toMatch(/AISHA_SEED_PROFILE/);
    expect(deployInit).toMatch(/AISHA_IMPLEMENTATION/);
    expect(deployInit).toMatch(/AISHA_IMPLEMENTATION_HOOK/);
    expect(deployInit).toMatch(/AISHA_OPERATORS/);
    expect(deployInit).toMatch(/AISHA_PRIMARY_ADMIN_EMAIL/);
  });
});

describe("Operator reconstruction - realm-driven fallback", () => {
  test("reconstructs the roster from realm-role membership", () => {
    expect(provisionOps).toMatch(/function\s+rosterFromRealm/);
    expect(provisionOps).toMatch(/\/roles\/\$\{encodeURIComponent\(roleName\)\}\/users/);
  });

  test("is scoped to operator-tier realm roles", () => {
    expect(provisionOps).toMatch(/AISHA_OPERATOR_REALM_ROLES\s*\|\|\s*["']admin,staff["']/);
    expect(provisionOps).not.toMatch(/rosterFromRealm[\s\S]*?\/admin\/realms\/\$\{KC_REALM\}\/users\b(?![/])/);
  });

  test("explicit roster takes precedence", () => {
    expect(provisionOps).toMatch(/operators\s*=\s*loadRoster\(\)/);
    expect(provisionOps).toMatch(/operators\.length === 0[\s\S]*?rosterFromRealm\(token\)/);
  });

  test("realm-derived operators flow through app_role provisioning", () => {
    expect(provisionOps).toMatch(/roles:\s*\[\]/);
    expect(provisionOps).toMatch(/::public\.app_role/);
  });

  test("introduces no committed PII", () => {
    expect(provisionOps).not.toMatch(/@(?:ekortn\.com|seznam\.cz|gmail\.com|evymo\.com|aisha\.guru)\b/);
  });
});

describe("Operator creation - missing Keycloak users auto-created (wipe gap)", () => {
  test("creation is opt-out-able (env + CLI flag) and defaults to ON", () => {
    expect(provisionOps).toMatch(/AISHA_OPERATORS_CREATE_MISSING\s*\?\?\s*"1"/);
    expect(provisionOps).toMatch(/--no-create/);
  });

  test("creation never fires in the safe dry default (gated on --apply / --create-only)", () => {
    expect(provisionOps).toMatch(
      /canCreate\s*=\s*rosterIsExplicit\s*&&\s*!NO_CREATE\s*&&\s*\(APPLY\s*\|\|\s*CREATE_ONLY\)/,
    );
  });

  test("creates with UPDATE_PASSWORD required action + crypto-random temporary password", () => {
    expect(provisionOps).toMatch(/requiredActions:\s*\["UPDATE_PASSWORD"\]/);
    expect(provisionOps).toMatch(/reset-password/);
    expect(provisionOps).toMatch(/temporary:\s*true/);
    expect(provisionOps).toMatch(/crypto\.randomBytes\(24\)/);
  });

  test("existing users are never modified — creation only fires when the email resolves to nothing", () => {
    expect(provisionOps).toMatch(/if\s*\(!hit\s*&&\s*canCreate\)/);
  });

  test("realm-role fallback path stays creation-free (derives FROM the realm)", () => {
    expect(provisionOps).toMatch(/rosterIsExplicit\s*=\s*operators\.length\s*>\s*0/);
  });

  test("temp password prints once in a marked block and never reaches the SQL", () => {
    expect(provisionOps).toMatch(/TEMP_PW_MARK\s*=\s*"\[TEMP-PASSWORD\]"/);
    const buildSqlBody = provisionOps.slice(
      provisionOps.indexOf("function buildSql"),
      provisionOps.indexOf("// ── Operator roster"),
    );
    expect(buildSqlBody.length).toBeGreaterThan(0);
    expect(buildSqlBody).not.toMatch(/tempPassword/);
  });

  test("migrate entrypoint keeps temp passwords OUT of the anon-readable migration_log_dump", () => {
    // [TEMP-PASSWORD] lines go to the container's real stdout (docker logs)
    // and are stripped from MIGRATE_OUT, whose tail is persisted to the DB.
    expect(migrateEntrypoint).toContain("grep '^\\[TEMP-PASSWORD\\]' \"$PROVISION_OUT\"");
    expect(migrateEntrypoint).toContain(
      "grep -v '^\\[TEMP-PASSWORD\\]' \"$PROVISION_OUT\" >>\"$MIGRATE_OUT\"",
    );
  });

  test("cold-start creates missing users HOST-side before the core re-migrate (temp passwords in terminal)", () => {
    expect(coldStart).toMatch(/provision-operators\.mjs --create-only/);
    expect(coldStart).toMatch(/AISHA_OPERATORS_CREATE_MISSING:-1/);
    const createIdx = coldStart.indexOf("provision-operators.mjs --create-only");
    const remigrateIdx = coldStart.indexOf("Restoring operator users (re-running idempotent core migrate");
    expect(createIdx).toBeGreaterThan(-1);
    expect(remigrateIdx).toBeGreaterThan(createIdx);
  });
});

describe("Operator creation - functional (mock fetch)", () => {
  type FetchCall = { url: string; init: { method?: string; body?: string; headers?: Record<string, string> } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    // module-level KC/KC_REALM are read from env at import time
    process.env.KEYCLOAK_URL = "http://kc.test";
    process.env.KEYCLOAK_REALM = "aisha";
    mod = await import(pathToFileURL(join(ROOT, "scripts/db/provision-operators.mjs")).href);
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  function jsonResponse(status: number, opts: { location?: string; body?: string } = {}) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === "location" ? opts.location ?? null : null) },
      text: async () => opts.body ?? "",
      json: async () => ({}),
    };
  }

  test("creates a missing user (POST users → PUT reset-password{temporary:true}) and prints [TEMP-PASSWORD] once", async () => {
    const calls: FetchCall[] = [];
    const newId = "3f8e8c1e-0000-4000-8000-000000000001";
    globalThis.fetch = (async (url: unknown, init: FetchCall["init"] = {}) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (init.method === "POST" && u === "http://kc.test/admin/realms/aisha/users") {
        return jsonResponse(201, { location: `${u}/${newId}` });
      }
      if (init.method === "PUT" && u === `http://kc.test/admin/realms/aisha/users/${newId}/reset-password`) {
        return jsonResponse(204);
      }
      throw new Error(`unexpected fetch: ${init.method} ${u}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const out: string[] = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = (chunk: unknown) => {
      out.push(String(chunk));
      return true;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res: any;
    try {
      res = await mod.createKcUser("test-token", {
        email: "operator@example.com",
        username: "operator",
        displayName: "Primary Operator",
      });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = realWrite;
    }

    expect(res?.sub).toBe(newId);
    const post = calls.find((c) => c.init.method === "POST");
    expect(post).toBeDefined();
    const body = JSON.parse(String(post?.init.body));
    expect(body).toMatchObject({
      username: "operator",
      email: "operator@example.com",
      enabled: true,
      emailVerified: true,
      requiredActions: ["UPDATE_PASSWORD"],
      firstName: "Primary",
      lastName: "Operator",
    });
    const put = calls.find((c) => c.init.method === "PUT");
    expect(put).toBeDefined();
    const pw = JSON.parse(String(put?.init.body));
    expect(pw.type).toBe("password");
    expect(pw.temporary).toBe(true);
    expect(String(pw.value).length).toBeGreaterThanOrEqual(24);
    expect(res.tempPassword).toBe(pw.value);

    // stdout: ONLY clearly marked [TEMP-PASSWORD] lines; the password exactly once
    const printed = out.join("");
    const lines = printed.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.startsWith("[TEMP-PASSWORD]")).toBe(true);
    expect(printed.split(pw.value).length - 1).toBe(1);
  });

  test("HTTP 409 (user exists under a different email) → soft null, reset-password NEVER called", async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = (async (url: unknown, init: FetchCall["init"] = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse(409, { body: "User exists with same username" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    const res = await mod.createKcUser("test-token", { email: "operator@example.com", username: "operator" });
    expect(res).toBeNull();
    expect(calls.some((c) => c.url.includes("reset-password"))).toBe(false);
  });

  test("temp passwords are crypto-random, ≥24 chars, url-safe, unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      const pw = mod.generateTempPassword();
      expect(pw.length).toBeGreaterThanOrEqual(24);
      expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
      seen.add(pw);
    }
    expect(seen.size).toBe(64);
  });

  test("displayName parsing → firstName/lastName for the KC representation", () => {
    expect(mod.parseDisplayName("Ada Lovelace")).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(mod.parseDisplayName("Ada Augusta King Lovelace")).toEqual({
      firstName: "Ada",
      lastName: "Augusta King Lovelace",
    });
    expect(mod.parseDisplayName("Ada")).toEqual({ firstName: "Ada" });
    expect(mod.parseDisplayName("")).toEqual({});
    expect(mod.parseDisplayName(undefined)).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AISHA_INSTANCE_DATA_GIT_URL delivery chain
// (derive → .env.coolify heredoc → sync payload intersection → migrate hook)
//
// Locks the fix for the 2026-06 audit finding: generate-secrets.mjs derived the
// overlay URL, but the cold-start heredoc never wrote the key into .env.coolify
// → coolify-sync-envs.sh (payload = .env.coolify keys ∩ compose ${VAR} refs)
// silently never delivered it to aisha-core → after --wipe the private overlay
// (KB + web content) never applied, with zero errors anywhere.
//
// Kept as a SEPARATE describe block — other agents extend the blocks above.
// ─────────────────────────────────────────────────────────────────────────────
describe("AISHA_INSTANCE_DATA_GIT_URL delivery chain", () => {
  const generateSecrets = read("scripts/generate-secrets.mjs");
  const envDoctor = read("scripts/aisha-env-doctor.mjs");
  const instanceHook = read("scripts/deploy/instance-data-hook.sh");
  const configureRealms = read("keycloak/configure-realms.sh");

  /** Heredoc body of the .env.coolify writer in aisha-cold-start.sh. */
  function heredocBody(): string {
    const start = coldStart.indexOf('cat > "$TMP_ENV" <<HEADER');
    const end = coldStart.indexOf("\nHEADER\n", start);
    expect(start, "cold-start .env.coolify heredoc not found").toBeGreaterThan(-1);
    expect(end, "cold-start heredoc terminator not found").toBeGreaterThan(start);
    return coldStart.slice(start, end);
  }

  test("generate-secrets derives + emits the key (vault wins, FORGEJO fallback)", () => {
    expect(generateSecrets).toMatch(/emit\('AISHA_INSTANCE_DATA_GIT_URL'/);
    expect(generateSecrets).toMatch(/preservedValue\('FORGEJO_API_TOKEN'/);
    // Forkability: the overlay URL must be COMPOSED from a per-instance org+repo
    // (so a fork derives ITS repo, not the hardcoded aisha/aisha-instance-data
    // which 401s the whole overlay), not a baked literal. Assert the template
    // shape + the org/repo derivation, and that the default repo follows the
    // <org>-instance-data convention (keeps the upstream aisha instance identical).
    expect(generateSecrets).toMatch(/forgejoOrg\s*=/);
    expect(generateSecrets).toMatch(/\$\{forgejoOrg\}\/\$\{instanceRepo\}\.git#main/);
    expect(generateSecrets).toMatch(/-instance-data`/);
  });

  test("cold-start heredoc writes the key into .env.coolify (the wipe gap)", () => {
    // Without this line the derived URL lives only as an unexported shell var
    // inside the cold-start process and never reaches any deployed app.
    expect(heredocBody()).toMatch(
      /^AISHA_INSTANCE_DATA_GIT_URL=\$\{AISHA_INSTANCE_DATA_GIT_URL:-\}$/m,
    );
  });

  test("REGEN_KEY_PATTERNS owns the key (no duplicate from backup passthrough)", () => {
    // generate-secrets/heredoc OWN the key → it must be in the regen set, or an
    // explicit .env-prod-backup value would be appended a second time and the
    // chain's parsers disagree on first-wins vs last-wins.
    expect(coldStart).toMatch(/TENANT_HOOK\|INSTANCE_DATA_GIT_URL\)/);
  });

  test("sync payload intersection carries the key to aisha-core", () => {
    // coolify-sync-envs payload = (.env.coolify keys) ∩ (compose ${VAR} refs ∪
    // Dockerfile ARGs). Side A is locked by the heredoc test above; side B must
    // come from the real extractor over the real core compose.
    const result = spawnSync(
      "bash",
      [
        "-c",
        'source scripts/lib/coolify-app-vars.sh && extract_compose_vars docker-compose.coolify.yml',
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split("\n")).toContain("AISHA_INSTANCE_DATA_GIT_URL");
  });

  test("core compose migrate service consumes the key with a safe empty default", () => {
    const migrateBlock = coreCompose.slice(
      coreCompose.indexOf("\n  migrate:"),
      coreCompose.indexOf("\n  db:"),
    );
    expect(migrateBlock).toMatch(
      /AISHA_INSTANCE_DATA_GIT_URL:\s*\$\{AISHA_INSTANCE_DATA_GIT_URL:-\}/,
    );
  });

  test("deploy-init pushes the key to the core app (env re-sync path)", () => {
    expect(deployInit).toMatch(
      /set_coolify_env_if\s+"\$local_uuid"\s+"AISHA_INSTANCE_DATA_GIT_URL"/,
    );
  });

  test("env-doctor contract keeps the key present (placeholder, empty allowed)", () => {
    expect(envDoctor).toMatch(/\["AISHA_INSTANCE_DATA_GIT_URL",\s*"placeholder"\]/);
  });

  test("cold-start passes the key through to configure-realms (KC instance clients)", () => {
    // ⛔ 2026-09-17: tenhle regex byl ZELENÝ, zatímco configure-realms.sh NIKDY
    // neběžel — o řádek výš stálo `${X:+TENANT_REALM_FILE=…}`, bash z něj udělal
    // jméno příkazu a klíč overlaye (s tokenem) spustil jako příkaz. Tvar textu
    // doručení nedokazuje. Doručení se MĚŘÍ během v bráně
    // faze-b-keycloak-dostane-co-ma (vyřízne blok a spustí ho s podvrženým
    // configure-realms.sh); tady zůstává jen ukazatel, že klíč jde do jeho prostředí.
    expect(coldStart).toMatch(/AISHA_INSTANCE_DATA_GIT_URL="\$\{AISHA_INSTANCE_DATA_GIT_URL:-\}"/);
    expect(coldStart).toMatch(/env "\$\{_kc_realm_env\[@\]\}" bash "\$\{REPO_ROOT\}\/keycloak\/configure-realms\.sh"/);
  });

  test("consumers self-heal JSON-escaped slashes (https:\\/\\/ corruption)", () => {
    // Observed in production: the value arrived in Coolify as
    // 'https:\/\/oauth2:…' (PHP json_encode escapes `/` as `\/`; a raw API dump
    // pasted anywhere in the chain persists it). Every consumer normalizes.
    const shGuard = /sed 's\|\\\\\/\|\/\|g'/;
    expect(instanceHook).toMatch(shGuard);
    expect(configureRealms).toMatch(shGuard);
    expect(generateSecrets).toMatch(/replace\(\/\\\\\\\/\/g,\s*'\/'\)/);
  });

  test("sync path builds env JSON with jq encoders only (no hand-escaped values)", () => {
    const syncEnvs = read("scripts/coolify-sync-envs.sh");
    // Hand-built `-d "{\"value\":\"$VAL\"}"` bodies are how `\/` (or worse)
    // sneaks into Coolify. The bulk payload + per-key writer must go through
    // jq encoders (`jq -Rs` / `jq -n --arg`) which never escape slashes.
    expect(syncEnvs).toMatch(/jq -Rs/);
    expect(syncEnvs).not.toMatch(/\\"value\\":/);
    expect(deployInit).toMatch(/jq -n\s*\\\n\s*--arg key "\$key"\s*\\\n\s*--arg value "\$value"/);
    expect(deployInit).not.toMatch(/\\"value\\":\\"\$/);
  });

  test("behavioral: derive, priority and self-heal through real generate-secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "aisha-instance-url-chain-"));
    try {
      const run = (backupLines: string[], env: Record<string, string> = {}) => {
        const backup = join(dir, ".env-prod-backup");
        writeFileSync(
          backup,
          [
            // keep bip39 out of the hot path (mnemonic preserved from fixture)
            "COSMOS_SIGNER_MNEMONIC=fixture mnemonic words only",
            ...backupLines,
            "",
          ].join("\n"),
        );
        // The fixture must declare its instance: generate-secrets no longer guesses one.
        const scrubbed: Record<string, string | undefined> = { ...process.env, APP_NAME_PREFIX: "aisha" };
        delete scrubbed.AISHA_INSTANCE_DATA_GIT_URL;
        delete scrubbed.FORGEJO_API_TOKEN;
        delete scrubbed.FORGEJO_URL;
        const result = spawnSync(
          "node",
          [
            join(ROOT, "scripts/generate-secrets.mjs"),
            "--preserve=1",
            `--env-backup=${backup}`,
            `--env-coolify=${join(dir, "missing.env.coolify")}`,
          ],
          { cwd: ROOT, env: { ...scrubbed, ...env }, encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        const line = result.stdout
          .split("\n")
          .find((l) => l.startsWith("AISHA_INSTANCE_DATA_GIT_URL="));
        expect(line, "key missing from generated env set").toBeDefined();
        return line!;
      };

      // 1. Derived from FORGEJO creds, oauth2-embedded, #main-pinned.
      expect(
        run(["FORGEJO_API_TOKEN=fixture-token-123", "FORGEJO_URL=https://git.example.test/"]),
      ).toBe(
        "AISHA_INSTANCE_DATA_GIT_URL='https://oauth2:fixture-token-123@git.example.test/aisha/aisha-instance-data.git#main'",
      );

      // 2. Explicit vault value beats derivation.
      expect(
        run([
          "FORGEJO_API_TOKEN=fixture-token-123",
          "FORGEJO_URL=https://git.example.test",
          "AISHA_INSTANCE_DATA_GIT_URL=https://oauth2:other@fork.example.test/x/y.git#release",
        ]),
      ).toBe(
        "AISHA_INSTANCE_DATA_GIT_URL='https://oauth2:other@fork.example.test/x/y.git#release'",
      );

      // 3. JSON-escaped corruption self-heals.
      expect(
        run([
          "AISHA_INSTANCE_DATA_GIT_URL=https:\\/\\/oauth2:tok@git.example.test\\/aisha\\/aisha-instance-data.git#main",
        ]),
      ).toBe(
        "AISHA_INSTANCE_DATA_GIT_URL='https://oauth2:tok@git.example.test/aisha/aisha-instance-data.git#main'",
      );

      // 4. No creds, no explicit value → empty (community no-op, not an error).
      expect(run([])).toBe("AISHA_INSTANCE_DATA_GIT_URL=''");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Instance roster from the PRIVATE overlay (AISHA_OPERATORS_FILE) +
// scripts/instance-rollout.sh (final rollout entrypoint)
//
// Locks the operator requirement (2026-06-12): the production roster (real
// operator accounts) lives as a top-level operators.json in the PRIVATE
// aisha-instance-data repo — "nothing static/local-only". instance-data-hook.sh
// exports it from the overlay clone; the migrate entrypoint hands it to
// provision-operators.mjs as AISHA_OPERATORS_FILE, so a wipe cold-start
// restores users purely from the private instance repo (zero local files).
// Day-2 pushes against live APIs go through ONE idempotent script:
// scripts/instance-rollout.sh.
//
// Kept as a SEPARATE describe block — other agents extend the blocks above.
// ─────────────────────────────────────────────────────────────────────────────
describe("Instance roster (AISHA_OPERATORS_FILE) + final rollout entrypoint", () => {
  const instanceHook = read("scripts/deploy/instance-data-hook.sh");
  const rollout = read("scripts/instance-rollout.sh");

  // Precedence INVERTED 2026-08-07 (measured incident, live instance): the
  // DECLARED overlay roster now outranks the AISHA_OPERATORS env SNAPSHOT.
  // The gate this replaced asserted the order of identifiers in the source —
  // and the order it locked in was exactly the one that hid the bug. Precedence
  // is a BEHAVIOUR, so it is tested through what loadRoster() returns and warns.
  describe("roster precedence — declared file beats env snapshot", () => {
    type Op = { email: string; roles?: string[] };
    let loadRoster: () => Op[];
    let tmp: string;
    const KEYS = ["AISHA_OPERATORS", "AISHA_OPERATORS_FILE", "AISHA_PRIMARY_ADMIN_EMAIL"];
    const saved: Record<string, string | undefined> = {};

    const FILE_ROSTER = {
      operators: [
        { email: "zdenek@example.test", roles: ["admin", "staff"] },
        { email: "novy@example.test", roles: ["admin", "staff"] },
      ],
    };
    const ENV_SNAPSHOT = { operators: [{ email: "zdenek@example.test", roles: ["admin", "staff"] }] };

    // Run fn with stderr captured — the conflict report IS the deliverable here,
    // so the test has to read it, not just trust that it was written.
    function capture<T>(fn: () => T): { value: T; err: string } {
      const orig = process.stderr.write.bind(process.stderr);
      let err = "";
      process.stderr.write = ((chunk: string | Uint8Array) => {
        err += String(chunk);
        return true;
      }) as typeof process.stderr.write;
      try {
        return { value: fn(), err };
      } finally {
        process.stderr.write = orig;
      }
    }

    function writeRoster(name: string, body: unknown): string {
      const p = join(tmp, name);
      writeFileSync(p, JSON.stringify(body));
      return p;
    }

    beforeAll(async () => {
      process.env.KEYCLOAK_URL = process.env.KEYCLOAK_URL || "http://kc.test";
      const mod = await import(pathToFileURL(join(ROOT, "scripts/db/provision-operators.mjs")).href);
      loadRoster = mod.loadRoster;
      tmp = mkdtempSync(join(tmpdir(), "roster-gate-"));
      for (const k of KEYS) saved[k] = process.env[k];
    });

    afterAll(() => {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      rmSync(tmp, { recursive: true, force: true });
    });

    // The roster file is the only source under test; the primary admin would be
    // prepended to every result and drown the assertions.
    function only(env: Partial<Record<string, string>>) {
      for (const k of KEYS) delete process.env[k];
      for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    }

    test("loadRoster is exported (precedence is testable, not just readable)", () => {
      expect(typeof loadRoster).toBe("function");
    });

    test("both sources present + differing → the FILE wins, the env snapshot is ignored", () => {
      only({
        AISHA_OPERATORS_FILE: writeRoster("declared.json", FILE_ROSTER),
        AISHA_OPERATORS: JSON.stringify(ENV_SNAPSHOT),
      });
      const { value } = capture(() => loadRoster());
      expect(value.map((o) => o.email).sort()).toEqual(["novy@example.test", "zdenek@example.test"]);
    });

    test("the disagreement is REPORTED, naming who the snapshot would have dropped", () => {
      only({
        AISHA_OPERATORS_FILE: writeRoster("declared2.json", FILE_ROSTER),
        AISHA_OPERATORS: JSON.stringify(ENV_SNAPSHOT),
      });
      const { err } = capture(() => loadRoster());
      expect(err).toMatch(/ROSTER CONFLICT/);
      expect(err).toMatch(/novy@example\.test/);
      // and it says which source won, with a count — the migrate log used to
      // report "Provisioned N operator(s)" without ever naming the source
      expect(err).toMatch(/Roster source: AISHA_OPERATORS_FILE/);
      expect(err).toMatch(/2 operator\(s\)/);
    });

    test("a role downgrade between the two sources is caught, not just a missing person", () => {
      only({
        AISHA_OPERATORS_FILE: writeRoster("roles.json", {
          operators: [{ email: "kdo@example.test", roles: ["admin", "staff"] }],
        }),
        AISHA_OPERATORS: JSON.stringify({ operators: [{ email: "kdo@example.test", roles: ["staff"] }] }),
      });
      const { err } = capture(() => loadRoster());
      expect(err).toMatch(/different roles/);
      expect(err).toMatch(/kdo@example\.test/);
    });

    test("sources that AGREE produce no conflict noise", () => {
      const same = { operators: [{ email: "shoda@example.test", roles: ["admin"] }] };
      only({
        AISHA_OPERATORS_FILE: writeRoster("same.json", same),
        AISHA_OPERATORS: JSON.stringify(same),
      });
      const { err } = capture(() => loadRoster());
      expect(err).not.toMatch(/ROSTER CONFLICT/);
    });

    // The wipe-restore path aisha-cold-start.sh depends on: with no overlay
    // reachable, AISHA_OPERATORS_FILE is unset and the snapshot must still work
    // as a full-value source on its own.
    test("env snapshot alone still provisions (wipe-restore keeps working)", () => {
      only({ AISHA_OPERATORS: JSON.stringify(ENV_SNAPSHOT) });
      const { value, err } = capture(() => loadRoster());
      expect(value.map((o) => o.email)).toEqual(["zdenek@example.test"]);
      expect(err).toMatch(/Roster source: AISHA_OPERATORS\b/);
      expect(err).not.toMatch(/ROSTER CONFLICT/);
    });

    test("a set-but-missing roster file stays FATAL even when the env snapshot could cover it", () => {
      only({
        AISHA_OPERATORS_FILE: join(tmp, "neexistuje.json"),
        AISHA_OPERATORS: JSON.stringify(ENV_SNAPSHOT),
      });
      // fail() calls process.exit(1) — assert via a child process so the
      // suite survives, and check the message reaches stderr.
      const res = spawnSync(
        process.execPath,
        [
          "-e",
          `import(${JSON.stringify(pathToFileURL(join(ROOT, "scripts/db/provision-operators.mjs")).href)}).then((m) => m.loadRoster())`,
        ],
        { env: { ...process.env }, encoding: "utf-8" },
      );
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/AISHA_OPERATORS_FILE points at a missing file/);
    });
  });

  test("provision-operators: a set-but-broken roster file is FATAL (loud > silent)", () => {
    expect(provisionOps).toMatch(/AISHA_OPERATORS_FILE points at a missing file/);
    expect(provisionOps).toMatch(/AISHA_OPERATORS_FILE \(\$\{rosterPath\}\) is not valid JSON/);
  });

  test("instance-data-hook exports the overlay's top-level operators.json (file-based handoff)", () => {
    expect(instanceHook).toMatch(/AISHA_OPERATORS_EXPORT_FILE:-\/tmp\/aisha-instance-operators\.json/);
    expect(instanceHook).toMatch(/cp "\$WORKDIR\/repo\/operators\.json" "\$ROSTER_EXPORT"/);
    // stale exports are cleared when the overlay carries no roster
    expect(instanceHook).toMatch(/rm -f "\$ROSTER_EXPORT"/);
  });

  test("migrate entrypoint consumes the export AFTER the hook and feeds provision-operators", () => {
    expect(migrateEntrypoint).toMatch(/AISHA_OPERATORS_EXPORT_FILE:-\/tmp\/aisha-instance-operators\.json/);
    expect(migrateEntrypoint).toMatch(/AISHA_OPERATORS_FILE="\$\{AISHA_OPERATORS_FILE:-\}"/);
    // the roster file is a provisioning trigger in its own right
    expect(migrateEntrypoint).toMatch(/\[ -n "\$\{AISHA_OPERATORS_FILE:-\}" \]/);
    // ordering: the hook (which stages the export) runs BEFORE provisioning
    const hookIdx = migrateEntrypoint.indexOf("Running implementation hook");
    const provisionIdx = migrateEntrypoint.indexOf("provision-operators.mjs --apply");
    expect(hookIdx).toBeGreaterThan(-1);
    expect(provisionIdx).toBeGreaterThan(hookIdx);
  });

  test("instance-rollout.sh exists and is the ONE idempotent day-2 entrypoint", () => {
    expect(rollout.length).toBeGreaterThan(0);
    expect(rollout).toMatch(/set -euo pipefail/);
    // (a) KC instance clients from the overlay
    expect(rollout).toMatch(/keycloak\/\*-client\.json/);
    // (b) roster ensure against live KC, instance roster wins deterministically
    expect(rollout).toMatch(/provision-operators\.mjs --create-only/);
    expect(rollout).toMatch(/AISHA_OPERATORS_FILE="\$ROSTER"/);
    expect(rollout).toMatch(/AISHA_OPERATORS=""/);
    // (c) DB plane: direct apply only where a DB path exists; core migrate is
    //     the deployed path; redeploy is an explicit opt-in flag
    expect(rollout).toMatch(/ON_ERROR_STOP=1/);
    expect(rollout).toMatch(/--redeploy-core/);
    expect(rollout).toMatch(/aisha-redeploy\.mjs --only=core/);
    expect(rollout).toMatch(/--local=/);
  });

  test("instance-rollout.sh has no hardcoded deployment hosts (env/.env.coolify only)", () => {
    for (const [i, line] of rollout.split("\n").entries()) {
      const t = line.trim();
      if (t.startsWith("#")) continue;
      expect(t, `instance-rollout.sh line ${i + 1} hardcodes a deployment host`).not.toMatch(
        /\b(?:id3a\.cz|aisha\.guru|aisha\.network|evymo\.com|alquist\.ai)\b/,
      );
      // any https URL must be assembled from env vars, never a literal host
      expect(t, `instance-rollout.sh line ${i + 1} hardcodes a URL`).not.toMatch(
        /https?:\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i,
      );
    }
    // realm is always env-driven (no /realms/aisha literal)
    expect(rollout).not.toMatch(/\/realms\/aisha\b/);
  });
});

describe("content propagation — comment-leak hygiene + content-repo wiring", () => {
  // Locks the 2026-06-30 fix: both private content repos (aisha-instance-data →
  // KB/RAG/web_pages/operators, aisha-guru-web → design templates for aisha+corp)
  // must propagate on a fresh --wipe. The root regression was a `# comment` from
  // domains.env.example being captured AS the URL value (file parse AND shell
  // fallback), shadowing the derived URL.
  const generateSecrets = read("scripts/generate-secrets.mjs");
  const webArtifactDf = read("services/svc-web-artifact/Dockerfile");
  const domainsExample = read("config/domains.env.example");

  test("generate-secrets strips inline comments on BOTH file + process.env paths", () => {
    expect(generateSecrets).toContain("function stripInlineComment");
    expect(generateSecrets).toContain("stripInlineComment(line.slice"); // parseEnvFile (file values)
    expect(generateSecrets).toContain("stripInlineComment(value)"); // cleanEnvValue (process.env values)
  });

  test("cold-start neexportuje z domains.env.example NIC — ani komentář, ani hodnotu", () => {
    // Původně: „fallback smyčka z domains.env.example musí před exportem odříznout
    // inline komentář" (`# https://…` se jinak stal hodnotou URL). 2026-09-13 byla
    // ta smyčka ODSTRANĚNA celá — doplňovala referenční placeholdery (na nasazené
    // instanci naměřeno pět mrtvých *_MESH_HOST). Silnější tvrzení: z `.example` do
    // prostředí nevede žádná cesta, takže komentář ani placeholder nemají kudy.
    // Vlastnost měří brána example-neni-zdroj-hodnot; tady se pinuje, že smyčka
    // se nevrátila v tvaru, který tahle brána kdysi hlídala.
    const kod = coldStart
      .split("\n")
      .filter((r) => !/^\s*#/.test(r))
      .join("\n");
    expect(kod).not.toMatch(/\$\{DOMAINS_FILE\}\.example|domains\.env\.example/);
  });

  test("cold-start heredoc writes all three content-repo keys to .env.coolify", () => {
    expect(coldStart).toMatch(/\nAISHA_INSTANCE_DATA_GIT_URL=\$\{AISHA_INSTANCE_DATA_GIT_URL:-\}/);
    expect(coldStart).toMatch(/\nAISHA_WEB_DESIGN_GIT_URL=\$\{AISHA_WEB_DESIGN_GIT_URL:-\}/);
    // AISHA_SEED_DOMAIN is the build-arg folder name for the design ingest — without
    // it the web-design overlay can't resolve domains/templates/<domain>/. Forkability:
    // it falls back to PUBLIC_TLD (the one TLD input a fork already provides) so a fork
    // need not remember to set it separately (else the branded web silently never populates).
    expect(coldStart).toMatch(/\nAISHA_SEED_DOMAIN=\$\{AISHA_SEED_DOMAIN:-\$\{PUBLIC_TLD:-\}\}/);
  });

  test("domains.env.example content-URL value lines carry NO trailing inline comment", () => {
    for (const k of ["AISHA_INSTANCE_DATA_GIT_URL", "AISHA_WEB_DESIGN_GIT_URL"]) {
      const m = domainsExample.match(new RegExp(`^${k}=(.*)$`, "m"));
      expect(m, `${k} present in domains.env.example`).toBeTruthy();
      expect((m?.[1] ?? "").trim(), `${k} value must be empty (format hint is a full-line comment above)`).toBe("");
    }
  });

  test("web-design overlay is fail-loud (no silent placeholder when a design URL is set)", () => {
    expect(webArtifactDf).toContain("AISHA_WEB_DESIGN_GIT_URL");
    expect(webArtifactDf).toContain("exit 1"); // fail on misconfig / clone failure
    expect(webArtifactDf).not.toContain("keeping placeholder"); // the old silent WARN is gone
  });

  test("AISHA_IMPLEMENTATION_HOOK defaults to the hook PATH (empty would never run the overlay)", () => {
    // The migrate entrypoint runs the instance-data hook only when
    // AISHA_IMPLEMENTATION_HOOK is non-empty (docker-migrate-entrypoint.sh:
    // `[ -n "$IMPLEMENTATION_HOOK" ]`). Writing it EMPTY to .env.coolify makes
    // coolify-sync-envs push "" → Coolify injects an explicit empty var that
    // SHADOWS the compose ${...:-default} → the hook never runs → the overlay
    // (KB/web_pages/operators) never applies (live root cause 2026-06-30, missed
    // by static audits that only saw the compose default). Default it to the path.
    expect(coldStart).toMatch(
      /AISHA_IMPLEMENTATION_HOOK=\$\{AISHA_IMPLEMENTATION_HOOK:-scripts\/deploy\/instance-data-hook\.sh\}/,
    );
    expect(deployInit).toMatch(
      /AISHA_IMPLEMENTATION_HOOK"\s+"\$\{AISHA_IMPLEMENTATION_HOOK:-scripts\/deploy\/instance-data-hook\.sh\}/,
    );
    // the migrate entrypoint still gates on non-empty (the reason the default matters)
    expect(read("scripts/docker-migrate-entrypoint.sh")).toMatch(/\[\s+-n\s+"\$IMPLEMENTATION_HOOK"\s+\]/);
  });
});

describe("Adopter template - instance-data overlay skeleton is shipped and PII-free", () => {
  const tpl = "docs/onboarding/instance-data-template";

  test("skeleton files exist (README + roster + KC client + example SQL)", () => {
    expect(existsSync(join(ROOT, tpl, "README.md"))).toBe(true);
    expect(existsSync(join(ROOT, tpl, "operators.json"))).toBe(true);
    expect(existsSync(join(ROOT, tpl, "keycloak", "01-example-client.json"))).toBe(true);
    expect(existsSync(join(ROOT, tpl, "00_example_seed.sql"))).toBe(true);
  });

  test("operators.json is valid JSON with a roster and NO real emails (example.com only)", () => {
    const raw = read(`${tpl}/operators.json`);
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed.operators)).toBe(true);
    expect(parsed.operators.length).toBeGreaterThan(0);
    for (const op of parsed.operators) {
      expect(op.email).toMatch(/@example\.com$/);
    }
  });

  test("KC client template is valid JSON with a clientId and no committed secret", () => {
    const client = JSON.parse(read(`${tpl}/keycloak/01-example-client.json`));
    expect(client.clientId).toBeTruthy();
    // A confidential secret must never be committed to the (public) skeleton.
    expect(client.secret).toBeUndefined();
  });

  test("example SQL demonstrates the idempotency contract (ON CONFLICT / IF NOT EXISTS)", () => {
    const sql = read(`${tpl}/00_example_seed.sql`);
    expect(sql).toMatch(/ON CONFLICT|IF NOT EXISTS/i);
    // no destructive platform-table ops in the shipped example. Strip `--` line
    // comments first: a comment that NAMES truncate/drop as a warning is guidance,
    // not a destructive statement.
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/\b(TRUNCATE|DROP\s+TABLE)\b/i);
  });

  test("README points adopters at the real consumers (cold-start + instance-rollout + hook)", () => {
    const readme = read(`${tpl}/README.md`);
    expect(readme).toMatch(/AISHA_INSTANCE_DATA_GIT_URL/);
    expect(readme).toMatch(/instance-rollout\.sh/);
    expect(readme).toMatch(/instance-data-hook\.sh/);
    expect(readme).toMatch(/provision-operators\.mjs/);
  });
});

describe("Roster je autorita operátorských rolí — co neuvádí, se odebere (2026-09-28)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  beforeAll(async () => {
    process.env.KEYCLOAK_URL = process.env.KEYCLOAK_URL || "http://kc.test";
    process.env.KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || "aisha";
    mod = await import(pathToFileURL(join(ROOT, "scripts/db/provision-operators.mjs")).href);
  });

  const SUB_ADMIN = "11111111-1111-4111-8111-111111111111";
  const SUB_CLEN = "22222222-2222-4222-8222-222222222222";

  test("odebírají se jen operátorské role, které roster u e-mailu neuvádí", () => {
    expect(mod.operatorRolesToRevoke({ roles: ["member"] }, ["admin", "staff"])).toEqual(["admin", "staff"]);
    expect(mod.operatorRolesToRevoke({ roles: ["admin", "staff"] }, ["admin", "staff"])).toEqual([]);
    expect(mod.operatorRolesToRevoke({ roles: ["staff"] }, ["admin", "staff"])).toEqual(["admin"]);
  });

  test("plán: operátor zůstane, běžný uživatel v rosteru přijde o admin/staff", () => {
    const plan = mod.planRevocations(
      [
        { email: "a@x.test", sub: SUB_ADMIN, roles: ["admin", "staff"] },
        { email: "b@x.test", sub: SUB_CLEN, roles: ["member"] },
      ],
      ["admin", "staff"],
    );
    expect(plan).toEqual([{ email: "b@x.test", sub: SUB_CLEN, roles: ["admin", "staff"] }]);
  });

  test("⛔ pojistka: roster bez jediného admina → STOP, nic se neodebere", () => {
    expect(() =>
      mod.planRevocations([{ email: "b@x.test", sub: SUB_CLEN, roles: ["member"] }], ["admin", "staff"]),
    ).toThrow(/ŽÁDNÉHO admina/);
  });

  test("SQL: DELETE jen pro plánované odebrání a až po INSERTech rosteru", () => {
    const resolved = [
      { email: "a@x.test", sub: SUB_ADMIN, displayName: "A", language: "cs", roles: ["admin", "staff"] },
      { email: "b@x.test", sub: SUB_CLEN, displayName: "B", language: "cs", roles: ["member"] },
    ];
    const bez = mod.buildSql(resolved);
    expect(bez).not.toMatch(/DELETE FROM public\.user_roles/);
    const s = mod.buildSql(resolved, mod.planRevocations(resolved, ["admin", "staff"]));
    const del = s.match(/DELETE FROM public\.user_roles[^\n]*/g) ?? [];
    expect(del).toEqual([
      `DELETE FROM public.user_roles WHERE user_id = '${SUB_CLEN}' AND role IN ('admin'::public.app_role, 'staff'::public.app_role);`,
    ]);
    expect(s.lastIndexOf("INSERT INTO public.user_roles")).toBeLessThan(s.indexOf("DELETE FROM public.user_roles"));
  });

  test("odebírá se JEN z deklarovaného souboru (AISHA_OPERATORS_FILE), ne ze snapshotu ani z realmu", () => {
    expect(provisionOps).toMatch(/const declared = rosterIsExplicit && Boolean\(process\.env\.AISHA_OPERATORS_FILE\)/);
    expect(provisionOps).toMatch(/if \(declared && !CREATE_ONLY\) \{\s*try \{\s*revocations = planRevocations\(resolved\)/);
  });

  test("Keycloak se srovná DŘÍV než DB; když odmítne, DB se nesnižuje", () => {
    const kc = provisionOps.indexOf("await dropRealmRoles(token, r.sub, r.roles)");
    // Cíl z psqlPripojeni (heslo mimo argv, upstream fbf9f7aa5) — dřív `[dbUrl`.
    const psql = provisionOps.indexOf('execFileSync("psql", [cil');
    expect(kc).toBeGreaterThan(0);
    expect(kc).toBeLessThan(psql);
    expect(provisionOps).toMatch(/if \(neodebrano\.length\) fail\(/);
  });

  test("Keycloak: reprezentace rolí z mapování uživatele, ne z GET /roles (omezený klient → 403) a výsledek se ověří", () => {
    const telo = provisionOps.slice(provisionOps.indexOf("async function dropRealmRoles"));
    const konec = telo.indexOf("\n}\n");
    const fce = telo.slice(0, konec);
    expect(fce).not.toMatch(/\/roles\/\$\{encodeURIComponent/);
    expect(fce).toMatch(/users\/\$\{sub\}\/role-mappings\/realm/);
    expect(fce).toMatch(/after removal/);
  });
});

