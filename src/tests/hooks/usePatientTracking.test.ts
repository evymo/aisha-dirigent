import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import {
  useUserConsentStatus,
  useUserCheckIns,
  calculateAverage,
  calculateStreak,
  determineTrend,
} from "@/hooks/usePatientTracking";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  safeError: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: (...args: unknown[]) => mocks.rpc(...args) },
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: (...args: unknown[]) => mocks.safeError(...args),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mocks.useSession(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("usePatientTracking hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mocks.useSession).mockReturnValue({ user: { id: "partner-1" } });
  });

  it("calls get_consent_status RPC and returns granted", async () => {
    vi.mocked(mocks.rpc).mockResolvedValue({ data: "granted", error: null });

    const { result } = renderHook(() => useUserConsentStatus("user-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(mocks.rpc)).toHaveBeenCalledWith("get_consent_status", {
      p_partner_user_id: "partner-1",
      p_user_id: "user-1",
    });
    expect(result.current.data).toBe("granted");
  });

  it("fail-closes and logs safeError on invalid consent response", async () => {
    vi.mocked(mocks.rpc).mockResolvedValue({ data: "invalid", error: null });

    const { result } = renderHook(() => useUserConsentStatus("user-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe("none");
    expect(vi.mocked(mocks.safeError)).toHaveBeenCalledWith(
      "useUserTracking.consentStatus.validation",
      expect.anything()
    );
  });

  it("calls audited check-ins RPC only with granted consent", async () => {
    vi.mocked(mocks.rpc).mockResolvedValue({ data: [], error: null });

    renderHook(() => useUserCheckIns("user-1", "granted"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(vi.mocked(mocks.rpc)).toHaveBeenCalledWith(
        "get_user_health_check_ins_summary_audited",
        { p_user_id: "user-1" }
      );
    });
  });

  it("does not call check-ins RPC for revoked consent", async () => {
    renderHook(() => useUserCheckIns("user-1", "revoked"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(vi.mocked(mocks.rpc)).not.toHaveBeenCalledWith(
      "get_user_health_check_ins_summary_audited",
      expect.anything()
    );
  });
});

describe("usePatientTracking utilities", () => {
  it("calculateAverage returns rounded value and null for empty", () => {
    expect(calculateAverage([1, 2, 2])).toBe(1.7);
    expect(calculateAverage([null, null])).toBeNull();
  });

  it("calculateStreak stops on first gap", () => {
    expect(calculateStreak(["2026-01-03", "2026-01-02", "2026-01-01"])).toBe(3);
    expect(calculateStreak(["2026-01-03", "2026-01-01"])).toBe(1);
  });

  it("determineTrend handles improving and stable scenarios", () => {
    const improving = [
      { check_in_date: "2026-01-06", mood_level: 5, energy_level: 5, id: "a", pain_level: null, sleep_quality: null },
      { check_in_date: "2026-01-05", mood_level: 5, energy_level: 5, id: "b", pain_level: null, sleep_quality: null },
      { check_in_date: "2026-01-04", mood_level: 2, energy_level: 2, id: "c", pain_level: null, sleep_quality: null },
      { check_in_date: "2026-01-03", mood_level: 2, energy_level: 2, id: "d", pain_level: null, sleep_quality: null },
    ];
    expect(determineTrend(improving)).toBe("improving");
    expect(determineTrend(improving.slice(0, 3))).toBe("stable");
  });
});
