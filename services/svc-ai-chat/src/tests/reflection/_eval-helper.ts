/**
 * Test-only helper that mirrors the guarded expression evaluator from
 * services/svc-ai-chat/src/reflection/orchestrator.ts. We keep the
 * implementation in sync with the runner (1:1 with the evalGuardedExpression
 * + helpers there) so behaviour-level assertions catch drift.
 *
 * Why a separate helper: the real evaluator is private inside orchestrator.ts.
 * Exporting it just for tests would widen the public surface area. Mirroring
 * the algorithm in test land is the standard "behavior contract" pattern.
 */

function splitTopLevel(s: string, sep: string): string[] {
  return s
    .split(sep)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function resolveValue(token: string, scope: Record<string, unknown>): unknown {
  const t = token.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^"[^"]*"$/.test(t) || /^'[^']*'$/.test(t)) return t.slice(1, -1);

  const parts = t.split('.');
  let cur: unknown = scope[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (cur == null) return undefined;
    if (parts[i] === 'length' && (Array.isArray(cur) || typeof cur === 'string')) {
      cur = (cur as { length: number }).length;
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[parts[i]];
    } else {
      return undefined;
    }
  }
  return cur;
}

function evalGuardedExpression(expr: string, scope: Record<string, unknown>): boolean {
  const e = expr.trim();

  const orParts =
    splitTopLevel(e, ' OR ').length > 1 ? splitTopLevel(e, ' OR ') : splitTopLevel(e, '||');
  if (orParts.length > 1) {
    return orParts.some((p) => evalGuardedExpression(p, scope));
  }
  const andParts =
    splitTopLevel(e, ' AND ').length > 1 ? splitTopLevel(e, ' AND ') : splitTopLevel(e, '&&');
  if (andParts.length > 1) {
    return andParts.every((p) => evalGuardedExpression(p, scope));
  }

  const ops: Array<[string, (a: unknown, b: unknown) => boolean]> = [
    ['>=', (a, b) => (a as number) >= (b as number)],
    ['<=', (a, b) => (a as number) <= (b as number)],
    ['==', (a, b) => a === b],
    ['!=', (a, b) => a !== b],
    ['>', (a, b) => (a as number) > (b as number)],
    ['<', (a, b) => (a as number) < (b as number)],
  ];
  for (const [op, fn] of ops) {
    const idx = e.indexOf(op);
    if (idx > 0) {
      const left = e.slice(0, idx).trim();
      const right = e.slice(idx + op.length).trim();
      return fn(resolveValue(left, scope), resolveValue(right, scope));
    }
  }

  const v = resolveValue(e, scope);
  return !!v;
}

export function evalEdgeCondition(
  condition: string,
  state: Record<string, unknown>,
  iteration: number,
): boolean {
  const scope: Record<string, unknown> = {
    ...state,
    iteration,
    iterations: iteration,
    score: state.last_critic_overall,
    warnings:
      ((state.sandbox_result as Record<string, unknown> | undefined)?.warnings as unknown[]) ?? [],
    approved: (state.pending_approval as Record<string, unknown> | undefined)?.approved ?? false,
  };
  try {
    return evalGuardedExpression(condition, scope);
  } catch {
    return false;
  }
}
