/**
 * Brána: predikát nároku patří do InitPlanu — a co se nedostane do heals, na běžící DB nevznikne
 *
 * VZNIKLA Z MĚŘENÍ (produkční instance, 2026-07-30). Tři vady, každá vlastní třídy:
 *
 * 1) RLS predikát se vyhodnocuje PER ŘÁDEK. `is_admin_or_staff()` v `USING (…)`
 *    tedy proběhla 43 157× na jeden dotaz nad li_source_registry:
 *       admin 10 405 ms · identita BEZ nároku 41 252 ms (a vrátila 0 řádků)
 *    Po obalení do poddotazu `(select f())` → InitPlan, jedno vyhodnocení:
 *       27 ms · 42 ms. Neoprávněný platil nejvíc → byla to DoS páka.
 *    POZOR: přepnout funkci na STABLE NESTAČÍ (změřeno 10 509 ms) — Postgres
 *    STABLE funkci z RLS `qual` sám nevytáhne, vytáhne jen poddotaz.
 *
 * 2) Cast na LEVÉ straně join podmínky (`li.id::text = r.source_key`) zahodí
 *    index → Seq Scan (886 ms vs 0,55 ms; blok pd_review 673 → 5,1 ms). Opravou
 *    NENÍ přepsat cast na druhou stranu — to by rozbilo GENERIČNOST: source_key
 *    UUID být nemusí (jiný zdroj 0/37, klíče jsou názvy firem a lokalit).
 *    Opravou je FUNKČNÍ index na tom výrazu.
 *
 * 3) Soubor, který není v `heals.sql`, se na EXISTUJÍCÍ databázi nepřehraje —
 *    baseline běží jen při COLD STARTU, heals při každém migrate. Přesně tak
 *    vypadala tato oprava, než se to zjistilo: sedm opravených SoT souborů,
 *    ani jeden v heals.
 *
 * PROČ DIFF-BASED: 861 z 866 policy souborů dnes volá authz pomocníka per řádek.
 * Plošná brána by CI utopila v červené, a 861-položkový allowlist neříká nic.
 * Brána proto měří to, CO SE MĚNÍ — kdo se souboru dotkne, opraví ho. Historie
 * se dohání podle toho, jak tabulky rostou (dnes to měřitelně platí u čtyř:
 * audit_journal 71 051 řádků, li_source_registry 43 157, knowledge_items 23 817,
 * translations 6 926 — ty jsou opravené v 20260730062357_rls_narok_do_initplanu).
 *
 * Spouští se přes: npm run test:gates -- rls-predikat-a-indexy
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const POLICIES_DIR = 'aisha/db/sql/policies';
const INDEXES_DIR = 'aisha/db/sql/indexes';
const FUNCTIONS_DIR = 'aisha/db/sql/functions';
const HEALS = join(ROOT, 'aisha/db/heals.sql');
const MIGRATIONS_DIR = join(ROOT, 'aisha/db/migrations');

/**
 * Authz pomocníci, jejichž hodnota NEZÁVISÍ na řádku — per-row vyhodnocení je
 * u nich čistá režie. Predikáty závislé na řádku (document_visible_to(uid,
 * source_sha256), korelované EXISTS) tu ZÁMĚRNĚ nejsou: tam je per-row vazba.
 */
const ROW_INDEPENDENT_AUTHZ = ['is_admin_or_staff', 'is_service_role', 'has_role'];

/**
 * Změněné SQL soubory proti hlavní větvi. Prázdno = brána nemá co měřit (projde).
 *
 * MĚŘÍ SE AUTORSTVÍ, NE POUHÁ ZMĚNA. Diff proti základu sám o sobě nestačí:
 * u MERGE commitu se git „dotkne" všeho, co přišlo z druhé větve, ačkoli to tady
 * nikdo nenapsal. Ve forku, který si stahuje upstream, je to celý cizí korpus —
 * naměřeno 2026-08-08 na syncu forku `<fork>`: 289 SQL souborů v měření,
 * z toho 0 fork-autorských, a brána spadla na cizí legacy, kterou upstream sám
 * vědomě veze (viz „861 z 866" výše). Plošná červená přesně tam, kde se jí
 * návrh brány chtěl vyhnout.
 *
 * Proto se odečtou soubory, jejichž obsah je SHODNÝ s některou přitečenou větví
 * (druhý rodič kteréhokoli merge v rozsahu — ne jen HEAD: sync větev nese merge
 * a NAD NÍM opravné commity). Zůstane, co větev skutečně napsala: vlastní práce
 * a řešení konfliktů. Bez merge v rozsahu se nemění nic.
 */
type Git = (args: string[]) => string;
const radky = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * ⛔ MĚŘÍ SE PRACOVNÍ STROM, ne jen commitnutý rozdíl (naměřeno 2026-10-04).
 * Seznam se bral z `git diff <základ>...HEAD` — tedy jen z toho, co už je
 * COMMITNUTÉ. Úpravu v pracovním stromu brána neviděla: commit zapojil do heals
 * dva soubory se zbytečným DROP téže signatury, celá sada bran před commitem
 * byla zelená a spadla až v dalším kroku — nad commitem, který už existoval.
 * Brána, která vadu ukáže až po commitu, ji neukáže tomu, kdo ji může levně
 * opravit.
 *
 * Proto: základ proti pracovnímu stromu (`git diff <základ>` = commity větve
 * + připravené + nepřipravené úpravy) a k tomu nesledované soubory, které
 * `git diff` nevidí. V CI (čistý checkout) vyjde totéž co dřív.
 */
function changedFiles(git: Git): string[] {
  /**
   * Přitečené větve: druzí (a další) rodiče KAŽDÉHO merge commitu v rozsahu.
   * Nestačí koukat na HEAD — sync větev typicky nese merge a NAD NÍM opravné
   * commity, takže merge je jen předek a jeho přírůstek by se jinak počítal
   * jako zdejší práce.
   */
  const mergedInRefs = (range: string): string[] => {
    try {
      return radky(git(['rev-list', '--parents', '--merges', range])).flatMap((line) => line.split(/\s+/).slice(2)); // [commit, p1, p2…] → p2…
    } catch {
      return [];
    }
  };

  /** Soubory, které se od dané větve NELIŠÍ = přitekly s merge, nejsou zdejší. Porovnává se pracovní strom. */
  const authoredAgainst = (files: string[], ref: string): string[] => {
    const differs = new Set(radky(git(['diff', '--name-only', '--diff-filter=d', ref])));
    return files.filter((f) => differs.has(f));
  };

  for (const base of ['origin/main', 'main', 'HEAD~1']) {
    try {
      const mergeBase = base === 'HEAD~1' ? base : git(['merge-base', base, 'HEAD']).trim();
      let files = radky(git(['diff', '--name-only', '--diff-filter=d', mergeBase]));

      // Nech jen to, co se liší od všech přitečených větví — tj. co tu vzniklo.
      for (const ref of mergedInRefs(`${mergeBase}..HEAD`)) {
        files = authoredAgainst(files, ref);
      }
      // Nový soubor, který ještě nikdo nepřidal (`git add`), v žádném diffu není.
      const untracked = radky(git(['ls-files', '--others', '--exclude-standard', '--', POLICIES_DIR, INDEXES_DIR, FUNCTIONS_DIR]));
      return [...new Set([...files, ...untracked])];
    } catch {
      // zkus další základ
    }
  }
  return [];
}

const gitVeStromu: Git = (args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const CHANGED = changedFiles(gitVeStromu);
/**
 * Změněné `.sql` v adresáři — BEZ SMAZANÝCH.
 *
 * ⛔ NAMĚŘENO 2026-09-10: `CHANGED` přichází z gitu a obsahuje i SMAZANÉ
 * soubory. Brána je pak četla a spadla na `ENOENT` — tedy chybou, která
 * o měřené vlastnosti neříká nic a vypadá jako porucha nástroje. Smazaný
 * soubor žádné SQL nemá, takže do měření prostě nepatří; jeho vynechání
 * bránu NEOSLEPUJE, protože co zmizelo, to už žádný predikát ani join nenese.
 */
const changedIn = (dir: string): string[] =>
  CHANGED.filter(
    (f) => f.startsWith(`${dir}/`) && f.endsWith('.sql') && existsSync(join(ROOT, f)),
  );

/** Odstraní komentáře, aby se brána nechytala na příklady v dokumentaci. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Obsah všech `USING (…)` / `WITH CHECK (…)` závorek, párovaně. */
function predicateBodies(sql: string): string[] {
  const bodies: string[] = [];
  const re = /\b(?:using|with\s+check)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    bodies.push(sql.slice(start, i - 1));
  }
  return bodies;
}

describe('RLS predikát: nárok se vyhodnotí jednou, ne na každý řádek', () => {
  const files = changedIn(POLICIES_DIR);

  test('brána ví, co se změnilo (jinak neměří nic a mlčí o tom)', () => {
    // Diagnostika, ne pravidlo: prázdný diff je legitimní (běh na main).
    expect(Array.isArray(CHANGED)).toBe(true);
  });

  for (const rel of files) {
    test(`${rel}: authz pomocník je obalený v (select …)`, () => {
      const sql = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      const offenders: string[] = [];

      for (const body of predicateBodies(sql)) {
        for (const fn of ROW_INDEPENDENT_AUTHZ) {
          const call = new RegExp(`(select\\s+(?:public\\.)?)?\\b${fn}\\s*\\(`, 'gi');
          let m: RegExpExecArray | null;
          while ((m = call.exec(body)) !== null) {
            if (!m[1]) offenders.push(`${fn}() bez (select …)`);
          }
        }
      }

      expect(
        offenders,
        `${rel}: predikát volá authz pomocníka PER ŘÁDEK. Obal ho do poddotazu — ` +
          `\`(SELECT public.is_admin_or_staff())\` → InitPlan. Změřeno na 43 157 ` +
          `řádcích: per-row 10 405 ms vs InitPlan 27 ms; identita bez nároku ` +
          `41 252 ms vs 42 ms. Samotné STABLE NEPOMÁHÁ (10 509 ms). ` +
          `Nalezeno: ${offenders.join(', ')}`
      ).toEqual([]);
    });
  }
});

describe('Co není v heals, na běžící DB nevznikne', () => {
  const heals = existsSync(HEALS) ? readFileSync(HEALS, 'utf8') : '';
  const migrations = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql') && !f.startsWith('00000000000000'))
        .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
        .join('\n')
    : '';

  // Suite nesmí zůstat prázdná — vitest hlásí „No test found in suite" jako
  // selhání, takže by brána padala na svém vlastním tvaru, ne na měřené
  // vlastnosti (a to je horší než brána, která tiše projde).
  test('heals.sql je čitelný (bez něj nemá smysl měřit dosažitelnost)', () => {
    expect(heals.length).toBeGreaterThan(0);
  });

  for (const rel of [...changedIn(INDEXES_DIR), ...changedIn(POLICIES_DIR)]) {
    const name = rel.split('/').pop()!;
    const objectName = name.replace(/\.sql$/, '');

    test(`${rel} má cestu na existující DB (heals \\ir nebo migrace)`, () => {
      const inHeals = heals.includes(rel.replace('aisha/db/', ''));
      const inMigration = migrations.includes(objectName);

      expect(
        inHeals || inMigration,
        `${rel} není ani v heals.sql, ani v žádné neaarchivované migraci. ` +
          `Baseline se přehrává JEN při cold startu, heals při KAŽDÉM migrate — ` +
          `takhle změna nikdy nedoteče na běžící produkci a měřený zisk zůstane ` +
          `na papíře. Přidej \`\\ir ${rel.replace('aisha/db/', '')}\` do ` +
          `aisha/db/heals.sql (a/nebo objekt do migrace).`
      ).toBe(true);
    });
  }

  /**
   * Soubor zapojený do heals se přehrává na BĚŽÍCÍ databázi, kde na objektech
   * visí závislosti — `DROP FUNCTION` tam znamená něco úplně jiného než na
   * prázdné DB. Doloženo cold-start bránou 2026-07-30:
   *   is_admin_or_staff.sql:10 → ERROR: cannot drop function
   *   is_admin_or_staff(uuid) because other objects depend on it
   *   (253 policies, „and 231 other objects")
   * Na baseline (cold start) týž řádek projde jako no-op, protože funkce vzniká
   * PŘED policies. Přidání `\ir` do heals tedy není zadarmo: dělá z dosud
   * spícího DROPu kód, který běží při každém migrate.
   *
   * `CREATE OR REPLACE` zvládne změnu těla i volatility bez zahození závislostí.
   *
   * MĚŘENÁ VLASTNOST JE ÚZKÁ: hlásí se jen DROP, jehož signatura ODPOVÍDÁ
   * signatuře CREATE v témž souboru — tedy DROP, který je ZBYTEČNÝ (a přesto
   * fatální). Když se signatura mění, je DROP naopak NUTNÝ, jinak v databázi
   * zůstanou dva overloady. Doloženo na dvou souborech téhož repa:
   *   is_admin_or_staff       DROP(uuid)  vs CREATE(p_user_id uuid)      → shoda   → VADA
   *   mcp_search_knowledge_v2 DROP(10 typů) vs CREATE(11 argumentů)      → neshoda → v pořádku
   * První verze téhle kontroly hlásila obojí a byla by donutila „opravit" i ten
   * legitimní DROP — brána, která nutí rozbít správný kód, se naučí obcházet.
   */
  const healsSourced = (rel: string): boolean => heals.includes(rel.replace('aisha/db/', ''));

  /** Typy argumentů z `DROP FUNCTION f(a,b,c)` — jen počet a pořadí, bez jmen. */
  const dropArgTypes = (args: string): string[] =>
    args
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);

  /**
   * Počet argumentů z `CREATE OR REPLACE FUNCTION f(p_x type DEFAULT …, …)`.
   * Čárky uvnitř závorek (`numeric(10,2)`, `'{}'::text[]`) se nepočítají.
   */
  const createArgCount = (args: string): number => {
    let depth = 0;
    let count = args.trim() ? 1 : 0;
    for (const ch of args) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) count++;
    }
    return count;
  };

  for (const rel of changedIn(FUNCTIONS_DIR)) {
    if (!healsSourced(rel)) continue;

    test(`${rel} je v heals → žádný zbytečný DROP téže signatury`, () => {
      const sql = stripComments(readFileSync(join(ROOT, rel), 'utf8'));

      // Signatury, které soubor VYTVÁŘÍ: jméno → počty argumentů.
      const created = new Map<string, number[]>();
      for (const m of sql.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+([^\s(]+)\s*\(([\s\S]*?)\)\s*(?:returns|as|language)/gi
      )) {
        const name = m[1].toLowerCase();
        const list = created.get(name) ?? [];
        list.push(createArgCount(m[2]));
        created.set(name, list);
      }

      const offenders: string[] = [];
      for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?([^\s(;]+)\s*\(([^)]*)\)/gi)) {
        const name = m[1].toLowerCase();
        const types = dropArgTypes(m[2]);
        if (types.length === 0) continue; // 0-arg overload cleanup je bezpečný
        // Shodný počet argumentů = táž signatura = DROP nic nepřidá, jen zabíjí závislosti.
        if ((created.get(name) ?? []).includes(types.length)) {
          offenders.push(`${m[1]}(${types.join(',')})`);
        }
      }

      expect(
        offenders,
        `${rel} je zapojený v heals.sql a DROPuje funkci, kterou hned nato vytváří ` +
          `se STEJNÝM počtem argumentů — ten DROP je zbytečný, a přitom fatální: ` +
          `na běžící databázi na funkci visí policies/views, takže psql skončí na ` +
          `"cannot drop function … because other objects depend on it" a CELÝ migrate ` +
          `spadne (u is_admin_or_staff to bylo 253 policies). Nech jen ` +
          `CREATE OR REPLACE — zvládne i změnu volatility. Nalezeno: ${offenders.join(', ')}`
      ).toEqual([]);
    });
  }
});

describe('Cast v join podmínce potřebuje funkční index', () => {
  const castInJoin = /join\s+([a-z_][a-z0-9_.]*)\s+([a-z][a-z0-9_]*)\s+on\s+([^\n]*?::\s*[a-z]+[^\n]*)/gi;

  // Stejný důvod jako výše: prázdná suite = selhání vitestu, ne nález.
  test('měřidlo je připravené (kolik SQL funkcí se v této změně dotklo)', () => {
    expect(changedIn(FUNCTIONS_DIR).length).toBeGreaterThanOrEqual(0);
  });

  /** Indexy se hledají v CELÉM SoT, ne jen ve změněných — index může být starší. */
  const indexSql = (existsSync(join(ROOT, INDEXES_DIR))
    ? readdirSync(join(ROOT, INDEXES_DIR))
        .filter((f) => f.endsWith('.sql'))
        .map((f) => readFileSync(join(ROOT, INDEXES_DIR, f), 'utf8'))
    : []
  )
    .join('\n')
    .toLowerCase();

  for (const rel of changedIn(FUNCTIONS_DIR)) {
    const sql = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    const hits = [...sql.matchAll(castInJoin)];
    if (hits.length === 0) continue;

    test(`${rel}: castovaný join má funkční index`, () => {
      const missing: string[] = [];
      for (const hit of hits) {
        const cast = hit[3].toLowerCase().match(/([a-z_][a-z0-9_]*)\s*::\s*([a-z]+)/);
        if (!cast) continue;
        const [, column, type] = cast;
        const wanted = `(${column})::${type}`;
        if (!indexSql.includes(wanted)) missing.push(`${wanted} (join ${hit[1]})`);
      }

      expect(
        missing,
        `${rel}: join castuje sloupec, ale funkční index na ten výraz chybí → ` +
          `Seq Scan. Změřeno na li_source_registry (43 157 řádků): join 886 ms ` +
          `bez indexu vs 0,55 ms s ním; blok pd_review 673 → 5,1 ms. Přepisovat ` +
          `cast na druhou stranu NELZE (cizí klíč nemusí mít náš typ) — přidej ` +
          `funkční index do ${INDEXES_DIR}/ a zapoj ho do heals.sql. ` +
          `Chybí: ${missing.join(', ')}`
      ).toEqual([]);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// Měřák sám: seznam změněných souborů bere PRACOVNÍ strom. Git je podstrčený —
// odpovídá jen na volání, která měřák smí udělat; cokoli jiného je chyba.
// ───────────────────────────────────────────────────────────────────────────────
describe('měřák: seznam změněných souborů bere pracovní strom', () => {
  const NESLEDOVANE = `ls-files --others --exclude-standard -- ${POLICIES_DIR} ${INDEXES_DIR} ${FUNCTIONS_DIR}`;
  const podstrceny = (odpovedi: Record<string, string>): Git => (args) => {
    const k = args.join(' ');
    if (!(k in odpovedi)) throw new Error(`neočekávané volání gitu: ${k}`);
    return odpovedi[k];
  };
  const F = (jmeno: string) => `${FUNCTIONS_DIR}/${jmeno}.sql`;

  test('commitnuté, rozpracované i nesledované soubory jsou v měření', () => {
    const git = podstrceny({
      'merge-base origin/main HEAD': 'zaklad\n',
      'diff --name-only --diff-filter=d zaklad': `${F('commitnuta')}\n${F('rozpracovana')}\n`,
      'rev-list --parents --merges zaklad..HEAD': '',
      [NESLEDOVANE]: `${F('nova')}\n`,
    });
    expect(changedFiles(git)).toEqual([F('commitnuta'), F('rozpracovana'), F('nova')]);
  });

  test('rozdíl jen z commitů (`základ...HEAD`) měřák nevolá — pracovní strom by neviděl', () => {
    // Podstrčený git umí JEN starý tvar. Měřák ho použít nesmí: žádný základ se mu nepovede a vrátí prázdno.
    const git = podstrceny({
      'merge-base origin/main HEAD': 'zaklad\n',
      'diff --name-only --diff-filter=d zaklad...HEAD': `${F('commitnuta')}\n`,
      'rev-list --parents --merges zaklad..HEAD': '',
      [NESLEDOVANE]: '',
    });
    expect(changedFiles(git)).toEqual([]);
  });

  test('soubor shodný s přitečenou větví se nepočítá; jeho rozpracovaná úprava a nesledovaný soubor ano', () => {
    const zaklad = {
      'merge-base origin/main HEAD': 'zaklad\n',
      'diff --name-only --diff-filter=d zaklad': `${F('pritekla')}\n${F('zdejsi')}\n`,
      'rev-list --parents --merges zaklad..HEAD': 'merge rodic1 rodic2\n',
      [NESLEDOVANE]: `${F('nova')}\n`,
    };
    // `pritekla` se od druhého rodiče neliší → není zdejší.
    expect(changedFiles(podstrceny({ ...zaklad, 'diff --name-only --diff-filter=d rodic2': `${F('zdejsi')}\n` }))).toEqual([F('zdejsi'), F('nova')]);
    // Jakmile ji někdo v pracovním stromu upraví, od druhého rodiče se liší → měří se.
    expect(changedFiles(podstrceny({ ...zaklad, 'diff --name-only --diff-filter=d rodic2': `${F('pritekla')}\n${F('zdejsi')}\n` }))).toEqual([F('pritekla'), F('zdejsi'), F('nova')]);
  });

  test('bez origin/main zkusí další základ', () => {
    const git = podstrceny({
      'merge-base main HEAD': 'zaklad\n',
      'diff --name-only --diff-filter=d zaklad': `${F('commitnuta')}\n`,
      'rev-list --parents --merges zaklad..HEAD': '',
      [NESLEDOVANE]: '',
    });
    expect(changedFiles(git)).toEqual([F('commitnuta')]);
  });
});
