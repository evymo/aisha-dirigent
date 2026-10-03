/**
 * ACS effect guard (IP-8) — LEAN module for toolExecutor.
 *
 * Deliberately self-contained: no static import of @aisha/acs-sdk, llmRouter or
 * postgrest. With ACS_MODE=off (default) NOTHING beyond this file is resolved or
 * loaded — unit-test import graphs and runtime behaviour are bit-for-bit
 * identical to the pre-ACS state (No Regressions). The SDK and the postgrest
 * layer are imported dynamically only on the active path.
 */
import { createSafeLogger } from '@aisha/security';
import type { EffectClass } from '@aisha/acs-contracts';

const log = createSafeLogger('acs-guard');

export type AcsMode = 'off' | 'shadow' | 'warn' | 'enforce';
const MODES: readonly AcsMode[] = ['off', 'shadow', 'warn', 'enforce'];

let cachedMode: AcsMode | null = null;
export function acsGlobalMode(env: NodeJS.ProcessEnv = process.env): AcsMode {
  if (cachedMode === null) {
    const raw = (env['ACS_MODE'] ?? 'off').trim().toLowerCase();
    cachedMode = (MODES as readonly string[]).includes(raw) ? (raw as AcsMode) : 'off';
    if (!((MODES as readonly string[]).includes(raw)) && raw !== '' && raw !== 'off') {
      log.safeWarn('ACS_MODE invalid — failing closed to off', { raw });
    }
  }
  return cachedMode;
}
/** Test hook. */
export function resetAcsGuardCache(): void {
  cachedMode = null;
  effectMap = null;
}

let effectMap: Record<string, EffectClass> | null = null;
function toolEffectClass(name: string, env: NodeJS.ProcessEnv = process.env): EffectClass {
  if (!effectMap) {
    effectMap = {};
    const raw = env['ACS_EFFECT_TOOLS'];
    if (raw) {
      try {
        effectMap = JSON.parse(raw) as Record<string, EffectClass>;
      } catch {
        log.safeWarn('ACS_EFFECT_TOOLS is not valid JSON — treating all tools as unclassified');
      }
    }
  }
  return effectMap[name] ?? 'unclassified';
}

export interface GuardableToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface GuardedResult {
  toolCallId: string;
  content: string;
  ok: boolean;
  durationMs: number;
}

/**
 * Readback (propose → machine decision → execute) around a tool call.
 * off: direct passthrough (nothing loaded). shadow/warn: telemetry only.
 * enforce: persist trail; aborted/unclassified effects do not run.
 */
export async function acsGuardToolExecution<R extends GuardedResult>(
  call: GuardableToolCall,
  intentRef: string | null,
  runExecution: () => Promise<R>,
): Promise<R> {
  const mode = acsGlobalMode();
  if (mode === 'off') return runExecution();

  const sdk = await import('@aisha/acs-sdk');
  const effectClass = toolEffectClass(call.name);
  const anchor = intentRef ?? `int_${'0'.repeat(26)}`; // placeholder until F4 threads the run intent
  const proposal = sdk.buildProposal({
    toolName: call.name,
    effectClass,
    intentRef: anchor,
    target: call.name,
    action: 'invoke',
    params: call.arguments ?? {},
  });
  const decision = sdk.decideProposal(proposal, null);

  if (mode !== 'enforce') {
    if (decision.decision === 'abort') {
      log.safeWarn('ACS shadow: effect would be aborted in enforce mode', {
        tool: call.name,
        effectClass,
        reason: decision.reason_code,
      });
    }
    return runExecution();
  }

  const { rpcService } = await import('../../postgrest.js');
  try {
    await rpcService('acs_effect_propose', { p_payload: proposal });
    await rpcService('acs_effect_decide', { p_decision: decision, p_effect_id: proposal.effect_id });
  } catch (err) {
    // Enforce mode is fail-CLOSED: if the readback trail cannot be persisted
    // (e.g. the intent anchor does not exist yet — F4 not wired — or the DB is
    // unreachable), the effect MUST NOT run untracked. Abort with an error
    // result instead of falling through to executeGuarded.
    log.safeError('ACS enforce: readback persistence failed — aborting effect (fail-closed)', err, { tool: call.name });
    return {
      toolCallId: call.id,
      content: JSON.stringify({
        error: `ACS enforce: readback persistence failed for tool=${call.name} — effect aborted (fail-closed)`,
      }),
      ok: false,
      durationMs: 0,
    } as R;
  }
  if (decision.decision !== 'confirm') {
    return {
      toolCallId: call.id,
      content: JSON.stringify({
        error: `ACS readback abort: ${decision.reason_code ?? 'denied'} (tool=${call.name}, class=${effectClass})`,
      }),
      ok: false,
      durationMs: 0,
    } as R;
  }
  const outcome = await sdk.executeGuarded(proposal, decision, call.arguments ?? {}, runExecution);
  try {
    await rpcService('acs_effect_mark_executed', { p_effect_id: proposal.effect_id });
  } catch (err) {
    log.safeError('ACS effect mark_executed failed', err);
  }
  return outcome;
}
