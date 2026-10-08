import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Každý klíč, který generate-secrets vydává přes `pg()`, je VÝSLOVNĚ zařazený:
 * stavový (na hodnotě závisí data nebo svazek) nebo bezstavový (podpis / sdílené
 * heslo, které cold-start v témže běhu doručí všem stranám).
 *
 * ⛔ PROČ (konvergence existující instance, 2026-10-03): `pg()` dřív bral každý klíč
 * mimo STATELESS_KEYS jako stavový. Nové sdílené tajemství nad existujícím stackem
 * (`--stack-exists`, cold-start `--skip-create`) proto generátor odmítl vyrobit
 * a konvergence padla v kroku 2 — v okně nasazení, ne při psaní kódu. Výchozí
 * zařazení proto neexistuje; tahle brána to přenáší do commitu (pg() nezařazený
 * klíč odmítne i za běhu).
 */
const SOUBOR = resolve(__dirname, '../../../scripts/generate-secrets.mjs');

function mnozina(zdroj: string, jmeno: string): string[] {
  const m = zdroj.match(new RegExp(`const ${jmeno} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  if (!m) throw new Error(`generate-secrets.mjs: množina ${jmeno} nenalezena (změnil se tvar?)`);
  return [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]);
}

/** Klíče volané přes pg('KLIC', …) — mimo komentáře. */
function pgKlice(zdroj: string): string[] {
  const bezKomentaru = zdroj
    .split('\n')
    .filter((r) => !r.trimStart().startsWith('//') && !r.trimStart().startsWith('*'))
    .join('\n');
  const dosl = [...bezKomentaru.matchAll(/\bpg\(\s*'([A-Z0-9_]+)'/g)].map((x) => x[1]);
  // pg() s proměnnou: jediné dovolené místo je jwtDependent(key, role) — jeho klíče se čtou z volání.
  const jwt = [...bezKomentaru.matchAll(/\bjwtDependent\(\s*'([A-Z0-9_]+)'/g)].map((x) => x[1]);
  return [...new Set([...dosl, ...jwt])].sort();
}

/** Volání pg(), jejichž klíč NENÍ doslovný (mimo definici funkce) — měřidlo by je nevidělo. */
function pgNedoslovne(zdroj: string): string[] {
  return zdroj
    .split('\n')
    .filter((r) => !r.trimStart().startsWith('//') && !r.trimStart().startsWith('*'))
    .filter((r) => /\bpg\(/.test(r) && !/\bpg\(\s*'[A-Z0-9_]+'/.test(r) && !/function pg\(/.test(r));
}

/** Nálezy zařazení — prázdné pole = v pořádku. */
function nalezy(zdroj: string): string[] {
  const stavove = new Set(mnozina(zdroj, 'STATEFUL_KEYS'));
  const bezstavove = new Set(mnozina(zdroj, 'STATELESS_KEYS'));
  const klice = pgKlice(zdroj);
  const out: string[] = [];
  for (const k of klice) {
    const s = stavove.has(k);
    const b = bezstavove.has(k);
    if (s && b) out.push(`${k}: v OBOU množinách`);
    else if (!s && !b) out.push(`${k}: NEZAŘAZENÝ (STATEFUL_KEYS / STATELESS_KEYS)`);
  }
  const vse = new Set(klice);
  for (const k of [...stavove, ...bezstavove]) {
    if (!vse.has(k)) out.push(`${k}: zařazený, ale pg() ho nevydává (zbytek po odebraném klíči)`);
  }
  return out;
}

describe('generate-secrets: každý pg() klíč je výslovně zařazený', () => {
  const zdroj = readFileSync(SOUBOR, 'utf8');

  it('pg() s nedoslovným klíčem je jen v jwtDependent — jinak měřidlo rozšiř', () => {
    const r = pgNedoslovne(zdroj);
    expect(r.length, r.join('\n')).toBe(1);
    expect(r[0]).toMatch(/jwtSecretPreserved\) return pg\(key,/);
  });

  it('měřidlo vidí klíče (ne prázdný výsledek z jiného tvaru souboru)', () => {
    expect(pgKlice(zdroj).length).toBeGreaterThan(50);
    expect(mnozina(zdroj, 'STATELESS_KEYS')).toContain('JWT_SECRET');
  });

  it('žádný klíč bez zařazení, žádný v obou množinách, žádný zbytek', () => {
    expect(
      nalezy(zdroj),
      'Rozhodni u klíče, zda na jeho hodnotě závisí data nebo svazek: ano → STATEFUL_KEYS, ' +
        'ne (podpis / sdílené heslo doručené v témže běhu) → STATELESS_KEYS. ' +
        'Nezařazený klíč by konvergence existující instance odmítla vyrobit.',
    ).toEqual([]);
  });

  it('⛔ mutace: nový pg() klíč bez zařazení brána NAJDE', () => {
    const mutant = zdroj.replace(
      /\nfunction pg\(/,
      "\nemit('ZKOUSKA_NOVY_KLIC', pg('ZKOUSKA_NOVY_KLIC', () => secret(32)));\nfunction pg(",
    );
    expect(mutant).not.toBe(zdroj);
    expect(nalezy(mutant)).toContain('ZKOUSKA_NOVY_KLIC: NEZAŘAZENÝ (STATEFUL_KEYS / STATELESS_KEYS)');
  });

  it('⛔ mutace: klíč v obou množinách brána NAJDE', () => {
    const mutant = zdroj.replace(
      'const STATELESS_KEYS = new Set([',
      "const STATELESS_KEYS = new Set([\n  'APPSMITH_ENCRYPTION_PASSWORD',",
    );
    expect(mutant).not.toBe(zdroj);
    const n = nalezy(mutant);
    // klíč, který pg() vydává a je ve stavových, teď stojí v obou
    expect(n).toContain('APPSMITH_ENCRYPTION_PASSWORD: v OBOU množinách');
  });
});
