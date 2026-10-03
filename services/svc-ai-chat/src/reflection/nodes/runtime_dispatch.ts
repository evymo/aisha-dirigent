import type { NodeHandler } from '../types.js';
import { rpc } from '../postgrest.js';
import { executeViaRuntime } from '../runtime/adapters.js';
import { providerForResolvedBackend } from '../../lib/providerIdentity.js';

/**
 * runtime_dispatch — execute the current clow through its DERIVED runtime (E3).
 *
 * Reads the runtime chosen by openclaw_resolve_clow (state.derived_runtime) plus
 * the resolved model (state.clow_backend), and routes execution through
 * executeViaRuntime: direct_llm → the model router, openclaw → the agent-mesh HTTP
 * API, hermes → the reflexive-learning rail. Fails loud when the runtime's adapter
 * is unavailable in this process — never silently downgrades to direct_llm.
 *
 * Config:
 *   - clow_path  (default 'current_clow')   — key into state for the clow descriptor
 *   - input_path (default 'dispatch_input') — key into state for the work input
 *   - input (string)                        — literal work input (overrides input_path)
 */
export const runtimeDispatch: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const clowPath = (cfg.clow_path as string) ?? 'current_clow';
  const inputPath = (cfg.input_path as string) ?? 'dispatch_input';

  const clow = (ctx.state[clowPath] as Record<string, unknown> | undefined) ?? {};
  const runtime = (ctx.state.derived_runtime as string) ?? (clow.runtime as string);
  if (!runtime) {
    return {
      output_data: { error: 'no_runtime' },
      fatal_error: 'runtime_dispatch: no derived runtime in state — run openclaw_resolve_clow first',
    };
  }

  const backend = ctx.state.clow_backend as { provider_slug?: string; backend_kind?: string; model_id?: string } | null;
  // Provider z ŘÁDKU resolveru (provider_slug + backend_kind), ne z prefixu model id.
  // ⛔ NAMĚŘENO 2026-09-13: `resolveProvider(backend.model_id)` poslal model za
  // llm_gateway (`llmgateway-io`) nebo lokální alias bez prefixu k `openai`.
  // providerForRegistryRow přijímá slug i rodinný klíč, takže námitka „slug
  // 'google-genai' není LlmProvider" (důvod původního odhadu) už neplatí.
  const provider = backend?.model_id ? providerForResolvedBackend(backend) : null;
  if (backend?.model_id && !provider) {
    return {
      output_data: { runtime, error: 'unknown_provider', provider_slug: backend.provider_slug ?? null },
      transition_key: 'failed',
      fatal_error:
        `runtime_dispatch: resolver vydal providera "${backend.provider_slug ?? ''}" ` +
        `(backend_kind "${backend.backend_kind ?? ''}"), kterého tenhle proces neobsluhuje`,
    };
  }
  const runInput = (ctx.run.metadata.input as Record<string, unknown> | undefined) ?? {};
  const input =
    (cfg.input as string) ??
    (ctx.state[inputPath] as string) ??
    (runInput.description as string) ??
    (clow.purpose as string) ??
    '';

  try {
    const dispatchStartedAt = Date.now();
    const result = await executeViaRuntime(runtime, {
      clow,
      input,
      model: backend?.model_id && provider ? { provider, model_id: backend.model_id } : null,
      storyId: ctx.run.story_id,
      context: {
        run_id: ctx.run.id,
        session_id: (ctx.run.metadata.context as Record<string, unknown> | undefined)?.session_id,
      },
    });

    // E3 observability: emit ONE ai_trace_events row carrying the executor identity
    // (runtime/model/backend_kind + decision_id → ai_decisions.runtime) so the
    // dispatch is visible in traces + Langfuse, not just a setup event. Non-fatal.
    try {
      await rpc('fn_log_runtime_dispatch_trace', {
        p_run_id: ctx.run.id,
        p_runtime: runtime,
        p_event_type: runtime === 'direct_llm' ? 'llm_call' : 'tool_call',
        p_model_id: backend?.model_id ?? null,
        p_backend_kind: (backend as { backend_kind?: string } | null)?.backend_kind ?? runtime,
        p_decision_id: (result.detail?.decision_id as string | undefined) ?? null,
        p_provider: backend?.provider_slug ?? null,
        p_status: result.ok ? 'ok' : 'error',
        // L0: capture real dispatch latency (was hard-coded null) so the outcome
        // read (fn_get_decision_outcomes) and Langfuse have a measurable signal.
        p_duration_ms: Date.now() - dispatchStartedAt,
      });
    } catch {
      // tracing must never brick a dispatch
    }

    if (!result.ok) {
      return {
        output_data: { runtime, error: 'runtime_execution_failed', detail: result.detail },
        transition_key: 'failed',
        fatal_error: `runtime_dispatch: ${runtime} execution failed`,
      };
    }

    return {
      output_data: { runtime, output: result.output, tokensIn: result.tokensIn, tokensOut: result.tokensOut },
      state_patch: {
        runtime_used: runtime,
        runtime_output: result.output,
        runtime_detail: result.detail ?? {},
      },
      transition_key: 'executed',
    };
  } catch (err) {
    return {
      output_data: { runtime, error: 'runtime_adapter_unavailable', detail: String(err).slice(0, 200) },
      transition_key: 'failed',
      fatal_error: `runtime_dispatch: ${String(err).slice(0, 160)}`,
    };
  }
};
