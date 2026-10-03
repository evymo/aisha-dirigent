/**
 * Brána: heals pokrývá SoT — co není v heals, na běžící DB nevznikne
 *
 * VZNIKLA Z AUDITU 2026-08-06. Sesterská brána (`rls-predikat-a-indexy`,
 * sekce „Co není v heals") hlídá jen ZMĚNĚNÉ indexy a policies. Funkce,
 * tabulky, granty, triggery a views nehlídal nikdo — a audit našel přesně
 * ty třídy selhání, které z toho plynou. Všechny ZMĚŘENÉ simulací
 * (baseline z data wipe + dnešní heals ⟷ čistý cold start), ne odhadnuté:
 *
 *  1. PŘEHRATELNOST: dnešní heals NEDOBĚHNE z baseline starší než 2026-07-30.
 *     Tři zlomy: policy volá funkci, jejíž \ir v heals není
 *     (document_visible_to); blok čte tabulku, která tam není
 *     (twin_external_refs); funkce volá surface_audience_allows. Obnova ze
 *     zálohy starší než poslední regenerace baseline + dnešní repo = pád
 *     v půlce migrace s ON_ERROR_STOP=1.
 *
 *  2. GRANTY SE NIKDY NEREVOKUJÍ: substrate nastavuje ALTER DEFAULT
 *     PRIVILEGES (authenticated=arwd), takže objekt založený healsem se RODÍ
 *     zapisovatelný — a `REVOKE ALL FROM PUBLIC` v jeho souboru to nezruší.
 *     Nalezeno živé: auto-updatable view nad integration_services (tabulka
 *     s api_token) s INSERT/UPDATE/DELETE pro authenticated, DML mimo RLS
 *     právy vlastníka.
 *
 *  3. DUPLICITNÍ POLICY SOUBORY: táž policy ve dvou SoT souborech s JINÝM
 *     tělem (starý per-row predikát × nový InitPlan). Generátor baseline
 *     emituje oba a vyhrával STARÝ — příští cold start by vrátil změřenou
 *     DoS páku (41 s na dotaz). Produkci držel správný tvar jen tím, že
 *     heals běží až PO baseline.
 *
 * RATCHET, NE ALLOWLIST: dluh v baseline JSON smí jen klesat. Nový SoT
 * soubor musí mít \ir; položka dluhu, která se zapojí nebo zmizí, se musí
 * z dluhu smazat. Přírůstek = červená.
 */
import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SQL_ROOT = join(ROOT, 'aisha/db/sql');
const HEALS = join(ROOT, 'aisha/db/heals.sql');
const BASELINE = join(ROOT, 'src/tests/gates/heals-pokryva-sot.baseline.json');

/** Složky, které sesterská brána NEHLÍDÁ (ta bere změněné indexes/policies). */
const DIRS = ['functions', 'tables', 'grants', 'triggers', 'views'] as const;

interface Debt {
  unwired: string[];
  duplicate_policy_pairs: string[];
}

const heals = readFileSync(HEALS, 'utf8');
const debt: Debt = JSON.parse(readFileSync(BASELINE, 'utf8'));

/** SoT soubory (relativně k aisha/db/, tak jak je zapisuje \ir). */
function sotFiles(): string[] {
  const out: string[] = [];
  for (const d of DIRS) {
    const dir = join(SQL_ROOT, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.sql')) out.push(`sql/${d}/${f}`);
    }
  }
  return out.sort();
}

const wired = (rel: string) => heals.includes(`\\ir ${rel}`);

describe('heals pokrývá SoT (ratchet)', () => {
  test('měřidlo má co měřit', () => {
    expect(sotFiles().length).toBeGreaterThan(1000);
    expect(debt.unwired.length).toBeGreaterThan(0);
  });

  test('⛔ žádný NOVÝ SoT soubor bez \\ir v heals', () => {
    const known = new Set(debt.unwired);
    const offenders = sotFiles().filter((rel) => !wired(rel) && !known.has(rel));
    expect(
      offenders,
      'SoT soubor bez \\ir v heals se na BĚŽÍCÍ databázi nikdy nepřehraje — ' +
        'dodá ho jen cold-start baseline, takže „hotová" změna nedoteče do ' +
        'produkce a obnova ze starší zálohy dostane jiný svět. Přidej ' +
        '`\\ir <soubor>` do aisha/db/heals.sql (s důvodem v chronologii): ' +
        offenders.join(', '),
    ).toEqual([]);
  });

  test('dluh smí jen KLESAT (zapojené nebo smazané položky z něj musí pryč)', () => {
    const stale = debt.unwired.filter((rel) => {
      const abs = join(ROOT, 'aisha/db', rel);
      return !existsSync(abs) || wired(rel);
    });
    expect(
      stale,
      'Tyhle položky dluhu už neplatí (soubor zmizel nebo dostal \\ir) — ' +
        'smaž je z heals-pokryva-sot.baseline.json, ať ratchet drží: ' +
        stale.join(', '),
    ).toEqual([]);
  });

  test('⛔ duplicitní policy s ODLIŠNÝM tělem nesmí přibývat', () => {
    // Týž výpočet jako audit: CREATE POLICY "x" ON y napříč soubory; dvojice
    // s odlišným normalizovaným tělem je časovaná bomba — kdo vyhraje, určuje
    // pořadí emise v generované baseline, ne úmysl autora.
    // Jméno s uvozovkami I BEZ — první verze brány bez-uvozovkové definice
    // neviděla vůbec (ověřeno mutací M3, která prošla zeleně) a podpočítával
    // je i audit, ze kterého brána vznikla.
    const pat = /CREATE POLICY\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s+ON\s+([a-z_."]+)([\s\S]*?);/gi;
    const defs = new Map<string, Set<string>>();
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.sql')) {
          const src = readFileSync(p, 'utf8')
            .split('\n')
            .filter((l) => !l.trim().startsWith('--'))
            .join('\n');
          for (const m of src.matchAll(pat)) {
            const name = m[1] ?? m[2];
            const key = `${m[3].replace('public.', '').replace(/"/g, '')} :: ${name}`;
            const body = m[4].replace(/\s+/g, ' ').trim().toLowerCase();
            if (!defs.has(key)) defs.set(key, new Set());
            defs.get(key)!.add(body);
          }
        }
      }
    };
    walk(SQL_ROOT);
    const differing = [...defs.entries()]
      .filter(([, bodies]) => bodies.size > 1)
      .map(([k]) => k)
      .sort();
    const known = new Set(debt.duplicate_policy_pairs);
    const fresh = differing.filter((k) => !known.has(k));
    expect(
      fresh,
      'Nová policy definovaná ve víc souborech s JINÝM tělem — kdo vyhraje ' +
        'při cold startu, rozhoduje pořadí emise, ne autor. Slouč do jednoho ' +
        'souboru (a ten dej do heals): ' + fresh.join(', '),
    ).toEqual([]);
    const gone = debt.duplicate_policy_pairs.filter((k) => !differing.includes(k));
    expect(
      gone,
      'Tyhle dvojice už sloučené jsou — smaž je z baseline, ať dluh klesá: ' +
        gone.join(', '),
    ).toEqual([]);
  });
});
