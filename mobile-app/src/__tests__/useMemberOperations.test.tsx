import { renderHook, waitFor } from "@testing-library/react-native";
import {
  useMyAppointments,
  useMyCart,
  useMyOrders,
  useMyVouchers,
  useMyWearableConnections,
} from "@/hooks/useMemberOperations";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

describe("useMemberOperations", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches appointments", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "11111111-1111-4111-8111-111111111111", status: "scheduled", partner: null }],
      error: null,
    });

    const { result } = renderHook(() => useMyAppointments("user-1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_appointments");
    expect(result.current.data?.[0].status).toBe("scheduled");
  });

  it("fetches orders via audited RPC", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "22222222-2222-4222-8222-222222222222", status: "paid", total: 1200 }],
      error: null,
    });

    const { result } = renderHook(() => useMyOrders("user-1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_orders_audited");
    expect(result.current.data?.[0].total).toBe(1200);
  });

  it("fetches cart items", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          product_id: "44444444-4444-4444-8444-444444444444",
          product_name: "Product",
          product_price: 99,
          quantity: 2,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useMyCart("user-1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_cart");
    expect(result.current.data?.[0].quantity).toBe(2);
  });

  it("fetches vouchers with limit", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "55555555-5555-4555-8555-555555555555", code: "ABC", status: "active" }],
      error: null,
    });

    const { result } = renderHook(() => useMyVouchers("user-1", 6), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_vouchers", { p_limit: 6 });
    expect(result.current.data?.[0].code).toBe("ABC");
  });

  it("fetches wearable connections", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          connection_status: "connected",
          device_type: "watch",
          permissions_granted: ["steps"],
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useMyWearableConnections("user-1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_my_wearable_connections");
    expect(result.current.data?.[0].permissions_granted).toEqual(["steps"]);
  });
});
