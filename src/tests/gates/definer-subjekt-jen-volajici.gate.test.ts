/**
 * Brána: SECURITY DEFINER funkce, která bere SUBJEKT (uuid osoby), odpovídá jen
 * o VOLAJÍCÍM — nebo se sama ptá, kdo volá.
 *
 * VZNIKLA Z ŽIVÉHO NÁLEZU (guru, 2026-09-19). Katalogový dotaz nad produkcí —
 * schéma public, `prosecdef`, argument user/uid/subject typu uuid, EXECUTE pro
 * anon nebo authenticated — vrátil ~60 funkcí a PostgREST je všechny vystavuje
 * jako `/rpc/<jméno>`. `has_role` s VEŘEJNÝM anon klíčem a náhodným uuid
 * odpověděl 200. Predikát, který pravdivě odpovídá o CIZÍM účtu, je orákulum:
 * `is_story_participant(X, S)` složí graf spoluprací, `has_data_sharing_consent`
 * prozradí, kdo je čím klientem (a navíc zapsal audit pod cizím jménem),
 * `user_has_admin_role` / `is_user_admin` vydají seznam administrátorů.
 *
 * ⭐ PROČ TO ŽÁDNÁ BRÁNA NEŘEKLA. `idor-prevention` bere jen `p_user_id` a
 * booleovské predikáty (`is_/has_/can_/check_`, RETURNS boolean) VÝSLOVNĚ
 * vynechává („leak at most one bit"). Jenže jeden bit na dotaz × libovolný
 * počet dotazů = celá odpověď. `access.mjs` (SEC_DEF_NO_AUTH) se spokojí
 * s tím, že soubor někde zmiňuje `auth.uid()` — i v komentáři nebo ve
 * `COALESCE(p_user_id, auth.uid())`, kde parametr vyhrává.
 *
 * CO BRÁNA MĚŘÍ (staticky nad SoT — CI v lane test:gates živou DB nemá):
 *   univerzum = funkce v `aisha/db/sql/**` ve schématu public, které jsou
 *     SECURITY DEFINER, nejsou trigger, mají parametr typu uuid/uuid[]
 *     pojmenovaný user/uid/subject, a podle GRANT/REVOKE v SoT je smí spustit
 *     PUBLIC, anon nebo authenticated (bez `REVOKE … FROM PUBLIC` platí
 *     výchozí EXECUTE pro PUBLIC).
 *   stráž = tělo (BEZ komentářů) se na volajícího ptá jedním z tvarů:
 *     1. každý subjektový parametr je porovnán s volajícím
 *        (`= / <> / IS [NOT] DISTINCT FROM` proti `auth.uid()` nebo proměnné
 *        z něj naplněné), nebo
 *     2. auth-first `COALESCE(auth.uid(), p_x)` — JEN když funkce není
 *        vystavená anonymovi (anon má uid NULL, takže by vyhrál parametr), nebo
 *     3. tělo se ptá na roli VOLAJÍCÍHO: `is_service_role()`,
 *        `is_admin_or_staff()` bez argumentu / s volajícím, `get_jwt_role()`,
 *        `auth.role()`, `current_setting('role')`, `has_role(<volající>, …)`, nebo
 *     4. deny-stráž přes pojmenovaného delegáta vztahu (`IF NOT delegát(p_x)
 *        THEN RAISE`), který sám váže subjekt na volajícího.
 *   Co stráž nemá a není ve výjimkách → červená. Výjimka, která stráž mezitím
 *   dostala (nebo zmizela), je zastaralá → červená.
 *
 * ⛔ HRANICE MĚŘIDLA (napsané, ne zamlčené): tvar 3 pozná, ŽE se funkce ptá na
 * roli, ne CO s odpovědí udělá. Stráž „přihlášen, nebo služba" (fn_create_
 * workflow_run: `auth.uid() IS NULL AND role != service_role → RAISE`) projde,
 * i když přihlášený pak jedná za cizí actor_user_id. Proto u opravených funkcí
 * drží CHOVÁNÍ runtime sonda `src/tests/db/definer-subjekt-jen-volajici.runtime
 * .test.ts` (npm run test:db:subjekt) — anonym, cizí přihlášený, vlastník,
 * služba, správa + RLS legitimního volajícího nad throwaway DB.
 *
 * Mutačně ověřeno 2026-09-19: vrácení stráže (soubor z origin/main) v KAŽDÉM ze
 * 13 opravených SoT souborů → červená se jménem funkce; vyjmutí výjimky has_role →
 * červená; výjimka u opravené funkce → červená (zastaralá); has_role/has_permission
 * z forku (eb1a84e3e) → zelená třída + červená „zastaralé fork-pr-339" (brána
 * tak po sloučení forkového PR vynutí úklid výjimek — stalo se 2026-09-23 po #1045:
 * has_role, has_permission, is_story_partner pryč, strop dluhu 13 → 10). Stráž jen v komentáři a
 * `COALESCE(p_user_id, auth.uid())` drží kontrolní vzorky přímo v testu.
 *
 * Spouští se přes: npm run test:gates -- definer-subjekt-jen-volajici
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SQL_ROOT = join(ROOT, 'aisha/db/sql');
/**
 * Kde SoT nese definice funkcí a GRANT/REVOKE nad nimi. Změřeno 2026-09-19
 * (`CREATE FUNCTION` | `ON FUNCTION`): functions 1691/1691, grants 3, tables 1,
 * triggers 2 — policies, rls, indexes, enums, views, storage, constraints 0.
 * Čte se JEN tady (2 832 z 5 086 souborů), a to asynchronně v beforeAll:
 * synchronní čtení celého stromu trvalo pod zátěží 25 s (profil: 98 % readFileUtf8)
 * a blokovalo event loop workeru — vitest pak nestihl `onTaskUpdate` a lehká
 * dráha skončila jako NEZMĚŘENO. Funkci přestěhovanou jinam by brána neviděla —
 * proto kontrolní test „univerzum > 60" a tenhle komentář.
 */
const DOMOVY = ['functions', 'grants', 'tables', 'triggers'];
const SOUBEZNE_CTENI = 64;
const ALLOWLIST_PATH = join(ROOT, 'src/tests/gates/definer-subjekt-jen-volajici.allowlist.json');

/** Jméno parametru, které nese identitu osoby (user / uid / subject jako celé slovo). */
const SUBJEKT = /(^|_)(user|uid|subject)(_|s?$)/i;
/** Role, přes které se na funkci dostane PostgREST klient. */
const VYSTAVENO = new Set(['public', 'anon', 'authenticated']);
/** Delegáti vztahu: sami váží subjekt na volajícího (měřeno čtením těl). */
const DELEGATI = ['audience_user_can_see_creator_stats', 'audience_user_can_access_via_profile'];
const KATEGORIE = new Set(['zamer', 'vztah', 'k-revizi']);

interface Param { name: string; type: string }
interface Definice { soubor: string; jmeno: string; params: Param[]; typy: string; definer: boolean; trigger: boolean; telo: string }
interface Acl { druh: 'GRANT' | 'REVOKE'; jmeno: string; typy: string | null; role: string[] }
interface Vyjimka { name: string; kategorie: string; reason: string }

/** Odstraní SQL komentáře — prosa o stráži nesmí stráž splnit. */
function bezKomentaru(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

function projdi(dir: string): string[] {
  let out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out = out.concat(projdi(p));
    else if (f.endsWith('.sql')) out.push(p);
  }
  return out.sort();
}

/** První token argumentu je CELÝ typ (ne jméno, které typem jen začíná — `date_from date`). */
const ZACATEK_TYPU =
  /^(?:(?:uuid|text|int[248]?|integer|bigint|smallint|boolean|bool|jsonb?|numeric|decimal|real|double|float[48]?|timestamptz|timestamp|date|timetz|time|interval|character|char|varchar|bytea|inet|anyelement|anyarray|regclass|oid|record|vector)(?:\[\]|\(.*)?$|public\.)/i;

function normTyp(t: string): string {
  return t
    .toLowerCase()
    .replace(/"/g, '')
    .replace(/^public\./, '')
    // Typmod do identity funkce nepatří: vector(1024) = vector, numeric(10,2) = numeric.
    .replace(/\(\s*\d+\s*(,\s*\d+\s*)?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(int4|int)$/, 'integer')
    .replace(/^int8$/, 'bigint')
    .replace(/^bool$/, 'boolean')
    .replace(/^timestamp with time zone$/, 'timestamptz')
    .replace(/^character varying(\(\d+\))?$/, 'varchar')
    .replace(/^varchar\(\d+\)$/, 'varchar');
}

function rozdelNaNejvyssiUrovni(s: string): string[] {
  const out: string[] = [];
  let hloubka = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') hloubka++;
    if (ch === ')') hloubka--;
    if (ch === ',' && hloubka === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Vstupní parametry signatury (OUT se do identity funkce nepočítá). */
function parametry(sig: string): Param[] {
  return rozdelNaNejvyssiUrovni(sig)
    .map((a) => {
      let arg = a.replace(/\s+(DEFAULT|=)\s+[\s\S]*$/i, '').trim();
      let mod = 'in';
      const m = arg.match(/^(IN|OUT|INOUT|VARIADIC)\s+/i);
      if (m) {
        mod = m[1].toLowerCase();
        arg = arg.slice(m[0].length);
      }
      const tok = arg.split(/\s+/);
      const bezJmena = tok.length === 1 || ZACATEK_TYPU.test(tok[0]);
      return {
        mod,
        name: bezJmena ? '' : tok[0].replace(/"/g, ''),
        type: normTyp(bezJmena ? arg : tok.slice(1).join(' ')),
      };
    })
    .filter((p) => p.mod !== 'out')
    .map(({ name, type }) => ({ name, type }));
}

/** Definice funkcí public.* a GRANT/REVOKE nad funkcemi z jednoho SQL textu. */
function rozparsuj(sql: string, soubor: string): { definice: Definice[]; acl: Acl[] } {
  const cisty = bezKomentaru(sql);
  const acl: Acl[] = [];
  const reAcl =
    /\b(GRANT|REVOKE)\s+[^;]*?\s+ON\s+FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*(\(([^;]*?)\))?\s+(TO|FROM)\s+([^;]*);/gi;
  let a: RegExpExecArray | null;
  while ((a = reAcl.exec(cisty))) {
    acl.push({
      druh: a[1].toUpperCase() as 'GRANT' | 'REVOKE',
      jmeno: a[2].toLowerCase(),
      typy: a[4] !== undefined ? parametry(a[4]).map((p) => p.type).join(',') : null,
      role: a[6].split(',').map((r) => r.trim().toLowerCase().replace(/\s+(cascade|restrict)$/, '')),
    });
  }
  const definice: Definice[] = [];
  const reFn = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?\w+"?\.)?)"?(\w+)"?\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = reFn.exec(cisty))) {
    const schema = m[1].replace(/[".]/g, '').toLowerCase();
    if (schema && schema !== 'public') continue;
    let i = reFn.lastIndex;
    let hloubka = 1;
    const start = i;
    while (hloubka > 0 && i < cisty.length) {
      if (cisty[i] === '(') hloubka++;
      else if (cisty[i] === ')') hloubka--;
      i++;
    }
    const params = parametry(cisty.slice(start, i - 1));
    const zbytek = cisty.slice(i);
    const tag = zbytek.match(/\bAS\s+(\$\w*\$)/i);
    if (!tag || tag.index === undefined) continue;
    const zacatekTela = tag.index + tag[0].length;
    const konecTela = zbytek.indexOf(tag[1], zacatekTela);
    const telo = zbytek.slice(zacatekTela, konecTela);
    // Atributy smějí stát i ZA tělem (`$$ LANGUAGE plpgsql SECURITY DEFINER;`).
    const zaTelem = zbytek.slice(konecTela + tag[1].length).split(';')[0];
    const hlavicka = zbytek.slice(0, tag.index) + ' ' + zaTelem;
    definice.push({
      soubor,
      jmeno: m[2].toLowerCase(),
      params,
      typy: params.map((p) => p.type).join(','),
      definer: /SECURITY\s+DEFINER/i.test(hlavicka),
      trigger: /RETURNS\s+(event_)?trigger\b/i.test(hlavicka),
      telo,
    });
  }
  return { definice, acl };
}

/** Role z {public, anon, authenticated}, které smějí funkci spustit (pořadí příkazů = pořadí v SoT). */
function vystaveni(d: Pick<Definice, 'jmeno' | 'typy'>, acl: Acl[]): string[] {
  const role = new Set(['public']); // výchozí EXECUTE pro PUBLIC, dokud ho nikdo neodebere
  for (const a of acl) {
    if (a.jmeno !== d.jmeno || (a.typy !== null && a.typy !== d.typy)) continue;
    for (const r of a.role) {
      if (a.druh === 'GRANT') role.add(r);
      else role.delete(r);
    }
  }
  return [...role].filter((r) => VYSTAVENO.has(r));
}

function volajici(telo: string): string[] {
  const promenne = new Set<string>([String.raw`auth\.uid\(\)`]);
  const re = /\b(\w+)\s+(?:uuid\s*)?(?::=|DEFAULT)\s*(?:\(\s*SELECT\s+)?auth\.uid\(\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(telo))) promenne.add(m[1]);
  const re2 = /\b(\w+)\s*:=\s*(?:\(\s*SELECT\s+)?auth\.uid\(\)/gi;
  while ((m = re2.exec(telo))) promenne.add(m[1]);
  return [...promenne];
}

const OP = String.raw`(?:=|<>|!=|IS\s+(?:NOT\s+)?DISTINCT\s+FROM)`;

/** Jakou stráž volajícího tělo nese — nebo null. */
function straz(d: Pick<Definice, 'telo'>, subjekty: string[], anonMa: boolean): string | null {
  const t = d.telo;
  const vol = volajici(t).join('|');
  const role = new RegExp(
    String.raw`\bis_service_role\s*\(\s*\)|\bis_admin_or_staff\s*\(\s*(?:${vol})?\s*\)|\bget_jwt_role\s*\(\s*\)` +
      String.raw`|\bauth\.role\s*\(\s*\)|current_setting\s*\(\s*'role'|request\.jwt\.claim|\bhas_role\s*\(\s*(?:${vol})\s*,`,
    'i',
  );
  const vazany = (p: string): string | null => {
    if (new RegExp(String.raw`\b${p}\b\s*${OP}\s*(?:\(\s*SELECT\s+)?(?:${vol})`, 'i').test(t)) return 'porovnání';
    if (new RegExp(String.raw`(?:${vol})\s*\)?\s*${OP}\s*\b${p}\b`, 'i').test(t)) return 'porovnání';
    if (!anonMa && new RegExp(String.raw`COALESCE\s*\(\s*auth\.uid\(\)\s*,\s*${p}\b`, 'i').test(t)) return 'auth-first';
    const delegat = new RegExp(String.raw`IF\s+NOT\s+(?:public\.)?(?:${DELEGATI.join('|')})\s*\(\s*${p}\b[^;]*?THEN\s+RAISE`, 'i');
    if (delegat.test(t)) return 'delegát';
    return null;
  };
  const zpusoby = subjekty.map(vazany);
  if (zpusoby.every((z) => z !== null)) return [...new Set(zpusoby)].join('+');
  if (role.test(t)) return 'role volajícího';
  return null;
}

interface Nalez { jmeno: string; typy: string; soubor: string; subjekty: string[]; role: string[]; straz: string | null }

/** Celé univerzum třídy nad domovy funkcí v SoT (čtení neblokuje worker). */
async function zmer(sqlRoot: string): Promise<Nalez[]> {
  const soubory = DOMOVY.map((d) => join(sqlRoot, d))
    .filter((d) => existsSync(d))
    .flatMap((d) => projdi(d));
  const texty: string[] = new Array(soubory.length);
  for (let i = 0; i < soubory.length; i += SOUBEZNE_CTENI) {
    const davka = soubory.slice(i, i + SOUBEZNE_CTENI);
    const obsah = await Promise.all(davka.map((f) => readFile(f, 'utf8')));
    obsah.forEach((t, j) => {
      texty[i + j] = t;
    });
  }
  const definice: Definice[] = [];
  const acl: Acl[] = [];
  soubory.forEach((soubor, i) => {
    const r = rozparsuj(texty[i], relative(ROOT, soubor));
    definice.push(...r.definice);
    acl.push(...r.acl);
  });
  const nalezy: Nalez[] = [];
  for (const d of definice) {
    if (!d.definer || d.trigger) continue;
    const subjekty = d.params.filter((p) => p.type.startsWith('uuid') && SUBJEKT.test(p.name)).map((p) => p.name);
    if (subjekty.length === 0) continue;
    const role = vystaveni(d, acl);
    if (role.length === 0) continue;
    const anonMa = role.includes('anon') || role.includes('public');
    nalezy.push({ jmeno: d.jmeno, typy: d.typy, soubor: d.soubor, subjekty, role, straz: straz(d, subjekty, anonMa) });
  }
  return nalezy;
}

function nactiVyjimky(): Vyjimka[] {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  return (JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as { vyjimky: Vyjimka[] }).vyjimky ?? [];
}

describe('SECURITY DEFINER se subjektem odpovídá jen o volajícím', () => {
  let nalezy: Nalez[] = [];
  let bezStraze: Nalez[] = [];
  const vyjimky = nactiVyjimky();

  beforeAll(async () => {
    nalezy = existsSync(SQL_ROOT) ? await zmer(SQL_ROOT) : [];
    bezStraze = nalezy.filter((n) => n.straz === null);
  });

  test('měřidlo má co měřit (SoT existuje a univerzum třídy není prázdné)', () => {
    // Živý katalog guru vrátil ~60; SoT nese i funkce, které guru nemá, a
    // přetížení počítá zvlášť. Pod 60 by znamenalo, že se změnil idiom zápisu
    // (GRANT, jména parametrů) a brána měří vedle — ne že je třída čistá.
    expect(nalezy.length, 'univerzum je podezřele malé — měřidlo nečte SoT, jak si myslí').toBeGreaterThan(60);
    expect(
      nalezy.filter((n) => n.straz !== null).length,
      'žádná strážená funkce — rozpoznání stráže je rozbité, ne třída čistá',
    ).toBeGreaterThan(40);
  });

  test('kontrolní vzorky: měřidlo umí říct NE i ANO', () => {
    const vzorek = (telo: string, grant = 'authenticated') =>
      zmerVzorek(
        `CREATE OR REPLACE FUNCTION public.vzorek(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $f$ ${telo} $f$;\n` +
          `REVOKE ALL ON FUNCTION public.vzorek(uuid) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public.vzorek(uuid) TO ${grant};`,
      );
    // Orákulum bez stráže.
    expect(vzorek('SELECT EXISTS (SELECT 1 FROM t WHERE user_id = p_user_id)')?.straz).toBeNull();
    // Stráž jen v komentáři NENÍ stráž.
    expect(vzorek('-- IF p_user_id IS DISTINCT FROM auth.uid() THEN RETURN false\n SELECT true')?.straz).toBeNull();
    // Parametr vyhrává nad JWT = orákulum, i když auth.uid() v těle je.
    expect(vzorek('SELECT EXISTS (SELECT 1 FROM t WHERE user_id = COALESCE(p_user_id, auth.uid()))')?.straz).toBeNull();
    // Auth-first chrání přihlášeného, anonyma ne (uid NULL → vyhraje parametr).
    expect(vzorek('SELECT EXISTS (SELECT 1 FROM t WHERE user_id = COALESCE(auth.uid(), p_user_id))')?.straz).toBe('auth-first');
    expect(vzorek('SELECT EXISTS (SELECT 1 FROM t WHERE user_id = COALESCE(auth.uid(), p_user_id))', 'anon, authenticated')?.straz).toBeNull();
    // Stráž „ptám se o sobě" i role volajícího.
    expect(vzorek('SELECT CASE WHEN p_user_id = auth.uid() OR public.is_service_role() THEN true ELSE false END')?.straz).toBe('porovnání');
    expect(vzorek('SELECT public.is_admin_or_staff() AND true')?.straz).toBe('role volajícího');
    // Role CIZÍHO účtu stráž není.
    expect(vzorek('SELECT public.is_admin_or_staff(p_user_id)')?.straz).toBeNull();
    // Bez grantu pro klienta (jen služba) funkce do třídy nepatří.
    expect(vzorek('SELECT true', 'service_role')).toBeUndefined();
  });

  test('výjimky jsou jmenné a zdůvodněné', () => {
    expect(vyjimky.length).toBeGreaterThan(0);
    for (const v of vyjimky) {
      expect(typeof v.name, 'výjimka bez jména').toBe('string');
      expect(KATEGORIE.has(v.kategorie), `${v.name}: neznámá kategorie ${v.kategorie}`).toBe(true);
      expect(v.reason?.length ?? 0, `${v.name}: důvod musí vysvětlit, proč to není orákulum`).toBeGreaterThan(60);
    }
    // Dluh smí jen klesat. Horní mez chytí pokus „vyřešit" třídu dopsáním výjimek.
    // ⛔ Dvě meze (2026-10-05): DLUH (k-revizi = známá vada) má vlastní strop, který
    // smí jen klesat; celkový strop hlídá tiché přibývání zamer/vztah. Do té doby
    // byla jediná mez 10 společná, takže zdokumentovaný vztahový predikát
    // (is_consultant_for_user, rozhodnutí majitele) by šel přidat jen výměnou za
    // „opravu" cizí vady, nebo vůbec.
    const dluh = vyjimky.filter((v) => v.kategorie === 'k-revizi');
    expect(dluh.length, 'známých vad přibylo — oprav funkci, nezapisuj ji').toBeLessThanOrEqual(3);
    expect(vyjimky.length, 'výjimek přibylo — oprav funkci, nezapisuj ji').toBeLessThanOrEqual(11);
  });

  test('žádná vystavená definer funkce se subjektem není bez stráže volajícího', () => {
    const jmena = new Set(vyjimky.map((v) => v.name));
    const poruseni = bezStraze.filter((n) => !jmena.has(n.jmeno));
    expect(
      poruseni.map((n) => `${n.jmeno}(${n.typy}) [${n.role.join('|')}] subjekt=${n.subjekty.join('+')} — ${n.soubor}`),
      `SECURITY DEFINER funkce odpovídá o CIZÍM subjektu bez otázky, kdo se ptá.\n` +
        `PostgREST ji vystavuje jako /rpc/<jméno>, takže kdokoli s grantem se ptá na kohokoli.\n` +
        `Vzor opravy (predikát → false, zápis → RAISE 42501):\n` +
        `  IF v_uid IS NULL OR p_user_id IS DISTINCT FROM v_uid THEN\n` +
        `    IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN RETURN false; END IF;\n` +
        `  END IF;\n` +
        `LANGUAGE sql: CASE WHEN p_user_id = auth.uid() OR is_service_role() OR is_admin_or_staff() THEN … ELSE false END.\n` +
        `REVOKE řešením není, pokud funkci volá RLS politika — predikát běží právy volajícího.`,
    ).toEqual([]);
  });

  test('výjimky nejsou zastaralé (co stráž dostalo nebo zmizelo, z výjimek pryč)', () => {
    const bez = new Set(bezStraze.map((n) => n.jmeno));
    const zastarale = vyjimky.filter((v) => !bez.has(v.name));
    expect(
      zastarale.map((v) => `${v.name} [${v.kategorie}]`),
      'Tyhle výjimky už nic nevysvětlují — funkce stráž má, nebo už není vystavená. Smaž je ' +
        `z ${relative(ROOT, ALLOWLIST_PATH)}; jinak by schovaly příští regresi.`,
    ).toEqual([]);
  });
});

/** Vzorek: jedna syntetická funkce projde celým měřidlem (parse → vystavení → stráž). */
function zmerVzorek(sql: string): Nalez | undefined {
  const { definice, acl } = rozparsuj(sql, 'vzorek.sql');
  const d = definice[0];
  const subjekty = d.params.filter((p) => p.type.startsWith('uuid') && SUBJEKT.test(p.name)).map((p) => p.name);
  const role = vystaveni(d, acl);
  if (!d.definer || role.length === 0 || subjekty.length === 0) return undefined;
  const anonMa = role.includes('anon') || role.includes('public');
  return { jmeno: d.jmeno, typy: d.typy, soubor: d.soubor, subjekty, role, straz: straz(d, subjekty, anonMa) };
}
