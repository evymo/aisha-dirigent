/**
 * control.ts — driveControlledWrite: the ONE read→external-write→hub-record saga
 * for driving an external system AS the federated operator (generalized from
 * a fork connector's per-route pair/reprice/pricing writers). Idempotent: an
 * idempotencyKey already recorded skips the external write, so a retry or a
 * step-3 failure never double-writes to the external system.
 *
 * All I/O injected (readAuthoritative / recordHub / hasApplied) → unit-testable.
 */
import type { IControlTarget, ControlAction, ControlResult, CallerScope, SourceConnection } from '@aisha/audience-types';

export interface ControlDeps {
  resolveBinding(storyId: string, endpointRole: string): Promise<SourceConnection | null>;
  /** Read the current authoritative state from the hub BEFORE the external write. */
  readAuthoritative(action: ControlAction): Promise<{ ok: boolean; detail?: string }>;
  /** True iff this idempotencyKey already produced an external write (skip it). */
  hasApplied(idempotencyKey: string): Promise<boolean>;
  /** Record the applied write hub-side (v2-hashed audit), AFTER the external write lands. */
  recordHub(action: ControlAction, result: ControlResult): Promise<void>;
  endpointRole?: string; // default 'control-api'
}

export class ControlDeniedError extends Error {
  constructor(public reason: 'not_configured' | 'unsupported' | 'not_authoritative', message: string) {
    super(message);
    this.name = 'ControlDeniedError';
  }
}

export async function driveControlledWrite(
  deps: ControlDeps,
  storyId: string,
  target: IControlTarget,
  action: ControlAction,
  caller: CallerScope,
): Promise<ControlResult> {
  if (!action.idempotencyKey) throw new ControlDeniedError('unsupported', 'action.idempotencyKey is required');

  // capability — refuse a kind the target does not advertise.
  if (!target.capabilities().includes(action.kind)) {
    throw new ControlDeniedError('unsupported', `target ${target.config.slug} cannot ${action.kind}`);
  }

  // idempotency — never double-write externally.
  if (await deps.hasApplied(action.idempotencyKey)) {
    return { ok: true, detail: 'already applied (idempotent)' };
  }

  const endpointRole = deps.endpointRole ?? 'control-api';
  const conn = await deps.resolveBinding(storyId, endpointRole);
  if (!conn) throw new ControlDeniedError('not_configured', `no approved '${endpointRole}' binding for story ${storyId}`);

  // 1) read-authoritative — the hub is the source of truth for what may be written.
  const authoritative = await deps.readAuthoritative(action);
  if (!authoritative.ok) {
    throw new ControlDeniedError('not_authoritative', authoritative.detail ?? 'not authoritative for this action');
  }

  // 2) external write, fail-fast (AS the federated caller).
  const result = await target.execute(action, conn, caller);
  if (!result.ok) return result;

  // 3) record hub-side ONLY after the external write landed (v2-hashed audit).
  await deps.recordHub(action, result);
  return result;
}
