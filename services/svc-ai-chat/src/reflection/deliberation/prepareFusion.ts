/**
 * Fusion contract — the pure pre-flight for the `tot_synthesize` node.
 *
 * The distinctive move of a council is FUSION, not selection: the judge reads N
 * parallel drafts, reconciles agreements / contradictions / omissions, and emits
 * ONE combined answer. Our existing `critic` node *scores one draft* and our ToT
 * search *selects a branch* — neither fuses. `tot_synthesize` (E1, depends on the
 * ToT v1 nodes) is the LLM step that fuses; this module is its dependency-free
 * guard so the judge is never invoked wastefully:
 *
 *   - reject an empty candidate set (nothing to fuse),
 *   - drop empty drafts and de-duplicate identical ones (don't pay the judge to
 *     reconcile copies — a real risk when cheap drafters converge),
 *   - short-circuit to passthrough when only one distinct candidate survives,
 *   - cap the panel width handed to the judge.
 *
 * The judge PROMPT contract (find agreements / contradictions / omissions, then
 * synthesize) lives with the `tot_synthesize` node; this file owns only the
 * deterministic, testable plumbing around it.
 */

export interface FuseCandidate {
  /** Drafter identity for provenance (model id / slot / branch id). */
  source: string;
  /** The candidate answer text. */
  text: string;
}

export interface FusionPrep {
  /** Whether the judge/fuse step should run at all. */
  shouldFuse: boolean;
  /** Distinct, capped candidates to hand to the judge (fusion case). */
  candidates: FuseCandidate[];
  /** How many raw candidates were dropped as duplicates or empties. */
  droppedCount: number;
  /** When `shouldFuse` is false, the single answer to return as-is. */
  passthrough?: FuseCandidate;
  /** Audit-readable justification. */
  reason: string;
}

/** Collapse whitespace + lowercase so trivially-different copies dedupe. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Prepare a set of drafter candidates for fusion. Pure. Throws only on a
 * structurally invalid call (no candidates at all / all empty) — those are
 * programming errors upstream, not runtime conditions to coerce.
 */
export function prepareFusion(raw: FuseCandidate[], maxCandidates = 5): FusionPrep {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('prepareFusion: no candidates to fuse');
  }
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error(`prepareFusion: invalid maxCandidates=${String(maxCandidates)}`);
  }

  const byKey = new Map<string, FuseCandidate>();
  for (const candidate of raw) {
    const key = normalize(candidate.text ?? '');
    if (key.length === 0) continue; // drop empty / whitespace-only drafts
    if (!byKey.has(key)) byKey.set(key, candidate); // first writer wins (stable)
  }

  const distinct = [...byKey.values()];
  const droppedCount = raw.length - distinct.length;

  if (distinct.length === 0) {
    throw new Error('prepareFusion: all candidates were empty');
  }

  if (distinct.length === 1) {
    return {
      shouldFuse: false,
      candidates: distinct,
      droppedCount,
      passthrough: distinct[0],
      reason: 'single distinct candidate after dedup: no fusion needed (passthrough)',
    };
  }

  const capped = distinct.slice(0, maxCandidates);
  const overflow = distinct.length - capped.length;
  return {
    shouldFuse: true,
    candidates: capped,
    droppedCount,
    reason:
      `fuse ${capped.length} distinct candidate(s); ` +
      `dropped ${droppedCount} dup/empty` +
      (overflow > 0 ? `, capped ${overflow} over maxCandidates=${maxCandidates}` : ''),
  };
}
