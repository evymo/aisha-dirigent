/**
 * IP-11 — reflection node boundary gate (ACS §4.3 R1).
 *
 * tot_* handlers may merge into checkpoint state ONLY shapes that validate
 * against the ToT contract: ThoughtNode fields are typed, status/strategy are
 * closed enums, scores are bounded. An invalid thought must not exist.
 *
 * Shadow/warn: violations are logged, the run continues (No Regressions).
 * Enforce: the node run fails — same semantics as a handler exception.
 */
import { z } from 'zod';

// Self-contained mode read (duplicated on purpose — this gate must not add ANY
// import edges to the reflection test graph; "prefer duplication over
// premature abstraction", CLAUDE.md).
type AcsMode = 'off' | 'shadow' | 'warn' | 'enforce';
const MODES: readonly AcsMode[] = ['off', 'shadow', 'warn', 'enforce'];

const ThoughtStatusSchema = z.enum(['unevaluated', 'sure', 'maybe', 'impossible']);

const ThoughtNodeSchema = z
  .object({
    id: z.string().min(1).max(128),
    parent: z.string().min(1).max(128).optional(),
    depth: z.number().int().min(0).max(64),
    content: z.string().max(20000),
    status: ThoughtStatusSchema,
    score: z.number().min(0).max(1).optional(),
  })
  .strict();

const ToTPolicySchema = z
  .object({
    strategy: z.enum(['bfs', 'dfs', 'beam']),
    wave_width: z.number().int().min(1).max(16),
    sure_threshold: z.number().min(0).max(1),
    impossible_threshold: z.number().min(0).max(1),
    max_expansions: z.number().int().min(1).max(256),
  })
  .passthrough();

const ToTStateSchema = z
  .object({
    tree: z.record(z.string(), ThoughtNodeSchema),
    policy: ToTPolicySchema.optional(),
  })
  .passthrough();

export interface NodeGateResult {
  ok: boolean;
  detail?: string;
}

let cachedMode: AcsMode | null = null;
function gateMode(): AcsMode {
  if (cachedMode === null) {
    const raw = (process.env['ACS_MODE'] ?? 'off').trim().toLowerCase();
    cachedMode = (MODES as readonly string[]).includes(raw) ? (raw as AcsMode) : 'off';
  }
  return cachedMode;
}

/** Test hook. */
export function resetAcsNodeGateCache(): void {
  cachedMode = null;
}

/**
 * Validate the ToT portion of checkpoint state after a tot_* node ran.
 * Returns ok=true for non-ToT nodes, for absent state.tot, and in mode=off.
 */
export function acsValidateNodeState(nodeType: string, state: Record<string, unknown>): NodeGateResult {
  if (gateMode() === 'off') return { ok: true };
  if (!nodeType.startsWith('tot_')) return { ok: true };
  const tot = state['tot'];
  if (tot === undefined || tot === null) return { ok: true };

  const verdict = ToTStateSchema.safeParse(tot);
  if (verdict.success) {
    // Structural cross-checks the schema alone cannot express:
    // every parent reference must exist and depth must be parent.depth + 1.
    const tree = (tot as { tree: Record<string, { parent?: string; depth: number }> }).tree ?? {};
    for (const [id, node] of Object.entries(tree)) {
      if (node.parent !== undefined) {
        const parent = tree[node.parent];
        if (!parent) return { ok: false, detail: `thought ${id}: parent ${node.parent} does not exist` };
        if (node.depth !== parent.depth + 1) {
          return { ok: false, detail: `thought ${id}: depth ${node.depth} != parent.depth+1 (${parent.depth + 1})` };
        }
      }
    }
    return { ok: true };
  }
  const first = verdict.error.issues[0];
  return { ok: false, detail: `${first?.path?.join('.') ?? 'tot'}: ${first?.message ?? 'invalid'}` };
}

export function acsNodeGateIsEnforcing(): boolean {
  return gateMode() === 'enforce';
}
