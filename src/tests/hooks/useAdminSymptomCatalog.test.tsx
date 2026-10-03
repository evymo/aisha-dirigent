/**
 * Tests for src/hooks/useAdminSymptomCatalog.ts
 *
 * Coverage:
 *   - useSymptomCatalogAdmin      (query — get_symptom_catalog_admin)
 *   - useCreateSymptomCatalog     (mutation — upsert with p_id: undefined)
 *   - useUpdateSymptomCatalog     (mutation — upsert with p_id: params.id)
 *   - useDeleteSymptomCatalog     (mutation — delete by id)
 *
 * Note: the create/update hooks both call `upsert_symptom_catalog_admin`.
 * The only difference is `p_id` (undefined for create, real UUID for
 * update). We verify both flows independently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useSymptomCatalogAdmin,
  useCreateSymptomCatalog,
  useUpdateSymptomCatalog,
  useDeleteSymptomCatalog,
} from "@/hooks/useAdminSymptomCatalog";

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

const UUID_SYMPTOM = "70000000-0000-4000-a000-000000000001";

const mockSymptomRow = {
  id: UUID_SYMPTOM,
  code: "headache",
  category: "neurological",
  icon: "head",
  color: "#ff5577",
  default_severity_scale: 10,
  sort_order: 5,
  is_active: true,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T01:00:00Z",
  translations: {
    en: { name: "Headache", description: "Pain in the head" },
    cs: { name: "Bolest hlavy", description: "Bolest v hlavě" },
  },
};

const upsertInput = {
  code: "headache",
  category: "neurological",
  icon: "head",
  color: "#ff5577",
  default_severity_scale: 10,
  sort_order: 5,
  is_active: true,
  translations: {
    en: { name: "Headache" },
    cs: { name: "Bolest hlavy" },
  },
};

// ── useSymptomCatalogAdmin ─────────────────────────────────────

describe("useSymptomCatalogAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_symptom_catalog_admin and returns parsed array", async () => {
    mockRpc.mockResolvedValue({ data: [mockSymptomRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSymptomCatalogAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_symptom_catalog_admin");
    expect(result.current.data).toEqual([mockSymptomRow]);
  });

  it("falls back to raw data on schema mismatch (current contract)", async () => {
    // The hook logs the parse error and casts data through — this is the
    // current behaviour and we lock it in as a regression test. If we
    // ever switch to soft-fail empty array, update this test.
    const malformed = [{ ...mockSymptomRow, default_severity_scale: "ten" }];
    mockRpc.mockResolvedValue({ data: malformed, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSymptomCatalogAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(malformed);
  });

  it("returns [] when caller lacks view_admin_dashboard (query body short-circuits)", async () => {
    mockHasPermission.mockReturnValue(false);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSymptomCatalogAdmin(), {
      wrapper: Wrapper,
    });
    // enabled: false → fetchStatus settles to idle, no RPC call
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSymptomCatalogAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied for function");
  });
});

// ── useCreateSymptomCatalog ────────────────────────────────────

describe("useCreateSymptomCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls upsert_symptom_catalog_admin with p_id=undefined (CREATE flow)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSymptomCatalog(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(upsertInput);
    });

    expect(mockRpc).toHaveBeenCalledWith("upsert_symptom_catalog_admin", {
      p_category: "neurological",
      p_code: "headache",
      p_color: "#ff5577",
      p_default_severity_scale: 10,
      p_icon: "head",
      p_id: undefined,
      p_is_active: true,
      p_sort_order: 5,
      p_translations: upsertInput.translations,
    });
  });

  it("invalidates admin-symptom-catalog cache on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateSymptomCatalog(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(upsertInput);
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-symptom-catalog"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate code 'headache'" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSymptomCatalog(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(upsertInput);
      }),
    ).rejects.toThrow("duplicate code");
  });
});

// ── useUpdateSymptomCatalog ────────────────────────────────────

describe("useUpdateSymptomCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls upsert_symptom_catalog_admin with p_id=params.id (UPDATE flow)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateSymptomCatalog(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ ...upsertInput, id: UUID_SYMPTOM });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "upsert_symptom_catalog_admin",
      expect.objectContaining({ p_id: UUID_SYMPTOM }),
    );
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "symptom not found" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateSymptomCatalog(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ ...upsertInput, id: UUID_SYMPTOM });
      }),
    ).rejects.toThrow("symptom not found");
  });
});

// ── useDeleteSymptomCatalog ────────────────────────────────────

describe("useDeleteSymptomCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls delete_symptom_catalog_admin with the id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteSymptomCatalog(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(UUID_SYMPTOM);
    });

    expect(mockRpc).toHaveBeenCalledWith("delete_symptom_catalog_admin", {
      p_id: UUID_SYMPTOM,
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "symptom has tracking entries — cannot hard delete" },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteSymptomCatalog(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_SYMPTOM);
      }),
    ).rejects.toThrow("cannot hard delete");
  });
});
