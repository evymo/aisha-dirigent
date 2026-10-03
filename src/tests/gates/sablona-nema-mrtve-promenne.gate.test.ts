/**
 * BRÁNA: v `config/domains.env` nesmí zůstat proměnná, kterou nikdo nekonzumuje.
 *
 * ⛔ NAMĚŘENO 2026-09-01. Šablona nesla `CORE_MESH_HOST`, `EDGE_MESH_HOST`,
 * `LEDGER_MESH_HOST` a `INTEGRATION_MESH_HOST` — všechny s fallbackem a
 * s NULOU konzumentů (první tři nepoužívala ani šablona sama). Protože se
 * nikdy nedoručovaly, jejich fallback BYL hodnotou ve 100 % běhů — a měl
 * špatný tvar (mesh jméno bez prefixu instance).
 *
 * Následek: `RAGNAROK_URL` se z nich skládal, rozcházel se se SoT a nasazení
 * u KAŽDÉHO běhu hlásilo varování. Rada v tom varování („doplň do
 * OWNED_COMPOSITES") by správnou hodnotu PŘEPSALA tou špatnou.
 *
 * Mrtvá proměnná není inventář, je to nález: nikdo ji nečte, takže o ní nikdo
 * neví, že lže.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const sablona = readFileSync(join(ROOT, 'config/domains.env'), 'utf-8');

/** Jména, která šablona DEFINUJE (levá strana `KEY=`), bez komentářů. */
const definovane = sablona
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
  .filter((x): x is string => Boolean(x));

/** Univerzum konzumentů se HLEDÁ, nepíše — jinak mine právě to, na co se zapomnělo. */
function ctenari(): string {
  const out: string[] = [];
  const chod = (d: string, hloubka = 0) => {
    if (hloubka > 3) return;
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === '.git' || n.startsWith('.wt-')) continue;
      const p = join(d, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) chod(p, hloubka + 1);
      else if (/\.(yml|yaml|sh|mjs|ts|env)$/.test(n) && p !== join(ROOT, 'config/domains.env')) {
        try { out.push(readFileSync(p, 'utf-8')); } catch { /* nečitelné = neměřeno */ }
      }
    }
  };
  chod(ROOT);
  return out.join('\n');
}

describe('brána: šablona nemá mrtvé proměnné', () => {
  const vse = ctenari();

  it('sonda má co měřit — šablona něco definuje a čtenáři se našli', () => {
    expect(definovane.length).toBeGreaterThan(10);
    expect(vse.length).toBeGreaterThan(10_000);
  });

  it('mesh hostitelé bez konzumenta v šabloně NEJSOU', () => {
    // Třída, která to způsobila. Obecné pravidlo přes VŠECHNY proměnné by
    // dnes hlásilo i legitimní dluh; tohle drží aspoň tu vadu, co bolela.
    const mrtvi = ['CORE_MESH_HOST', 'EDGE_MESH_HOST', 'LEDGER_MESH_HOST', 'INTEGRATION_MESH_HOST']
      .filter((v) => definovane.includes(v));
    expect(mrtvi).toEqual([]);
  });

  it('RAGNAROK_URL se ze šablony neskládá — není odvoditelná', () => {
    expect(definovane).not.toContain('RAGNAROK_URL');
  });
});
