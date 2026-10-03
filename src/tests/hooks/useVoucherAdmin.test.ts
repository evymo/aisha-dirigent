import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useVouchersAdmin,
  useVoucherAnalytics,
  useCreateManualVoucher,
} from "@/hooks/useVoucherAdmin";

// Hoisted mocks
const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockHasPermission: vi.fn(),
  mockGuardAdminMutation: vi.fn(),
  mockGuardAdminRead: vi.fn(),
  mockToast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  }),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: hoisted.mockRpc },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: hoisted.mockHasPermission }),
}));

vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({
    guardAdminMutation: hoisted.mockGuardAdminMutation,
    guardAdminRead: hoisted.mockGuardAdminRead,
  }),
}));

vi.mock("sonner", () => ({
  toast: hoisted.mockToast,
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

const mockVouchers = [
  {
    code: "ABCD1234",
    created_at: "2026-02-19T10:00:00Z",
    expires_at: "2027-02-19T10:00:00Z",
    id: "v1-uuid",
    metadata: null,
    points_cost: 50,
    product_id: "prod-uuid",
    product_name: "Test Product",
    status: "active",
    updated_at: "2026-02-19T10:00:00Z",
    used_at: null,
    user_email: "user@test.com",
    user_id: "user-uuid",
  },
];

const mockAnalytics = {
  active_count: 5,
  avg_points_cost: 30.5,
  conversion_rate: 60.0,
  expired_count: 2,
  total_issued: 10,
  total_points_spent: 305,
  used_count: 3,
};

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("useVouchersAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockGuardAdminMutation.mockImplementation(
      (_name: string, fn: (...args: unknown[]) => unknown) => fn
    );
    hoisted.mockGuardAdminRead.mockImplementation(
      (_name: string, fn: () => unknown) => fn
    );
    hoisted.mockRpc.mockResolvedValue({ data: mockVouchers, error: null });
  });

  it("returns voucher list from RPC", async () => {
    const { result } = renderHook(
      () => useVouchersAdmin(undefined, 25, 0),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].code).toBe("ABCD1234");
    expect(vi.mocked(hoisted.mockRpc)).toHaveBeenCalledWith(
      "get_vouchers_admin",
      expect.objectContaining({ p_limit: 25, p_offset: 0 })
    );
  });

  it("filters by status when provided", async () => {
    const { result } = renderHook(
      () => useVouchersAdmin("active", 25, 0),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(hoisted.mockRpc)).toHaveBeenCalledWith(
      "get_vouchers_admin",
      expect.objectContaining({ p_status: "active" })
    );
  });

  it("handles RPC error gracefully", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const { result } = renderHook(
      () => useVouchersAdmin(undefined, 25, 0),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("returns empty array for invalid RPC data", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: [{ invalid: true }], error: null });
    const { result } = renderHook(
      () => useVouchersAdmin(undefined, 25, 0),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // parseRpcArray silently drops invalid items
    expect(result.current.data).toEqual([]);
  });
});

describe("useVoucherAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockGuardAdminRead.mockImplementation(
      (_name: string, fn: () => unknown) => fn
    );
    hoisted.mockRpc.mockResolvedValue({ data: [mockAnalytics], error: null });
  });

  it("returns analytics data", async () => {
    const { result } = renderHook(() => useVoucherAnalytics(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total_issued).toBe(10);
    expect(result.current.data?.conversion_rate).toBe(60.0);
    expect(vi.mocked(hoisted.mockRpc)).toHaveBeenCalledWith(
      "get_voucher_analytics_admin"
    );
  });

  it("returns undefined when no data", async () => {
    hoisted.mockRpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useVoucherAnalytics(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("useCreateManualVoucher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockHasPermission.mockReturnValue(true);
    hoisted.mockGuardAdminMutation.mockImplementation(
      (_name: string, fn: (...args: unknown[]) => unknown) => fn
    );
    hoisted.mockRpc.mockResolvedValue({
      data: [{ code: "MANUAL01", id: "mv-uuid" }],
      error: null,
    });
  });

  it("calls RPC with correct params and shows success toast", async () => {
    const { result } = renderHook(() => useCreateManualVoucher(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        p_product_id: "prod-uuid",
        p_user_id: "user-uuid",
        p_reason: "Test compensation",
      });
    });

    expect(vi.mocked(hoisted.mockRpc)).toHaveBeenCalledWith(
      "create_manual_voucher_admin",
      expect.objectContaining({
        p_product_id: "prod-uuid",
        p_user_id: "user-uuid",
        p_reason: "Test compensation",
      })
    );
    expect(hoisted.mockToast.success).toHaveBeenCalled();
  });

  it("shows error toast on RPC failure", async () => {
    hoisted.mockRpc.mockResolvedValue({
      data: null,
      error: { message: "not found" },
    });
    const { result } = renderHook(() => useCreateManualVoucher(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          p_product_id: "bad-prod",
          p_user_id: "user-uuid",
        });
      } catch {
        // expected error
      }
    });

    expect(hoisted.mockToast.error).toHaveBeenCalled();
  });
});
