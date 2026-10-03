/**
 * useIntegrationServices Hook Tests
 *
 * Tests for the admin integration services hooks that call
 * `list_integration_services` RPC, permission-gated.
 *
 * @see src/hooks/useIntegrationServices.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useIntegrationServices,
  useIntegrationServiceByName,
  useIntegrationServicesByNames,
} from "@/hooks/useIntegrationServices";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn(() => true));
const mockSafeError = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    permissions: ["view_admin_dashboard"],
    isLoading: false,
    hasPermission: mockHasPermission,
    hasAllPermissions: vi.fn(() => true),
    hasAnyPermission: vi.fn(() => true),
  }),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: mockSafeError,
}));

/* ── Test data ────────────────────────────────────────────────── */

const VALID_SERVICES = [
  {
    id: "309771ef-0802-4e0d-ab53-a5e4ef90acc8",
    service_name: "appsmith",
    display_name: "Appsmith",
    service_type: "admin",
    base_url: "https://appsmith.aisha.guru",
    config: { description: "No-code admin dashboard" },
    health_status: "healthy",
    last_health_check: "2026-03-31T10:00:00Z",
    is_active: true,
    managed_by: "aisha",
    created_at: "2026-03-31T10:00:00Z",
    updated_at: "2026-03-31T10:00:00Z",
  },
  {
    id: "7fa95ba2-3fcd-4c68-ac27-1db15adc4ebf",
    service_name: "nocodb",
    display_name: "NocoDB",
    service_type: "admin_bridge",
    base_url: "https://nocodb.aisha.guru",
    config: { description: "Spreadsheet-like admin interface" },
    health_status: "unknown",
    last_health_check: null,
    is_active: true,
    managed_by: "aisha",
    created_at: "2026-03-31T10:00:00Z",
    updated_at: "2026-03-31T10:00:00Z",
  },
];

/* ── Helpers ──────────────────────────────────────────────────── */

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/* ── Tests ────────────────────────────────────────────────────── */

describe("useIntegrationServices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("returns integration services on successful RPC call", async () => {
    mockRpc.mockResolvedValue({ data: VALID_SERVICES, error: null });

    const { result } = renderHook(() => useIntegrationServices(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].service_name).toBe("appsmith");
    expect(result.current.data?.[1].service_name).toBe("nocodb");
  });

  it("calls rpc with correct parameters", async () => {
    mockRpc.mockResolvedValue({ data: VALID_SERVICES, error: null });

    renderHook(() => useIntegrationServices(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith("list_integration_services", {
      p_active_only: true,
    });
  });

  it("does not fetch when user lacks permission", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useIntegrationServices(), {
      wrapper: createWrapper(),
    });

    // Should stay in idle/pending state without fetching
    expect(result.current.isFetching).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error gracefully", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "unauthorized", code: "PGRST301" },
    });

    const { result } = renderHook(() => useIntegrationServices(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockSafeError).toHaveBeenCalledWith(
      "admin.integrationServices.list",
      expect.objectContaining({ message: "unauthorized" }),
    );
  });

  it("returns empty array when RPC returns null data", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useIntegrationServices(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("validates data with Zod schema and rejects invalid entries", async () => {
    const invalidData = [{ id: "not-a-uuid", service_name: 123 }];
    mockRpc.mockResolvedValue({ data: invalidData, error: null });

    const { result } = renderHook(() => useIntegrationServices(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useIntegrationServiceByName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("returns the matching service by name", async () => {
    mockRpc.mockResolvedValue({ data: VALID_SERVICES, error: null });

    const { result } = renderHook(() => useIntegrationServiceByName("appsmith"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.service_name).toBe("appsmith");
    expect(result.current.data?.base_url).toBe("https://appsmith.aisha.guru");
  });

  it("returns null when service name not found", async () => {
    mockRpc.mockResolvedValue({ data: VALID_SERVICES, error: null });

    const { result } = renderHook(() => useIntegrationServiceByName("nonexistent"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not fetch when serviceName is null", async () => {
    const { result } = renderHook(() => useIntegrationServiceByName(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not fetch when user lacks permission", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useIntegrationServiceByName("appsmith"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("useIntegrationServicesByNames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("returns a service lookup map for requested names", async () => {
    mockRpc.mockResolvedValue({ data: VALID_SERVICES, error: null });

    const { result } = renderHook(
      () => useIntegrationServicesByNames(["appsmith", "langfuse", "nocodb"]),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.appsmith?.display_name).toBe("Appsmith");
    expect(result.current.data?.nocodb?.display_name).toBe("NocoDB");
    expect(result.current.data?.langfuse).toBeNull();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when list of names is empty", () => {
    const { result } = renderHook(() => useIntegrationServicesByNames([]), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not fetch when user lacks permission", () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(
      () => useIntegrationServicesByNames(["appsmith", "n8n"]),
      {
        wrapper: createWrapper(),
      },
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
