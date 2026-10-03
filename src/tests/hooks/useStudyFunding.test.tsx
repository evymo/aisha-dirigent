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
  useExtendedStudies,
  useStudyContributions,
  useMyContributions,
  useCreateContribution,
  useStudyConsultants,
  useMyStudyConsultantApplication,
  useApplyAsConsultant,
  useStudyRatings,
  useMyStudyRating,
  useSubmitStudyRating,
  type ExtendedStudy,
  type StudyContribution,
  type StudyConsultant,
  type StudyRating,
} from '@/hooks/useStudyFunding';

const mockUser = { id: '550e8400-e29b-41d4-a716-446655440100' };

const mockExtendedStudy: ExtendedStudy = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  code: 'STUDY-001',
  name: 'Test Study',
  description: 'A test study',
  study_type: 'observational',
  target_condition: 'immunity',
  products: ['Retisin'],
  duration_weeks: 12,
  target_registration: 100,
  current_registration: 50,
  is_blinded: false,
  is_active: true,
  is_umbrella: false,
  starts_at: '2024-01-01',
  ends_at: '2024-06-01',
  protocol_url: null,
  funding_goal: 100000,
  current_funding: 50000,
  funding_deadline: '2024-03-01',
  funding_status: 'funding',
  min_participants: 10,
  max_participants: 200,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  consultant_count: 5,
  contribution_count: 20,
  total_contributed: 50000,
};

const mockContribution: StudyContribution = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  study_id: '550e8400-e29b-41d4-a716-446655440001',
  user_id: '550e8400-e29b-41d4-a716-446655440100',
  contribution_type: 'financial',
  amount: 1000,
  currency: 'CZK',
  token_type: null,
  message: 'Supporting research',
  is_anonymous: false,
  status: 'completed',
  created_at: '2024-02-01T00:00:00Z',
};

const mockConsultant: StudyConsultant = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  study_id: '550e8400-e29b-41d4-a716-446655440001',
  partner_id: '550e8400-e29b-41d4-a716-446655440030',
  role: 'consultant',
  status: 'approved',
  max_participants: 50,
  notes: 'Experienced consultant',
  approved_at: '2024-01-15T00:00:00Z',
  created_at: '2024-01-10T00:00:00Z',
  partner: {
    display_name: 'Dr. Smith',
    business_name: 'Smith Clinic',
    city: 'Prague',
    is_production_provider: true,
  },
};

const mockRating: StudyRating = {
  id: '550e8400-e29b-41d4-a716-446655440040',
  study_id: '550e8400-e29b-41d4-a716-446655440001',
  registration_id: '550e8400-e29b-41d4-a716-446655440050',
  user_id: '550e8400-e29b-41d4-a716-446655440100',
  rating: 5,
  comment: 'Great study!',
  is_visible: true,
  created_at: '2024-03-01T00:00:00Z',
};

describe('useStudyFunding hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ user: mockUser });
  });

  describe('useExtendedStudies', () => {
    it('fetches extended studies via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockExtendedStudy],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useExtendedStudies());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_extended_studies', {
        p_locale: 'en',
      });
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].name).toBe('Test Study');
    });

    it('falls back to get_active_studies on error', async () => {
      // First call fails, second succeeds with minimal data
      hoisted.rpcMock
        .mockResolvedValueOnce({ data: null, error: { message: 'RPC not found' } })
        .mockResolvedValueOnce({
          data: [{
            id: '550e8400-e29b-41d4-a716-446655440001',
            code: 'STUDY-001',
            name: 'Fallback Study',
            description: null,
            study_type: 'observational',
            target_condition: null,
            products: null,
            duration_weeks: null,
            target_registration: null,
            current_registration: 0,
            is_blinded: false,
            is_active: true,
            is_umbrella: false,
            starts_at: null,
            ends_at: null,
            protocol_url: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          }],
          error: null,
        });

      const { result } = renderHookWithProviders(() => useExtendedStudies());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_extended_studies', {
        p_locale: 'en',
      });
      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_active_studies');
      expect(result.current.data?.[0].name).toBe('Fallback Study');
      // Fallback fills in defaults
      expect(result.current.data?.[0].funding_goal).toBe(0);
    });

    it('handles complete fetch error', async () => {
      // Both primary and fallback RPC fail, with retry support
      hoisted.rpcMock
        .mockResolvedValue({ data: null, error: { message: 'Error' } });

      const { result } = renderHookWithProviders(() => useExtendedStudies());

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      }, { timeout: 5000 });
    });
  });

  describe('useStudyContributions', () => {
    it('fetches contributions for study via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockContribution],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useStudyContributions('550e8400-e29b-41d4-a716-446655440001')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_study_contributions', {
        p_study_id: '550e8400-e29b-41d4-a716-446655440001',
      });
      expect(result.current.data?.[0].amount).toBe(1000);
    });
  });

  describe('useMyContributions', () => {
    it('fetches user contributions via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockContribution],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyContributions());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_contributions');
    });

    it('returns empty array when user is not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useMyContributions());

      // Query is disabled when no user
      expect(result.current.status).toBe('pending');
      expect(result.current.fetchStatus).toBe('idle');
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('useCreateContribution', () => {
    it('creates contribution via RPC and invalidates cache', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: 'new-contribution-id',
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() => useCreateContribution());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const newContribution = {
        study_id: '550e8400-e29b-41d4-a716-446655440001',
        contribution_type: 'financial' as const,
        amount: 500,
        currency: 'EUR',
        message: 'For science!',
        is_anonymous: true,
      };

      await result.current.mutateAsync(newContribution);

      expect(hoisted.rpcMock).toHaveBeenCalledWith('create_study_contribution', {
        p_study_id: '550e8400-e29b-41d4-a716-446655440001',
        p_contribution_type: 'financial',
        p_amount: 500,
        p_currency: 'EUR',
        p_message: 'For science!',
        p_is_anonymous: true,
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['study-contributions', '550e8400-e29b-41d4-a716-446655440001'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['my-contributions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['extended-studies'] });
    });

    it('throws when user is not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useCreateContribution());

      await expect(
        result.current.mutateAsync({
          study_id: 'study-1',
          contribution_type: 'financial',
          amount: 100,
        })
      ).rejects.toThrow('Not authenticated');
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Insufficient funds' },
      });

      const { result } = renderHookWithProviders(() => useCreateContribution());

      await expect(
        result.current.mutateAsync({
          study_id: 'study-1',
          contribution_type: 'financial',
          amount: 100,
        })
      ).rejects.toThrow();
    });
  });

  describe('useStudyConsultants', () => {
    it('fetches approved consultants via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockConsultant],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useStudyConsultants('550e8400-e29b-41d4-a716-446655440001')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_approved_study_consultants', {
        p_study_id: '550e8400-e29b-41d4-a716-446655440001',
      });
      expect(result.current.data?.[0].partner?.display_name).toBe('Dr. Smith');
    });
  });

  describe('useMyStudyConsultantApplication', () => {
    it('fetches own consultant application via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockConsultant],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useMyStudyConsultantApplication(
          '550e8400-e29b-41d4-a716-446655440001',
          '550e8400-e29b-41d4-a716-446655440030'
        )
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_study_consultant_application', {
        p_study_id: '550e8400-e29b-41d4-a716-446655440001',
        p_partner_id: '550e8400-e29b-41d4-a716-446655440030',
      });
      expect(result.current.data?.status).toBe('approved');
    });

    it('does not fetch when studyId is missing', async () => {
      const { result } = renderHookWithProviders(() =>
        useMyStudyConsultantApplication('', '550e8400-e29b-41d4-a716-446655440030')
      );

      expect(result.current.status).toBe('pending');
      expect(result.current.fetchStatus).toBe('idle');
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('useApplyAsConsultant', () => {
    it('creates consultant application via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: 'new-application-id',
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() => useApplyAsConsultant());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const application = {
        study_id: '550e8400-e29b-41d4-a716-446655440001',
        partner_id: '550e8400-e29b-41d4-a716-446655440030',
        role: 'consultant' as const,
        max_participants: 25,
        notes: 'I want to help',
      };

      await result.current.mutateAsync(application);

      expect(hoisted.rpcMock).toHaveBeenCalledWith('apply_as_study_consultant_full', {
        p_study_id: '550e8400-e29b-41d4-a716-446655440001',
        p_partner_id: '550e8400-e29b-41d4-a716-446655440030',
        p_role: 'consultant',
        p_max_participants: 25,
        p_notes: 'I want to help',
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['study-consultants', '550e8400-e29b-41d4-a716-446655440001'],
      });
    });

    it('handles application error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Already applied' },
      });

      const { result } = renderHookWithProviders(() => useApplyAsConsultant());

      await expect(
        result.current.mutateAsync({
          study_id: 'study-1',
          partner_id: 'partner-1',
          role: 'consultant',
        })
      ).rejects.toThrow();
    });
  });

  describe('useStudyRatings', () => {
    it('fetches study ratings via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRating],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useStudyRatings('550e8400-e29b-41d4-a716-446655440001')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_study_ratings', {
        p_study_id: '550e8400-e29b-41d4-a716-446655440001',
      });
      expect(result.current.data?.[0].rating).toBe(5);
    });
  });

  describe('useMyStudyRating', () => {
    it('fetches own study rating via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRating],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useMyStudyRating('550e8400-e29b-41d4-a716-446655440001')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_study_rating', {
        p_study_id: '550e8400-e29b-41d4-a716-446655440001',
      });
      expect(result.current.data?.comment).toBe('Great study!');
    });

    it('does not fetch when user is not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() =>
        useMyStudyRating('550e8400-e29b-41d4-a716-446655440001')
      );

      expect(result.current.status).toBe('pending');
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('useSubmitStudyRating', () => {
    it('submits rating via RPC and invalidates cache', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: 'new-rating-id',
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() => useSubmitStudyRating());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const rating = {
        study_id: '550e8400-e29b-41d4-a716-446655440001',
        registration_id: '550e8400-e29b-41d4-a716-446655440050',
        rating: 4,
        comment: 'Very good study',
      };

      await result.current.mutateAsync(rating);

      expect(hoisted.rpcMock).toHaveBeenCalledWith('submit_study_rating', {
        p_study_id: '550e8400-e29b-41d4-a716-446655440001',
        p_rating: 4,
        p_comment: 'Very good study',
        p_registration_id: '550e8400-e29b-41d4-a716-446655440050',
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['study-ratings', '550e8400-e29b-41d4-a716-446655440001'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['my-study-rating', '550e8400-e29b-41d4-a716-446655440001'],
      });
    });

    it('throws when user is not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useSubmitStudyRating());

      await expect(
        result.current.mutateAsync({
          study_id: 'study-1',
          rating: 5,
        })
      ).rejects.toThrow('Not authenticated');
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Invalid rating' },
      });

      const { result } = renderHookWithProviders(() => useSubmitStudyRating());

      await expect(
        result.current.mutateAsync({
          study_id: 'study-1',
          rating: 5,
        })
      ).rejects.toThrow();
    });
  });
});
