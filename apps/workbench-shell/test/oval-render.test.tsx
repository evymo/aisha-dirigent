import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GoalProgressBlock } from '@aisha/surface-blocks';
import { Block } from '../src/components/blocks.js';

const prov = { source_slug: 'production_workflow', freshness_at: '2026-07-29T00:00:00Z', trace_id: 'x' };

const MILNIKY = [
  { code: 'a', name: 'Naložení', order: 1, status: 'completed' as const },
  { code: 'b', name: 'Přeprava', order: 2, status: 'pending' as const },
  { code: 'c', name: 'Předání', order: 3, status: 'pending' as const }
];

/** Blok s libovolným počtem běhů — pořadí v poli je vstup, ne výsledek. */
const blok = (behy: ReadonlyArray<{ id: string; pos: number; met?: boolean }>): GoalProgressBlock => ({
  schema_version: 1, block_slug: 'g', block_type: 'goal_progress',
  title_key: 'app.blocks.goal', sensitivity: 'internal', provenance: prov,
  data: {
    runs: behy.map((b) => ({
      batch_id: b.id, title: b.id, pos: b.pos, state: 's', total: 3, completed: 1, failed: 0,
      milestones: MILNIKY, goal: b.met ? { met: true } : null
    }))
  }
});

/** Souřadnice jezdců tak, jak je renderer opravdu nakreslil. */
const jezdci = (html: string) =>
  [...html.matchAll(
    /class="rdl-circuit__car[^"]*"[^>]*>(?:<title>[^<]*<\/title>)?<circle cx="([\d.]+)" cy="([\d.]+)"/g
  )].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

const vzdalenost = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('okruh (goal_progress) — poloha je DATA, ne dekorace', () => {
  it('jezdec se kreslí z pos, ne z pořadí v poli', () => {
    // Táž dvojice běhů, opačně seřazená. Kdyby se poloha brala z indexu,
    // body by se prohodily; z `pos` musí každý zůstat na svém.
    const a = jezdci(renderToStaticMarkup(<Block block={blok([{ id: 'A', pos: 0.1 }, { id: 'B', pos: 0.6 }])} />));
    const b = jezdci(renderToStaticMarkup(<Block block={blok([{ id: 'B', pos: 0.6 }, { id: 'A', pos: 0.1 }])} />));
    expect(a).toHaveLength(2);
    expect(a[0]).toEqual(b[1]);
    expect(a[1]).toEqual(b[0]);
    // …a jsou to dvě různá místa na trati, ne dva body u sebe.
    expect(vzdalenost(a[0]!, a[1]!)).toBeGreaterThan(20);
  });

  it('jezdci vůbec JSOU — statický render nesmí vrátit prázdnou trať', () => {
    // Naměřeno 2026-08-01: poloha se počítala `getPointAtLength` v `useEffect`,
    // takže při serverovém i testovacím renderu byla trať bez jediného jezdce.
    // Prázdná trať vypadá jako „žádné běhy", ne jako vada — proto vlastní kontrola.
    expect(jezdci(renderToStaticMarkup(<Block block={blok([{ id: 'A', pos: 0.3 }])} />))).toHaveLength(1);
  });

  it('nula je start/cíl — kontrakt polohy má pevný počátek', () => {
    // Bez pevného počátku je „30 %" jen odstín; s ním je to místo na trati.
    const html = renderToStaticMarkup(<Block block={blok([{ id: 'A', pos: 0 }])} />);
    const start = /<line x1="([\d.]+)" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" class="rdl-circuit__start"/.exec(html)!;
    expect(jezdci(html)[0]!.x).toBeCloseTo(Number(start[1]), 1);
  });

  it('tři milníky = tři sektorové rysky', () => {
    const html = renderToStaticMarkup(<Block block={blok([{ id: 'A', pos: 0.3 }])} />);
    expect((html.match(/class="rdl-circuit__tick"/g) ?? []).length).toBe(3);
  });

  it('splněný cíl je gain, ne akcent — a ta barva je v jazyce SKUTEČNĚ navázaná', () => {
    const html = renderToStaticMarkup(<Block block={blok([{ id: 'A', pos: 1, met: true }])} />);
    expect(html).toContain('rdl-circuit__car is-gain');

    // Samotný název třídy nic nebarví. Naměřeno 2026-08-01: tón se jmenoval
    // `is-ok` a mířil na `var(--ok, var(--accent))` — token `--ok` v jazyce není,
    // takže splněný cíl vyšel akcentem a v markupu to vidět nebylo. Proto se
    // vazba ověřuje až ve stylech, ne jen podle jména třídy.
    const css = readFileSync(
      fileURLToPath(new URL('../../../packages/design-language/src/styles.css', import.meta.url)),
      'utf-8'
    );
    expect(css).toMatch(/\.rdl-circuit__car\.is-gain circle\s*{\s*fill:\s*var\(--gain\)/);
    expect(css).not.toMatch(/\.rdl-circuit__car[^\n]*var\(--(ok|warn|danger)\b/);
  });

  it('běh, který jen jede, není výstraha ani ztráta', () => {
    const html = renderToStaticMarkup(<Block block={blok([{ id: 'A', pos: 0.4 }])} />);
    expect(html).toContain('rdl-circuit__car is-info');
  });
});
