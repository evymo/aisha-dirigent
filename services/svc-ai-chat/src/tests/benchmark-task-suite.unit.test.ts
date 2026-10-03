/**
 * Benchmark sada — čeština je v ní rovnocenně, a každá úloha je SPLNITELNÁ.
 *
 * ⛔ NAMĚŘENO 2026-09-13: BENCHMARK_TASKS byla jen anglická, takže výběr modelu
 * (aisha_resolve_clow_backend / get_adaptive_model_tiers čtou agregát per task_type)
 * neodrážel češtinu — primární jazyk platformy.
 *
 * Drží se:
 *   1. každá úloha deklaruje jazyk; každý task_type má úlohy obou jazyků,
 *   2. ke každé anglické úloze existuje česká téhož tvaru (`cs-<id>`) a téhož task_type,
 *   3. heuristika je splnitelná: vzorová správná česká odpověď dá 1, typická chyba 0
 *      (bez tohohle kontrolního vzorku by úloha s nesplnitelným `expect` jen tiše srážela
 *      skóre všem modelům).
 */
import { describe, expect, it } from 'vitest';
import { BENCHMARK_TASKS } from '../lib/benchmarkTaskSuite.js';
import { heuristicCorrectness } from '../lib/benchmarkScorer.js';

/** Vzorové odpovědi: [správná, typická chyba] pro každou českou úlohu. */
const VZORY: Record<string, [string, string]> = {
  'cs-factual-recall': ['Paříž', 'Paris'],
  'cs-instruction-follow': ['POTVRZENO', 'ANO'],
  'cs-arithmetic-reason': ['40', '90'],
  'cs-inflection': ['vody', 'voda'],
  'cs-structured-output': ['["červená", "zelená", "modrá"]', 'červená, zelená, modrá'],
  'cs-sentiment-classify': ['negativní', 'pozitivní'],
  'cs-topic-classify': ['technologie', 'zdraví'],
  'cs-transitive-order': ['Cyril', 'Alena'],
  'cs-rate-trap': ['5', '100'],
  'cs-field-extract': ['{"jmeno": "Marie", "mesto": "Brno"}', '{"jmeno": "Marie", "mesto": "Brna"}'],
  'cs-number-extract': ['[12, 7]', '12 a 7'],
};

describe('BENCHMARK_TASKS — čeština a splnitelnost', () => {
  it('id úloh jsou jedinečná a každá úloha deklaruje jazyk', () => {
    const ids = BENCHMARK_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BENCHMARK_TASKS) expect(['cs', 'en'], `${t.id} bez jazyka`).toContain(t.language);
  });

  it('⛔ každý task_type má úlohy v češtině i angličtině', () => {
    const typy = new Set(BENCHMARK_TASKS.map((t) => t.task_type));
    for (const typ of typy) {
      const jazyky = new Set(BENCHMARK_TASKS.filter((t) => t.task_type === typ).map((t) => t.language));
      expect([...jazyky].sort(), `task_type ${typ}`).toEqual(['cs', 'en']);
    }
  });

  it('ke každé anglické úloze existuje česká téhož tvaru a téhož task_type', () => {
    // Ne-česká úloha (i bez deklarovaného jazyka) musí mít českou dvojici — jinak by
    // test nad sadou bez `language` prošel naprázdno (ověřeno negativní sondou).
    const neCeske = BENCHMARK_TASKS.filter((t) => t.language !== 'cs');
    expect(neCeske.length).toBeGreaterThan(0);
    for (const en of neCeske) {
      const cs = BENCHMARK_TASKS.find((t) => t.id === `cs-${en.id}`);
      expect(cs, `chybí cs-${en.id}`).toBeDefined();
      expect(cs!.language).toBe('cs');
      expect(cs!.task_type).toBe(en.task_type);
      expect(Object.keys(cs!.expect ?? {})).toEqual(Object.keys(en.expect ?? {}));
    }
  });

  it('⛔ česká úloha je splnitelná: vzor dá 1, typická chyba 0 (kontrolní vzorek)', () => {
    const ceske = BENCHMARK_TASKS.filter((t) => t.language === 'cs');
    expect(ceske.map((t) => t.id).sort()).toEqual(Object.keys(VZORY).sort());
    for (const t of ceske) {
      const [spravne, chyba] = VZORY[t.id];
      expect(heuristicCorrectness(t, spravne), `${t.id}: správná odpověď neprošla`).toBe(1);
      expect(heuristicCorrectness(t, chyba), `${t.id}: chyba prošla`).toBeLessThan(1);
    }
  });

  it('diakritika nerozhoduje o velikosti písmen (PAŘÍŽ = Paříž), ale chybějící diakritika je chyba', () => {
    const t = BENCHMARK_TASKS.find((x) => x.id === 'cs-factual-recall')!;
    expect(heuristicCorrectness(t, 'PAŘÍŽ')).toBe(1);
    expect(heuristicCorrectness(t, 'Pariz')).toBe(0);
  });
});
