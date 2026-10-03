/**
 * batchSubmitter unit tests — covers AISHA-development scenarios:
 *   - Empty requests array → 400-style error
 *   - Missing API key → 500-style error
 *   - Provider rejection (4xx HTTP) → BatchSubmitError surfaced
 *   - Anthropic happy path: POST /v1/messages/batches returns id → submit_batch_job called
 *   - OpenAI happy path: two-step (file upload + batch create) → submit_batch_job called
 *   - submit_batch_job RPC failure → throws BatchSubmitError (no DB row leak)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const rpcServiceMock = vi.hoisted(() => vi.fn());
vi.mock('../../postgrest.js', () => ({
  rpcService: rpcServiceMock,
  postgRESTConfig: {},
}));

describe('batchSubmitter — validation', () => {
  beforeEach(() => {
    rpcServiceMock.mockReset();
  });

  it('rejects empty requests array', async () => {
    const { submitBatch, BatchSubmitError } = await import('../../lib/batchSubmitter.js');
    await expect(submitBatch({ provider: 'anthropic', requests: [] })).rejects.toBeInstanceOf(BatchSubmitError);
  });

  it('rejects unknown provider', async () => {
    const { submitBatch, BatchSubmitError } = await import('../../lib/batchSubmitter.js');
    await expect(
      submitBatch({
        provider: 'cohere' as unknown as 'anthropic',
        requests: [{ custom_id: 'a', request: { model: 'x', messages: [] } }],
      }),
    ).rejects.toBeInstanceOf(BatchSubmitError);
  });

  it('errors when ANTHROPIC_API_KEY missing for anthropic submit', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { submitBatch, BatchSubmitError } = await import('../../lib/batchSubmitter.js');
    await expect(
      submitBatch({
        provider: 'anthropic',
        requests: [{ custom_id: 'a', request: { model: 'x', messages: [] } }],
      }),
    ).rejects.toBeInstanceOf(BatchSubmitError);
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });
});

describe('batchSubmitter — provider responses', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rpcServiceMock.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch') as ReturnType<typeof vi.spyOn>;
    fetchSpy.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('Anthropic batch: HTTP 200 with id → registers via submit_batch_job', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'msgbatch_abc', processing_status: 'in_progress' }), {
        status: 200,
      }),
    );
    rpcServiceMock.mockResolvedValueOnce('11111111-1111-1111-1111-111111111111');

    const { submitBatch } = await import('../../lib/batchSubmitter.js');
    const result = await submitBatch({
      provider: 'anthropic',
      requests: [{ custom_id: 'a', request: { model: 'claude', messages: [] } }],
    });
    expect(result.external_batch_id).toBe('msgbatch_abc');
    expect(result.batch_job_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(rpcServiceMock).toHaveBeenCalledWith(
      'submit_batch_job',
      expect.objectContaining({ p_provider: 'anthropic', p_external_batch_id: 'msgbatch_abc' }),
    );
  });

  it('Anthropic batch: HTTP 401 → throws BatchSubmitError, no RPC call', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-bad';
    fetchSpy.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));

    const { submitBatch, BatchSubmitError } = await import('../../lib/batchSubmitter.js');
    await expect(
      submitBatch({
        provider: 'anthropic',
        requests: [{ custom_id: 'a', request: { model: 'x', messages: [] } }],
      }),
    ).rejects.toBeInstanceOf(BatchSubmitError);
    expect(rpcServiceMock).not.toHaveBeenCalled();
  });

  it('OpenAI batch: 2-step (file upload then batch create) → submit_batch_job called', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    // 1st call: file upload
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'file-123', object: 'file' }), { status: 200 }),
    );
    // 2nd call: batch create
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'batch_xyz', status: 'validating' }), { status: 200 }),
    );
    rpcServiceMock.mockResolvedValueOnce('22222222-2222-2222-2222-222222222222');

    const { submitBatch } = await import('../../lib/batchSubmitter.js');
    const result = await submitBatch({
      provider: 'openai',
      requests: [{ custom_id: 'a', request: { model: 'gpt-4o', messages: [] } }],
    });
    expect(result.external_batch_id).toBe('batch_xyz');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('OpenAI batch: file upload failure → no batch create, no RPC', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    fetchSpy.mockResolvedValueOnce(new Response('quota exceeded', { status: 429 }));

    const { submitBatch, BatchSubmitError } = await import('../../lib/batchSubmitter.js');
    await expect(
      submitBatch({
        provider: 'openai',
        requests: [{ custom_id: 'a', request: { model: 'gpt-4o', messages: [] } }],
      }),
    ).rejects.toBeInstanceOf(BatchSubmitError);
    expect(rpcServiceMock).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only file upload attempted
  });

  it('submit_batch_job returning null → throws (no orphaned batch)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'msgbatch_orphan' }), { status: 200 }),
    );
    rpcServiceMock.mockResolvedValueOnce(null);

    const { submitBatch, BatchSubmitError } = await import('../../lib/batchSubmitter.js');
    await expect(
      submitBatch({
        provider: 'anthropic',
        requests: [{ custom_id: 'a', request: { model: 'x', messages: [] } }],
      }),
    ).rejects.toBeInstanceOf(BatchSubmitError);
  });
});
