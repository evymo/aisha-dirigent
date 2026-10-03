import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimingTowerBlock } from '@aisha/surface-blocks';
import { Block, runToTask, sectorsToPhases } from '../src/components/blocks.js';

const prov = { source_slug: 'production_workflow', freshness_at: '2026-07-29T00:00:00Z', trace_id: 'x' };

const SEKTORY = [
  { code: 'a', name: 'Naložení', order: 1, status: 'completed' },
  { code: 'b', name: 'Přeprava', order: 2, status: 'active' },
  { code: 'c', name: 'Předání', order: 3, status: 'pending' }
];

const beh = (o: Partial<TimingTowerBlock['data']['runs'][number]> = {}): TimingTowerBlock['data']['runs'][number] => ({
  batch_id: 'B-1', title: 'Šarže 1', pos: 0.4, sectors: SEKTORY, flag: 'green', ...o
});

const blok = (runs: TimingTowerBlock['data']['runs']): TimingTowerBlock => ({
  schema_version: 1, block_slug: 'tw', block_type: 'timing_tower',
  title_key: 'app.blocks.tower', sensitivity: 'internal', provenance: prov,
  data: { runs }
});

describe('věž (timing_tower → StoryLoopMC) — mapování je kontrakt, ne dekorace', () => {
  it('vlajky procházejí doslova — oba slovníky jsou green|yellow|red|box|finish', () => {
    // Kdyby se tu překládalo, překlad je místo, kde se ztratí pátá vlajka
    // (přesně to se stalo instanční šabloně se čtyřmi vlajkami).
    for (const flag of ['green', 'yellow', 'red', 'box', 'finish'] as const) {
      expect(runToTask(beh({ flag }), prov, 'f')).toMatchObject({ flag });
    }
  });

  it('pos je sevřené do ⟨0;1⟩ — poloha mimo trať není poloha', () => {
    expect(runToTask(beh({ pos: -0.2 }), prov, 'f').pos).toBe(0);
    expect(runToTask(beh({ pos: 1.7 }), prov, 'f').pos).toBe(1);
    expect(runToTask(beh({ pos: 0.4 }), prov, 'f').pos).toBe(0.4);
  });

  it('provenance jede s úkolem jako src — žádné číslo bez zdroje', () => {
    expect(runToTask(beh(), prov, '29. 7. 2026')).toMatchObject({
      src: [{ source: 'production_workflow', freshness: '29. 7. 2026' }]
    });
  });

  it('ent/done/radio se NEVYMÝŠLEJÍ — dokud je neposílá producent, klíče neexistují', () => {
    // Vyrobená nula by na desce vypadala jako změřený čas, který nikdo neměřil.
    const task = runToTask(beh(), prov, 'f');
    expect(task).not.toHaveProperty('ent');
    expect(task).not.toHaveProperty('done');
    expect(task).not.toHaveProperty('radio');
  });

  it('sektory šablony → kotvy fází: seřazené podle order, trať rozdělená beze zbytku', () => {
    // Vstup schválně pozpátku — pořadí je `order`, ne index v poli.
    const phases = sectorsToPhases([SEKTORY[2]!, SEKTORY[0]!, SEKTORY[1]!]);
    expect(phases.map((p) => p.key)).toEqual(['a', 'b', 'c']);
    expect(phases[0]).toMatchObject({ from: 0 });
    expect(phases[phases.length - 1]).toMatchObject({ to: 1 });
    for (let i = 1; i < phases.length; i++) expect(phases[i]!.from).toBe(phases[i - 1]!.to);
  });

  it('šablona bez sektorů = žádné kotvy (komponenta si vezme výchozí), ne NaN', () => {
    expect(sectorsToPhases([])).toEqual([]);
  });

  it('render předává běhy elementu <story-loop-mc> a nese provenanci sekce', () => {
    // Custom element je v statickém renderu inertní značka — vlastnosti výše
    // jsou proto testované na mapovacích funkcích; tady se jistí jen to, že
    // renderer element opravdu vystaví a rám sekce (titulek + provenance) drží.
    const html = renderToStaticMarkup(<Block block={blok([beh()])} />);
    expect(html).toContain('<story-loop-mc');
    expect(html).toContain('production_workflow');
  });

  it('bez běhů se element nevystavuje — prázdná deska je stav, ne rozbitá deska', () => {
    const html = renderToStaticMarkup(<Block block={blok([])} />);
    expect(html).not.toContain('<story-loop-mc');
  });
});
