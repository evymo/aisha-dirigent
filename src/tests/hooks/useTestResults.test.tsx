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

vi.mock('@/hooks/useSession', () => ({
  useSession: () => hoisted.useSessionMock(),
}));

import {
  useMyQualificationResults,
  useMyPartnerCertification,
  useMyTestResults,
} from '@/hooks/useTestResults';
import { QUALIFICATION_TEST_QUESTIONNAIRE_ID } from '@/lib/studyRegistrationSchema';

const mockUser = { id: 'user-123' };

const mockQualificationResult = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  user_id: 'user-123',
  responses: {
    score: 85,
    passed: true,
    completedAt: '2024-02-15T10:00:00Z',
    answers: { q1: 'a', q2: 'b' },
  },
  completed_at: '2024-02-15T10:00:00Z',
  created_at: '2024-02-15T09:00:00Z',
};

const mockPartnerCertification = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  user_id: 'user-123',
  score: 90,
  passed: true,
  answers: { q1: 'a', q2: 'c' },
  completed_at: '2024-03-01T12:00:00Z',
  created_at: '2024-03-01T11:00:00Z',
};

describe('useTestResults hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ user: mockUser });
  });

  describe('useMyQualificationResults', () => {
    it('fetches qualification results via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockQualificationResult],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyQualificationResults());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_qualification_results', {
        p_questionnaire_id: QUALIFICATION_TEST_QUESTIONNAIRE_ID,
      });
      expect(result.current.data?.score).toBe(85);
      expect(result.current.data?.passed).toBe(true);
      expect(result.current.data?.user_id).toBe('user-123');
    });

    it('returns null when no results exist', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyQualificationResults());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toBeNull();
    });

    it('does not fetch when user is not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useMyQualificationResults());

      expect(result.current.status).toBe('pending');
      expect(result.current.fetchStatus).toBe('idle');
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { result } = renderHookWithProviders(() => useMyQualificationResults());

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('handles missing response fields gracefully', async () => {
      const resultWithMissingFields = {
        id: '550e8400-e29b-41d4-a716-446655440003',
        user_id: 'user-123',
        responses: null, // Missing responses
        completed_at: '2024-02-15T10:00:00Z',
        created_at: '2024-02-15T09:00:00Z',
      };

      hoisted.rpcMock.mockResolvedValue({
        data: [resultWithMissingFields],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyQualificationResults());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Should use defaults
      expect(result.current.data?.score).toBe(0);
      expect(result.current.data?.passed).toBe(false);
      expect(result.current.data?.completedAt).toBe('2024-02-15T10:00:00Z');
    });
  });

  describe('useMyPartnerCertification', () => {
    it('fetches partner certification via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockPartnerCertification],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyPartnerCertification());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_partner_certification');
      expect(result.current.data?.score).toBe(90);
      expect(result.current.data?.passed).toBe(true);
    });

    it('returns null when no certification exists', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyPartnerCertification());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toBeNull();
    });

    it('does not fetch when user is not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useMyPartnerCertification());

      expect(result.current.status).toBe('pending');
      expect(result.current.fetchStatus).toBe('idle');
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Certification not found' },
      });

      const { result } = renderHookWithProviders(() => useMyPartnerCertification());

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe('useMyTestResults', () => {
    it('combines qualification and certification results', async () => {
      hoisted.rpcMock
        .mockResolvedValueOnce({
          data: [mockQualificationResult],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [mockPartnerCertification],
          error: null,
        });

      const { result } = renderHookWithProviders(() => useMyTestResults());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.qualification?.score).toBe(85);
      expect(result.current.certification?.score).toBe(90);
    });

    it('returns loading state while fetching', () => {
      hoisted.rpcMock.mockReturnValue(new Promise(() => {})); // Never resolves

      const { result } = renderHookWithProviders(() => useMyTestResults());

      expect(result.current.isLoading).toBe(true);
      expect(result.current.qualificationLoading).toBe(true);
      expect(result.current.certificationLoading).toBe(true);
    });

    it('handles partial data', async () => {
      hoisted.rpcMock
        .mockResolvedValueOnce({
          data: [mockQualificationResult],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [],
          error: null,
        });

      const { result } = renderHookWithProviders(() => useMyTestResults());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.qualification).not.toBeNull();
      expect(result.current.certification).toBeNull();
    });
  });
});
