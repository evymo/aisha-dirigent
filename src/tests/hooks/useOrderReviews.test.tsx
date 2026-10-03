import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockUseSession = vi.fn();

vi.mock('@/hooks/useSession', () => ({
  useSession: () => mockUseSession(),
}));

const safeErrorMock = vi.fn();
vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: (...args: unknown[]) => safeErrorMock(...args),
    safeWarn: vi.fn(),
    safeInfo: vi.fn(),
  };
});

// Hoisted mock for aisha.rpc - hook uses RPC calls only
const hoisted = vi.hoisted(() => {
  const rpcMock = vi.fn();
  return { rpcMock };
});

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: hoisted.rpcMock,
  },
}));

import { useOrderReviews } from '@/hooks/useOrderReviews';

describe('useOrderReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null from getReviewForOrder when user not authenticated', async () => {
    mockUseSession.mockReturnValue({ user: null });

    const { result } = renderHook(() => useOrderReviews());

    const review = await result.current.getReviewForOrder('order-1');
    expect(review).toBeNull();
  });

  it('does not log for PGRST116 (no rows) and returns null', async () => {
    mockUseSession.mockReturnValue({ user: { id: 'user-1' } });

    // Mock get_order_review_by_order RPC returning PGRST116 error
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    });

    const { result } = renderHook(() => useOrderReviews());

    const review = await result.current.getReviewForOrder('order-1');
    expect(review).toBeNull();
    expect(safeErrorMock).not.toHaveBeenCalled();
    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_order_review_by_order', {
      p_order_id: 'order-1',
    });
  });

  it('createReview returns auth error when user missing', async () => {
    mockUseSession.mockReturnValue({ user: null });

    const { result } = renderHook(() => useOrderReviews());

    const res = await result.current.createReview('order-1', 5, 'ok');
    expect(res).toEqual({ data: null, error: 'User not authenticated' });
  });

  it('createReview succeeds and toggles loading state', async () => {
    mockUseSession.mockReturnValue({ user: { id: '22222222-2222-2222-2222-222222222222' } });

    // Mock create_order_review_full RPC returning created review (as array)
    hoisted.rpcMock.mockResolvedValue({
      data: [
        {
          id: '550e8400-e29b-41d4-a716-446655440501',
          order_id: '550e8400-e29b-41d4-a716-446655440502',
          user_id: '22222222-2222-2222-2222-222222222222',
          rating: 5,
          comment: null,
          is_visible: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useOrderReviews());

    expect(result.current.loading).toBe(false);

    await act(async () => {
      const res = await result.current.createReview('550e8400-e29b-41d4-a716-446655440502', 5);
      expect(res.error).toBeNull();
      expect(res.data?.order_id).toBe('550e8400-e29b-41d4-a716-446655440502');
    });

    expect(result.current.loading).toBe(false);
    expect(hoisted.rpcMock).toHaveBeenCalledWith('create_order_review_full', {
      p_order_id: '550e8400-e29b-41d4-a716-446655440502',
      p_rating: 5,
      p_comment: undefined,
    });
  });

  it('updateReview succeeds and toggles loading state', async () => {
    mockUseSession.mockReturnValue({ user: { id: '550e8400-e29b-41d4-a716-446655440510' } });

    // Mock update_order_review RPC returning updated review (as array)
    hoisted.rpcMock.mockResolvedValue({
      data: [
        {
          id: '550e8400-e29b-41d4-a716-446655440501',
          order_id: '550e8400-e29b-41d4-a716-446655440502',
          user_id: '550e8400-e29b-41d4-a716-446655440510',
          rating: 4,
          comment: 'updated',
          is_visible: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useOrderReviews());

    await act(async () => {
      const res = await result.current.updateReview('550e8400-e29b-41d4-a716-446655440501', 4, 'updated');
      expect(res.error).toBeNull();
      expect(res.data?.rating).toBe(4);
    });

    expect(result.current.loading).toBe(false);
    expect(hoisted.rpcMock).toHaveBeenCalledWith('update_order_review', {
      p_review_id: '550e8400-e29b-41d4-a716-446655440501',
      p_rating: 4,
      p_comment: 'updated',
    });
  });

  it('canReviewOrder + daysUntilReviewable behave around 30-day threshold', () => {
    mockUseSession.mockReturnValue({ user: { id: 'user-1' } });
    const { result } = renderHook(() => useOrderReviews());

    expect(result.current.canReviewOrder(null)).toBe(false);
    expect(result.current.daysUntilReviewable(null)).toBe(30);

    const delivered29DaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
    const delivered31DaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    expect(result.current.canReviewOrder(delivered29DaysAgo)).toBe(false);
    expect(result.current.canReviewOrder(delivered31DaysAgo)).toBe(true);

    const remaining = result.current.daysUntilReviewable(delivered29DaysAgo);
    expect(remaining).toBeGreaterThanOrEqual(1);

    expect(result.current.daysUntilReviewable(delivered31DaysAgo)).toBe(0);
  });
});
