import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import {
  useFioBankSettingsConfig,
  useUpdateFioBankSettings,
  useSetupBankTransfer,
  DEFAULT_FIO_BANK_SETTINGS,
} from "@/hooks/useBankTransferSettings";
import type {
  FioBankSettingsConfig,
  BankTransferSetupResult,
} from "@/hooks/useBankTransferSettings";

// ── Hoisted mocks ──────────────────────────────────────────────

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: hoisted.safeErrorMock,
  };
});

// ── Wrapper ────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ── useFioBankSettingsConfig ───────────────────────────────────

describe("useFioBankSettingsConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch and normalize fio bank settings", async () => {
    const config: FioBankSettingsConfig = {
      check_interval_minutes: 15,
      enabled: true,
    };

    hoisted.rpcMock.mockResolvedValue({
      data: config,
      error: null,
    });

    const { result } = renderHook(() => useFioBankSettingsConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(config);
    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_system_config", {
      p_key: "fio_bank",
    });
  });

  it("should return defaults on RPC error without throwing", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Config not found" },
    });

    const { result } = renderHook(() => useFioBankSettingsConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DEFAULT_FIO_BANK_SETTINGS);
  });

  it("should return defaults for malformed data", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { enabled: "not-a-boolean", check_interval_minutes: -5 },
      error: null,
    });

    const { result } = renderHook(() => useFioBankSettingsConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // partial schema fails on invalid types → returns defaults
    expect(result.current.data?.enabled).toBe(false);
    expect(result.current.data?.check_interval_minutes).toBe(30);
  });

  it("should merge partial config with defaults", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { enabled: true },
      error: null,
    });

    const { result } = renderHook(() => useFioBankSettingsConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      check_interval_minutes: 30,
      enabled: true,
    });
  });

  it("should handle thrown exception gracefully", async () => {
    hoisted.rpcMock.mockRejectedValue(new Error("Connection refused"));

    const { result } = renderHook(() => useFioBankSettingsConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DEFAULT_FIO_BANK_SETTINGS);
  });
});

// ── useUpdateFioBankSettings ───────────────────────────────────

describe("useUpdateFioBankSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should update fio bank settings via admin RPC", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useUpdateFioBankSettings(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        check_interval_minutes: 15,
        enabled: true,
      });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith("set_system_config_admin", {
      p_category: "commerce",
      p_description: "Fio banka API reconciliation settings",
      p_is_public: false,
      p_key: "fio_bank",
      p_value: { check_interval_minutes: 15, enabled: true },
    });
  });

  it("should throw on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Admin role required" },
    });

    const { result } = renderHook(() => useUpdateFioBankSettings(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          check_interval_minutes: 30,
          enabled: false,
        });
      }),
    ).rejects.toThrow("Admin role required");
  });
});

// ── useSetupBankTransfer ───────────────────────────────────────

describe("useSetupBankTransfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should setup bank transfer for order", async () => {
    const setupResult: BankTransferSetupResult = {
      amount: 1200,
      bic: "FIOBCZPP",
      currency: "CZK",
      due_date: "2026-03-01",
      iban: "CZ1234567890",
      ok: true,
      variable_symbol: "20260001",
    };

    hoisted.rpcMock.mockResolvedValue({
      data: setupResult,
      error: null,
    });

    const { result } = renderHook(() => useSetupBankTransfer(), {
      wrapper: createWrapper(),
    });

    let data: BankTransferSetupResult | undefined;
    await act(async () => {
      data = await result.current.mutateAsync("order-123");
    });

    expect(data).toEqual(setupResult);
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "setup_bank_transfer_for_order",
      { p_order_id: "order-123" },
    );
  });

  it("should throw on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Order not found" },
    });

    const { result } = renderHook(() => useSetupBankTransfer(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync("order-bad");
      }),
    ).rejects.toThrow("Order not found");
  });

  it("should throw on invalid response schema", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { ok: true, missing_fields: true },
      error: null,
    });

    const { result } = renderHook(() => useSetupBankTransfer(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync("order-123");
      }),
    ).rejects.toThrow("Invalid bank transfer setup response");
  });

  it("should throw on null data", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useSetupBankTransfer(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync("order-123");
      }),
    ).rejects.toThrow("Invalid bank transfer setup response");
  });
});
