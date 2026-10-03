/**
 * Tests for Occipitum design profile hooks.
 *
 * @module tests/hooks/useDesignProfile
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────

const mockRpc = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockSafeError = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
    auth: {
      getSession: mockGetSession,
    },
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: mockSafeError,
}));

// ── SUT ───────────────────────────────────────────────────────

import { useDesignProfile, designProfileKeys } from "@/hooks/useDesignProfile";

// ── Helpers ───────────────────────────────────────────────────

const PARTNER_ID = "aaaa1111-bbbb-cccc-dddd-eeee22223333";

const VALID_PROFILE_RESPONSE = {
  status: "ok" as const,
  profile: {
    id: "11112222-3333-4444-5555-666677778888",
    partner_id: PARTNER_ID,
    brand_dna: { personality: "bold", values: ["innovation", "clarity"] },
    ux_persona: { goals: ["quick onboarding"], tech_savviness: "high" },
    style_preferences: { vibe_words: ["minimalist", "dark"] },
    design_constraints: { accessibility_level: "wcag_aa" as const, mobile_first: true },
    profile_version: 3,
    created_at: "2026-04-12T10:00:00Z",
    updated_at: "2026-04-12T10:00:00Z",
  },
};

const NOT_FOUND_RESPONSE = {
  status: "not_found" as const,
  profile: null,
};

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── Tests ─────────────────────────────────────────────────────

describe("useDesignProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches design profile successfully", async () => {
    mockRpc.mockResolvedValue({ data: VALID_PROFILE_RESPONSE, error: null });

    const { result } = renderHook(() => useDesignProfile(PARTNER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_design_profile", {
      p_partner_id: PARTNER_ID,
    });
    expect(result.current.data?.status).toBe("ok");
    expect(result.current.data?.profile?.brand_dna?.personality).toBe("bold");
  });

  it("handles not_found response", async () => {
    mockRpc.mockResolvedValue({ data: NOT_FOUND_RESPONSE, error: null });

    const { result } = renderHook(() => useDesignProfile(PARTNER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe("not_found");
    expect(result.current.data?.profile).toBeNull();
  });

  it("does not fetch when partnerId is undefined", async () => {
    const { result } = renderHook(() => useDesignProfile(undefined), {
      wrapper: createWrapper(),
    });

    // Query should not execute — stays in idle/disabled state
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("transitions to error state on RPC failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "unauthorized" } });

    const { result } = renderHook(() => useDesignProfile(PARTNER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockSafeError).toHaveBeenCalled();
  });

  it("transitions to error state on Zod validation failure", async () => {
    // Return data with wrong shape — status is missing
    mockRpc.mockResolvedValue({
      data: { notAValidField: true },
      error: null,
    });

    const { result } = renderHook(() => useDesignProfile(PARTNER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("designProfileKeys", () => {
  it("generates correct query keys", () => {
    expect(designProfileKeys.all).toEqual(["design-profile"]);
    expect(designProfileKeys.byPartner("abc")).toEqual(["design-profile", "abc"]);
  });
});
