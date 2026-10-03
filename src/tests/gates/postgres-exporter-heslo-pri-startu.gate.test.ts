/**
 * Wrapper Postgresu nastaví heslo role postgres_exporter při KAŽDÉM startu — jen
 * když role existuje — a prázdnou proměnnou tam, kde role je, ohlásí.
 *
 * ⛔ NAMĚŘENO 2026-09-17 na instanci (core db, read-only
 * `select rolpassword is null from pg_authid where rolname='postgres_exporter'` → t):
 * role nemá heslo, exporter (observability) se nepřihlásí, metriky Postgresu nejdou.
 * set-passwords.sh heslo nastaví jen při inicializaci prázdného datového adresáře
 * (role tehdy neexistuje, zakládá ji až heals.sql) a slibuje „set on next boot …
 * via the entrypoint wrapper" — wrapper to nedělal a službě `db` se proměnná ani
 * nepředávala.
 *
 * ⭐ Brána SPOUŠTÍ skutečný wrapper s podvrženým postgresem a čte SQL, které by
 * re-applier poslal databázi (lib/postgres-wrapper-sql.ts). Že SQL při neexistující
 * roli neselže a při existující heslo opravdu nastaví, měří DB test
 * src/tests/db/postgres-exporter-heslo.test.ts nad skutečným Postgresem.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { exporterRadky, sqlZWrapperu } from "./lib/postgres-wrapper-sql";

const ROOT = resolve(__dirname, "../../..");
const HESLO = "exp'orter-heslo-brany";

describe("postgres_exporter dostane heslo při každém startu (brána)", () => {
  test("⛔ s heslem: re-apply SQL nastaví heslo exporteru, podmíněně existencí role, s ošetřeným apostrofem", () => {
    const { sql, vystup } = sqlZWrapperu(ROOT, { POSTGRES_EXPORTER_PASSWORD: HESLO });
    expect(sql, `re-applier nic neposlal:\n${vystup}`).toContain("ALTER ROLE aisha_admin");
    const radky = exporterRadky(sql);
    const alter = radky.filter((r) => /ALTER ROLE postgres_exporter WITH PASSWORD/.test(r));
    expect(alter, "re-apply SQL heslo exporteru nenastavuje").toHaveLength(1);
    expect(alter[0]).toMatch(/WHERE EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'postgres_exporter'\)/);
    expect(alter[0]).toMatch(/\\gexec\s*$/);
    expect(alter[0], "apostrof v hesle není zdvojený — SQL by se rozbilo").toContain("exp''orter-heslo-brany");
    expect(vystup).toContain("ENTRYPOINT-START");
  });

  test("bez hesla: žádné ALTER exporteru, ale hlasitá vada tam, kde role existuje", () => {
    const { sql } = sqlZWrapperu(ROOT, {});
    const radky = exporterRadky(sql);
    expect(radky.some((r) => /ALTER ROLE postgres_exporter/.test(r))).toBe(false);
    expect(radky.some((r) => /POSTGRES_EXPORTER_PASSWORD není doručené/.test(r) && /WHERE EXISTS/.test(r))).toBe(true);
  });

  test("služba db v core compose proměnnou dostane — bez `:?` (tajemství nepatří do buildu)", () => {
    // `${X:?}` v compose udělá z klíče build-time argument → hodnota v `docker history`
    // (brána build-time-mnozina-vsech-compose, 2026-08-16). Pojistka proti prázdnu je
    // U SPOTŘEBY: wrapper tam, kde role existuje, prázdnou hodnotu hlasitě ohlásí (test výš).
    const core = parseYaml(readFileSync(join(ROOT, "docker-compose.coolify.yml"), "utf8"), { merge: true }) as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    expect(String(core.services.db?.environment?.POSTGRES_EXPORTER_PASSWORD ?? "")).toBe("${POSTGRES_EXPORTER_PASSWORD}");
    const obs = readFileSync(join(ROOT, "docker-compose.coolify-observability.yml"), "utf8");
    expect(obs).toContain("postgres_exporter:${POSTGRES_EXPORTER_PASSWORD}@");
  });
});
