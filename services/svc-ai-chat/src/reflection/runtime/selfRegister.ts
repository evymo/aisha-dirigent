/**
 * Runtime self-registration (E3) — reconcile in-process RuntimeAdapter liveness
 * into ai_runtime_registry on boot, mirroring model/provider self-registration.
 *
 * An adapter that is available in THIS process declares its runtime is_enabled +
 * healthy; one that is not flips it down. This closes the code-half ↔ registry-half
 * gap the audit found (hermes shipped is_enabled=false while hermesAdapter.isAvailable()
 * was unconditionally true, and runtimeAdapterHealth() had no production caller):
 * fn_runtime_available / fn_admit_clow can only DERIVE a runtime the registry knows
 * is enabled with a healthy adapter.
 *
 * Governance stays capability-availability — the enabled set is DERIVED from real
 * adapter state, never a maintained allow-list of permitted runtime names.
 */
import { runtimeAdapterHealth } from './adapters.js';

type RpcFn = (fn: string, params: Record<string, unknown>) => Promise<unknown>;

export async function selfRegisterRuntimes(
  rpc: RpcFn,
): Promise<{ enabled: string[]; disabled: string[] }> {
  const enabled: string[] = [];
  const disabled: string[] = [];
  for (const { runtime, available } of runtimeAdapterHealth()) {
    // cli is a generic KIND whose registry slug is 'cli:<tool>' (never bare 'cli')
    // AND an out-of-process ENQUEUE runtime — svc-ai-chat is not its executor, so it
    // does not self-register cli's enabled/health here (the seed + the dedicated
    // runtime health probe own that row). Skipping also avoids
    // update_runtime_admin_audited RAISING 'Runtime not found' on 'cli' and aborting
    // the whole reconcile.
    if (runtime === 'cli') continue;
    try {
      await rpc('update_runtime_admin_audited', {
        p_adapter_health: available ? 'healthy' : 'down',
        p_is_enabled: available,
        p_slug: runtime,
      });
      (available ? enabled : disabled).push(runtime);
    } catch {
      // A missing/renamed registry row for ONE adapter must never drop the rest —
      // capability-availability reconcile is best-effort, not a hard boot dependency.
    }
  }
  return { enabled, disabled };
}
