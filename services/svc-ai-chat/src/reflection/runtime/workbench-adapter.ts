/**
 * workbenchAdapter — the 'workbench' RuntimeAdapter (PR-J). It runs a clow on a LOCAL
 * model living in the dev's VSCode workbench extension, via a POLL+BLOCK rail: enqueue a
 * request, then block-poll for the result while the aisha-dirigent extension claims it,
 * runs it locally, and posts the result back. No push to the dev's machine, so it works
 * behind NAT/firewall.
 *
 * isAvailable() is SYNC (the RuntimeAdapter contract) → it reads ONLY a config flag.
 * Real liveness ("is a VSCode session alive?") is the GLOBAL adapter_health written by the
 * runtime health probe; fn_resolve_runtime excludes a 'down' workbench, so a request is
 * never enqueued when no extension is listening. A timeout returns ok:false (NOT a throw)
 * so runtime_dispatch transitions to 'failed' rather than a fatal adapter error.
 */
import { rpc } from '../postgrest.js';
import { journalDispatch } from '../../lib/dispatchJournal.js';
import { reflectionConfig as config } from '../config.js';
import type { RuntimeAdapter, RuntimeResult, RuntimeWork } from './adapters.js';

const POLL_BACKOFF_MS = [250, 500, 1000];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface WorkbenchPoll {
  status: string;
  output?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  error_detail?: unknown;
}

export const workbenchAdapter: RuntimeAdapter = {
  runtime: 'workbench',
  isAvailable: () => config.enableWorkbench,

  async execute(work: RuntimeWork): Promise<RuntimeResult> {
    // I1 — journal the dispatch (mints an ai_decisions row) BEFORE enqueue, then thread
    // the decision_id into the request for the audit chain. Soft (never blocks).
    const decisionId = await journalDispatch({
      model: work.model?.model_id ?? 'workbench-local',
      runtime: 'workbench',
      runId: (work.context?.run_id as string | undefined) ?? null,
      storyId: work.storyId ?? null,
      reason: 'runtime_adapter.workbench',
    }).catch(() => null);

    let requestId: string;
    try {
      requestId = await rpc<string>('enqueue_workbench_request', {
        p_clow: work.clow,
        p_decision_id: decisionId,
        p_input: work.input,
        p_model_id: work.model?.model_id ?? null,
        p_provider_slug: work.model?.provider ?? null,
        p_run_id: (work.context?.run_id as string | undefined) ?? null,
        p_story_id: work.storyId ?? null,
      });
    } catch (err) {
      return {
        runtime: 'workbench', ok: false, output: '',
        detail: { error: 'workbench_enqueue_failed', message: String(err).slice(0, 200) },
      };
    }

    const deadline = Date.now() + config.workbenchPollTimeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      await sleep(POLL_BACKOFF_MS[Math.min(attempt, POLL_BACKOFF_MS.length - 1)]);
      attempt += 1;

      let res: WorkbenchPoll;
      try {
        res = await rpc<WorkbenchPoll>('fetch_workbench_result', { p_request_id: requestId });
      } catch (err) {
        return {
          runtime: 'workbench', ok: false, output: '',
          detail: { request_id: requestId, error: 'workbench_poll_failed', message: String(err).slice(0, 200) },
        };
      }

      if (res.status === 'completed') {
        return {
          runtime: 'workbench', ok: true, output: res.output ?? '',
          detail: { request_id: requestId, decision_id: decisionId },
          tokensIn: res.tokens_in ?? undefined,
          tokensOut: res.tokens_out ?? undefined,
        };
      }
      if (res.status === 'failed') {
        return {
          runtime: 'workbench', ok: false, output: '',
          detail: { request_id: requestId, error_detail: res.error_detail },
        };
      }
      // pending | claimed → keep polling
    }

    // Timeout: the extension never produced a result in time. ok:false (no throw).
    return {
      runtime: 'workbench', ok: false, output: '',
      detail: { request_id: requestId, error: 'workbench_timeout', elapsed_ms: config.workbenchPollTimeoutMs },
    };
  },
};
