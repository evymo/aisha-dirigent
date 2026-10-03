/**
 * Tests for src/hooks/useAdminShipments.ts
 *
 * Coverage:
 *   - useShipmentsAdmin         (query — useState/useEffect pattern, not useQuery)
 *   - createPacketaShipment     (standalone async — edge fn + follow-up RPC)
 *   - markOrderShipped          (standalone async — single RPC)
 *   - getPacketaTrackingStatus  (standalone async — edge fn only)
 *
 * Notes:
 *   - The hook uses a custom `useState + useEffect` pattern (returns
 *     `{ orders, loading, refetch }`), so we wait on `result.current.loading`
 *     rather than on `isSuccess`.
 *   - The hook is forgiving: errors don't propagate to callers — they're
 *     caught, logged via `safeError`, and `orders` is set to `[]`. We
 *     verify that contract here.
 *   - Status filter: only orders with status ∈
 *     {paid, processing, shipped, in_transit, delivered} pass through.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  useShipmentsAdmin,
  createPacketaShipment,
  markOrderShipped,
  getPacketaTrackingStatus,
  type ShipmentOrder,
} from "@/hooks/useAdminShipments";

const { mockRpc, mockInvoke, mockHasPermission, mockUser, mockSafeError } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockInvoke: vi.fn(),
    mockHasPermission: vi.fn(),
    mockUser: { id: "admin-id" },
    mockSafeError: vi.fn(),
  }));

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: mockRpc,
    functions: { invoke: mockInvoke },
  },
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser }),
}));
vi.mock("@/lib/security/safeLogger", () => ({
  safeError: mockSafeError,
}));

const UUID_ORDER = "50000000-0000-4000-a000-000000000001";
const UUID_USER = "50000000-0000-4000-a000-000000000002";
const UUID_ITEM = "50000000-0000-4000-a000-000000000003";

function mockShipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_ORDER,
    user_id: UUID_USER,
    status: "paid",
    total: 5000,
    created_at: "2026-03-01T00:00:00Z",
    shipped_at: null,
    delivered_at: null,
    shipping_method: "packeta",
    packeta_packet_id: null,
    packeta_barcode: null,
    packeta_branch_id: 99,
    tracking_url: null,
    shipping_address: {
      firstName: "Test",
      lastName: "Buyer",
      address: "Test 1",
      city: "Prague",
      postalCode: "11000",
      country: "CZ",
    },
    profile: {
      display_name: "Test Buyer",
      email: "buyer@example.test",
      phone: "+420123456789",
    },
    order_items: [
      {
        id: UUID_ITEM,
        quantity: 2,
        product: { name: "Test Supplement", weight: 0.25 },
      },
    ],
    ...overrides,
  };
}

// ── useShipmentsAdmin ──────────────────────────────────────────

describe("useShipmentsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_shipments_admin_audited with p_limit=200 and returns mapped orders", async () => {
    mockRpc.mockResolvedValue({ data: [mockShipmentRow()], error: null });

    const { result } = renderHook(() => useShipmentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith("get_shipments_admin_audited", {
      p_limit: 200,
      p_status: undefined,
    });
    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0].id).toBe(UUID_ORDER);
    expect(result.current.orders[0].profile?.email).toBe("buyer@example.test");
  });

  it("filters out orders with non-shipment status (e.g. pending, cancelled)", async () => {
    // Hook only surfaces paid / processing / shipped / in_transit / delivered
    mockRpc.mockResolvedValue({
      data: [
        mockShipmentRow({ id: UUID_ORDER, status: "pending" }),
        mockShipmentRow({
          id: "50000000-0000-4000-a000-000000000099",
          status: "cancelled",
        }),
        mockShipmentRow({
          id: "50000000-0000-4000-a000-0000000000aa",
          status: "shipped",
        }),
      ],
      error: null,
    });

    const { result } = renderHook(() => useShipmentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0].status).toBe("shipped");
  });

  it("defaults profile to null when RPC omits the field", async () => {
    const row = mockShipmentRow();
    delete (row as Record<string, unknown>).profile;
    mockRpc.mockResolvedValue({ data: [row], error: null });

    const { result } = renderHook(() => useShipmentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.orders[0].profile).toBeNull();
  });

  it("returns [] on schema mismatch (safeParse soft-fails) without throwing", async () => {
    // Missing required `status` → schema rejects → orders stays []
    mockRpc.mockResolvedValue({
      data: [{ ...mockShipmentRow(), status: undefined }],
      error: null,
    });

    const { result } = renderHook(() => useShipmentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.orders).toEqual([]);
    expect(mockSafeError).toHaveBeenCalledWith(
      "admin.shipments.validation",
      expect.anything(),
    );
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useShipmentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.orders).toEqual([]);
  });

  it("swallows RPC error (logs via safeError, leaves orders untouched)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });

    const { result } = renderHook(() => useShipmentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The hook intentionally does NOT rethrow — it logs and keeps the UI
    // mounted with empty orders, so the admin can refetch.
    expect(result.current.orders).toEqual([]);
    expect(mockSafeError).toHaveBeenCalledWith(
      "admin.shipments.fetchFailed",
      expect.anything(),
    );
  });

  it("exposes a refetch() that re-invokes the RPC", async () => {
    mockRpc.mockResolvedValue({ data: [mockShipmentRow()], error: null });

    const { result } = renderHook(() => useShipmentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockRpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

// ── createPacketaShipment ──────────────────────────────────────

describe("createPacketaShipment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function fixtureOrder(): ShipmentOrder {
    return {
      id: UUID_ORDER,
      user_id: UUID_USER,
      status: "paid",
      total: 5000,
      created_at: "2026-03-01T00:00:00Z",
      shipped_at: null,
      delivered_at: null,
      shipping_method: "packeta",
      packeta_packet_id: null,
      packeta_barcode: null,
      packeta_branch_id: 99,
      tracking_url: null,
      shipping_address: {
        firstName: "Test",
        lastName: "Buyer",
        address: "Test 1",
        city: "Prague",
        postalCode: "11000",
        country: "CZ",
      },
      profile: {
        display_name: "Test Buyer",
        email: "buyer@example.test",
        phone: "+420123456789",
      },
      order_items: [
        {
          id: UUID_ITEM,
          quantity: 2,
          product: { name: "Test Supplement", weight: 0.25 },
        },
      ],
    };
  }

  it("calls packeta-api create-packet with recipient + weight + branchId, then patches the order RPC", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        barcode: "Z1234567890",
        packetId: "9876543210",
        trackingUrl: "https://tracking.packeta/Z1234567890",
      },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: null, error: null });

    await createPacketaShipment(fixtureOrder());

    expect(mockInvoke).toHaveBeenCalledWith("packeta-api", {
      body: expect.objectContaining({
        action: "create-packet",
        orderId: UUID_ORDER,
        // 2 items × 0.25kg = 0.5kg
        weight: 0.5,
        value: 5000,
        branchId: 99,
        recipient: expect.objectContaining({
          name: "Test Buyer",
          email: "buyer@example.test",
          street: "Test 1",
          country: "CZ",
        }),
      }),
    });
    expect(mockRpc).toHaveBeenCalledWith("update_order_packeta_admin", {
      p_order_id: UUID_ORDER,
      p_packeta_barcode: "Z1234567890",
      p_packeta_packet_id: "9876543210",
      p_status: "processing",
      p_tracking_url: "https://tracking.packeta/Z1234567890",
    });
  });

  it("defaults missing per-item weight to 0.5kg and country to CZ", async () => {
    mockInvoke.mockResolvedValue({
      data: { barcode: "Z1", packetId: "1", trackingUrl: "u1" },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const order = fixtureOrder();
    order.order_items[0].product = { name: "Unknown weight item" };
    order.shipping_address!.country = undefined;
    order.order_items[0].quantity = 3;

    await createPacketaShipment(order);

    expect(mockInvoke).toHaveBeenCalledWith(
      "packeta-api",
      expect.objectContaining({
        body: expect.objectContaining({
          weight: 1.5, // 3 × 0.5 fallback
          recipient: expect.objectContaining({ country: "CZ" }),
        }),
      }),
    );
  });

  it("falls back to pickupPointId when packeta_branch_id is null", async () => {
    mockInvoke.mockResolvedValue({
      data: { barcode: "Z1", packetId: "1", trackingUrl: "u1" },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const order = fixtureOrder();
    order.packeta_branch_id = null;
    order.shipping_address!.pickupPointId = 42;

    await createPacketaShipment(order);

    expect(mockInvoke).toHaveBeenCalledWith(
      "packeta-api",
      expect.objectContaining({
        body: expect.objectContaining({ branchId: 42 }),
      }),
    );
  });

  it("throws when packeta-api edge fn returns an error (no RPC follow-up)", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "Packeta rejected: invalid postal code" },
    });

    await expect(createPacketaShipment(fixtureOrder())).rejects.toThrow(
      "Packeta rejected: invalid postal code",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws when the follow-up RPC fails (order left in inconsistent state — caller must reconcile)", async () => {
    mockInvoke.mockResolvedValue({
      data: { barcode: "Z1", packetId: "1", trackingUrl: "u1" },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "update_order_packeta_admin: order not found" },
    });

    await expect(createPacketaShipment(fixtureOrder())).rejects.toThrow(
      /order not found/,
    );
  });
});

// ── markOrderShipped ───────────────────────────────────────────

describe("markOrderShipped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls mark_order_shipped_admin with the order id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await markOrderShipped(UUID_ORDER);
    expect(mockRpc).toHaveBeenCalledWith("mark_order_shipped_admin", {
      p_order_id: UUID_ORDER,
    });
  });

  it("propagates RPC error message to the caller", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Cannot ship: order not paid" },
    });
    await expect(markOrderShipped(UUID_ORDER)).rejects.toThrow(
      "Cannot ship: order not paid",
    );
  });
});

// ── getPacketaTrackingStatus ───────────────────────────────────

describe("getPacketaTrackingStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls packeta-api with action=track and returns the data verbatim", async () => {
    mockInvoke.mockResolvedValue({
      data: { status: "in_transit" },
      error: null,
    });

    const out = await getPacketaTrackingStatus("9876543210");
    expect(mockInvoke).toHaveBeenCalledWith("packeta-api", {
      body: { action: "track", packetId: "9876543210" },
    });
    expect(out).toEqual({ status: "in_transit" });
  });

  it("throws on edge-fn error", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "Packeta: tracking id not found" },
    });
    await expect(getPacketaTrackingStatus("xxx")).rejects.toThrow(
      "tracking id not found",
    );
  });
});
