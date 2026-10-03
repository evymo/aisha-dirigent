import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { exporterRadky, sqlZWrapperu } from "../gates/lib/postgres-wrapper-sql";

/**
 * SQL, které wrapper Postgresu posílá při startu pro roli postgres_exporter, nad
 * SKUTEČNÝM Postgresem: při neexistující roli neselže a nic neudělá, při existující
 * heslo opravdu nastaví (i s apostrofem).
 *
 * ⛔ NAMĚŘENO 2026-09-17 na instanci: `rolpassword IS NULL` pro postgres_exporter —
 * exporter se nepřihlásí. Brána postgres-exporter-heslo-pri-startu měří, že wrapper
 * řádek vydá; tady se měří, co řádek v databázi udělá. Vše běží v transakci
 * s ROLLBACK — stav sdílené testovací DB se nemění.
 */
const dbAvailable = isPgReachable();
const ROOT = process.cwd();

let radek = "";

beforeAll(async () => {
  await reportTestCapabilities("heslo postgres_exporter z wrapperu");
  const { sql } = sqlZWrapperu(ROOT, { POSTGRES_EXPORTER_PASSWORD: "exp'orter-db-test" });
  radek = exporterRadky(sql).find((r) => /ALTER ROLE postgres_exporter WITH PASSWORD/.test(r)) ?? "";
});

const zajistitRoli = `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres_exporter') THEN
    CREATE ROLE postgres_exporter LOGIN;
  END IF;
END $$;`;

describe("postgres_exporter: re-apply SQL z wrapperu nad skutečnou DB", () => {
  it("wrapper řádek pro exporter vydal (jinak by testy níž měřily prázdno)", () => {
    expect(radek).toMatch(/ALTER ROLE postgres_exporter WITH PASSWORD/);
  });

  it.skipIf(!dbAvailable)("⛔ role EXISTUJE bez hesla → po řádku z wrapperu heslo má", () => {
    const vystup = psqlMultiline(
      [
        "\\set ON_ERROR_STOP on",
        "BEGIN;",
        zajistitRoli,
        "ALTER ROLE postgres_exporter PASSWORD NULL;",
        radek,
        "SELECT 'VYSLEDEK:' || (rolpassword IS NOT NULL)::text FROM pg_authid WHERE rolname = 'postgres_exporter';",
        "ROLLBACK;",
      ].join("\n"),
    );
    expect(/VYSLEDEK:(true|false)/.exec(vystup)?.[1], vystup).toBe("true");
  });

  it.skipIf(!dbAvailable)("role NEEXISTUJE (jiný stack s týmž obrazem) → řádek neselže a nic nevytvoří", () => {
    const vystup = psqlMultiline(
      [
        "\\set ON_ERROR_STOP on",
        "BEGIN;",
        zajistitRoli,
        "DROP OWNED BY postgres_exporter;",
        "DROP ROLE postgres_exporter;",
        radek,
        "SELECT 'VYSLEDEK:' || count(*)::text FROM pg_roles WHERE rolname = 'postgres_exporter';",
        "ROLLBACK;",
      ].join("\n"),
    );
    expect(/VYSLEDEK:(\d+)/.exec(vystup)?.[1], vystup).toBe("0");
  });
});
