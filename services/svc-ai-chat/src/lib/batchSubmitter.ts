/**
 * batchSubmitter — AISHA's deferred-execution helper for Anthropic Message
 * Batches API and OpenAI Batch API. ~50% off sync pricing for non-urgent
 * workloads. AISHA dynamically routes here based on aisha_choose_execution_strategy
 * (deadline-aware decision, NOT static pattern).
 *
 * The HTTP POST is done from this process. Once the provider accepts the
 * batch, we register it in ai_batch_jobs via submit_batch_job RPC. n8n's
 * WF_BATCH_POLLER then polls + writes results back into ai_runs.
 *
 * NO routing through LLM Gateway. Batch APIs require provider-specific JSONL
 * shapes (Anthropic message_batches.create, OpenAI files.create + batches.create)
 * that the Gateway proxy doesn't normalize. We call providers directly here.
 *
 * Source-of-truth invariants honored:
 *   - ai_batch_jobs is the canonical state register
 *   - audit_journal logs every submission + status change
 *   - cost_total accrues via WF_BATCH_POLLER when results land
 */

import { rpcService } from '../postgrest.js';
import { credentials } from './credentials.js';

export type BatchProvider = 'anthropic' | 'openai';

export interface BatchRequestItem {
  /** Caller-supplied custom_id; echoed back in result. */
  custom_id: string;
  /** Per-provider request body. For Anthropic: { model, max_tokens, messages, ... }.
   *  For OpenAI: { method: 'POST', url: '/v1/chat/completions', body: { ... } } */
  request: Record<string, unknown>;
}

export interface SubmitBatchOptions {
  provider: BatchProvider;
  requests: BatchRequestItem[];
  /** Free-form metadata persisted on ai_batch_jobs (task, slot, profile, ...). */
  metadata?: Record<string, unknown>;
  relatedRunId?: string;
  agentSlug?: string;
  storyId?: string;
  estimatedCostUsd?: number;
  /** Anthropic API key override. Jinak čtečka pověření (trezor instance → přechodně env). */
  anthropicApiKey?: string;
  /** OpenAI API key override. Jinak čtečka pověření (trezor instance → přechodně env). */
  openaiApiKey?: string;
}

export interface SubmitBatchResult {
  /** Local UUID of the ai_batch_jobs row. */
  batch_job_id: string;
  /** Provider-side batch identifier. */
  external_batch_id: string;
  provider: BatchProvider;
  request_count: number;
}

export class BatchSubmitError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Submit a batch to the configured provider. Returns the local ai_batch_jobs
 * row id after the provider accepts the batch.
 *
 * Errors: throws BatchSubmitError on provider rejection. The DB row is NOT
 * created in that case — only successful provider submissions are recorded.
 */
export async function submitBatch(opts: SubmitBatchOptions): Promise<SubmitBatchResult> {
  if (!opts.requests.length) {
    throw new BatchSubmitError('batch requires at least one request', 400, null);
  }

  let externalBatchId: string;
  if (opts.provider === 'anthropic') {
    externalBatchId = await submitAnthropicBatch(opts);
  } else if (opts.provider === 'openai') {
    externalBatchId = await submitOpenAIBatch(opts);
  } else {
    throw new BatchSubmitError(`Unknown provider: ${opts.provider}`, 400, null);
  }

  const batchJobId = await rpcService<string>('submit_batch_job', {
    p_agent_slug: opts.agentSlug ?? 'aisha',
    p_estimated_cost: opts.estimatedCostUsd ?? null,
    p_external_batch_id: externalBatchId,
    p_metadata: opts.metadata ?? {},
    p_provider: opts.provider,
    p_related_run_id: opts.relatedRunId ?? null,
    p_request_count: opts.requests.length,
    p_story_id: opts.storyId ?? null,
  });

  if (!batchJobId) {
    throw new BatchSubmitError(
      `submit_batch_job RPC returned no id for provider=${opts.provider} ` +
        `external_batch_id=${externalBatchId}`,
      500,
      null,
    );
  }

  return {
    batch_job_id: batchJobId,
    external_batch_id: externalBatchId,
    provider: opts.provider,
    request_count: opts.requests.length,
  };
}

// =============================================================================
// Anthropic Message Batches
// =============================================================================
async function submitAnthropicBatch(opts: SubmitBatchOptions): Promise<string> {
  const key = opts.anthropicApiKey ?? (await credentials.get('ANTHROPIC_API_KEY'));
  if (!key) {
    throw new BatchSubmitError('ANTHROPIC_API_KEY not configured', 500, null);
  }

  // https://docs.anthropic.com/en/api/creating-message-batches
  const body = {
    requests: opts.requests.map((r) => ({
      custom_id: r.custom_id,
      params: r.request,
    })),
  };

  const res = await fetch('https://api.anthropic.com/v1/messages/batches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'message-batches-2024-09-24',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new BatchSubmitError(
      `Anthropic batch submit failed: HTTP ${res.status}`,
      res.status,
      text,
    );
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    throw new BatchSubmitError('Anthropic batch response missing id', 500, data);
  }
  return data.id;
}

// =============================================================================
// OpenAI Batch API
// =============================================================================
async function submitOpenAIBatch(opts: SubmitBatchOptions): Promise<string> {
  const key = opts.openaiApiKey ?? (await credentials.get('OPENAI_API_KEY'));
  if (!key) {
    throw new BatchSubmitError('OPENAI_API_KEY not configured', 500, null);
  }

  // OpenAI requires uploading a JSONL file first, then creating the batch.
  // https://platform.openai.com/docs/guides/batch
  const jsonl = opts.requests
    .map((r) =>
      JSON.stringify({
        custom_id: r.custom_id,
        method: 'POST',
        url: '/v1/chat/completions',
        body: r.request,
      }),
    )
    .join('\n');

  // 1) Upload as a file with purpose=batch
  const form = new FormData();
  form.append('purpose', 'batch');
  form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), 'batch.jsonl');

  const fileRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!fileRes.ok) {
    const text = await fileRes.text();
    throw new BatchSubmitError(
      `OpenAI file upload failed: HTTP ${fileRes.status}`,
      fileRes.status,
      text,
    );
  }
  const fileData = (await fileRes.json()) as { id?: string };
  if (!fileData.id) {
    throw new BatchSubmitError('OpenAI file response missing id', 500, fileData);
  }

  // 2) Create the batch referencing the uploaded file
  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input_file_id: fileData.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: opts.metadata ?? {},
    }),
  });

  if (!batchRes.ok) {
    const text = await batchRes.text();
    throw new BatchSubmitError(
      `OpenAI batch create failed: HTTP ${batchRes.status}`,
      batchRes.status,
      text,
    );
  }

  const batchData = (await batchRes.json()) as { id?: string };
  if (!batchData.id) {
    throw new BatchSubmitError('OpenAI batch response missing id', 500, batchData);
  }
  return batchData.id;
}
