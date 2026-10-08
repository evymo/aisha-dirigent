/**
 * Brána: výchozí hodnota parametru platí jen při ZALOŽENÍ, nikdy v aktualizaci
 *
 * VZNIKLA Z NÁLEZU (2026-10-07): `upsert_public_chat_channel` měla parametry
 * s `DEFAULT 'gpt-4o-mini'`, `DEFAULT 'draft'`, `DEFAULT ''` … a aktualizační
 * větev `model = COALESCE(p_model, model)`. COALESCE má zachovat uloženou hodnotu,
 * když volající pole neposlal — jenže neposlané pole nebylo NULL, ale VÝCHOZÍ
 * hodnota. Změna stavu kanálu z UI (posílá jen p_id + p_status) tak tiše vrátila
 * model, prompt, teplotu i typ kanálu na výchozí. Stejný tvar měly další admin
 * upserty (katalogy, webové stránky, znalosti, statická obrana).
 *
 * MECHANISMUS: PostgREST i SQL doplní vynechaný parametr jeho DEFAULTem. Pro
 * aktualizaci „neměnit, co nepřišlo“ musí být vynechaný parametr NULL; výchozí
 * hodnota patří do větve INSERT (`COALESCE(p_x, 'výchozí')`).
 *
 * CO BRÁNA HLÍDÁ: SoT funkce, kde parametr s DEFAULT ≠ NULL stojí v přiřazení
 * `sloupec = COALESCE(p_x, sloupec)`. Výjimky nejsou — oprava je vždy táž.
 *
 * Pravidlo k tomu: nový nebo změněný parametr RPC dostane DEFAULT (ať starší
 * volající nespadnou) — a když jde do aktualizační cesty, je ten DEFAULT NULL.
 * Žádná obalová funkce vedle se starou signaturou.
 *
 * Spouští se přes: npm run test:gates -- upsert-vychozi-hodnota-jen-pri-zalozeni
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, 'aisha/db/sql/functions');

/** Odstraní SQL komentáře — brána nesmí padat na příkladu v dokumentaci. */
function bezKomentaru(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/** Rozdělí seznam parametrů podle čárek mimo závorky a hranaté závorky. */
function parametry(seznam: string): string[] {
  const out: string[] = [];
  let hloubka = 0;
  let cur = '';
  for (const ch of seznam) {
    if (ch === '(' || ch === '[') hloubka++;
    if (ch === ')' || ch === ']') hloubka--;
    if (ch === ',' && hloubka === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Vrátí [funkce, parametr] pro každý parametr s DEFAULT ≠ NULL v `sloupec = COALESCE(p_x, sloupec)`. */
export function nalezy(sql: string): Array<[string, string]> {
  const telo = bezKomentaru(sql);
  const out: Array<[string, string]> = [];
  const hlavicka = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = hlavicka.exec(telo))) {
    // seznam parametrů = do odpovídající zavírací závorky
    let i = hlavicka.lastIndex;
    let hloubka = 1;
    while (i < telo.length && hloubka > 0) {
      if (telo[i] === '(') hloubka++;
      if (telo[i] === ')') hloubka--;
      i++;
    }
    const seznam = telo.slice(hlavicka.lastIndex, i - 1);
    const sDefaultem = new Set<string>();
    for (const p of parametry(seznam)) {
      const d = /^\s*(p_\w+)\s+[\s\S]+?\s+DEFAULT\s+([\s\S]+?)\s*$/i.exec(p);
      if (d && !/^null(\s*::[\s\S]*)?$/i.test(d[2].trim())) sDefaultem.add(d[1].toLowerCase());
    }
    const dalsi = telo.slice(i).search(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
    const kod = dalsi >= 0 ? telo.slice(i, i + dalsi) : telo.slice(i);
    const prirazeni = /\b(\w+)\s*=\s*COALESCE\s*\(\s*(p_\w+)(?:\s*::[\w.]+)?\s*,\s*(?:\w+\.)?(\w+)\s*\)/gi;
    let a: RegExpExecArray | null;
    const videno = new Set<string>();
    while ((a = prirazeni.exec(kod))) {
      const [, sloupec, param, zachovej] = a;
      if (sloupec.toLowerCase() !== zachovej.toLowerCase()) continue;
      const p = param.toLowerCase();
      if (sDefaultem.has(p) && !videno.has(p)) {
        videno.add(p);
        out.push([m[1], p]);
      }
    }
  }
  return out;
}

describe('výchozí hodnota parametru platí jen při založení, ne v aktualizaci', () => {
  const soubory = existsSync(FUNCTIONS_DIR) ? readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith('.sql')) : [];

  test('měřidlo má co měřit (SoT funkce existují)', () => {
    expect(soubory.length).toBeGreaterThan(100);
  });

  test('kontrolní vzorek: detektor vzor pozná, NULL default ani komentář ho nespustí', () => {
    const vadna = `CREATE OR REPLACE FUNCTION public.f(p_id uuid DEFAULT NULL, p_model text DEFAULT 'gpt-4o-mini')
      RETURNS void LANGUAGE plpgsql AS $$ BEGIN
        UPDATE t SET model = COALESCE(p_model, model) WHERE id = p_id; END $$;`;
    expect(nalezy(vadna)).toEqual([['f', 'p_model']]);
    expect(nalezy(vadna.replace("DEFAULT 'gpt-4o-mini'", 'DEFAULT NULL'))).toEqual([]);
    expect(nalezy(vadna.replace("DEFAULT 'gpt-4o-mini'", 'DEFAULT NULL::text'))).toEqual([]);
    // kvalifikovaný sloupec i přetypování parametru
    expect(nalezy(vadna.replace('COALESCE(p_model, model)', 'COALESCE(p_model::text, t.model)'))).toEqual([['f', 'p_model']]);
    // výchozí hodnota ve větvi INSERT je správně
    expect(
      nalezy(vadna.replace('UPDATE t SET model = COALESCE(p_model, model) WHERE id = p_id;', "INSERT INTO t (model) VALUES (COALESCE(p_model, 'x'));")),
    ).toEqual([]);
    // ARRAY výchozí hodnota se závorkami v seznamu parametrů
    expect(
      nalezy(vadna.replace("p_model text DEFAULT 'gpt-4o-mini'", "p_model text[] DEFAULT ARRAY['a', 'b']::text[]")),
    ).toEqual([['f', 'p_model']]);
    expect(nalezy(`-- x = COALESCE(p_model, x)\n${vadna.replace("DEFAULT 'gpt-4o-mini'", 'DEFAULT NULL')}`)).toEqual([]);
  });

  test('žádná SoT funkce nemá výchozí hodnotu v aktualizační cestě', () => {
    const vse = soubory.flatMap((f) => nalezy(readFileSync(join(FUNCTIONS_DIR, f), 'utf8')).map(([fn, p]) => `${f}: ${fn}(${p})`));
    expect(
      vse,
      'Parametr s DEFAULT ≠ NULL stojí v `sloupec = COALESCE(p_x, sloupec)` — vynechané pole by v aktualizaci ' +
        'tiše vrátilo uloženou hodnotu na výchozí. DEFAULT NULL v hlavičce, výchozí hodnota jen ve větvi INSERT.',
    ).toEqual([]);
  });
});
