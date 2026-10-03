/**
 * Benchmark scorer — the heuristic is deterministic (fixed input → fixed score, no
 * network), the judge blend anchors on it, and aggregation averages per-task scores.
 */
import { describe, it, expect } from 'vitest';
import {
  heuristicCorrectness,
  heuristicScore,
  scoreTask,
  aggregateScores,
  type BenchmarkTask,
  type JudgeFn,
} from '../lib/benchmarkScorer.js';

const task = (e: BenchmarkTask['expect']): BenchmarkTask => ({ id: 't', task_type: 'chat', prompt: 'p', expect: e });

describe('heuristicCorrectness', () => {
  it('contains: matches case-insensitively, misses cleanly', () => {
    expect(heuristicCorrectness(task({ contains: 'Paris' }), 'The capital is paris.')).toBe(1);
    expect(heuristicCorrectness(task({ contains: 'Paris' }), 'London')).toBe(0);
  });

  it('jsonArrayMinLength: valid array of length passes, incl. fenced; short/garbage fail', () => {
    expect(heuristicCorrectness(task({ jsonArrayMinLength: 3 }), '["red","green","blue"]')).toBe(1);
    expect(heuristicCorrectness(task({ jsonArrayMinLength: 3 }), '```json\n["red","green","blue"]\n```')).toBe(1);
    expect(heuristicCorrectness(task({ jsonArrayMinLength: 3 }), '["red","green"]')).toBe(0);
    expect(heuristicCorrectness(task({ jsonArrayMinLength: 3 }), 'not json')).toBe(0);
  });

  it('containsAll: full credit when all present, partial per field, 0 when none (extraction)', () => {
    expect(heuristicCorrectness(task({ containsAll: ['Maria', 'Prague'] }), '{"name":"Maria","city":"Prague"}')).toBe(1);
    expect(heuristicCorrectness(task({ containsAll: ['Maria', 'Prague'] }), 'Maria went somewhere')).toBe(0.5);
    expect(heuristicCorrectness(task({ containsAll: ['Maria', 'Prague'] }), 'nobody here')).toBe(0);
  });

  it('empty response → 0', () => {
    expect(heuristicCorrectness(task({ contains: 'x' }), '   ')).toBe(0);
  });

  it('heuristicScore: a correct answer scores relevance/groundedness/overall = 1', () => {
    expect(heuristicScore(task({ contains: 'Paris' }), 'Paris')).toMatchObject({ relevance: 1, groundedness: 1, overall: 1 });
  });
});

describe('scoreTask with judge', () => {
  it('blends the heuristic with the judge dimensions', async () => {
    const judge: JudgeFn = async () => ({ relevance: 0.5, groundedness: 0.5, safety: 1, coherence: 1 });
    const s = await scoreTask(task({ contains: 'Paris' }), 'Paris', judge); // heuristic 1, judge 0.5 → avg 0.75
    expect(s.relevance).toBeCloseTo(0.75);
    expect(s.safety).toBe(1);
  });

  it('a judge failure degrades to the heuristic — never throws', async () => {
    const judge: JudgeFn = async () => {
      throw new Error('judge unreachable');
    };
    const s = await scoreTask(task({ contains: 'Paris' }), 'Paris', judge);
    expect(s.overall).toBe(1);
  });

  it('clamps an out-of-range judge score', async () => {
    const judge: JudgeFn = async () => ({ relevance: 5, groundedness: -2, safety: 1, coherence: 1 });
    const s = await scoreTask(task({ contains: 'Paris' }), 'Paris', judge);
    expect(s.relevance).toBeLessThanOrEqual(1);
    expect(s.groundedness).toBeGreaterThanOrEqual(0);
  });
});

describe('aggregateScores', () => {
  it('averages per-task scores', () => {
    const agg = aggregateScores([
      { relevance: 1, groundedness: 1, safety: 1, coherence: 1, overall: 1 },
      { relevance: 0, groundedness: 0, safety: 1, coherence: 1, overall: 0 },
    ]);
    expect(agg.overall).toBe(0.5);
    expect(agg.safety).toBe(1);
  });

  it('empty → zeros', () => {
    expect(aggregateScores([]).overall).toBe(0);
  });
});
