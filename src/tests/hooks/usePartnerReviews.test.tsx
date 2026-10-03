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

import {
  useAppointmentReview,
  useCreateAppointmentReview,
  usePartnerRatingStats,
  usePartnerReviews,
  useUpdateAppointmentReview,
} from '@/hooks/usePartnerReviews';

describe('usePartnerReviews', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ user: { id: '550e8400-e29b-41d4-a716-446655440001' } });
  });

  it('načte reviews pro partnera', async () => {
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_partner_appointment_reviews') {
        return Promise.resolve({
          data: [
            {
              id: '550e8400-e29b-41d4-a716-446655440101',
              appointment_id: '550e8400-e29b-41d4-a716-446655440201',
              member_id: '550e8400-e29b-41d4-a716-446655440001',
              partner_id: '550e8400-e29b-41d4-a716-446655440301',
              rating: 5,
              comment: null,
              is_visible: true,
              created_at: '2025-01-01',
              updated_at: '2025-01-01',
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHookWithProviders(() => usePartnerReviews('550e8400-e29b-41d4-a716-446655440301'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_partner_appointment_reviews', { p_partner_id: '550e8400-e29b-41d4-a716-446655440301' });
    expect(result.current.data?.[0]?.id).toBe('550e8400-e29b-41d4-a716-446655440101');
  });

  it('počítá rating stats deterministicky', async () => {
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_partner_appointment_reviews') {
        return Promise.resolve({
          data: [
            { id: '550e8400-e29b-41d4-a716-446655440101', appointment_id: '550e8400-e29b-41d4-a716-446655440201', member_id: '550e8400-e29b-41d4-a716-446655440001', partner_id: '550e8400-e29b-41d4-a716-446655440301', rating: 5, comment: null, is_visible: true, created_at: '2025-01-01', updated_at: '2025-01-01' },
            { id: '550e8400-e29b-41d4-a716-446655440102', appointment_id: '550e8400-e29b-41d4-a716-446655440202', member_id: '550e8400-e29b-41d4-a716-446655440002', partner_id: '550e8400-e29b-41d4-a716-446655440301', rating: 4, comment: null, is_visible: true, created_at: '2025-01-02', updated_at: '2025-01-02' },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHookWithProviders(() => usePartnerRatingStats('550e8400-e29b-41d4-a716-446655440301'));

    await waitFor(() => {
      expect(result.current.totalReviews).toBe(2);
    });

    expect(result.current.averageRating).toBe(4.5);
    expect(result.current.ratingDistribution.find(d => d.rating === 5)?.count).toBe(1);
    expect(result.current.ratingDistribution.find(d => d.rating === 4)?.percentage).toBe(50);
  });

  it('appointment review vrací první záznam nebo null', async () => {
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_appointment_review') {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHookWithProviders(() => useAppointmentReview('550e8400-e29b-41d4-a716-446655440201'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_appointment_review', { p_appointment_id: '550e8400-e29b-41d4-a716-446655440201' });
    expect(result.current.data).toBeNull();
  });

  it('create vyžaduje auth a invaliduje cache', async () => {
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'create_partner_appointment_review') {
        return Promise.resolve({
          data: [{ id: '550e8400-e29b-41d4-a716-446655440101', appointment_id: '550e8400-e29b-41d4-a716-446655440201', member_id: '550e8400-e29b-41d4-a716-446655440001', partner_id: '550e8400-e29b-41d4-a716-446655440301', rating: 5, comment: 'ok', is_visible: true, created_at: '2025-01-01', updated_at: '2025-01-01' }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result, queryClient } = renderHookWithProviders(() => useCreateAppointmentReview());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ appointmentId: '550e8400-e29b-41d4-a716-446655440201', partnerId: '550e8400-e29b-41d4-a716-446655440301', rating: 5, comment: 'ok' });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['partner-reviews', '550e8400-e29b-41d4-a716-446655440301'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['appointment-review', '550e8400-e29b-41d4-a716-446655440201'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['my-appointments'] });
  });

  it('create bez usera vyhodí chybu', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: null });
    const { result } = renderHookWithProviders(() => useCreateAppointmentReview());
    
    let error: Error | null = null;
    try {
      await result.current.mutateAsync({ appointmentId: '550e8400-e29b-41d4-a716-446655440201', partnerId: '550e8400-e29b-41d4-a716-446655440301', rating: 5 });
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).toBe('Not authenticated');
  });

  it('update invaliduje partner-reviews a appointment-review', async () => {
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'update_partner_appointment_review') {
        return Promise.resolve({
          data: [{ id: '550e8400-e29b-41d4-a716-446655440101', appointment_id: '550e8400-e29b-41d4-a716-446655440201', member_id: '550e8400-e29b-41d4-a716-446655440001', partner_id: '550e8400-e29b-41d4-a716-446655440301', rating: 4, comment: 'ok', is_visible: true, created_at: '2025-01-01', updated_at: '2025-01-01' }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result, queryClient } = renderHookWithProviders(() => useUpdateAppointmentReview());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ id: '550e8400-e29b-41d4-a716-446655440101', rating: 4, comment: 'ok' });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['partner-reviews', '550e8400-e29b-41d4-a716-446655440301'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['appointment-review', '550e8400-e29b-41d4-a716-446655440201'] });
  });
});
