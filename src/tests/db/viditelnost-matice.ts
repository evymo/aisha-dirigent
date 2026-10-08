/**
 * Společný harness matic viditelnosti (cesta × identita × sonda) nad skutečnou databází.
 *
 * Používají ho src/tests/db/znalosti-viditelnost-cesta-identita.runtime.test.ts (znalosti) a
 * src/tests/db/pravidla-viditelnost-cesta-identita.runtime.test.ts (expertní pravidla).
 *
 * Pravidlo majitele (HARD, 2026-10-04): nepřihlášený vidí jen `public`; `members` jen přihlášený.
 * Gilda (rozhodnutí majitele 2026-10-05, G1): jen kdo je SCHVÁLENÝ konzultant studie
 * (study_consultants.status = 'approved') A má partner_profiles.is_certified (řídí správa).
 * Identity proto pokrývají i hranu gildy: vlastní profil partnera bez schválení (NEVIDÍ), schválený
 * konzultant bez certifikace (NEVIDÍ), schválený a certifikovaný (VIDÍ — kotva).
 *
 * Měří se pod rolí API (SET ROLE + značky JWT), ne pod vlastníkem. Každá identita = jedno spojení,
 * každá cesta = jeden blok DO, každá sonda v něm vlastní podtransakci: odepřené právo (42501) je
 * výsledek „odepreno“, jiná chyba test shodí (v režimu měření ZKV_MERENI=1 se zapíše jako „chyba …“).
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER } from "./test-env-probe";

export const MERENI = process.env.ZKV_MERENI === "1";

const ARGS = ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-q"];
const ENV = { ...process.env, PGPASSWORD: PG_PASSWORD };

export function psql(sql: string): { kod: number; vystup: string; chyba: string } {
  const r = spawnSync("psql", ARGS, { input: sql, encoding: "utf-8", env: ENV, maxBuffer: 64 * 1024 * 1024 });
  return { kod: r.status ?? -1, vystup: (r.stdout ?? "").trim(), chyba: r.stderr ?? "" };
}

export function psqlOk(sql: string): string {
  const r = psql(sql);
  if (r.kod !== 0) throw new Error(`psql selhal (${r.kod}): ${r.chyba.slice(0, 2000)}`);
  return r.vystup;
}

export type Kdo = "anon" | "prihlaseny" | "profil" | "konzultant" | "gilda" | "vlastnik" | "ucastnik" | "autor" | "sprava";
export const KDO: Kdo[] = ["anon", "prihlaseny", "profil", "konzultant", "gilda", "vlastnik", "ucastnik", "autor", "sprava"];
/** Kdo smí do příběhu sond (vlastník, účastník, správa). */
export const S_PRISTUPEM: Kdo[] = ["vlastnik", "ucastnik", "sprava"];

/** Viditelnost štítku pro identitu — pravidlo majitele psané nezávisle na SQL (správu a autora řeší volající). */
export function stitekPro(vis: string, kdo: Kdo): 0 | 1 {
  if (kdo === "sprava") return 1;
  if (vis === "public") return 1;
  if (vis === "members") return kdo === "anon" ? 0 : 1;
  if (vis === "guild") return kdo === "gilda" ? 1 : 0;
  return 0;
}

export type Identity = {
  U: Record<Kdo, string | null>;
  /** id profilu partnera autora pravidel */
  autorPartner: string;
  pribeh: string;
  sql: string;
  uklid: string;
};

/** Uživatelé, role, profily partnera, studie se schválenými konzultanty, příběh s vlastníkem a účastníkem. */
export function vytvorIdentity(beh: string): Identity {
  const U = Object.fromEntries(KDO.map((k) => [k, k === "anon" ? null : randomUUID()])) as Record<Kdo, string | null>;
  const studie = randomUUID();
  const pribeh = randomUUID();
  const pp = { profil: randomUUID(), konzultant: randomUUID(), gilda: randomUUID(), autor: randomUUID() };
  const uzivatele = KDO.filter((k) => U[k]).map((k) => `('${U[k]}', 'zkvid-${k}-${beh}@test.local')`);
  const sql = `
INSERT INTO aisha_auth.users (id, email) VALUES ${uzivatele.join(", ")};
INSERT INTO public.user_roles (user_id, role) VALUES ('${U.sprava}', 'admin');
INSERT INTO public.partner_profiles (id, user_id, display_name, city, is_certified) VALUES
  ('${pp.profil}', '${U.profil}', 'ZKV profil ${beh}', 'Brno', false),
  ('${pp.konzultant}', '${U.konzultant}', 'ZKV konzultant ${beh}', 'Brno', false),
  ('${pp.gilda}', '${U.gilda}', 'ZKV gilda ${beh}', 'Brno', true),
  ('${pp.autor}', '${U.autor}', 'ZKV autor ${beh}', 'Brno', false);
INSERT INTO public.studies (id, code, name, study_type) VALUES ('${studie}', 'zkvid-${beh}', 'ZKV studie ${beh}', 'community');
INSERT INTO public.study_consultants (study_id, partner_id, status) VALUES
  ('${studie}', '${pp.konzultant}', 'approved'), ('${studie}', '${pp.gilda}', 'approved'), ('${studie}', '${pp.profil}', 'pending');
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${pribeh}', 'ZKV příběh ${beh}', '${U.vlastnik}');
INSERT INTO public.story_participants (story_id, user_id, role) VALUES ('${pribeh}', '${U.ucastnik}', 'partner');`;
  const ids = KDO.filter((k) => U[k]).map((k) => `'${U[k]}'`).join(", ");
  const uklid = `
DELETE FROM public.story_participants WHERE story_id = '${pribeh}';
DELETE FROM public.partner_stories WHERE id = '${pribeh}';
DELETE FROM public.study_consultants WHERE study_id = '${studie}';
DELETE FROM public.studies WHERE id = '${studie}';
DELETE FROM public.partner_profiles WHERE user_id IN (${ids});
DELETE FROM public.user_roles WHERE user_id IN (${ids});
DELETE FROM aisha_auth.users WHERE id IN (${ids});`;
  return { U, autorPartner: pp.autor, pribeh, sql, uklid };
}

/** Relace identity pro cesty, které volá ona sama (role API + značky JWT). */
export function relace(kdo: Kdo, U: Record<Kdo, string | null>): string {
  const sub = U[kdo];
  const role = kdo === "anon" ? "anon" : "authenticated";
  return `RESET ROLE; SELECT set_config('request.jwt.claims', '${JSON.stringify(sub ? { role, sub } : { role })}', false);
SELECT set_config('request.jwt.claim.sub', '${sub ?? ""}', false); SET ROLE ${role};`;
}

export const SLUZBA = `RESET ROLE; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE service_role;`;

/** Publikum identity jako argument SQL (anonym = bez identity). */
export const publikum = (kdo: Kdo, U: Record<Kdo, string | null>) => (U[kdo] ? `'${U[kdo]}'::uuid` : "NULL::uuid");

export type Cesta<S> = {
  jmeno: string;
  /** Kdo volá: identita sama (role), nebo služba ZA identitu. */
  jako: "role" | "sluzba";
  sondy: (s: S) => boolean;
  /** Dotaz, který do proměnné n uloží 0/1 (najde sondu). */
  sql: (s: S, kdo: Kdo) => string;
};

/** Jeden blok DO na cestu, podtransakce na sondu: 42501 = „odepreno“, jiná chyba test shodí (v režimu měření se zapíše). */
function blok<S extends { klic: string }>(c: Cesta<S>, sondy: S[], kdo: Kdo, U: Record<Kdo, string | null>): string {
  const telo = sondy
    .filter(c.sondy)
    .map(
      (s) => `  BEGIN
    ${c.sql(s, kdo)};
    RAISE NOTICE 'ZKV|%|%|%', '${c.jmeno}', '${s.klic}', n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ZKV|%|%|odepreno', '${c.jmeno}', '${s.klic}';${
      MERENI
        ? `
  WHEN OTHERS THEN
    RAISE NOTICE 'ZKV|%|%|chyba %', '${c.jmeno}', '${s.klic}', SQLSTATE;`
        : ""
    }
  END;`,
    )
    .join("\n");
  return `${c.jako === "role" ? relace(kdo, U) : SLUZBA}
DO $zkv$
DECLARE n bigint;
BEGIN
${telo}
END $zkv$;`;
}

/** Změř všechny cesty pro identitu: mapa „cesta|sonda“ → "0" | "1" | "odepreno" (| "chyba …" v režimu měření). */
export function zmer<S extends { klic: string }>(cesty: Cesta<S>[], sondy: S[], kdo: Kdo, U: Record<Kdo, string | null>): Record<string, string> {
  const r = psql(cesty.map((c) => blok(c, sondy, kdo, U)).join("\n"));
  if (r.kod !== 0) throw new Error(`${kdo}: měření spadlo jinou chybou než odepřeným právem:\n${r.chyba.slice(-3000)}`);
  const out: Record<string, string> = {};
  for (const m of r.chyba.matchAll(/ZKV\|([^|\n]+)\|([a-z0-9]+)\|([^\n]+)/g)) out[`${m[1]}|${m[2]}`] = m[3].trim();
  return out;
}

/** Matice pro režim měření (tabulka před/po bez tvrzení). */
export function maticeText<S extends { klic: string }>(cesty: Cesta<S>[], sondy: S[], namereno: Partial<Record<Kdo, Record<string, string>>>): string {
  const radky: string[] = [`cesta | sonda | ${KDO.join(" | ")}`];
  for (const c of cesty) for (const s of sondy.filter(c.sondy)) radky.push(`${c.jmeno} | ${s.klic} | ${KDO.map((k) => namereno[k]?.[`${c.jmeno}|${s.klic}`] ?? "—").join(" | ")}`);
  return `ZKV-MATICE\n${radky.join("\n")}\nZKV-KONEC`;
}
