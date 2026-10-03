/**
 * Fáze B cold-startu: configure-realms.sh opravdu běží s tím, co má dostat, a
 * operátorské kroky po převzetí .env.coolify sahají na OPERÁTORSKOU adresu Keycloaku.
 *
 * ⛔ NAMĚŘENO 2026-09-17 ve dvou bězích cold-startu instance za sebou:
 *   1. `${_KC_TENANT_REALM_FILE:+TENANT_REALM_FILE=…}` stálo mezi přiřazeními před
 *      příkazem. Bash pozná přiřazení podle tvaru slova PŘED expanzí; tohle začíná
 *      `$`, stalo se jménem příkazu, a příkazem se stalo další slovo
 *      `AISHA_INSTANCE_DATA_GIT_URL=https://oauth2:<token>@…`. Výsledek: „No such
 *      file or directory" S TOKENEM v logu a realm se NIKDY neimportoval.
 *   2. Po aisha-bootstrap-user-init.sh cold-start převezme celý .env.coolify do
 *      prostředí — včetně KEYCLOAK_URL pro KONTEJNERY (mesh jméno). provision-operators
 *      pak z operátorského stroje sáhl na mesh jméno → `fetch failed`.
 *
 * ⭐ Brána VYŘÍZNE oba bloky ze skutečného scripts/aisha-cold-start.sh (podle
 * stabilních značek, které nesou obě verze) a SPUSTÍ je v bash nad podvrženým
 * configure-realms.sh a env souborem. Měří chování, ne text.
 */
import { afterAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const CS = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8").split("\n");
const dir = mkdtempSync(join(tmpdir(), "aisha-faze-b-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function blok(zacatek: RegExp, konec: RegExp): string {
  const i = CS.findIndex((r) => zacatek.test(r));
  const j = i < 0 ? -1 : CS.findIndex((r, k) => k > i && konec.test(r));
  if (i < 0 || j < 0) throw new Error(`blok ${zacatek} … ${konec} v aisha-cold-start.sh nenalezen — měřidlo přestalo sedět`);
  return CS.slice(i, j + 1).join("\n");
}

function bash(skript: string, env: Record<string, string>) {
  return spawnSync("bash", ["-c", skript], {
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
}

const TOKEN = "TAJNY-TOKEN-BRANY-7f3a";

describe("fáze B: configure-realms.sh dostane proměnné (brána)", () => {
  const realmBlok = blok(/info " {2}Importing realm/, /configure-realms\.sh skončil nenulou/);
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "keycloak"), { recursive: true });
  const zaznam = join(dir, "configure-realms.env");
  writeFileSync(
    join(repo, "keycloak/configure-realms.sh"),
    `#!/bin/bash\nenv | grep -E '^(KC_URL|KC_ADMIN_USER|TENANT_REALM_FILE|AISHA_INSTANCE_DATA_GIT_URL)=' | sed 's/=.*//' | sort > "${zaznam}"\n` +
      `[ "$AISHA_INSTANCE_DATA_GIT_URL" = "https://oauth2:${TOKEN}@example.invalid/data.git" ] && echo "URL-SEDI" >> "${zaznam}"\nexit 0\n`,
    { mode: 0o755 },
  );
  const spust = (tenantRealm: string) => {
    rmSync(zaznam, { force: true });
    const r = bash(
      ["set -uo pipefail", 'ok() { echo "OK: $*"; }', 'nedokonceno() { echo "NEDOKONCENO: $*"; }', 'info() { echo "INFO: $*"; }', realmBlok].join("\n"),
      {
        REPO_ROOT: repo,
        KEYCLOAK_REALM: "zkouska",
        KEYCLOAK_URL: "https://kc.example.invalid",
        KEYCLOAK_DOMAIN: "kc.example.invalid",
        KEYCLOAK_ADMIN: "admin",
        KEYCLOAK_ADMIN_PASSWORD: "heslo-brany",
        AISHA_INSTANCE_DATA_GIT_URL: `https://oauth2:${TOKEN}@example.invalid/data.git`,
        _KC_TENANT_REALM_FILE: tenantRealm,
      },
    );
    // Záznam nevznikne právě tehdy, když se configure-realms.sh nespustil — to je měřený stav.
    const env = existsSync(zaznam) ? readFileSync(zaznam, "utf8") : "";
    return { vystup: `${r.stdout}\n${r.stderr}`, env };
  };

  test("⛔ bez tenant realmu: skript BĚŽÍ a dostane URL overlaye", () => {
    const { vystup, env } = spust("");
    expect(env, `configure-realms.sh se nespustil:\n${vystup}`).toContain("AISHA_INSTANCE_DATA_GIT_URL");
    expect(env).toContain("URL-SEDI");
    expect(env).not.toContain("TENANT_REALM_FILE");
    expect(vystup).toContain("OK:");
  });

  test("s tenant realmem: skript běží a dostane i TENANT_REALM_FILE", () => {
    const { vystup, env } = spust("/cesta/k/realm.json");
    expect(env, `configure-realms.sh se nespustil:\n${vystup}`).toContain("TENANT_REALM_FILE");
    expect(env).toContain("URL-SEDI");
  });

  test("⛔ hodnota s pověřením se do výstupu nedostane v žádné variantě", () => {
    for (const t of ["", "/cesta/k/realm.json"]) {
      expect(spust(t).vystup, "token overlaye je ve výstupu cold-startu").not.toContain(TOKEN);
    }
  });
});

describe("fáze B: převzetí .env.coolify nepřepíše operátorskou adresu Keycloaku (brána)", () => {
  const funkce = blok(/^nacti_env_do_prostredi\(\) \{/, /^\}/);
  const prevzeti = blok(/# Přebírá se CELÝ soubor/, /ok " {2}převzato z fáze B/);

  test("⛔ KEYCLOAK_URL po převzetí = adresa vybraná pro operátora; ostatní klíče převzaty", () => {
    const envFile = join(dir, "env.coolify");
    writeFileSync(envFile, "KEYCLOAK_URL=https://aisha-auth.mesh.example.internal\nNOVY_KLIC_Z_FAZE_B=prevzato\n");
    const r = bash(
      [
        "set -uo pipefail",
        'ok() { echo "OK: $*"; }',
        funkce,
        prevzeti,
        'echo "KC=$KEYCLOAK_URL"',
        'echo "NOVY=$NOVY_KLIC_Z_FAZE_B"',
      ].join("\n"),
      { ENV_COOLIFY: envFile, KEYCLOAK_URL: "https://aisha-auth.backend.example.cz" },
    );
    expect(r.stdout, r.stderr).toContain("NOVY=prevzato");
    expect(r.stdout, "převzetí souboru přepsalo operátorskou adresu KC mesh jménem").toContain(
      "KC=https://aisha-auth.backend.example.cz",
    );
  });
});
