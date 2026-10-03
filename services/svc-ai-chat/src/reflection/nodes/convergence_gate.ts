import type { NodeHandler } from '../types.js';

/**
 * Convergence gate — pass/fail based on critic_overall vs min_score threshold,
 * with max_iterations safety to prevent infinite loops.
 *
 * Config:
 *   - min_score: number (default 0.85)
 *   - max_iterations: number (default 3)
 */
export const convergenceGate: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const minScore = (cfg.min_score as number) ?? 0.85;
  const maxIterations = (cfg.max_iterations as number) ?? 3;

  const overall = (ctx.state.last_critic_overall as number) ?? 0;
  const iter = ctx.iteration;

  const passed = overall >= minScore;
  const exhausted = iter >= maxIterations;

  let key: 'pass' | 'retry' | 'exhausted';
  if (passed) key = 'pass';
  else if (exhausted) key = 'exhausted';
  else key = 'retry';

  return {
    output_data: {
      overall,
      min_score: minScore,
      iteration: iter,
      max_iterations: maxIterations,
      result: key,
    },
    transition_key: key,
    state_patch: {
      convergence_result: key,
    },
  };
};
