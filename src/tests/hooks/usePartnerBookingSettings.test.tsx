import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor, act } from "@testing-library/react";

import { renderHookWithProviders } from "@/tests/utils/test-utils";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => hoisted.useSessionMock(),
}));

import {
  usePartnerBookingSettings,
  useUpdatePartnerBookingSettings,
} from "@/hooks/usePartnerAvailabilityManager";

describe("usePartnerBookingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.useSessionMock.mockReturnValue({ user: { id: "user-1" } });
    hoisted.rpcMock.mockReset();
  });

  it("returns validated booking settings from RPC", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { buffer_minutes: 10, slot_duration_minutes: 45 },
      error: null,
    });

    const { result } = renderHookWithProviders(() =>
      usePartnerBookingSettings("partner-1")
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      buffer_minutes: 10,
      slot_duration_minutes: 45,
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_partner_booking_settings", {
      p_partner_id: "partner-1",
    });
  });

  it("throws on invalid data shape", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { wrong_key: 999 },
      error: null,
    });

    const { result } = renderHookWithProviders(() =>
      usePartnerBookingSettings("partner-1")
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("throws on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Unauthorized" },
    });

    const { result } = renderHookWithProviders(() =>
      usePartnerBookingSettings("partner-1")
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("is disabled when partnerId is empty", () => {
    const { result } = renderHookWithProviders(() =>
      usePartnerBookingSettings("")
    );

    expect(result.current.isFetching).toBe(false);
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });
});

describe("useUpdatePartnerBookingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.useSessionMock.mockReturnValue({ user: { id: "user-1" } });
    hoisted.rpcMock.mockReset();
  });

  it("calls update_partner_booking_settings RPC with correct params", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHookWithProviders(() =>
      useUpdatePartnerBookingSettings("partner-1")
    );

    await act(async () => {
      result.current.mutate({
        buffer_minutes: 15,
        slot_duration_minutes: 60,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith("update_partner_booking_settings", {
      p_buffer_minutes: 15,
      p_partner_id: "partner-1",
      p_slot_duration_minutes: 60,
    });
  });

  it("handles RPC error gracefully", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "db error" },
    });

    const { result } = renderHookWithProviders(() =>
      useUpdatePartnerBookingSettings("partner-1")
    );

    await act(async () => {
      result.current.mutate({
        buffer_minutes: 0,
        slot_duration_minutes: 30,
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("throws when user is not authenticated", async () => {
    hoisted.useSessionMock.mockReturnValue({ user: null });

    const { result } = renderHookWithProviders(() =>
      useUpdatePartnerBookingSettings("partner-1")
    );

    await act(async () => {
      result.current.mutate({
        buffer_minutes: 5,
        slot_duration_minutes: 30,
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
