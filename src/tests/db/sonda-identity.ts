/**
 * Sonda identity — zavolá SQL jako konkrétní volající.
 *
 * Spojení testů je superuser, takže dotaz bez `SET ROLE` neřekne o nároku
 * NIC: granty ani RLS na superusera neplatí. Sonda proto nastaví obojí, co
 * PostgREST nastaví skutečnému požadavku: DB roli (granty, RLS) a
 * `request.jwt.claims` (z nich čtou `auth.uid()` a `is_service_role()`).
 *
 * `fixtura` je jediná cesta, která roli NEpřepíná — zakládá data, ke kterým
 * žádná klientská role přístup mít nemá (aisha_auth.users). Volitelný `sub`
 * nastaví `auth.uid()` i superuserovi (triggery, které chtějí přihlášeného).
 */
import { execFileSync } from "node:child_process";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER } from "./test-env-probe";

export type Identita =
  | { role: "service_role" }
  | { role: "authenticated"; sub?: string }
  | { role: "anon" };

export const SLUZBA: Identita = { role: "service_role" };
export const ANON: Identita = { role: "anon" };
/** Přihlášený BEZ `sub` — token bez subjektu, auth.uid() je NULL (past `NOT (NULL)`). */
export const BEZ_SUB: Identita = { role: "authenticated" };
export const prihlaseny = (sub: string): Identita => ({ role: "authenticated", sub });

const claims = (i: Identita) =>
  JSON.stringify(i.role === "authenticated" && i.sub ? { role: i.role, sub: i.sub } : { role: i.role });

function psql(input: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-X", "-v", "ON_ERROR_STOP=1", "-qtA"],
    { input, encoding: "utf-8", timeout: 30000, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

/**
 * Výstup posledního příkazu jako text. Chyba DB = výjimka, zápis se potvrdí.
 * `pred` běží v téže transakci PŘED přepnutím role (superuser) — jen pro sondy,
 * které si potřebují dočasně (do konce transakce) změnit stav, a pak ROLLBACK.
 */
export function jako(i: Identita, sql: string, volby: { pred?: string; rollback?: boolean } = {}): string {
  return psql(
    `\\o /dev/null\nBEGIN;\n${volby.pred ? `${volby.pred};\n` : ""}SET LOCAL ROLE ${i.role};\n` +
      `SELECT set_config('request.jwt.claims', '${claims(i)}', true);\n\\o\n${sql};\n` +
      `\\o /dev/null\n${volby.rollback ? "ROLLBACK" : "COMMIT"};\n`,
  );
}

/** Pokus, který MÁ selhat: vrací text chyby, nebo 'PROSLO'. */
export function zkus(i: Identita, sql: string): string {
  try {
    jako(i, sql);
    return "PROSLO";
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return String(e.stderr || e.message || err);
  }
}

/** Zakládání dat jako superuser se službou v claims (bez SET ROLE); `sub` = auth.uid(). */
export function fixtura(sql: string, sub?: string): string {
  const c = sub ? JSON.stringify({ role: "service_role", sub }) : claims(SLUZBA);
  return psql(`\\o /dev/null\nSELECT set_config('request.jwt.claims', '${c}', false);\n\\o\n${sql};\n`);
}
