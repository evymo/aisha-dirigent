import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProducts, useProduct } from '@/hooks/useProducts';
import i18n from '@/i18n';
import { getI18nPrimaryLocale } from '@/lib/i18n/locale';
import React from 'react';

// Create a test QueryClient with no retries
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: 0,
    },
  },
});

// Wrapper with QueryClientProvider (no JSX - this is .ts file)
const createWrapper = () => {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

// Mock data as returned from RPC (before transformation)
// Must include all fields required by publicProductSchema
const mockRpcProducts = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001', // Valid UUID
    name: 'Retisin',
    slug: 'retisin',
    description: 'Full description',
    short_description: 'Short desc',
    price: 1200,
    original_price: 1500,
    compare_at_price: 1500,
    images: ['/retisin-1.jpg', '/retisin-2.jpg'],
    image_url: '/retisin-1.jpg',
    category: 'products',
    stock_quantity: 100,
    in_stock: true,
    requires_membership: false,
    membership_tier_required: '',
    archive_document_id: '',
    base_locale: 'en',
    target_audience: null,
    use_case: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    // Marketing fields
    badge: 'New',
    tagline: 'Premium product',
    image_alt: 'Retisin product image',
    benefits_title: 'Key Benefits',
    composition_title: 'Composition',
    usage_title: 'How to Use',
    origin_content: { text: 'Made in Europe' },
    benefits_content: [{ title: 'Energy', description: 'Boosts energy' }],
    substances_content: [{ name: 'Vitamin C', amount: '500mg' }],
    usage_content: { steps: ['Take 1 capsule daily'] },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002', // Valid UUID
    name: 'Lyastin',
    slug: 'lyastin',
    description: 'Another product',
    short_description: 'Short',
    price: 800,
    original_price: 0,
    compare_at_price: 0,
    images: [],
    image_url: '',
    category: 'products',
    stock_quantity: 50,
    in_stock: true,
    requires_membership: false,
    membership_tier_required: '',
    archive_document_id: '',
    base_locale: 'en',
    target_audience: null,
    use_case: null,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    // Marketing fields (minimal)
    badge: '',
    tagline: '',
    image_alt: '',
    benefits_title: '',
    composition_title: '',
    usage_title: '',
    origin_content: null,
    benefits_content: null,
    substances_content: null,
    usage_content: null,
  },
];

// Expected data after hook transformation (includes all mapped fields)
const expectedProducts = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Retisin',
    slug: 'retisin',
    description: 'Full description',
    short_description: 'Short desc',
    price: 1200,
    original_price: 1500,
    compare_at_price: 1500,
    images: ['/retisin-1.jpg', '/retisin-2.jpg'],
    image_url: '/retisin-1.jpg',
    category: 'products',
    stock_quantity: 100,
    in_stock: true,
    requires_membership: false,
    membership_tier_required: '',
    archive_document_id: '',
    base_locale: 'en',
    target_audience: null,
    use_case: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    // Marketing fields
    badge: 'New',
    tagline: 'Premium product',
    image_alt: 'Retisin product image',
    benefits_title: 'Key Benefits',
    composition_title: 'Composition',
    usage_title: 'How to Use',
    origin_content: { text: 'Made in Europe' },
    benefits_content: [{ title: 'Energy', description: 'Boosts energy' }],
    substances_content: [{ name: 'Vitamin C', amount: '500mg' }],
    usage_content: { steps: ['Take 1 capsule daily'] },
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'Lyastin',
    slug: 'lyastin',
    description: 'Another product',
    short_description: 'Short',
    price: 800,
    original_price: 800, // 0 -> price
    compare_at_price: 0,
    images: [],
    image_url: '',
    category: 'products',
    stock_quantity: 50,
    in_stock: true,
    requires_membership: false,
    membership_tier_required: '',
    archive_document_id: '',
    base_locale: 'en',
    target_audience: null,
    use_case: null,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    // Marketing fields (minimal)
    badge: '',
    tagline: '',
    image_alt: '',
    benefits_title: '',
    composition_title: '',
    usage_title: '',
    origin_content: null,
    benefits_content: null,
    substances_content: null,
    usage_content: null,
  },
];

// Hoisted mock pattern - create mock function before vi.mock
const mockRpcFn = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpcFn,
  },
}));

describe('useProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementation for get_public_products RPC
    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === 'get_public_products') {
        return Promise.resolve({
          data: mockRpcProducts,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it('should fetch all products successfully', async () => {
    const { result } = renderHook(() => useProducts(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.products).toEqual(expectedProducts);
    expect(result.current.error).toBe(null);
    const locale = getI18nPrimaryLocale(i18n.language);
    expect(mockRpcFn).toHaveBeenCalledWith('get_public_products', { p_locale: locale });
  });

  it('should handle fetch error', async () => {
    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === 'get_public_products') {
        return Promise.resolve({
          data: null,
          error: { message: 'Database error' },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useProducts(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBe(i18n.t('errors.genericError'));
  });

  it('should handle empty products list', async () => {
    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === 'get_public_products') {
        return Promise.resolve({
          data: [],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useProducts(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBe(null);
  });
});

describe('useProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementation for get_public_product_by_slug RPC
    mockRpcFn.mockImplementation((fnName: string, params?: { p_slug?: string; p_locale?: string }) => {
      if (fnName === 'get_public_product_by_slug') {
        if (params?.p_slug === 'retisin') {
          // RPC returns an array, hook takes first element
          return Promise.resolve({
            data: [mockRpcProducts[0]],
            error: null,
          });
        }
        return Promise.resolve({
          data: [],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it('should fetch single product by slug', async () => {
    const { result } = renderHook(() => useProduct('retisin'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.product).toEqual(expectedProducts[0]);
    expect(result.current.error).toBe(null);
    const locale = getI18nPrimaryLocale(i18n.language);
    expect(mockRpcFn).toHaveBeenCalledWith('get_public_product_by_slug', {
      p_slug: 'retisin',
      p_locale: locale,
    });
  });

  it('should handle product not found', async () => {
    const { result } = renderHook(() => useProduct('nonexistent'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.product).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('should handle fetch error', async () => {
    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === 'get_public_product_by_slug') {
        return Promise.resolve({
          data: null,
          error: { message: 'Product not found' },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useProduct('retisin'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.product).toBe(null);
    // getUserFacingDataErrorMessage maps generic errors to serviceNotConfigured
    expect(result.current.error).toBe(i18n.t('errors.serviceNotConfigured'));
  });

  it('should not fetch when slug is empty', async () => {
    const { result } = renderHook(() => useProduct(''), { wrapper: createWrapper() });

    // With React Query, loading is false when query is disabled
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockRpcFn).not.toHaveBeenCalled();
  });
});
