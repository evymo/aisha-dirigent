/**
 * Postgres Grants Gate
 *
 * Static check of `infra/postgres/000_init_roles_schemas.sql` and
 * `infra/postgres/entrypoint-wrapper.sh` to ensure that every service role:
 *
 * 1. Has `GRANT CONNECT ON DATABASE postgres`
 * 2. Has its schema grants (`USAGE, CREATE ON SCHEMA <name>`)
 * 3. Has `GRANT CREATE ON DATABASE postgres` if the service performs
 *    schema introspection at startup (n8n 1.79+, synapse, langfuse)
 * 4. Init SQL never accidentally `GRANT ... TO PUBLIC` (security)
 * 5. Právo VYTVÁŘET ve schématu `public` mají jen vyjmenované role — měřeno
 *    v celém stromu, ne v jednom souboru (sekce na konci)
 *
 * The n8n_app `GRANT CREATE ON DATABASE postgres` was the root cause of a
 * deployment regression — n8n bootstrap requires CREATE on db to verify
 * schema existence even when DB_POSTGRESDB_SCHEMA is set to a pre-created
 * schema. Without that grant, n8n crashes at startup.
 *
 * Spouští se přes: npm run test:gates
 */

import { beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bezKomentaru, prikazyNaSchema, univerzumSql, zmerSoubor } from "../../../scripts/lib/grant-na-schema.mjs";
import { RESET_PUBLIC_SCHEMA_SQL } from "../../../scripts/db/lib/reset-public-schema.mjs";

const ROOT = process.cwd();
const INIT_SQL = readFileSync(join(ROOT, "infra/postgres/000_init_roles_schemas.sql"), "utf-8");
const ENTRYPOINT = readFileSync(join(ROOT, "infra/postgres/entrypoint-wrapper.sh"), "utf-8");

/**
 * needsExplicitConnect = true means the service role MUST have an explicit
 *   `GRANT CONNECT ON DATABASE postgres` (typically because it creates schemas
 *   or modifies database-level state at startup).
 * Roles without it rely on default PUBLIC CONNECT privilege — fine until
 *   anyone runs `REVOKE ALL ON DATABASE postgres FROM PUBLIC`.
 *
 * synapse_user is intentionally absent: it lives in a dedicated `synapse`
 *   database created by `synapse-db-init` in docker-compose.coolify-matrix.yml,
 *   not in init_roles_schemas.sql.
 */
const SERVICE_ROLES = [
  { role: "n8n_app", schema: "n8n", needsExplicitConnect: true, needsCreateOnPostgres: true },
  { role: "keycloak_app", schema: "keycloak", needsExplicitConnect: true, needsCreateOnPostgres: false },
  { role: "netbird_app", schema: "netbird", needsExplicitConnect: true, needsCreateOnPostgres: false },
  { role: "langfuse_app", schema: "langfuse", needsExplicitConnect: false, needsCreateOnPostgres: false },
  { role: "nocodb_app", schema: "public", needsExplicitConnect: false, needsCreateOnPostgres: false },
];

describe("Postgres init — role connectivity", () => {
  test("roles that need explicit CONNECT have GRANT CONNECT ON DATABASE postgres", () => {
    const missing = SERVICE_ROLES.filter((r) => {
      if (!r.needsExplicitConnect) return false;
      const re = new RegExp(`GRANT CONNECT ON DATABASE \\w+ TO ${r.role}`);
      return !re.test(INIT_SQL);
    });
    expect(
      missing.map((r) => r.role),
      "Service roles that bootstrap schemas need explicit CONNECT (defensive against REVOKE FROM PUBLIC)",
    ).toEqual([]);
  });
});

describe("Postgres init — schema privileges", () => {
  test("each service role has USAGE, CREATE on its dedicated schema", () => {
    const missing = SERVICE_ROLES.filter((r) => {
      if (!r.schema) return false;
      const re = new RegExp(`GRANT USAGE,?\\s*CREATE ON SCHEMA ${r.schema} TO ${r.role}`);
      return !re.test(INIT_SQL);
    });
    expect(
      missing.map((r) => `${r.role} (schema: ${r.schema})`),
      "Service roles need USAGE+CREATE on their schema",
    ).toEqual([]);
  });
});

describe("Postgres init — n8n bootstrap requirement", () => {
  test("n8n_app has GRANT CREATE ON DATABASE postgres", () => {
    expect(
      /GRANT CREATE ON DATABASE \w+ TO n8n_app/.test(INIT_SQL),
      "n8n 1.79+ verifies schema existence at startup which requires CREATE on database. Without this grant, n8n crashes during bootstrap.",
    ).toBe(true);
  });

  test("entrypoint-wrapper.sh idempotently re-applies n8n_app GRANT CREATE", () => {
    expect(
      /GRANT CREATE ON DATABASE \w+ TO n8n_app/.test(ENTRYPOINT),
      "entrypoint-wrapper.sh must idempotently re-apply the GRANT — Coolify volumes can lose grants on full re-init",
    ).toBe(true);
  });
});

describe("Postgres init — no accidental PUBLIC grants", () => {
  test("no GRANT ... TO PUBLIC in init SQL (security)", () => {
    const lines = INIT_SQL.split("\n");
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("--")) continue;
      if (/GRANT\s+[^;]+TO\s+PUBLIC[\s;,]/i.test(line)) {
        violations.push(`infra/postgres/000_init_roles_schemas.sql:${i + 1} — ${line.trim()}`);
      }
    }
    expect(
      violations,
      "GRANT TO PUBLIC exposes privileges to every login role including unauthenticated — explicit grants only",
    ).toEqual([]);
  });
});

describe("Postgres init — role hygiene", () => {
  test("every CREATE ROLE statement uses NOLOGIN or LOGIN explicitly", () => {
    const violations: string[] = [];
    const lines = INIT_SQL.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("--")) continue;
      const m = line.match(/CREATE ROLE\s+(\w+)\s+(.*)/i);
      if (!m) continue;
      if (!/\bLOGIN\b|\bNOLOGIN\b/i.test(m[2])) {
        violations.push(`infra/postgres/000_init_roles_schemas.sql:${i + 1} — role ${m[1]} missing explicit LOGIN/NOLOGIN`);
      }
    }
    expect(
      violations,
      "Roles should declare LOGIN or NOLOGIN explicitly (default LOGIN can be surprising)",
    ).toEqual([]);
  });

  test("authenticator role uses NOINHERIT (PostgREST switching pattern)", () => {
    expect(
      /CREATE ROLE authenticator\s+LOGIN\s+NOINHERIT/i.test(INIT_SQL),
      "PostgREST role-switching gateway requires NOINHERIT so SET ROLE switches don't leak privileges",
    ).toBe(true);
  });
});

// =============================================================================
// Schéma public — vytvářet v něm smí jen vyjmenovaní
// =============================================================================
// ⛔ ZMĚŘENO 2026-10-03 na živé instanci: ACL schématu public bylo
// {vlastník=UC, postgres=UC, =UC}. Sekce „no accidental PUBLIC grants“ výš čte
// JEDEN soubor (init skript rolí); grant, který dával právo CREATE všem, bydlel
// v řetězci uvnitř skriptu migrace a neviděl ho nikdo. Tady se proto měří celý
// strom — každé místo, kde může být SQL (viz scripts/lib/grant-na-schema.mjs).
//
// PROČ NA TOM ZÁLEŽÍ: funkce SECURITY DEFINER v public patří superuživateli a
// volají další funkce a operátory bez kvalifikace. Kdo smí ve schématu vytvářet,
// podstrčí přetížení s přesnějším typem argumentu a jeho kód poběží právy vlastníka.

/** Kdo smí ve schématu public vytvářet — a proč. Nová role = vědomé rozhodnutí tady. */
const TVURCI_V_PUBLIC: Record<string, string> = {
  postgres: "správcovská role databázového kontejneru; reset schématu jí vrací ALL",
  nocodb_app: "NocoDB drží své tabulky v public a při startu zakládá další",
};

/** Zdroje, které grant práva vytvářet nesou ZÁMĚRNĚ: zkušební regres na zahazované databázi. */
const ZKUSEBNI_REGRES: Record<string, string> = {
  "scripts/db/verify-upgrade-apply.sh":
    "vrací sondu do stavu dnešních instancí (CREATE pro PUBLIC), aby heals měly co léčit",
};

const HEAL_PUBLIC = "aisha/db/sql/grants/schema_public_create.sql";

describe("schéma public — vytvářet smí jen vyjmenovaní", () => {
  const kde = new Map<string, Set<string>>();
  const regres = new Map<string, Set<string>>();
  const nezmereno: string[] = [];
  let souboru = 0;

  beforeAll(() => {
    for (const rel of univerzumSql(ROOT)) {
      souboru++;
      const m = zmerSoubor(ROOT, rel);
      const cil = rel in ZKUSEBNI_REGRES ? regres : kde;
      for (const t of m.tvurci) {
        if (!cil.has(t.role)) cil.set(t.role, new Set());
        cil.get(t.role)!.add(rel);
      }
      for (const n of m.nezmereno) nezmereno.push(`${rel} :: ${n}`);
    }
  }, 180_000);

  test("měřák vidí místa, kde grant prokazatelně je (kotva)", () => {
    expect(souboru, "univerzum je prázdné — měřák by byl zelený nad ničím").toBeGreaterThan(100);
    const nocodb = [...(kde.get("nocodb_app") ?? [])];
    expect(nocodb).toContain("infra/postgres/000_init_roles_schemas.sql");
    expect(nocodb).toContain("scripts/db/lib/reset-public-schema.mjs");
    expect(nocodb).toContain(HEAL_PUBLIC);
  });

  test("PUBLIC právo vytvářet nedostává nikde", () => {
    expect(
      [...(kde.get("PUBLIC") ?? [])],
      "GRANT CREATE/ALL ON SCHEMA public TO PUBLIC = každá role, která se přihlásí, může v public vytvářet",
    ).toEqual([]);
  });

  test("právo vytvářet mají přesně vyjmenované role — ani víc, ani zastaralý zápis", () => {
    const nove = [...kde.keys()].filter((r) => r !== "PUBLIC" && !(r in TVURCI_V_PUBLIC));
    expect(
      nove.map((r) => `${r} ← ${[...kde.get(r)!].join(", ")}`),
      "Nová role s právem vytvářet v public: dej jí vlastní schéma, nebo ji vědomě zapiš do TVURCI_V_PUBLIC s důvodem",
    ).toEqual([]);
    expect(
      Object.keys(TVURCI_V_PUBLIC).filter((r) => !kde.has(r)),
      "Role v TVURCI_V_PUBLIC už grant nikde nemá — zápis smaž",
    ).toEqual([]);
  });

  test("žádný grant práva vytvářet, u kterého nejde změřit komu a kam", () => {
    expect(
      nezmereno,
      "Schéma nebo role se skládá za běhu — měřák neví, jestli nejde o public. Napiš jména literálem.",
    ).toEqual([]);
  });

  test("výjimka pro zkušební regres není zastaralá", () => {
    for (const rel of Object.keys(ZKUSEBNI_REGRES)) {
      const maGrant = [...regres.values()].some((s) => s.has(rel));
      expect(maGrant, `${rel} už grant práva vytvářet nenese — výjimku smaž`).toBe(true);
    }
  });

  test("běžící databáze: heals grant roli vrátí DŘÍV, než PUBLIC odeberou, a v jednom bloku", () => {
    const heals = readFileSync(join(ROOT, "aisha/db/heals.sql"), "utf-8");
    expect(
      heals.split("\n").some((l) => l.trim() === `\\ir ${HEAL_PUBLIC.replace("aisha/db/", "")}`),
      "bez \\ir v heals.sql se odebrání na běžící databázi nikdy nepřehraje",
    ).toBe(true);

    const sql = bezKomentaru(readFileSync(join(ROOT, HEAL_PUBLIC), "utf-8"));
    const bloky = sql.match(/\bDO\s+\$\$[\s\S]*?\$\$\s*;/g) ?? [];
    expect(bloky, "grant i REVOKE musí být v JEDNOM bloku DO").toHaveLength(1);
    const prikazy = prikazyNaSchema(bloky[0]);
    const grant = prikazy.findIndex(
      (p) => p.akce === "GRANT" && p.prava.includes("CREATE") && p.role.some((r) => r.jmeno === "nocodb_app"),
    );
    const revoke = prikazy.findIndex(
      (p) => p.akce === "REVOKE" && p.prava.includes("CREATE") && p.role.some((r) => r.jmeno === "PUBLIC"),
    );
    expect(revoke, "REVOKE CREATE ON SCHEMA public FROM PUBLIC v bloku chybí").toBeGreaterThanOrEqual(0);
    expect(grant, "grant roli, která v public vytváří, v bloku chybí").toBeGreaterThanOrEqual(0);
    expect(grant, "grant musí předcházet REVOKE — jinak existuje stav, kdy role vytvářet nemůže").toBeLessThan(revoke);
    // REVOKE odvolá jen právo udělené tím, kdo ho pouští; cizího udělovatele přeskočí.
    expect(
      /FOR\s+\w+\s+IN[\s\S]*aclexplode[\s\S]*LOOP[\s\S]*SET\s+LOCAL\s+ROLE[\s\S]*REVOKE\s+CREATE\s+ON\s+SCHEMA\s+public\s+FROM\s+PUBLIC[\s\S]*END\s+LOOP/i.test(bloky[0]),
      "blok musí právo odvolat i jménem každého dalšího udělovatele z ACL (SET LOCAL ROLE + REVOKE ve smyčce)",
    ).toBe(true);
    expect(
      /RAISE\s+WARNING[^;]*po odebrání/i.test(bloky[0]),
      "REVOKE bez účinku není úspěch — blok musí výsledek změřit a zbylé právo ohlásit s udělovatelem",
    ).toBe(true);
    expect(
      /RAISE\s+EXCEPTION/i.test(bloky[0]),
      "heal migraci NEZASTAVUJE (zastavená migrace = nenasazené jádro); natvrdo hlídá ověření po nasazení a brána upgradu",
    ).toBe(false);
  });

  test("zbylé právo zastaví ověření po nasazení; doktor ho před nasazením ohlásí", () => {
    // Nad živou databází se JEN ČTE: i vrácený pokus o CREATE TABLE je zápisový pokus
    // a ve stavu „díra“ uspěje. Zkouška chováním patří bráně upgradu (zahazovaná DB).
    const zive = readFileSync(join(ROOT, "scripts/db/verify-schema-public-live.sh"), "utf-8");
    expect(zive, "výchozí režim živého ověření je čtecí kontrola").toContain("scripts/db/verify-schema-public-acl.sql");
    expect(
      /default_transaction_read_only=on/.test(zive),
      "čtecí režim musí vynutit transakci jen pro čtení — zápis má skončit chybou, ne zápisem",
    ).toBe(true);
    expect(/--zkouska-chovanim/.test(zive), "zkouška chováním jen na výslovný přepínač").toBe(true);
    const upgrade = readFileSync(join(ROOT, "scripts/db/verify-upgrade-apply.sh"), "utf-8");
    for (const sql of ["verify-schema-public-create.sql", "verify-schema-public-acl.sql"]) {
      expect(upgrade, `brána upgradu pouští obě kontroly (${sql}) — musí se shodnout`).toContain(sql);
    }
    const poNasazeni = readFileSync(join(ROOT, "scripts/verify-live-instance.sh"), "utf-8");
    expect(
      /verify-schema-public-live\.sh[\s\S]{0,400}\bbad\b/.test(poNasazeni),
      "ověření po nasazení musí při díře SELHAT (bad), ne jen vypsat",
    ).toBe(true);
    expect(poNasazeni, "ověření po nasazení nesmí nad živou instancí zkoušet zápis").not.toContain("--zkouska-chovanim");
    const doktor = readFileSync(join(ROOT, "scripts/cold-start-doctor.sh"), "utf-8");
    expect(doktor, "doktor nesmí nad živou instancí zkoušet zápis").not.toContain("--zkouska-chovanim");
    expect(
      doktor.includes("verify-schema-public-live.sh"),
      "doktor má stav schématu public změřit ještě před nasazením",
    ).toBe(true);
  });

  // Měří se práva na SCHÉMA (GRANT … ON SCHEMA public). Výchozí oprávnění k tabulkám
  // (ALTER DEFAULT PRIVILEGES IN SCHEMA public) se NEMĚŘÍ a reset je nevrací: nevracel
  // je nikdy, živé instance běží bez nich a vrácením by se přístup rozšířil.
  test("reset schématu vrací tatáž práva NA SCHÉMA jako init skript rolí", () => {
    const paryZ = (text: string) =>
      new Set(
        prikazyNaSchema(text)
          .filter((p) => p.akce === "GRANT" && p.schemata.some((s) => s.literal && s.jmeno === "public"))
          .flatMap((p) => p.role.flatMap((r) => p.prava.map((pr) => `${r.jmeno}:${pr}`))),
      );
    const init = paryZ(bezKomentaru(INIT_SQL));
    const reset = paryZ(bezKomentaru(RESET_PUBLIC_SCHEMA_SQL));
    expect(init.size, "init skript rolí nedává na schéma public nic — kotva parity chybí").toBeGreaterThan(0);
    expect(
      [...init].filter((p) => !reset.has(p)),
      "Reset schématu (DROP … CASCADE) smaže granty z init skriptu; co nevrátí, to instance po studeném startu nemá",
    ).toEqual([]);

    const migrate = bezKomentaru(readFileSync(join(ROOT, "scripts/db/migrate.mjs"), "utf-8"), ".mjs");
    expect(
      /psqlExec\(\s*connStr\s*,\s*RESET_PUBLIC_SCHEMA_SQL\s*\)/.test(migrate),
      "migrate.mjs musí reset pouštět z jediného zdroje (scripts/db/lib/reset-public-schema.mjs)",
    ).toBe(true);
    expect(
      /CREATE\s+SCHEMA\s+(IF\s+NOT\s+EXISTS\s+)?"?public"?/i.test(migrate),
      "migrate.mjs nesmí zakládat schéma public vlastním SQL mimo společný zdroj",
    ).toBe(false);
  });
});
