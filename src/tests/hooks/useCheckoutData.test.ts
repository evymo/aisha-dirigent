import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOrderWithItems } from '@/hooks/useCheckoutData';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: hoisted.safeErrorMock,
  };
});

describe('createOrderWithItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends standardized create_order payload including shipping keys', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: '550e8400-e29b-41d4-a716-446655440500',
      error: null,
    });

    const orderId = await createOrderWithItems({
      total: 120,
      shippingAddress: { country: 'CZ', city: 'Prague' },
      billingAddress: { country: 'CZ', city: 'Prague' },
      currency: 'CZK',
      items: [
        {
          product_id: '550e8400-e29b-41d4-a716-446655440001',
          quantity: 2,
          price_at_purchase: 60,
        },
      ],
    });

    expect(orderId).toBe('550e8400-e29b-41d4-a716-446655440500');
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      'create_order_with_items_audited',
      expect.objectContaining({
        p_shipping_method: undefined,
        p_packeta_branch_id: undefined,
        p_currency: 'CZK',
        p_payment_method: 'bank_transfer',
      })
    );
  });

  it('passes payment method card when specified', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: '550e8400-e29b-41d4-a716-446655440501',
      error: null,
    });

    const orderId = await createOrderWithItems({
      total: 200,
      shippingAddress: { country: 'CZ', city: 'Brno' },
      billingAddress: { country: 'CZ', city: 'Brno' },
      currency: 'CZK',
      paymentMethod: 'card',
      items: [
        {
          product_id: '550e8400-e29b-41d4-a716-446655440002',
          quantity: 1,
          price_at_purchase: 200,
        },
      ],
    });

    expect(orderId).toBe('550e8400-e29b-41d4-a716-446655440501');
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      'create_order_with_items_audited',
      expect.objectContaining({
        p_payment_method: 'card',
      })
    );
  });
});
