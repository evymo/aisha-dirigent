/**
 * `withAitgGuard()` — the call-site middleware. Wrap any function that
 * produces an LLM response and the guard will:
 *
 *   1. Run heuristic classifiers (configurable per call site).
 *   2. Record a row in `aitg_runs` via the supplied runner.
 *   3. Optionally REWRITE the response when a classifier flags a violation
 *      (e.g. strip a canary leak, replace with a safe refusal).
 *   4. Return the (possibly rewritten) result PLUS the AITG run id.
 *
 * Why a wrapper rather than a Fastify hook: the same call site is invoked
 * from HTTP routes, n8n callouts, MCP tool dispatch, and Aisha's internal
 * loops. The wrapper is transport-agnostic; the Fastify integration layer
 * just decides WHICH classifiers to enable.
 *
 * The OWASP umbrella discovery gate enforces that every file that imports
 * an LLM provider also imports `withAitgGuard` (or is baselined).
 */

import { createSafeLogger } from '@aisha/security';
import {
  classifyPromptInjection,
  detectCanary,
  classifyToxicity,
  type CanaryDetection,
} from './classifiers.js';
import type { AitgRunner } from './runner.js';
import type { AitgStatus, AitgSeverity, AitgTrigger } from './schemas.js';

export interface AitgGuardOptions {
  runner: AitgRunner;
  buildSha: string;
  triggeredBy: AitgTrigger;
  /** Map of test ids to enable for this call site. Order matters: first match wins. */
  enabled: Array<'AITG-APP-01' | 'AITG-APP-03' | 'AITG-APP-12' | 'AITG-DAT-02'>;
  /** Canary string to seed into context (for APP-03 / DAT-02). */
  canary?: string;
  /** Service name for log tagging. */
  service: string;
}

export interface AitgGuardResult<T> {
  /** The original (or rewritten-safe) result of the wrapped function. */
  result: T;
  /** Map of test_id → run_id (null if record() failed transport). */
  runIds: Record<string, string | null>;
  /** True when at least one classifier reported a violation. */
  violated: boolean;
  /** Per-classifier observation (debug + audit). */
  observations: Record<string, unknown>;
}

export interface AitgGuardableResponse {
  text: string;
}

export async function withAitgGuard<T extends AitgGuardableResponse>(
  opts: AitgGuardOptions,
  fn: () => Promise<T>,
): Promise<AitgGuardResult<T>> {
  const log = createSafeLogger(`aitg-guard:${opts.service}`);
  const result = await fn();
  const text = result.text;

  const runIds: Record<string, string | null> = {};
  const observations: Record<string, unknown> = {};
  let violated = false;

  for (const testId of opts.enabled) {
    let status: AitgStatus = 'passed';
    let severity: AitgSeverity = 'info';
    let observation: Record<string, unknown> = {};

    switch (testId) {
      case 'AITG-APP-01': {
        const c = classifyPromptInjection(text);
        observation = { matchedMarkers: c.matchedMarkers, score: c.score };
        if (c.violated) {
          status = 'failed';
          severity = 'high';
          violated = true;
        }
        break;
      }
      case 'AITG-APP-03':
      case 'AITG-DAT-02': {
        if (!opts.canary) {
          observation = { skipped: 'no_canary_provided' };
          status = 'not_applicable';
        } else {
          const c: CanaryDetection = detectCanary(text, opts.canary);
          observation = { leaked: c.leaked, evidence: c.evidence };
          if (c.leaked) {
            status = 'failed';
            severity = 'critical';
            violated = true;
          }
        }
        break;
      }
      case 'AITG-APP-12': {
        const c = classifyToxicity(text);
        observation = { categories: c.categories, score: c.score };
        if (c.toxic) {
          status = 'failed';
          severity = 'high';
          violated = true;
        }
        break;
      }
    }

    observations[testId] = observation;
    const runId = await opts.runner.record({
      testId,
      buildSha: opts.buildSha,
      triggeredBy: opts.triggeredBy,
      status,
      severity,
      details: observation,
    });
    runIds[testId] = runId;
  }

  if (violated) {
    log.safeWarn('aitg.guard.violation', {
      service: opts.service,
      tests: Object.entries(runIds)
        .filter(([, id]) => id !== null)
        .map(([t]) => t),
    });
  }

  return { result, runIds, violated, observations };
}

/**
 * Convenience for the common "wrap an LLM call AND short-circuit on
 * violation" pattern. When a classifier flags a violation, this returns a
 * synthesised safe-refusal response instead of the leaky one.
 */
export async function withAitgGuardOrRefuse<T extends AitgGuardableResponse>(
  opts: AitgGuardOptions,
  fn: () => Promise<T>,
  refusal: T,
): Promise<AitgGuardResult<T>> {
  const guarded = await withAitgGuard(opts, fn);
  if (guarded.violated) {
    return { ...guarded, result: refusal };
  }
  return guarded;
}
