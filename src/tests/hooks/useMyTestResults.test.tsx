import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/utils/test-utils';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock('@/hooks/useSession', () => ({ useSession: () => hoisted.useSessionMock() }));

vi.mock('@/lib/studyRegistrationSchema', () => ({
  QUALIFICATION_TEST_QUESTIONNAIRE_ID: 'qualification-qid',
}));

import {
  useMyPartnerCertification,
  useMyQualificationResults,
  useMyTestResults,
} from '@/hooks/useTestResults';

describe('useTestResults (my results)', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
  });

  it('bez usera vrací null a nedotýká se DB', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: null });

    const { result } = renderHookWithProviders(() => useMyQualificationResults());

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle');
    });

    expect(result.current.data).toBeUndefined();
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it('mapuje qualification výsledek z questionnaire_responses', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_qualification_results') {
        return Promise.resolve({
          data: [
            {
              id: 'resp1',
              user_id: 'u1',
              questionnaire_id: 'qualification-qid',
              responses: { score: 7, passed: true, completedAt: '2025-01-10' },
              completed_at: '2025-01-11',
              created_at: '2025-01-12',
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHookWithProviders(() => useMyQualificationResults());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.id).toBe('resp1');
    expect(result.current.data?.score).toBe(7);
    expect(result.current.data?.passed).toBe(true);
    expect(result.current.data?.completedAt).toBe('2025-01-10');
  });

  it('když nejsou data, vrací null', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

    hoisted.rpcMock.mockImplementation(() => {
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHookWithProviders(() => useMyQualificationResults());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('načte partner certification a vrací poslední záznam', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_partner_certification') {
        return Promise.resolve({
          data: [
            {
              id: 'pc1',
              user_id: 'u1',
              score: 80,
              passed: true,
              answers: { q1: 'a' },
              completed_at: '2025-02-01',
              created_at: '2025-02-01',
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHookWithProviders(() => useMyPartnerCertification());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('pc1');
    expect(result.current.data?.score).toBe(80);
  });

  it('kombinovaný hook vrací obě části', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_qualification_results') {
        return Promise.resolve({
          data: [
            {
              id: 'resp1',
              user_id: 'u1',
              questionnaire_id: 'qualification-qid',
              responses: { score: 1, passed: false },
              completed_at: '2025-01-11',
              created_at: '2025-01-12',
            },
          ],
          error: null,
        });
      }
      if (fnName === 'get_my_partner_certification') {
        return Promise.resolve({
          data: [
            {
              id: 'pc1',
              user_id: 'u1',
              score: 80,
              passed: true,
              answers: { q1: 'a' },
              completed_at: '2025-02-01',
              created_at: '2025-02-01',
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHookWithProviders(() => useMyTestResults());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.qualification?.id).toBe('resp1');
    expect(result.current.certification?.id).toBe('pc1');
  });
});
