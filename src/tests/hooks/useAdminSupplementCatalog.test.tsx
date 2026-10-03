/**
 * Tests for src/hooks/useAdminSupplementCatalog.ts
 *
 * NOTE: This is the *dosage tracking* product catalog (which supplements
 * users can track for symptom management), NOT the e-commerce products
 * catalog (that one lives in useAdminProducts.ts). The RPC family is
 * `get_product_catalog_admin` / `upsert_product_catalog_admin` /
 * `delete_product_catalog_admin`.
 *
 * Coverage:
 *   - useProductCatalogAdmin       (query)
 *   - useCreateProductCatalog      (upsert, p_id: undefined)
 *   - useUpdateProductCatalog      (upsert, p_id: params.id)
 *   - useDeleteProductCatalog      (delete by id)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useProductCatalogAdmin,
  useCreateProductCatalog,
  useUpdateProductCatalog,
  useDeleteProductCatalog,
} from "@/hooks/useAdminSupplementCatalog";

const { mockRpc, mockHasPermission, mockUser, mockGuardAdminMutation } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockHasPermission: vi.fn(),
    mockUser: { id: "admin-id" },
    mockGuardAdminMutation: (_rpc: string, fn: (args: unknown) => unknown) => fn,
  }));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser }),
}));
vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({ guardAdminMutation: mockGuardAdminMutation }),
}));

function createWrapper(qc?: QueryClient) {
  const queryClient =
    qc ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

const UUID_PRODUCT = "70000001-0000-4000-a000-000000000001";

const mockProductRow = {
  id: UUID_PRODUCT,
  code: "vitamin_d3",
  category: "vitamin",
  icon: "pill",
  color: "#ffaa00",
  default_dose_amount: 2000,
  default_dose_unit: "IU",
  default_doses_per_day: 1,
  default_dose_timing: ["morning"],
  sort_order: 10,
  is_active: true,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T01:00:00Z",
  translations: {
    en: { name: "Vitamin D3", description: "Cholecalciferol" },
    cs: { name: "Vitamín D3", description: "Cholekalciferol" },
  },
};

const upsertInput = {
  code: "vitamin_d3",
  category: "vitamin",
  icon: "pill",
  color: "#ffaa00",
  default_dose_amount: 2000,
  default_dose_unit: "IU",
  default_doses_per_day: 1,
  default_dose_timing: ["morning"],
  sort_order: 10,
  is_active: true,
  translations: {
    en: { name: "Vitamin D3" },
    cs: { name: "Vitamín D3" },
  },
};

// ── useProductCatalogAdmin ─────────────────────────────────────

describe("useProductCatalogAdmin (supplement catalog query)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_product_catalog_admin and returns parsed array", async () => {
    mockRpc.mockResolvedValue({ data: [mockProductRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProductCatalogAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_product_catalog_admin");
    expect(result.current.data).toEqual([mockProductRow]);
  });

  it("supports null defaults for products without standard dosage", async () => {
    // E.g. a herb whose dose is per-person — all default_dose_* fields null
    const noDoseDefaults = {
      ...mockProductRow,
      default_dose_amount: null,
      default_dose_unit: null,
      default_doses_per_day: null,
      default_dose_timing: null,
    };
    mockRpc.mockResolvedValue({ data: [noDoseDefaults], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProductCatalogAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].default_dose_amount).toBeNull();
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProductCatalogAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProductCatalogAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied for function");
  });
});

// ── useCreateProductCatalog ────────────────────────────────────

describe("useCreateProductCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls upsert_product_catalog_admin with p_id=undefined (CREATE)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateProductCatalog(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(upsertInput);
    });

    expect(mockRpc).toHaveBeenCalledWith("upsert_product_catalog_admin", {
      p_category: "vitamin",
      p_code: "vitamin_d3",
      p_color: "#ffaa00",
      p_default_dose_amount: 2000,
      p_default_dose_timing: ["morning"],
      p_default_dose_unit: "IU",
      p_default_doses_per_day: 1,
      p_icon: "pill",
      p_id: undefined,
      p_is_active: true,
      p_sort_order: 10,
      p_translations: upsertInput.translations,
    });
  });

  it("maps null dose fields to undefined for the RPC (skip-update semantics)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateProductCatalog(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        ...upsertInput,
        default_dose_amount: null,
        default_dose_unit: null,
        default_doses_per_day: null,
        default_dose_timing: null,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "upsert_product_catalog_admin",
      expect.objectContaining({
        p_default_dose_amount: undefined,
        p_default_dose_unit: undefined,
        p_default_doses_per_day: undefined,
        p_default_dose_timing: undefined,
      }),
    );
  });

  it("invalidates admin-product-catalog cache on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateProductCatalog(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(upsertInput);
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-product-catalog"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate code 'vitamin_d3'" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateProductCatalog(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(upsertInput);
      }),
    ).rejects.toThrow("duplicate code");
  });
});

// ── useUpdateProductCatalog ────────────────────────────────────

describe("useUpdateProductCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls upsert_product_catalog_admin with p_id=params.id (UPDATE)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProductCatalog(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ ...upsertInput, id: UUID_PRODUCT });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "upsert_product_catalog_admin",
      expect.objectContaining({ p_id: UUID_PRODUCT }),
    );
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "product not found" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProductCatalog(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ ...upsertInput, id: UUID_PRODUCT });
      }),
    ).rejects.toThrow("product not found");
  });
});

// ── useDeleteProductCatalog ────────────────────────────────────

describe("useDeleteProductCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls delete_product_catalog_admin with the id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteProductCatalog(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(UUID_PRODUCT);
    });

    expect(mockRpc).toHaveBeenCalledWith("delete_product_catalog_admin", {
      p_id: UUID_PRODUCT,
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "product has dosing logs — cannot hard delete" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteProductCatalog(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_PRODUCT);
      }),
    ).rejects.toThrow("cannot hard delete");
  });
});
