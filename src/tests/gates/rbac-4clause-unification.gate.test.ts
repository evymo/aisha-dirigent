/**
 * Gate: RBAC 4-clause unification — fn_get_run_citations + graph_nodes RLS.
 *
 * After workbench Phase 6+7 merged, the codebase had two divergent
 * story-scoped RBAC predicates:
 *   - Phase 6/7 + story_timeline: admin_or_staff OR is_stack_default OR participant
 *   - Step 2 (fn_get_run_citations) + Step 7.3 (fn_get_run_graph_context):
 *     admin_or_staff OR ps.user_id OR participant
 *
 * The 4-clause unification absorbed both Step 2/7 surfaces into the
 * 4-clause superset. That change is now part of canonical SoT (the
 * function lives in aisha/db/sql/functions/fn_get_run_citations.sql, the
 * policy in aisha/db/sql/policies/graph_nodes_admin_staff_read.sql) and is
 * compiled into the real baseline. This gate reads ONLY current SoT — the
 * compiled schema (00000000000000_baseline.sql) and the per-object SoT
 * files — never the archived migration. It locks the predicate so a future
 * drift gets caught.
 *
 * ⛔ 2026-10-05 (revize B2, fix/znalosti-cteni-jen-povoleny-stav): čtvrtá klauzule v CITACÍCH už
 * NENÍ holé `ps.is_stack_default = true`. Ta vydávala KAŽDOU položku výchozího příběhu komukoli
 * přihlášenému — i soukromou (id běhu zná každý účastník). Výchozí příběh v citacích teď vydává jen
 * to, co dává domov viditelnosti, a jen AKTIVNÍ položky v čitelném stavu. Brána proto nedrží
 * pravopis klauzule, ale tuhle vlastnost:
 *   · každý výskyt `is_stack_default` v KÓDU funkce je konjunkce `(ps.is_stack_default AND <domov>)`,
 *     kde domov (`public.knowledge_visibility_searchable`) dostává viditelnost CITOVANÉ položky
 *     (sloupec CTE plněný z `ki.visibility`), „je přihlášen“ = `auth.uid() IS NOT NULL` a gildu jen
 *     z `public.knowledge_audience_in_guild(auth.uid())`. Vrácení holého `ps.is_stack_default = true`
 *     — místo domova i vedle něj — je červená;
 *   · množina citovaných položek (CTE candidate_chunks), ze které výchozí příběh vybírá, je
 *     omezená na `ki.status = 'active'` a pomocníka čitelného stavu jako KONJUNKCE na nejvyšší úrovni
 *     (OR tam nesmí být) a závěrečný dotaz čte jen z ní — tabulky znalostí už nejmenuje;
 *   · chování (identita × soukromá / archivovaná / čekající položka výchozího příběhu) měří matice
 *     nad skutečnou DB (src/tests/db/znalosti-viditelnost-cesta-identita); brána hlídá, že tahle
 *     měření z matice nezmizela.
 * Zbylé tři klauzule (správa, vlastník, účastník) drží beze změny.
 *
 * ⛔ 2026-10-06 (fix/pribeh-a-beh-cteni-podle-id): graph_nodes RLS už NEMÁ holé klauzule `story_id IS
 * NULL` a `ps.is_stack_default = true`. Ty vydávaly přihlášenému titulky (entity_label) všech globálních
 * uzlů a všech uzlů výchozího příběhu — i soukromých položek znalostí, soukromých pravidel a útržků
 * agentních pamětí (nález revize nad 8b7637acc). Uzel vlastní viditelnost nemá — nese titulek ZDROJE,
 * a tak ho vidí jen ten, kdo smí číst zdroj. Doslovný tvar citací (`public.knowledge_visibility_searchable
 * (…)`) v politice být NEMŮŽE: politika se vyhodnocuje právy tazatele a ten domov ani gildu spustit
 * nesmí (změřeno: authenticated nemá EXECUTE — každé čtení by skončilo „permission denied“, viz brána
 * politika-vola-jen-spustitelne). Podobou domova pro politiky je množina knowledge_visibilities_for_caller,
 * kterou nesou politiky zdrojových tabulek. Brána proto drží vlastnost (`vadaPolitikyGrafu`):
 *   · na nejvyšší úrovni USING právě dvě větve: stráž správy v InitPlanu a CASE podle zdroje uzlu —
 *     žádná další větev (holé `story_id IS NULL`, `OR true`) neprojde;
 *   · uzel z knowledge_items a z expert_rules: jen EXISTS na zdrojový řádek podle id — poddotaz čte
 *     právy tazatele, rozhodují politiky zdrojové tabulky (domov viditelnosti přes množinu štítků,
 *     čitelný stav, příběh položky); jiná podmínka, OR ani join v něm není;
 *   · ostatní uzly (ELSE) jen vlastník a účastník příběhu uzlu; výchozí příběh nic neotvírá
 *     (`is_stack_default` v politice není) a domov se v politice nevolá napřímo;
 *   · globální politiky knowledge_items a expert_rules pro role API se ptají množiny štítků (tranzitivní
 *     domov uzlu) a chování grafu (identita × uzel) měří src/tests/db/pribeh-a-beh-cteni-podle-id.
 *
 * Měří se jen KÓD objektu: tělo funkce od jejího CREATE po `$$;` a příkaz politiky po `;`, bez
 * komentářů. Do 2026-10-05 si oddíl baseline bral text až po další `DROP POLICY` (≈ 99 500 řádků
 * cizích funkcí, 7× holé `ps.is_stack_default = true`, 850× `SET search_path TO 'public'`) a oddíl
 * politiky celý zbytek souboru — tvrzení o citacích a grafu tak procházela díky JINÝM objektům.
 *
 * Static regex-on-source. No live DB needed.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripSqlComments } from '../../../scripts/db/lib/sql-comments.mjs';

const ROOT = process.cwd();
// The compiled schema (real baseline) is canonical SoT — it is NOT redirected
// by the archive shim. The function + policy this gate locks are emitted into
// it verbatim, so its body carries the same DDL the archived migration once did
// (CREATE OR REPLACE FUNCTION, DROP/CREATE POLICY, REVOKE/GRANT, 4-clause predicate).
const BASELINE     = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const SOT_FN       = resolve(ROOT, 'aisha/db/sql/functions/fn_get_run_citations.sql');
const SOT_POLICY   = resolve(ROOT, 'aisha/db/sql/policies/graph_nodes_admin_staff_read.sql');
const REGISTRY     = resolve(ROOT, 'aisha/db/migration-registry.json');
/** Matice chování nad skutečnou DB (cesta × identita × sonda). */
const MATICE       = resolve(ROOT, 'src/tests/db/znalosti-viditelnost-cesta-identita.runtime.test.ts');
/** Matice grafu napřímo (identita × uzel podle zdroje). */
const MATICE_GRAFU = resolve(ROOT, 'src/tests/db/pribeh-a-beh-cteni-podle-id.runtime.test.ts');
/** Politiky zdrojových tabulek uzlů (tranzitivní domov viditelnosti). */
const SOT_ZDROJE   = [
  resolve(ROOT, 'aisha/db/sql/policies/knowledge_items_global_authenticated_read.sql'),
  resolve(ROOT, 'aisha/db/sql/policies/expert_rules_visibility.sql'),
];

const FN_CREATE = /CREATE OR REPLACE FUNCTION public\.fn_get_run_citations\(/;
const POLICY_CREATE = /CREATE POLICY "graph_nodes admin staff read" ON public\.graph_nodes/;

/** Příkaz CREATE funkce fn_get_run_citations: od CREATE po konec jejího dolarového těla (`$$;`). */
function prikazFunkce(sql: string): string {
  const zac = sql.search(FN_CREATE);
  if (zac < 0) return '';
  const zbytek = sql.slice(zac);
  const konec = zbytek.search(/\$\$\s*;/);
  return konec < 0 ? '' : zbytek.slice(0, konec + 2);
}
/** Hlavička funkce (CREATE … před `AS $$`): SECURITY DEFINER, search_path, STABLE. */
const hlavicka = (prikaz: string) => prikaz.split(/\bAS\s*\$\$/)[0] ?? '';
/** Tělo funkce (`AS $$ … $$`) bez komentářů — rozhoduje KÓD. */
const kodTela = (prikaz: string) => stripSqlComments(prikaz.match(/AS\s*\$\$[\s\S]*\$\$/)?.[0] ?? '');
/** Příkaz politiky graph_nodes po první `;` (tělo politiky středník nenese), bez komentářů. */
function prikazPolitiky(sql: string): string {
  const zac = sql.search(POLICY_CREATE);
  if (zac < 0) return '';
  return stripSqlComments(sql.slice(zac).split(';')[0]);
}

/** Text uvnitř závorky, která začíná na indexu `otevreni` (znak `(`); index za ní. */
function obsahZavorky(kod: string, otevreni: number): { obsah: string; konec: number } {
  let hloubka = 0;
  for (let i = otevreni; i < kod.length; i++) {
    if (kod[i] === '(') hloubka++;
    else if (kod[i] === ')' && --hloubka === 0) return { obsah: kod.slice(otevreni + 1, i), konec: i + 1 };
  }
  return { obsah: kod.slice(otevreni + 1), konec: kod.length };
}
/** Výskyty vzoru (ukotveného `^`) na nejvyšší úrovni výrazu — mimo závorky a řetězce; slovo jen na hranici slova. */
function indexyNejvyssiUrovne(vyraz: string, vzor: RegExp): { i: number; delka: number }[] {
  const ven: { i: number; delka: number }[] = [];
  const slovo = /^\^?[A-Za-z]/.test(vzor.source.replace(/^\^/, ''));
  let hloubka = 0;
  let vRetezci = false;
  for (let i = 0; i < vyraz.length; i++) {
    const c = vyraz[i];
    if (vRetezci) {
      if (c === "'") vRetezci = false;
      continue;
    }
    if (c === "'") vRetezci = true;
    else if (c === '(') hloubka++;
    else if (c === ')') hloubka--;
    else if (hloubka === 0 && (!slovo || i === 0 || !/[A-Za-z0-9_.]/.test(vyraz[i - 1]))) {
      const m = vzor.exec(vyraz.slice(i));
      if (m && m.index === 0) {
        ven.push({ i, delka: m[0].length });
        i += m[0].length - 1;
      }
    }
  }
  return ven;
}
/** Rozdělí výraz na nejvyšší úrovni (mimo závorky a řetězce) podle oddělovače (`,` nebo slova AND / OR). */
function nejvyssiUroven(vyraz: string, oddelovac: RegExp): string[] {
  const casti: string[] = [];
  let zac = 0;
  for (const { i, delka } of indexyNejvyssiUrovne(vyraz, oddelovac)) {
    casti.push(vyraz.slice(zac, i));
    zac = i + delka;
  }
  casti.push(vyraz.slice(zac));
  return casti.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Proč čtvrtá klauzule citací NEDRŽÍ vlastnost (null = drží): výchozí příběh jen přes domov
 * viditelnosti citované položky za volajícího, a jen z množiny aktivních položek v čitelném stavu.
 */
function vadaVychozihoPribehu(kod: string): string | null {
  const vyskyty = [...kod.matchAll(/\bis_stack_default\b/gi)];
  if (vyskyty.length === 0) return 'čtvrtá klauzule (výchozí příběh) z predikátu zmizela';
  // Viditelnost citované položky: sloupec CTE plněný z ki.visibility.
  const sloupecViditelnosti = /\bki\.visibility\s+AS\s+([a-z_][a-z0-9_]*)/i.exec(kod)?.[1];
  if (!sloupecViditelnosti) return 'množina citovaných položek nenese viditelnost položky (ki.visibility AS …)';
  // Gilda: buď přímo knowledge_audience_in_guild(auth.uid()), nebo proměnná přiřazená JEN z něj.
  const GILDA = /^public\.knowledge_audience_in_guild\(\s*auth\.uid\(\)\s*\)$/i;
  const gildaOk = (vyraz: string) => {
    const v = norm(vyraz);
    if (GILDA.test(v)) return true;
    if (!/^[a-z_][a-z0-9_]*$/i.test(v)) return false;
    const prirazeni = [...kod.matchAll(new RegExp(`\\b${v}\\b\\s+(?:boolean\\s*)?:=\\s*([^;]+);`, 'gi'))].map((m) => norm(m[1]));
    return prirazeni.length > 0 && prirazeni.every((p) => GILDA.test(p)) &&
      !new RegExp(`\\bINTO\\s+(?:[a-z_0-9,\\s]*,\\s*)?${v}\\b`, 'i').test(kod);
  };
  for (const v of vyskyty) {
    // Výskyt musí otevírat konjunkci `( <alias>.is_stack_default AND public.knowledge_visibility_searchable(…) )`.
    const pred = kod.slice(0, v.index);
    const otevreni = pred.search(/\(\s*(?:[a-z_][a-z0-9_]*\.)?$/i);
    if (otevreni < 0) return `výchozí příběh mimo konjunkci s domovem viditelnosti: …${norm(kod.slice(Math.max(0, v.index! - 40), v.index! + 60))}…`;
    const { obsah } = obsahZavorky(kod, otevreni);
    const konjunkty = nejvyssiUroven(obsah, /^AND\b/i);
    if (nejvyssiUroven(obsah, /^OR\b/i).length !== 1) return `výchozí příběh v konjunkci s OR: (${norm(obsah)})`;
    if (konjunkty.length !== 2 || !/^(?:[a-z_][a-z0-9_]*\.)?is_stack_default$/i.test(konjunkty[0])) {
      return `výchozí příběh není právě „(ps.is_stack_default AND <domov>)“: (${norm(obsah)})`;
    }
    const domov = /^public\.knowledge_visibility_searchable\s*\(/i.exec(konjunkty[1]);
    if (!domov) return `výchozí příběh bez domova viditelnosti: (${norm(obsah)})`;
    const volani = obsahZavorky(konjunkty[1], konjunkty[1].indexOf('('));
    if (norm(konjunkty[1].slice(volani.konec)) !== '') return `za domovem viditelnosti ve výchozím příběhu ještě něco je: (${norm(obsah)})`;
    const args = nejvyssiUroven(volani.obsah, /^,/);
    if (args.length !== 3) return 'domov viditelnosti ve výchozím příběhu se nevolá se třemi vstupy';
    if (!new RegExp(`^(?:[a-z_][a-z0-9_]*\\.)?${sloupecViditelnosti}$`, 'i').test(args[0])) {
      return `domov ve výchozím příběhu se neptá na viditelnost citované položky (${args[0]} místo ${sloupecViditelnosti})`;
    }
    if (!/^auth\.uid\(\)\s+IS\s+NOT\s+NULL$/i.test(args[1])) return `„je přihlášen“ ve výchozím příběhu = ${args[1]} — jen auth.uid() IS NOT NULL`;
    if (!gildaOk(args[2])) return `gilda ve výchozím příběhu = ${args[2]} — jen public.knowledge_audience_in_guild(auth.uid())`;
  }
  // Jen aktivní: množina, ze které výchozí příběh vybírá, je filtrovaná konjunkcí na nejvyšší úrovni.
  const cte = /\bcandidate_chunks\s+AS\s*\(/i.exec(kod);
  if (!cte) return 'chybí množina citovaných položek (CTE candidate_chunks)';
  const { obsah: cteText, konec: zaCte } = obsahZavorky(kod, cte.index + cte[0].length - 1);
  // WHERE celé CTE (na její nejvyšší úrovni — ne WHERE poddotazu uvnitř).
  const wh = indexyNejvyssiUrovne(cteText, /^WHERE\b/i);
  if (wh.length !== 1) return `množina citovaných položek nemá právě jeden filtr WHERE (${wh.length})`;
  const where = cteText.slice(wh[0].i + wh[0].delka).split(/\b(?:GROUP\s+BY|ORDER\s+BY|LIMIT|UNION)\b/i)[0];
  if (nejvyssiUroven(where, /^OR\b/i).length !== 1) return `filtr citovaných položek má OR na nejvyšší úrovni: ${norm(where)}`;
  const podminky = nejvyssiUroven(where, /^AND\b/i).map((p) => p.replace(/^\((.*)\)$/, '$1'));
  if (!podminky.some((p) => /^ki\.status\s*=\s*'active'$/i.test(p))) return `citované položky nejsou omezené na ki.status = 'active': ${norm(where)}`;
  if (!podminky.some((p) => /^public\.knowledge_state_readable\(\s*ki\.quarantine_status\s*\)$/i.test(p))) {
    return `citované položky nejsou omezené pomocníkem čitelného stavu: ${norm(where)}`;
  }
  const zaver = kod.slice(zaCte);
  if (!/\bFROM\s+candidate_chunks\b/i.test(zaver)) return 'závěrečný dotaz nečte z množiny citovaných položek';
  if (/\bknowledge_(?:items|chunks|embeddings)\b/i.test(zaver)) return 'závěrečný dotaz čte tabulky znalostí mimo filtrovanou množinu';
  return null;
}

/** Výraz USING politiky (obsah závorky za USING), bez komentářů. */
function usingPolitiky(prikaz: string): string {
  const kod = stripSqlComments(prikaz);
  const m = /\bUSING\s*\(/i.exec(kod);
  return m ? obsahZavorky(kod, m.index + m[0].length - 1).obsah : '';
}
/** Tokeny výrazu: mezery kolem závorek sjednocené, `(SELECT auth.uid())` = `auth.uid()` (InitPlan nároku nemění). */
const tok = (v: string) =>
  norm(v.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ')).replace(/\( SELECT auth\.uid \( \) \)/gi, 'auth.uid ( )');
/** Zdroje uzlu, které mají domov viditelnosti a jejichž politika se ptá množiny štítků. */
const ZDROJE_S_DOMOVEM = ['knowledge_items', 'expert_rules'];
/** ELSE: uzel bez zdroje znalostí jen vlastníkovi a účastníkovi příběhu uzlu. */
const ELSE_PRIBEH_UZLU = tok(`EXISTS (SELECT 1 FROM public.partner_stories ps WHERE ps.id = graph_nodes.story_id
  AND (ps.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.story_participants sp WHERE sp.story_id = ps.id AND sp.user_id = auth.uid())))`);

/**
 * Proč politika graph_nodes NEDRŽÍ vlastnost (null = drží): uzel nese titulek zdroje, takže ho vidí jen
 * správa, kdo smí číst zdrojový řádek (politiky knowledge_items / expert_rules právy tazatele), a jinak
 * vlastník a účastník příběhu uzlu. Výchozí příběh ani globální uzly nic neotvírají.
 */
function vadaPolitikyGrafu(prikaz: string): string | null {
  const u = usingPolitiky(prikaz);
  if (!u) return 'politika grafu nemá USING';
  if (/\bis_stack_default\b/i.test(u)) return 'výchozí příběh v politice grafu — uzel nevydá víc než jeho zdroj (tabulka položek výchozí příběh neotvírá)';
  if (/\bknowledge_visibility_searchable\b|\bknowledge_audience_in_guild\b/i.test(u)) {
    return 'politika volá domov napřímo — tazatel ho spustit nesmí (permission denied); domov nesou politiky zdrojových tabulek';
  }
  const vetve = nejvyssiUroven(u, /^OR\b/i);
  if (vetve.length !== 2) return `na nejvyšší úrovni USING má být právě stráž správy a CASE podle zdroje (${vetve.length} větví): ${norm(u)}`;
  if (tok(vetve[0]) !== tok('(SELECT public.is_admin_or_staff((SELECT auth.uid())))')) return `první větev není stráž správy v InitPlanu: ${vetve[0]}`;
  const c = /^CASE\s+(?:graph_nodes\.)?source_table\s+([\s\S]*)\s+END$/i.exec(vetve[1]);
  if (!c) return `druhá větev není CASE podle zdroje uzlu (source_table): ${vetve[1]}`;
  const zacatky = indexyNejvyssiUrovne(c[1], /^(?:WHEN|ELSE)\b/i);
  if (zacatky.length === 0 || zacatky[0].i !== 0) return `CASE zdroje nezačíná větví WHEN: ${norm(c[1])}`;
  const casti = zacatky.map((z, k) => c[1].slice(z.i, zacatky[k + 1]?.i ?? c[1].length).trim());
  const tabulky: string[] = [];
  let jinak: string | null = null;
  for (const cast of casti) {
    const w = /^WHEN\s+'([a-z_]+)'\s+THEN\s+([\s\S]+)$/i.exec(cast);
    if (w) {
      const [, tabulka, vyraz] = w;
      if (!ZDROJE_S_DOMOVEM.includes(tabulka)) return `větev zdroje ${tabulka}: tabulka bez domova viditelnosti — nejdřív rozhodni, čí je uzel (a doplň bránu)`;
      const re = new RegExp(`^EXISTS \\( SELECT 1 FROM public\\.${tabulka} ([a-z_]+) WHERE \\1\\.id = graph_nodes\\.source_id \\)$`, 'i');
      if (!re.test(tok(vyraz))) return `větev ${tabulka} nečte jen zdrojový řádek podle id (právy tazatele): ${norm(vyraz)}`;
      tabulky.push(tabulka);
      continue;
    }
    const e = /^ELSE\s+([\s\S]+)$/i.exec(cast);
    if (!e) return `nerozpoznaná větev CASE: ${norm(cast)}`;
    jinak = e[1];
  }
  if ([...tabulky].sort().join(',') !== [...ZDROJE_S_DOMOVEM].sort().join(',')) return `větve zdrojů s domovem: ${tabulky.join(', ')} (čekám ${ZDROJE_S_DOMOVEM.join(', ')})`;
  if (jinak === null) return 'CASE zdroje nemá ELSE (uzel bez zdroje znalostí)';
  if (tok(jinak) !== ELSE_PRIBEH_UZLU) return `uzel bez zdroje znalostí ne jen vlastníkovi a účastníkovi příběhu uzlu: ${norm(jinak)}`;
  return null;
}

describe('RBAC 4-clause unification (fn_get_run_citations + graph_nodes RLS)', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // The 4-clause unification is absorbed into the compiled baseline (canonical
  // SoT). These assertions read that baseline — the same DDL the archived
  // migration once carried — and the real (baseline-only) registry.
  describe('Compiled schema (baseline)', () => {
    test('baseline exists + registry is baseline-only (migration absorbed)', () => {
      expect(existsSync(BASELINE)).toBe(true);
      // The real registry is baseline-only: no non-baseline migrations remain.
      // (The unification migration was absorbed into the baseline above.)
      expect(readFileSync(REGISTRY, 'utf-8')).toMatch(/Baseline-only state/i);
    });

    test('declares fn_get_run_citations via CREATE OR REPLACE (no signature change)', () => {
      const prikaz = prikazFunkce(readFileSync(BASELINE, 'utf-8'));
      expect(prikaz).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_get_run_citations\(p_run_id uuid\)/);
      // Return signature unchanged from the existing definition.
      expect(prikaz).toMatch(/RETURNS TABLE \(\s*chunk_id\s+uuid/);
    });

    test('SECURITY DEFINER + search_path + STABLE preserved', () => {
      const h = hlavicka(prikazFunkce(readFileSync(BASELINE, 'utf-8')));
      expect(h).toMatch(/SECURITY DEFINER/);
      // Zpevněná cesta (brána definer-search-path): `public` na cestě, `pg_temp` POSLEDNÍ.
      expect(h).toMatch(/SET search_path TO [^\n]*'public'[^\n]*'pg_temp'\s*$/m);
      expect(h).toMatch(/\bSTABLE\b/);
    });

    test('REVOKE + explicit GRANT preserved (authenticated + service_role)', () => {
      const sql = readFileSync(BASELINE, 'utf-8');
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_get_run_citations\(uuid\) FROM PUBLIC/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_run_citations\(uuid\) TO authenticated/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_run_citations\(uuid\) TO service_role/);
    });

    test('fn_get_run_citations: predicate has all 4 clauses (výchozí příběh jen přes domov viditelnosti a jen aktivní)', () => {
      const kod = kodTela(prikazFunkce(readFileSync(BASELINE, 'utf-8')));
      expect(kod, 'tělo fn_get_run_citations v baseline nenalezeno — brána by měřila prázdno').toMatch(/RETURN QUERY/);
      expect(kod).toMatch(/public\.is_admin_or_staff\(auth\.uid\(\)\)/);
      expect(vadaVychozihoPribehu(kod)).toBeNull();
      expect(kod).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(kod).toMatch(/public\.story_participants sp[\s\S]*sp\.user_id\s*=\s*auth\.uid\(\)/);
    });

    test('baseline nese TÝŽ kód funkce jako SoT (zkompilovaný, ne rozjetý)', () => {
      expect(norm(kodTela(prikazFunkce(readFileSync(BASELINE, 'utf-8'))))).toBe(norm(kodTela(prikazFunkce(readFileSync(SOT_FN, 'utf-8')))));
    });

    test('graph_nodes admin staff read: DROP + CREATE POLICY — správa, zdroj uzlu, vlastník, účastník (bez holého výchozího příběhu)', () => {
      const sql = readFileSync(BASELINE, 'utf-8');
      expect(sql).toMatch(/DROP POLICY IF EXISTS "graph_nodes admin staff read" ON public\.graph_nodes/);
      expect(sql).toMatch(/CREATE POLICY "graph_nodes admin staff read" ON public\.graph_nodes/);
      const policySection = prikazPolitiky(sql);
      // Měří se PŘÍTOMNOST klauzule nároku, ne její pravopis. Od 2026-09-12 je
      // predikát obalený do poddotazu — `(SELECT public.is_admin_or_staff((SELECT
      // auth.uid())))` — aby se vyhodnotil JEDNOU za dotaz, ne pro každý řádek
      // (10 405 ms × 27 ms nad 43 157 řádky, viz rls-predikat-a-indexy). Nárok
      // se tím nemění, mizí jen opakování; vzor proto musí snést obě podoby.
      expect(policySection).toMatch(/public\.is_admin_or_staff\(\s*\(?\s*(SELECT\s+)?auth\.uid\(\)/i);
      // Uzel jen se zdrojem, který smí tazatel číst; výchozí příběh ani globální uzly nic neotvírají.
      expect(vadaPolitikyGrafu(policySection)).toBeNull();
      expect(policySection).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(policySection).toMatch(/public\.story_participants sp[\s\S]*sp\.user_id\s*=\s*auth\.uid\(\)/);
      expect(policySection, 'politika grafu širší než dnes (konstanta místo podmínky)').not.toMatch(/\bOR\s+\(?\s*true\b(?!\s*(?:=|<>|!=|\bIS\b))/i);
    });

    test('no `owner_user_id` in either object body (regression guard for PR #111 fix)', () => {
      const sql = readFileSync(BASELINE, 'utf-8');
      // Isolate just the fn_get_run_citations function body + the graph_nodes
      // policy body so unrelated baseline objects can't false-positive.
      const fnBody = kodTela(prikazFunkce(sql));
      const policyBody = prikazPolitiky(sql);
      expect(fnBody).toMatch(/RETURN QUERY/);
      expect(policyBody).toMatch(/USING/);
      expect(fnBody).not.toMatch(/owner_user_id/);
      expect(policyBody).not.toMatch(/owner_user_id/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('SoT mirrors agree with the migration', () => {
    test('fn_get_run_citations SoT has all 4 clauses (výchozí příběh jen přes domov viditelnosti a jen aktivní)', () => {
      const fnBody = kodTela(prikazFunkce(readFileSync(SOT_FN, 'utf-8')));
      expect(fnBody, 'tělo fn_get_run_citations v SoT nenalezeno — brána by měřila prázdno').toMatch(/RETURN QUERY/);
      expect(fnBody).toMatch(/public\.is_admin_or_staff\(auth\.uid\(\)\)/);
      expect(vadaVychozihoPribehu(fnBody)).toBeNull();
      expect(fnBody).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(fnBody).toMatch(/sp\.user_id\s*=\s*auth\.uid\(\)/);
      expect(fnBody).not.toMatch(/owner_user_id/);
    });

    test('kotva měřidla výchozího příběhu: holý tvar, obchvat a ztráta filtru aktivních jsou červené', () => {
      const ok = kodTela(prikazFunkce(readFileSync(SOT_FN, 'utf-8')));
      expect(vadaVychozihoPribehu(ok), 'kontrolní vzorek: dnešní SoT vlastnost drží').toBeNull();
      const STRAZ = /\(ps\.is_stack_default AND public\.knowledge_visibility_searchable\(cc\.item_visibility, auth\.uid\(\) IS NOT NULL, v_in_guild\)\)/;
      expect(ok, 'kotva mutací v SoT chybí — mutanti by neměřili nic').toMatch(STRAZ);
      const FILTR = "WHERE ki.status = 'active'\n     AND public.knowledge_state_readable(ki.quarantine_status)";
      expect(ok, 'kotva filtru aktivních v SoT chybí').toContain(FILTR);
      const mutanti: [string, string][] = [
        // KOTVA ZADÁNÍ: vrácení holého tvaru z doby před revizí B2
        ['holý tvar místo domova', ok.replace(STRAZ, 'ps.is_stack_default = true')],
        ['holý tvar VEDLE domova', ok.replace(STRAZ, (m) => `${m}\n OR ps.is_stack_default = true`)],
        ['holé IS TRUE', ok.replace(STRAZ, 'ps.is_stack_default IS TRUE')],
        ['holý bez porovnání', ok.replace(STRAZ, 'ps.is_stack_default')],
        ['konstanta místo domova', ok.replace(STRAZ, '(ps.is_stack_default AND true)')],
        ['domov s pevnou viditelností', ok.replace(STRAZ, "(ps.is_stack_default AND public.knowledge_visibility_searchable('public', auth.uid() IS NOT NULL, v_in_guild))")],
        ['domov za nepřihlášeného jako přihlášeného', ok.replace(STRAZ, '(ps.is_stack_default AND public.knowledge_visibility_searchable(cc.item_visibility, true, v_in_guild))')],
        ['domov s gildou natvrdo', ok.replace(STRAZ, '(ps.is_stack_default AND public.knowledge_visibility_searchable(cc.item_visibility, auth.uid() IS NOT NULL, true))')],
        ['domov s OR uvnitř konjunkce', ok.replace(STRAZ, '(ps.is_stack_default AND public.knowledge_visibility_searchable(cc.item_visibility, auth.uid() IS NOT NULL, v_in_guild) OR true)')],
        ['výchozí příběh zmizel', ok.replace(STRAZ, 'false')],
        ['bez filtru aktivních', ok.replace(FILTR, 'WHERE public.knowledge_state_readable(ki.quarantine_status)')],
        ['filtr aktivních obejitý OR', ok.replace(FILTR, `${FILTR}\n     OR ki.status = 'archived'`)],
        ['bez pomocníka čitelného stavu', ok.replace(FILTR, "WHERE ki.status = 'active'")],
        ['závěr čte znalosti mimo množinu', ok.replace(/FROM candidate_chunks cc/, 'FROM candidate_chunks cc, public.knowledge_items k2')],
      ];
      for (const [jmeno, mutant] of mutanti) {
        expect(mutant, `mutant „${jmeno}“ se nevytvořil`).not.toBe(ok);
        expect(vadaVychozihoPribehu(mutant), `mutant „${jmeno}“ prošel`).not.toBeNull();
      }
      // Komentář s holým tvarem kód nemění (rozhoduje kód, ne komentář).
      const prikaz = prikazFunkce(readFileSync(SOT_FN, 'utf-8'));
      const sKomentarem = prikaz.replace(/\nBEGIN\n/, '\nBEGIN\n  -- OR ps.is_stack_default = true\n');
      expect(sKomentarem, 'kotva komentáře se nevytvořila').not.toBe(prikaz);
      expect(vadaVychozihoPribehu(kodTela(sKomentarem))).toBeNull();
    });

    test('chování výchozího příběhu v citacích měří matice nad skutečnou DB (měření nezmizelo)', () => {
      const m = readFileSync(MATICE, 'utf-8');
      // Sondy výchozího příběhu: soukromá, archivovaná, čekající (+ veřejná jako kontrolní vzorek).
      for (const [klic, vis, stav] of [['dpub', 'public', ''], ['dpri', 'private', ''], ['darc', 'public', 'archived'], ['dpen', 'members', 'pending_review']]) {
        const re = new RegExp(`S\\("${klic}", "[a-z_]+", "${vis}", "vychozi"${stav ? `, "${stav}"` : ''}\\)`);
        expect(m, `matice ztratila sondu ${klic} (${vis}${stav ? `, ${stav}` : ''}) výchozího příběhu`).toMatch(re);
      }
      const cesta = /\{\s*jmeno:\s*"fn_get_run_citations[^"]*"[\s\S]*?\n\s*\},/.exec(m)?.[0] ?? '';
      expect(cesta, 'matice ztratila cestu fn_get_run_citations').not.toBe('');
      expect(cesta, 'citace v matici musí běžet nad všemi sondami').toMatch(/sondy:\s*VSE\b/);
      expect(cesta, 'citace ve výchozím příběhu se v matici měří podle štítku').toMatch(/vychoziPodleStitku:\s*true/);
      expect(cesta, 'citace nevydávají neaktivní položky výchozího příběhu nikomu — matice to nesmí očekávat').not.toMatch(/neaktivniVychozi/);
      expect(cesta).toMatch(/public\.fn_get_run_citations\(/);
    });

    test('SoT documents the patch (so future readers know the history)', () => {
      const sot = readFileSync(SOT_FN, 'utf-8');
      expect(sot).toMatch(/20260520060000_rbac_4clause_unification/);
    });

    test('baseline nese TUTÉŽ politiku grafu jako SoT (zkompilovaná, ne rozjetá)', () => {
      expect(tok(prikazPolitiky(readFileSync(BASELINE, 'utf-8')))).toBe(tok(prikazPolitiky(readFileSync(SOT_POLICY, 'utf-8'))));
    });

    test('kotva měřidla politiky grafu: holé globální a výchozí uzly, obchvat zdroje i domov napřímo jsou červené', () => {
      const ok = prikazPolitiky(readFileSync(SOT_POLICY, 'utf-8'));
      expect(vadaPolitikyGrafu(ok), 'kontrolní vzorek: dnešní SoT vlastnost drží').toBeNull();
      const SPRAVA = '(SELECT public.is_admin_or_staff((SELECT auth.uid())))\n    OR CASE';
      const POLOZKA = /WHEN 'knowledge_items' THEN EXISTS \(\s*SELECT 1 FROM public\.knowledge_items ki\s*WHERE ki\.id = graph_nodes\.source_id\s*\)/;
      const PRAVIDLO = /WHEN 'expert_rules' THEN EXISTS \(\s*SELECT 1 FROM public\.expert_rules er\s*WHERE er\.id = graph_nodes\.source_id\s*\)/;
      const VLASTNIK = 'ps.user_id = auth.uid()';
      for (const [jm, kotva] of [['správa', SPRAVA], ['položka', POLOZKA], ['pravidlo', PRAVIDLO], ['vlastník', VLASTNIK]] as const) {
        expect(typeof kotva === 'string' ? ok.includes(kotva) : kotva.test(ok), `kotva mutací „${jm}“ v SoT chybí — mutanti by neměřili nic`).toBe(true);
      }
      const mutanti: [string, string][] = [
        // KOTVA ZADÁNÍ: vrácení holých klauzulí z doby před opravou
        ['holé story_id IS NULL', ok.replace(SPRAVA, '(SELECT public.is_admin_or_staff((SELECT auth.uid())))\n    OR story_id IS NULL\n    OR CASE')],
        ['holý výchozí příběh v ELSE', ok.replace(VLASTNIK, `ps.is_stack_default = true OR ${VLASTNIK}`)],
        ['výchozí příběh s domovem v ELSE', ok.replace(VLASTNIK, `(ps.is_stack_default AND graph_nodes.entity_type = 'KnowledgeItem') OR ${VLASTNIK}`)],
        ['OR true na nejvyšší úrovni', ok.replace(SPRAVA, '(SELECT public.is_admin_or_staff((SELECT auth.uid())))\n    OR true\n    OR CASE')],
        ['větev položky zmizela (rozhodl by příběh uzlu)', ok.replace(POLOZKA, '')],
        ['větev položky = true', ok.replace(POLOZKA, "WHEN 'knowledge_items' THEN true")],
        ['větev položky s OR', ok.replace(POLOZKA, (m) => m.replace('graph_nodes.source_id', "graph_nodes.source_id OR ki.visibility = 'private'"))],
        ['větev položky s joinem výchozího příběhu', ok.replace(POLOZKA, (m) => m.replace('ki\n', 'ki JOIN public.partner_stories ps ON ps.id = ki.story_id\n'))],
        [
          'domov napřímo v politice',
          ok.replace(POLOZKA, (m) => m.replace('graph_nodes.source_id', 'graph_nodes.source_id AND public.knowledge_visibility_searchable(ki.visibility, auth.uid() IS NOT NULL, public.knowledge_audience_in_guild(auth.uid()))')),
        ],
        ['větev pravidla = true', ok.replace(PRAVIDLO, "WHEN 'expert_rules' THEN true")],
        ['nová větev zdroje bez rozhodnutí', ok.replace(PRAVIDLO, (m) => `${m}\n      WHEN 'agent_memories' THEN true`)],
        ['ELSE = true', ok.replace(/ELSE EXISTS \([\s\S]*\)\s*END/, 'ELSE true END')],
        ['správa bez InitPlanu nahrazená konstantou', ok.replace('(SELECT public.is_admin_or_staff((SELECT auth.uid())))', 'true')],
      ];
      for (const [jmeno, mutant] of mutanti) {
        expect(mutant, `mutant „${jmeno}“ se nevytvořil`).not.toBe(ok);
        expect(vadaPolitikyGrafu(mutant), `mutant „${jmeno}“ prošel`).not.toBeNull();
      }
      // Komentář s holou klauzulí kód nemění (rozhoduje kód, ne komentář).
      const sKomentarem = ok.replace(SPRAVA, `${SPRAVA.split('\n')[0]}\n    -- OR story_id IS NULL OR ps.is_stack_default = true\n    OR CASE`);
      expect(sKomentarem, 'kotva komentáře se nevytvořila').not.toBe(ok);
      expect(vadaPolitikyGrafu(sKomentarem)).toBeNull();
    });

    test('domov uzlu je tranzitivní: globální politiky zdrojových tabulek pro přihlášené se ptají množiny štítků', () => {
      for (const soubor of SOT_ZDROJE) {
        const sql = stripSqlComments(readFileSync(soubor, 'utf-8'));
        const proPrihlasene = [...sql.matchAll(/CREATE POLICY[\s\S]*?;/gi)].map((m) => m[0]).filter((p) => /\bTO\s+authenticated\b/i.test(p) && /\bFOR\s+SELECT\b/i.test(p));
        expect(proPrihlasene.length, `${soubor}: politika SELECT pro authenticated nenalezena`).toBeGreaterThan(0);
        for (const p of proPrihlasene) {
          expect(p, `${soubor}: politika se neptá množiny štítků domova`).toMatch(/visibility\s*=\s*ANY\s*\(\s*\(\s*SELECT\s+public\.knowledge_visibilities_for_caller\(\)\s*\)\s*::\s*text\[\]\s*\)/i);
        }
      }
    });

    test('chování grafu napřímo měří matice nad skutečnou DB (měření nezmizelo)', () => {
      const m = readFileSync(MATICE_GRAFU, 'utf-8');
      expect(m, 'matice grafu ztratila cestu tabulka graph_nodes pod RLS').toMatch(/jmeno:\s*"tabulka graph_nodes pod RLS"/);
      expect(m).toMatch(/FROM public\.graph_nodes WHERE id = /);
      // uzly: soukromá položka výchozího příběhu (kotva nálezu), globální soukromá, položka zapsaná do cizího
      // příběhu, soukromé pravidlo, Concept výchozího příběhu, globální uzly bez zdroje znalostí
      for (const re of [
        /klic:\s*"kdpri",\s*typ:\s*"KnowledgeItem",\s*zdroj:\s*\{\s*tabulka:\s*"knowledge_items",\s*vis:\s*"private",\s*pribeh:\s*"vychozi"\s*\},\s*pribeh:\s*"vychozi"/,
        /klic:\s*"kgpri",\s*typ:\s*"KnowledgeItem",\s*zdroj:\s*\{\s*tabulka:\s*"knowledge_items",\s*vis:\s*"private",\s*pribeh:\s*null\s*\}/,
        /klic:\s*"kgprivp",[^\n]*vis:\s*"private",\s*pribeh:\s*null\s*\},\s*pribeh:\s*"pribeh"/,
        /klic:\s*"erpri",\s*typ:\s*"ExpertRule",\s*zdroj:\s*\{\s*tabulka:\s*"expert_rules",\s*vis:\s*"private"/,
        /klic:\s*"cvychozi",\s*typ:\s*"Concept",\s*zdroj:\s*null,\s*pribeh:\s*"vychozi"/,
        /klic:\s*"mglobal",\s*typ:\s*"Memory",\s*zdroj:\s*null,\s*pribeh:\s*null/,
      ]) {
        expect(m, `matice grafu ztratila uzel ${re.source.slice(0, 40)}…`).toMatch(re);
      }
    });

    test('graph_nodes_admin_staff_read SoT has all 4 clauses', () => {
      const sot = readFileSync(SOT_POLICY, 'utf-8');
      // Documentary comments may still mention the historical typo. Only
      // check the SQL body (CREATE POLICY ... );).
      const policyBody = prikazPolitiky(sot);
      expect(policyBody).toMatch(/USING/);
      // Viz výše: přítomnost klauzule, ne pravopis (predikát je v poddotazu).
      expect(policyBody).toMatch(/public\.is_admin_or_staff\(\s*\(?\s*(SELECT\s+)?auth\.uid\(\)/i);
      // Uzel jen se zdrojem, který smí tazatel číst; výchozí příběh ani globální uzly nic neotvírají.
      expect(vadaPolitikyGrafu(policyBody)).toBeNull();
      expect(policyBody).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(policyBody).toMatch(/sp\.user_id\s*=\s*auth\.uid\(\)/);
      expect(policyBody).not.toMatch(/owner_user_id/);
      expect(policyBody, 'politika grafu širší než dnes (konstanta místo podmínky)').not.toMatch(/\bOR\s+\(?\s*true\b(?!\s*(?:=|<>|!=|\bIS\b))/i);
    });

    test('graph_nodes RLS policy SoT documents the patch', () => {
      const sot = readFileSync(SOT_POLICY, 'utf-8');
      expect(sot).toMatch(/20260520060000_rbac_4clause_unification/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sjednocení bylo rozšiřující (přidalo is_stack_default). Od revize B2 (2026-10-05) se čtvrtá
  // klauzule v citacích ZÚŽILA na domov viditelnosti — tři původní ale musí přežít beze změny.
  describe('Pre-existing clauses survive (admin_or_staff, ps.user_id, story_participants)', () => {
    test('all pre-existing clauses survive (admin_or_staff, ps.user_id, story_participants)', () => {
      const sotFn     = kodTela(prikazFunkce(readFileSync(SOT_FN, 'utf-8')));
      const sotPolicy = prikazPolitiky(readFileSync(SOT_POLICY, 'utf-8'));
      for (const src of [sotFn, sotPolicy]) {
        expect(src).toMatch(/public\.is_admin_or_staff/);
        expect(src).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
        expect(src).toMatch(/story_participants/);
      }
    });
  });
});
