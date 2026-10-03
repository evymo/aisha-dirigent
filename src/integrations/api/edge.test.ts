import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: vi.fn(),
    safeWarn: vi.fn(),
    safeInfo: vi.fn(),
  };
});

const apiInvokeMock = vi.fn();
vi.mock('./client', () => ({
  api: {
    invoke: (...args: unknown[]) => apiInvokeMock(...args),
  },
}));

import { safeWarn } from '@/lib/security/safeLogger';
import { EdgeFunctionInvokeError, invokeEdgeFunction } from './edge';

describe('invokeEdgeFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed data when schema matches', async () => {
    apiInvokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    const schema = z.object({ ok: z.literal(true) });

    await expect(
      invokeEdgeFunction({
        functionName: 'test-fn',
        context: 'test.context',
        schema,
        body: { ignored: true },
      })
    ).resolves.toEqual({ ok: true });
  });

  it('throws EdgeFunctionInvokeError when invoke returns error', async () => {
    apiInvokeMock.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(
      invokeEdgeFunction({
        functionName: 'test-fn',
        context: 'test.context',
        body: {},
      })
    ).rejects.toBeInstanceOf(EdgeFunctionInvokeError);

    expect(vi.mocked(safeWarn)).toHaveBeenCalledWith(
      'api.edge.invokeError',
      expect.any(Error)
    );
  });

  it('throws EdgeFunctionInvokeError when schema does not match', async () => {
    apiInvokeMock.mockResolvedValue({ data: { ok: false }, error: null });
    const schema = z.object({ ok: z.literal(true) });

    await expect(
      invokeEdgeFunction({
        functionName: 'test-fn',
        context: 'test.context',
        schema,
        body: {},
      })
    ).rejects.toBeInstanceOf(EdgeFunctionInvokeError);

    expect(vi.mocked(safeWarn)).toHaveBeenCalledWith(
      'api.edge.invalidResponse',
      expect.any(Error)
    );
  });
});

