import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProductReviews } from '@/hooks/useProductReviews';

// Hoisted mock for aisha.rpc
const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

describe('useProductReviews', () => {
  // Mock RPC response data (matches get_product_reviews_with_stats return format)
  const mockRpcReviewsData = [
    {
      review_id: 'review-001',
      rating: 5,
      comment: 'Great product!',
      created_at: '2024-03-15T08:00:00Z',
      display_name: 'John Doe',
    },
    {
      review_id: 'review-002',
      rating: 4,
      comment: 'Very good',
      created_at: '2024-03-14T08:00:00Z',
      display_name: 'Jane Smith',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: successful RPC call with reviews
    mockRpc.mockResolvedValue({
      data: mockRpcReviewsData,
      error: null,
    });
  });

  it('should fetch product reviews successfully', async () => {
    const { result } = renderHook(() => useProductReviews('retisin'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockRpc).toHaveBeenCalledWith('get_product_reviews_with_stats', {
      p_product_slug: 'retisin',
    });
    expect(result.current.reviews).toHaveLength(2);
    expect(result.current.reviews[0].profile?.display_name).toBe('John Doe');
    expect(result.current.reviews[0].id).toBe('review-001');
    expect(result.current.reviews[0].rating).toBe(5);
  });

  it('should calculate correct stats', async () => {
    const { result } = renderHook(() => useProductReviews('retisin'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats.totalReviews).toBe(2);
    expect(result.current.stats.averageRating).toBe(4.5); // (5 + 4) / 2
    expect(result.current.stats.ratingDistribution[5]).toBe(1);
    expect(result.current.stats.ratingDistribution[4]).toBe(1);
  });

  it('should handle product not found (empty reviews)', async () => {
    mockRpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(() => useProductReviews('invalid-slug'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.reviews).toEqual([]);
    expect(result.current.stats.totalReviews).toBe(0);
    expect(result.current.stats.averageRating).toBe(0);
  });

  it('should handle no reviews for product', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useProductReviews('retisin'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.reviews).toEqual([]);
    expect(result.current.stats.totalReviews).toBe(0);
  });

  it('should handle fetch error', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('Database error'),
    });

    const { result } = renderHook(() => useProductReviews('retisin'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.reviews).toEqual([]);
    expect(result.current.stats.totalReviews).toBe(0);
  });

  it('should not fetch if productSlug is empty', async () => {
    const { result } = renderHook(() => useProductReviews(''));

    // Should stay in loading state since fetch is never triggered
    expect(result.current.loading).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.reviews).toEqual([]);
  });
});
