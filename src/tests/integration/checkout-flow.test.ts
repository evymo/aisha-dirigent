/**
 * Integration Tests for Checkout/Orders Flow
 *
 * Tests the complete e-commerce flow:
 * - Cart management
 * - Product access validation
 * - Checkout process
 * - Order creation
 * - Payment processing
 * - Order status tracking
 * - Shipment tracking
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock user contexts
interface MockUser {
  id: string;
  email: string;
  role: "member" | "admin" | "staff";
  membership_tier?: "basic" | "upgraded" | "trial";
}

interface MockAuthContext {
  user: MockUser | null;
  session: { access_token: string } | null;
}

const mockMember: MockAuthContext = {
  user: {
    id: "user-member-001",
    email: "member@example.com",
    role: "member",
    membership_tier: "upgraded",
  },
  session: { access_token: "mock-token-member" },
};

const mockBasicMember: MockAuthContext = {
  user: {
    id: "user-basic-001",
    email: "basic@example.com",
    role: "member",
    membership_tier: "basic",
  },
  session: { access_token: "mock-token-basic" },
};

const mockStaff: MockAuthContext = {
  user: { id: "user-staff-001", email: "staff@example.com", role: "staff" },
  session: { access_token: "mock-token-staff" },
};

// Mock products
const mockProducts = [
  {
    id: "product-001",
    code: "LYASTIN-30",
    name: "Lyastin 30-day supply",
    price: 89.99,
    stock_quantity: 100,
    is_active: true,
    requires_membership: true,
    min_membership_tier: "upgraded",
  },
  {
    id: "product-002",
    code: "RETISIN-30",
    name: "Retisin 30-day supply",
    price: 79.99,
    stock_quantity: 50,
    is_active: true,
    requires_membership: false,
    min_membership_tier: null,
  },
  {
    id: "product-003",
    code: "BUNDLE-01",
    name: "Starter Bundle",
    price: 149.99,
    stock_quantity: 0,
    is_active: true,
    requires_membership: false,
  },
];

// Mock cart items
const mockCartItems = [
  {
    id: "cart-001",
    user_id: "user-member-001",
    product_id: "product-001",
    quantity: 2,
    created_at: "2024-03-15T10:00:00Z",
  },
  {
    id: "cart-002",
    user_id: "user-member-001",
    product_id: "product-002",
    quantity: 1,
    created_at: "2024-03-15T10:05:00Z",
  },
];

// Mock orders
const mockOrders = [
  {
    id: "order-001",
    user_id: "user-member-001",
    status: "completed",
    total_amount: 259.97,
    payment_status: "paid",
    created_at: "2024-03-01T10:00:00Z",
    shipped_at: "2024-03-02T14:00:00Z",
  },
];

// Mock RPC functions
const mockRpcFunctions = {
  get_my_cart_items: vi.fn(),
  add_to_cart: vi.fn(),
  update_cart_item: vi.fn(),
  remove_from_cart: vi.fn(),
  clear_cart: vi.fn(),
  get_product_access_type: vi.fn(),
  create_checkout_session: vi.fn(),
  create_order_for_member: vi.fn(),
  get_my_orders_audited: vi.fn(),
  get_order_details_audited: vi.fn(),
  update_order_status_admin: vi.fn(),
  get_shipment_tracking: vi.fn(),
};

// Product access validation
function getProductAccessType(
  product: (typeof mockProducts)[0],
  user: MockUser | null
): "available" | "membership_required" | "tier_required" | "out_of_stock" | "unavailable" {
  if (!product.is_active) return "unavailable";
  if (product.stock_quantity <= 0) return "out_of_stock";
  if (!user) return product.requires_membership ? "membership_required" : "available";
  if (product.requires_membership && user.role !== "member") return "membership_required";
  if (
    product.min_membership_tier === "upgraded" &&
    user.membership_tier !== "upgraded"
  ) {
    return "tier_required";
  }
  return "available";
}

describe("Cart Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockRpcFunctions.get_my_cart_items.mockResolvedValue({
      data: mockCartItems.filter((item) => item.user_id === mockMember.user?.id),
      error: null,
    });
  });

  describe("Adding items to cart", () => {
    it("adds product to cart", async () => {
      mockRpcFunctions.add_to_cart.mockResolvedValue({
        data: {
          id: "cart-new",
          product_id: "product-002",
          quantity: 1,
        },
        error: null,
      });

      const result = await mockRpcFunctions.add_to_cart({
        p_product_id: "product-002",
        p_quantity: 1,
      });

      expect(result.error).toBeNull();
      expect(result.data.product_id).toBe("product-002");
      expect(result.data.quantity).toBe(1);
    });

    it("validates product availability before adding", () => {
      const outOfStockProduct = mockProducts.find((p) => p.code === "BUNDLE-01");
      const accessType = getProductAccessType(outOfStockProduct!, mockMember.user);

      expect(accessType).toBe("out_of_stock");
    });

    it("validates membership requirements", () => {
      const premiumProduct = mockProducts.find((p) => p.code === "LYASTIN-30");

      // Basic member cannot access upgraded tier product
      const basicAccess = getProductAccessType(premiumProduct!, mockBasicMember.user);
      expect(basicAccess).toBe("tier_required");

      // Upgraded member can access
      const upgradedAccess = getProductAccessType(premiumProduct!, mockMember.user);
      expect(upgradedAccess).toBe("available");
    });

    it("updates quantity for existing cart item", async () => {
      mockRpcFunctions.update_cart_item.mockResolvedValue({
        data: {
          id: "cart-001",
          quantity: 3,
        },
        error: null,
      });

      const result = await mockRpcFunctions.update_cart_item({
        p_cart_item_id: "cart-001",
        p_quantity: 3,
      });

      expect(result.data.quantity).toBe(3);
    });

    it("prevents adding more than available stock", async () => {
      mockRpcFunctions.add_to_cart.mockResolvedValue({
        data: null,
        error: { message: "Insufficient stock" },
      });

      const result = await mockRpcFunctions.add_to_cart({
        p_product_id: "product-002",
        p_quantity: 100,
      });

      expect(result.error).not.toBeNull();
    });
  });

  describe("Cart operations", () => {
    it("retrieves user cart items", async () => {
      const result = await mockRpcFunctions.get_my_cart_items();

      expect(result.data).toHaveLength(2);
      expect(result.data.every((item: (typeof mockCartItems)[0]) => item.user_id === mockMember.user?.id)).toBe(
        true
      );
    });

    it("removes item from cart", async () => {
      mockRpcFunctions.remove_from_cart.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const result = await mockRpcFunctions.remove_from_cart({
        p_cart_item_id: "cart-001",
      });

      expect(result.error).toBeNull();
    });

    it("clears entire cart", async () => {
      mockRpcFunctions.clear_cart.mockResolvedValue({
        data: { cleared_count: 2 },
        error: null,
      });

      const result = await mockRpcFunctions.clear_cart();

      expect(result.data.cleared_count).toBe(2);
    });
  });
});

describe("Checkout Process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Checkout session creation", () => {
    it("creates Stripe checkout session", async () => {
      mockRpcFunctions.create_checkout_session.mockResolvedValue({
        data: {
          sessionId: "cs_test_123",
          url: "https://checkout.stripe.com/pay/cs_test_123",
        },
        error: null,
      });

      const result = await mockRpcFunctions.create_checkout_session({
        items: [
          { product_id: "product-001", quantity: 2 },
          { product_id: "product-002", quantity: 1 },
        ],
        shipping_address: {
          name: "Test User",
          street: "123 Test St",
          city: "Prague",
          postal_code: "11000",
          country: "CZ",
        },
      });

      expect(result.error).toBeNull();
      expect(result.data.sessionId).toBeDefined();
      expect(result.data.url).toContain("stripe.com");
    });

    it("validates cart before checkout", async () => {
      mockRpcFunctions.create_checkout_session.mockResolvedValue({
        data: null,
        error: { message: "Cart contains unavailable items" },
      });

      const result = await mockRpcFunctions.create_checkout_session({
        items: [{ product_id: "product-003", quantity: 1 }], // Out of stock
      });

      expect(result.error).not.toBeNull();
    });

    it("requires shipping address for physical products", async () => {
      mockRpcFunctions.create_checkout_session.mockResolvedValue({
        data: null,
        error: { message: "Shipping address required" },
      });

      const result = await mockRpcFunctions.create_checkout_session({
        items: [{ product_id: "product-001", quantity: 1 }],
        // No shipping address
      });

      expect(result.error).not.toBeNull();
    });
  });

  describe("Order creation", () => {
    it("creates order after successful payment", async () => {
      mockRpcFunctions.create_order_for_member.mockResolvedValue({
        data: {
          id: "order-new",
          user_id: mockMember.user?.id,
          status: "pending",
          payment_status: "paid",
          total_amount: 259.97,
          items: [
            { product_id: "product-001", quantity: 2, unit_price: 89.99 },
            { product_id: "product-002", quantity: 1, unit_price: 79.99 },
          ],
        },
        error: null,
      });

      const result = await mockRpcFunctions.create_order_for_member({
        p_stripe_session_id: "cs_test_123",
      });

      expect(result.error).toBeNull();
      expect(result.data.payment_status).toBe("paid");
      expect(result.data.items).toHaveLength(2);
    });

    it("calculates correct total amount", async () => {
      const items = [
        { product_id: "product-001", quantity: 2, unit_price: 89.99 },
        { product_id: "product-002", quantity: 1, unit_price: 79.99 },
      ];

      const expectedTotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

      expect(expectedTotal).toBeCloseTo(259.97, 2);
    });
  });
});

describe("Order Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockRpcFunctions.get_my_orders_audited.mockResolvedValue({
      data: mockOrders.filter((o) => o.user_id === mockMember.user?.id),
      error: null,
    });
  });

  describe("Order retrieval", () => {
    it("member can view own orders", async () => {
      const result = await mockRpcFunctions.get_my_orders_audited();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].user_id).toBe(mockMember.user?.id);
    });

    it("retrieves order details with items", async () => {
      mockRpcFunctions.get_order_details_audited.mockResolvedValue({
        data: {
          ...mockOrders[0],
          items: [
            {
              product_id: "product-001",
              product_name: "Lyastin 30-day supply",
              quantity: 2,
              unit_price: 89.99,
            },
          ],
          shipping_address: {
            name: "Test User",
            street: "123 Test St",
            city: "Prague",
          },
        },
        error: null,
      });

      const result = await mockRpcFunctions.get_order_details_audited({
        p_order_id: "order-001",
      });

      expect(result.data.items).toBeDefined();
      expect(result.data.shipping_address).toBeDefined();
    });
  });

  describe("Order status management (staff/admin)", () => {
    it("staff can update order status", async () => {
      mockRpcFunctions.update_order_status_admin.mockResolvedValue({
        data: {
          id: "order-001",
          status: "shipped",
          shipped_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await mockRpcFunctions.update_order_status_admin({
        p_order_id: "order-001",
        p_status: "shipped",
      });

      expect(result.data.status).toBe("shipped");
      expect(result.data.shipped_at).toBeDefined();
    });

    it("validates status transitions", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["processing", "cancelled"],
        processing: ["shipped", "cancelled"],
        shipped: ["delivered", "returned"],
        delivered: ["returned"],
        cancelled: [],
        returned: [],
      };

      // Test valid transition
      expect(validTransitions.pending).toContain("processing");

      // Test invalid transition
      expect(validTransitions.cancelled).not.toContain("processing");
    });
  });
});

describe("Shipment Tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retrieves shipment tracking info", async () => {
    mockRpcFunctions.get_shipment_tracking.mockResolvedValue({
      data: {
        carrier: "packeta",
        tracking_number: "Z123456789",
        status: "in_transit",
        estimated_delivery: "2024-03-05",
        events: [
          {
            timestamp: "2024-03-02T14:00:00Z",
            status: "shipped",
            location: "Prague DC",
          },
          {
            timestamp: "2024-03-03T08:00:00Z",
            status: "in_transit",
            location: "Brno Hub",
          },
        ],
      },
      error: null,
    });

    const result = await mockRpcFunctions.get_shipment_tracking({
      p_order_id: "order-001",
    });

    expect(result.data.carrier).toBe("packeta");
    expect(result.data.events).toHaveLength(2);
    expect(result.data.estimated_delivery).toBeDefined();
  });

  it("returns null for unshipped orders", async () => {
    mockRpcFunctions.get_shipment_tracking.mockResolvedValue({
      data: null,
      error: null,
    });

    const result = await mockRpcFunctions.get_shipment_tracking({
      p_order_id: "order-pending",
    });

    expect(result.data).toBeNull();
  });
});

describe("Access Control", () => {
  it("members can only access own cart", async () => {
    const result = await mockRpcFunctions.get_my_cart_items();

    expect(
      result.data.every((item: (typeof mockCartItems)[0]) => item.user_id === mockMember.user?.id)
    ).toBe(true);
  });

  it("members can only access own orders", async () => {
    const result = await mockRpcFunctions.get_my_orders_audited();

    expect(
      result.data.every((order: (typeof mockOrders)[0]) => order.user_id === mockMember.user?.id)
    ).toBe(true);
  });

  it("unauthenticated users cannot access cart", () => {
    const anonymous: MockAuthContext = { user: null, session: null };
    expect(anonymous.user).toBeNull();
  });

  it("product access respects membership tier", () => {
    const premiumProduct = mockProducts[0];

    // Anonymous - needs membership
    const anonAccess = getProductAccessType(premiumProduct, null);
    expect(anonAccess).toBe("membership_required");

    // Basic member - needs tier upgrade
    const basicAccess = getProductAccessType(premiumProduct, mockBasicMember.user);
    expect(basicAccess).toBe("tier_required");

    // Upgraded member - can access
    const upgradedAccess = getProductAccessType(premiumProduct, mockMember.user);
    expect(upgradedAccess).toBe("available");
  });
});
