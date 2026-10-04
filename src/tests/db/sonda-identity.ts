/**
 * Sonda identity — zavolá SQL jako konkrétní volající.
 *
 * Spojení testů je superuser, takže dotaz bez `SET ROLE` neřekne o nároku
 * NIC: granty ani RLS na superusera neplatí. Sonda proto nastaví obojí, co
 * PostgREST nastaví skutečnému požadavku: DB roli (granty, RLS) a
 * `request.jwt.claims` (z nich čtou `auth.uid()` a `is_service_role()`).
 *
 * `fixtura` je jediná cesta, která roli NEpřepíná — zakládá data, ke kterým
 * žádná klientská role přístup mít nemá (aisha_auth.users).
 */
import { execFileSync } from "node:child_process";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER } from "./test-env-probe";

export type Identita =
  | { role: "service_role" }
  | { role: "authenticated"; sub: string }
  | { role: "anon" };

export const SLUZBA: Identita = { role: "service_role" };
export const ANON: Identita = { role: "anon" };
export const prihlaseny = (sub: string): Identita => ({ role: "authenticated", sub });

const claims = (i: Identita) =>
  JSON.stringify(i.role === "authenticated" ? { role: i.role, sub: i.sub } : { role: i.role });

function psql(input: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-qtA"],
    { input, encoding: "utf-8", timeout: 30000, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

/** Výstup posledního příkazu jako text. Chyba DB = výjimka, zápis se potvrdí. */
export function jako(i: Identita, sql: string): string {
  return psql(
    `\\o /dev/null\nBEGIN;\nSET LOCAL ROLE ${i.role};\n` +
      `SELECT set_config('request.jwt.claims', '${claims(i)}', true);\n\\o\n${sql};\nCOMMIT;\n`,
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

/** Zakládání dat jako superuser se službou v claims (bez SET ROLE). */
export function fixtura(sql: string): string {
  return psql(
    `\\o /dev/null\nSELECT set_config('request.jwt.claims', '${claims(SLUZBA)}', false);\n\\o\n${sql};\n`,
  );
}
