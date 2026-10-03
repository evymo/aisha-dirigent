import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { CartItem } from "@/hooks/useCart";

// ── Mocks ────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "cs" },
  }),
}));

// ── Fixtures ─────────────────────────────────────────
const MOCK_CART_ITEMS: CartItem[] = [
  {
    id: "cart-1",
    product_id: "prod-1",
    quantity: 2,
    product: {
      id: "prod-1",
      name: "Demo Product 1 DEMO-01",
      price: 3800,
      image_url: null,
      slug: "retisin",
    },
  },
  {
    id: "cart-2",
    product_id: "prod-2",
    quantity: 1,
    product: {
      id: "prod-2",
      name: "Demo Product 2 DEMO-02",
      price: 3800,
      image_url: null,
      slug: "floristen",
    },
  },
];

const EMPTY_CART: CartItem[] = [];

// ── Tests ────────────────────────────────────────────
describe("useOrderConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enriches cart items with GTIN and internal code", async () => {
    const { useOrderConsent } = await import("@/hooks/useOrderConsent");
    const { result } = renderHook(() => useOrderConsent(MOCK_CART_ITEMS));

    expect(result.current.orderItems).toHaveLength(2);

    const retisin = result.current.orderItems[0];
    expect(retisin.slug).toBe("retisin");
    expect(retisin.internalCode).toBe("DEMO-01");
    expect(retisin.gtin).toBe("00000000000017");
    expect(retisin.quantity).toBe(2);
    expect(retisin.lineTotal).toBe(7600);

    const floristen = result.current.orderItems[1];
    expect(floristen.slug).toBe("floristen");
    expect(floristen.internalCode).toBe("DEMO-02");
    expect(floristen.gtin).toBe("00000000000024");
  });

  it("calculates subtotal correctly", async () => {
    const { useOrderConsent } = await import("@/hooks/useOrderConsent");
    const { result } = renderHook(() => useOrderConsent(MOCK_CART_ITEMS));

    // 2 × 3800 + 1 × 3800 = 11400
    expect(result.current.subtotal).toBe(11400);
  });

  it("provides orderInterpolation with company data and protocol number", async () => {
    const { useOrderConsent } = await import("@/hooks/useOrderConsent");
    const { result } = renderHook(() =>
      useOrderConsent(MOCK_CART_ITEMS, "a1b2c3d4-5678-9abc-def0-123456789012")
    );

    const oi = result.current.orderInterpolation;
    expect(oi.operatorName).toBe("Example Operator s.r.o.");
    expect(oi.protocolNumber).toMatch(/^VP-\d{4}-A1B2C3D4$/);
    expect(oi.date).toBeDefined();
    expect(oi.timestamp).toBeDefined();
  });

  it("generates DRAFT protocol number when no orderId", async () => {
    const { useOrderConsent } = await import("@/hooks/useOrderConsent");
    const { result } = renderHook(() => useOrderConsent(MOCK_CART_ITEMS));

    expect(result.current.orderInterpolation.protocolNumber).toMatch(
      /^VP-\d{4}-DRAFT$/
    );
  });

  it("buildOrderConfirmation returns null for empty cart", async () => {
    const { useOrderConsent } = await import("@/hooks/useOrderConsent");
    const { result } = renderHook(() => useOrderConsent(EMPTY_CART));

    const confirmation = result.current.buildOrderConfirmation(
      "00000000-0000-0000-0000-000000000001",
      "packeta_pickup",
      ["gdpr", "terms"]
    );
    expect(confirmation).toBeNull();
  });

  it("buildOrderConfirmation returns valid OrderConfirmation for filled cart", async () => {
    const { useOrderConsent } = await import("@/hooks/useOrderConsent");
    const { result } = renderHook(() =>
      useOrderConsent(MOCK_CART_ITEMS, "a1b2c3d4-5678-9abc-def0-123456789012")
    );

    const confirmation = result.current.buildOrderConfirmation(
      "00000000-0000-0000-0000-000000000001",
      "packeta_pickup",
      ["gdpr", "terms", "research"]
    );

    expect(confirmation).not.toBeNull();
    expect(confirmation?.protocolNumber).toMatch(/^VP-\d{4}-A1B2C3D4$/);
    expect(confirmation?.memberId).toBe("00000000-0000-0000-0000-000000000001");
    expect(confirmation?.shippingMethod).toBe("packeta_pickup");
    expect(confirmation?.items).toHaveLength(2);
    expect(confirmation?.items[0].gtin).toBe("00000000000017");
    expect(confirmation?.items[0].internalCode).toBe("DEMO-01");
    expect(confirmation?.consentsAcknowledged).toEqual(["gdpr", "terms", "research"]);
    expect(confirmation?.totalCzk).toBe(11400);
  });

  it("handles products not in the identifier registry", async () => {
    const unknownItem: CartItem[] = [
      {
        id: "cart-x",
        product_id: "prod-x",
        quantity: 1,
        product: {
          id: "prod-x",
          name: "Unknown Product",
          price: 1000,
          image_url: null,
          slug: "unknown-product",
        },
      },
    ];

    const { useOrderConsent } = await import("@/hooks/useOrderConsent");
    const { result } = renderHook(() => useOrderConsent(unknownItem));

    expect(result.current.orderItems[0].internalCode).toBeUndefined();
    expect(result.current.orderItems[0].gtin).toBeUndefined();
    expect(result.current.orderItems[0].identifier).toBeUndefined();
  });
});
