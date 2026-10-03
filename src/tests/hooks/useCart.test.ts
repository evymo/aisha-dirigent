import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCart } from '@/hooks/useCart';

// Create wrapper with QueryClientProvider
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// Mock i18n
vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock user
const mockUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'test@example.com',
};

let mockAuthReturn: {
  user: { id: string; email: string } | null;
  isAuthenticated: boolean;
  loading: boolean;
} = {
  user: mockUser,
  isAuthenticated: true,
  loading: false,
};

vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(() => ({
    user: mockAuthReturn.user,
    session: mockAuthReturn.user ? { user: mockAuthReturn.user } : null,
    isLoading: mockAuthReturn.loading,
    hasRole: vi.fn(),
    roles: [],
    isAdmin: false,
    signOut: vi.fn(),
  })),
}));

// Mock toast (sonner)
const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);
vi.mock("sonner", () => ({
  toast: mockToast,
}));

// Mock RPC - create mock first before vi.mock
const mockRpcFn = vi.fn();

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpcFn(...args),
  },
}));

describe('useCart', () => {
  // RPC format - flat with product_ prefix
  const mockCartItemsRpc = [
    {
      id: '00000000-0000-0000-0000-000000000301',
      product_id: '00000000-0000-0000-0000-000000000401',
      quantity: 2,
      product_name: 'Retisin',
      product_price: 1290,
      product_image_url: '/images/retisin.jpg',
      product_slug: 'retisin',
    },
    {
      id: '00000000-0000-0000-0000-000000000302',
      product_id: '00000000-0000-0000-0000-000000000402',
      quantity: 1,
      product_name: 'Lyastin',
      product_price: 890,
      product_image_url: '/images/lyastin.jpg',
      product_slug: 'lyastin',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthReturn = {
      user: mockUser,
      isAuthenticated: true,
      loading: false,
    };
    
    // Default mock for cart fetch via RPC
    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_cart') {
        return Promise.resolve({ data: mockCartItemsRpc, error: null });
      }
      if (fnName === 'add_to_cart') {
        return Promise.resolve({ data: 'new-id', error: null });
      }
      if (fnName === 'update_cart_quantity') {
        return Promise.resolve({ data: null, error: null });
      }
      if (fnName === 'remove_from_cart') {
        return Promise.resolve({ data: null, error: null });
      }
      if (fnName === 'clear_my_cart') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it('should fetch cart items successfully', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].product.name).toBe('Retisin');
  });

  it('should calculate total price', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // (2 * 1290) + (1 * 890) = 2580 + 890 = 3470
    expect(result.current.total).toBe(3470);
  });

  it('should calculate item count', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // 2 + 1 = 3
    expect(result.current.itemCount).toBe(3);
  });

  it('should return empty cart when no items', async () => {
    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_cart') {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.itemCount).toBe(0);
  });

  it('should handle fetch error', async () => {
    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_cart') {
        return Promise.resolve({ data: null, error: new Error('Database error') });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
  });

  it('should add new item to cart', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let addResult;
    await act(async () => {
      addResult = await result.current.addToCart('00000000-0000-0000-0000-000000000499', 1);
    });

    expect(addResult).toBe(true);
    expect(mockRpcFn).toHaveBeenCalledWith('add_to_cart', {
      p_product_id: '00000000-0000-0000-0000-000000000499',
      p_quantity: 1,
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('should increase quantity for existing item', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let addResult;
    await act(async () => {
      // Adding to existing item in cart - RPC handles upsert internally
      addResult = await result.current.addToCart('00000000-0000-0000-0000-000000000401', 1);
    });

    expect(addResult).toBe(true);
    expect(mockRpcFn).toHaveBeenCalledWith('add_to_cart', {
      p_product_id: '00000000-0000-0000-0000-000000000401',
      p_quantity: 1,
    });
  });

  it('should handle add to cart error', async () => {
    mockRpcFn.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_cart') {
        return Promise.resolve({ data: mockCartItemsRpc, error: null });
      }
      if (fnName === 'add_to_cart') {
        return Promise.resolve({ data: null, error: new Error('Insert failed') });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let addResult;
    await act(async () => {
      addResult = await result.current.addToCart('prod-new', 1);
    });

    expect(addResult).toBe(false);
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('should update item quantity', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.updateQuantity('cart-001', 5);
    });

    expect(mockRpcFn).toHaveBeenCalledWith('update_cart_quantity', {
      p_item_id: 'cart-001',
      p_quantity: 5,
    });
  });

  it('should call update with quantity 0 when setting quantity to 0', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.updateQuantity('cart-001', 0);
    });

    // Hook calls update_cart_quantity with quantity 0, not remove_from_cart
    expect(mockRpcFn).toHaveBeenCalledWith('update_cart_quantity', {
      p_item_id: 'cart-001',
      p_quantity: 0,
    });
  });

  it('should remove item from cart', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.removeFromCart('cart-001');
    });

    expect(mockRpcFn).toHaveBeenCalledWith('remove_from_cart', {
      p_item_id: 'cart-001',
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('should clear all cart items', async () => {
    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.clearCart();
    });

    expect(mockRpcFn).toHaveBeenCalledWith('clear_my_cart');
  });

  it('should return empty cart when user is null', async () => {
    mockAuthReturn = {
      user: null,
      isAuthenticated: false,
      loading: false,
    };

    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
  });

  it('should show sign in toast when adding without auth', async () => {
    mockAuthReturn = {
      user: null,
      isAuthenticated: false,
      loading: false,
    };

    const { result } = renderHook(() => useCart(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let addResult;
    await act(async () => {
      addResult = await result.current.addToCart('prod-001', 1);
    });

    expect(addResult).toBe(false);
    expect(mockToast.error).toHaveBeenCalled();
  });
});
