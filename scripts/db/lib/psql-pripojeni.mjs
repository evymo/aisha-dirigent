/**
 * Heslo databáze NEPATŘÍ do argv psql.
 *
 * ⛔ NÁLEZ 2026-09-23 (obhlídka forku, řádek z logu kontejneru migrate):
 *     ❌ Seed failed: Command failed: psql postgresql://aisha_admin:<HESLO>@…-db:5432/postgres …
 * `execFileSync` při selhání skládá `error.message` z CELÉHO příkazu. Adresa
 * s heslem v argv tak skončila ve výpisu chyby — a entrypoint migrate ukládá
 * konec výpisu do `public.migration_log_dump`, kterou čte i `anon` přes veřejné
 * PostgREST (záměrný kanál cold-startu, viz sql/grants/migration_log_dump_jen_cteni.sql).
 * Heslo administrátorské role DB tím bylo čitelné bez přihlášení.
 *
 * Argv navíc vidí každý proces v kontejneru (`ps`). Heslo proto jde psql
 * prostředím (`PGPASSWORD`, libpq ho čte, když URL heslo nenese) a do argv jen
 * adresa bez něj. Cíl spojení se nemění: stejný uživatel, host, port, databáze
 * i parametry (sslmode …).
 *
 * @module
 */

const SCHEMA_URL = /^postgres(?:ql)?:\/\//i;

/**
 * Rozdělí připojení na cíl pro argv (bez hesla) a prostředí s heslem.
 *
 * @param {string} pripojeni  `postgresql://user:pass@host:port/db?…`
 * @param {NodeJS.ProcessEnv} [zaklad]  prostředí, do kterého se heslo přidá
 * @returns {{ cil: string, env: NodeJS.ProcessEnv }}
 */
export function psqlPripojeni(pripojeni, zaklad = process.env) {
  if (typeof pripojeni !== "string" || pripojeni === "") {
    throw new Error("psqlPripojeni: připojení k DB chybí — adresa se nehádá");
  }
  if (!SCHEMA_URL.test(pripojeni)) {
    // conninfo `host=… password=…` by heslo do argv poslal taky. Rozebírat ho
    // tu nebudeme (druhý parser libpq by se s prvním rozešel) — odmítnout.
    if (/\bpassword\s*=/i.test(pripojeni)) {
      throw new Error(
        "psqlPripojeni: conninfo s password= by heslo poslal do argv psql — předej adresu jako postgresql://…",
      );
    }
    return { cil: pripojeni, env: { ...zaklad } };
  }

  const u = new URL(pripojeni);
  const env = { ...zaklad };
  if (u.password) {
    env.PGPASSWORD = decodeURIComponent(u.password);
    u.password = "";
  }
  // Heslo smí stát i v parametrech URI (`?password=…`) — libpq ho tam čte taky.
  if (u.searchParams.has("password")) {
    env.PGPASSWORD = u.searchParams.get("password") ?? "";
    u.searchParams.delete("password");
  }
  return { cil: u.toString(), env };
}

/**
 * Zamaskuje heslo v adresách postgres:// uvnitř libovolného textu.
 * Pojistka pro výpisy, které se někam UKLÁDAJÍ — oprava je `psqlPripojeni`,
 * tohle jen chytá, co by přišlo odjinud. Bere se až k POSLEDNÍMU `@` v tokenu:
 * heslo s nezakódovaným `@` by jinak z poloviny zůstalo vidět.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function bezHesla(text) {
  return String(text ?? "").replace(/(postgres(?:ql)?:\/\/[^:/@\s]+:)\S*@/gi, "$1***@");
}
