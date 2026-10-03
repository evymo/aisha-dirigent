/**
 * Benchmark scorer — turns a model's response to a benchmark task into quality scores
 * (relevance / groundedness / safety / coherence / overall, each 0..1).
 *
 * Two signals, composed:
 *   - HEURISTIC (always, deterministic): the task's `expect` rule (contains / JSON
 *     shape) gives an objective correctness signal — no network, fully testable.
 *   - JUDGE (optional, injected): an LLM-as-judge rates the four dimensions. Injected so
 *     the runner can wire a real derived judge model while unit tests stay deterministic.
 *     A judge failure degrades to the heuristic — never throws.
 */

export interface BenchmarkTask {
  id: string;
  task_type: string;
  /**
   * Jazyk zadání. Skóre se agreguje per (model, task_type) přes OBA jazyky — výběr
   * modelu tak odráží i češtinu, ne jen angličtinu (sada byla do 2026-09-13 jen anglická).
   */
  language?: 'cs' | 'en';
  prompt: string;
  expect?: { contains?: string; containsAll?: string[]; jsonArrayMinLength?: number };
  rubric?: string;
}

export interface TaskScore {
  relevance: number;
  groundedness: number;
  safety: number;
  coherence: number;
  overall: number;
}

/** Injected LLM-as-judge: rates a response on the four dimensions (0..1 each). */
export type JudgeFn = (input: { prompt: string; response: string; rubric?: string }) => Promise<{
  relevance: number;
  groundedness: number;
  safety: number;
  coherence: number;
}>;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const avg = (a: number, b: number): number => (a + b) / 2;

/** Strip ``` fences so a JSON answer wrapped in a code block still parses. */
function stripFences(s: string): string {
  return s.replace(/```(?:json)?/gi, '').trim();
}

/** Deterministic correctness from the task's `expect` rule, 0..1. */
export function heuristicCorrectness(task: BenchmarkTask, response: string): number {
  const text = (response ?? '').trim();
  if (!text) return 0;
  const e = task.expect;
  if (!e) return text.length > 0 ? 1 : 0;

  if (e.contains !== undefined) {
    return text.toLowerCase().includes(e.contains.toLowerCase()) ? 1 : 0;
  }
  if (e.containsAll !== undefined) {
    // Every required substring must appear (e.g. an extraction that must yield ALL fields).
    // Partial credit (hits/total) is a finer signal than binary — discriminates a model
    // that extracts 1 of 2 fields from one that extracts both.
    const lower = text.toLowerCase();
    const hits = e.containsAll.filter((s) => lower.includes(s.toLowerCase())).length;
    return e.containsAll.length > 0 ? hits / e.containsAll.length : 1;
  }
  if (e.jsonArrayMinLength !== undefined) {
    try {
      const parsed = JSON.parse(stripFences(text));
      return Array.isArray(parsed) && parsed.length >= e.jsonArrayMinLength ? 1 : 0;
    } catch {
      return 0;
    }
  }
  return text.length > 0 ? 1 : 0;
}

/** Heuristic-only score: correctness drives relevance+groundedness+overall; a non-empty response is assumed safe + coherent. */
export function heuristicScore(task: BenchmarkTask, response: string): TaskScore {
  const correct = heuristicCorrectness(task, response);
  const nonEmpty = (response ?? '').trim().length > 0 ? 1 : 0;
  return { relevance: correct, groundedness: correct, safety: nonEmpty, coherence: nonEmpty, overall: correct };
}

/**
 * Score one task. With a judge, blend the objective heuristic with the judge's
 * dimensional ratings (heuristic anchors relevance/groundedness/overall so a confidently
 * wrong answer can't be talked up); without one, the heuristic stands alone.
 */
export async function scoreTask(task: BenchmarkTask, response: string, judge?: JudgeFn): Promise<TaskScore> {
  const h = heuristicScore(task, response);
  if (!judge) return h;
  try {
    const j = await judge({ prompt: task.prompt, response, rubric: task.rubric });
    const relevance = avg(h.relevance, clamp01(j.relevance));
    const groundedness = avg(h.groundedness, clamp01(j.groundedness));
    const safety = avg(h.safety, clamp01(j.safety));
    const coherence = avg(h.coherence, clamp01(j.coherence));
    const overall = avg(h.overall, (relevance + groundedness + safety + coherence) / 4);
    return { relevance, groundedness, safety, coherence, overall };
  } catch {
    return h; // judge unreachable → objective heuristic stands
  }
}

/** Mean of per-task scores → the aggregate benchmark for a (model, task_type). */
export function aggregateScores(scores: TaskScore[]): TaskScore {
  if (scores.length === 0) return { relevance: 0, groundedness: 0, safety: 0, coherence: 0, overall: 0 };
  const sum = scores.reduce(
    (acc, s) => ({
      relevance: acc.relevance + s.relevance,
      groundedness: acc.groundedness + s.groundedness,
      safety: acc.safety + s.safety,
      coherence: acc.coherence + s.coherence,
      overall: acc.overall + s.overall,
    }),
    { relevance: 0, groundedness: 0, safety: 0, coherence: 0, overall: 0 },
  );
  const n = scores.length;
  return {
    relevance: sum.relevance / n,
    groundedness: sum.groundedness / n,
    safety: sum.safety / n,
    coherence: sum.coherence / n,
    overall: sum.overall / n,
  };
}
