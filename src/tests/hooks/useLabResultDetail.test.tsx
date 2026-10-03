import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/tests/utils/test-utils";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
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
    safeError: vi.fn(),
    safeInfo: vi.fn(),
    safeWarn: vi.fn(),
  };
});

import { useLabResultDetail } from "@/hooks/useLabResultDetail";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockLabResultDetail = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  user_id: "660e8400-e29b-41d4-a716-446655440002",
  test_type: "blood_panel",
  test_date: "2026-02-15",
  result_date: "2026-02-18",
  lab_name: "Central Lab",
  status: "completed",
  file_url: "https://example.com/results.pdf",
  notes: "All values within range",
  results: null,
  created_at: "2026-02-15T09:00:00Z",
  reviewed_at: "2026-02-19T14:00:00Z",
  reviewed_by: "880e8400-e29b-41d4-a716-446655440004",
  reviewer_display_name: "Dr. Smith",
  updated_at: "2026-02-19T14:00:00Z",
  biomarkers: {
    crp: 1.5,
    wbc: 6.2,
    hemoglobin: 14.5,
    glucose: 95,
    vitamin_d: 45,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLabResultDetail", () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it("should fetch lab result detail via audited RPC", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: mockLabResultDetail,
      error: null,
    });

    const { result } = renderHookWithProviders(() =>
      useLabResultDetail("550e8400-e29b-41d4-a716-446655440001"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "get_lab_result_detail_audited",
      { p_lab_result_id: "550e8400-e29b-41d4-a716-446655440001" },
    );

    expect(result.current.data).toBeDefined();
    expect(result.current.data?.id).toBe(
      "550e8400-e29b-41d4-a716-446655440001",
    );
    expect(result.current.data?.test_type).toBe("blood_panel");
    expect(result.current.data?.status).toBe("completed");
    expect(result.current.data?.lab_name).toBe("Central Lab");
  });

  it("should not fetch when labResultId is null", () => {
    const { result } = renderHookWithProviders(() =>
      useLabResultDetail(null),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe("idle");
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("should not fetch when enabled is false", () => {
    const { result } = renderHookWithProviders(() =>
      useLabResultDetail("some-id", { enabled: false }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe("idle");
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("should handle RPC errors safely", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "Access denied to lab result data",
        code: "42501",
      },
    });

    const { result } = renderHookWithProviders(() =>
      useLabResultDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe(
      "Access denied to lab result data",
    );
    // No sensitive data in error message
    expect(result.current.error?.message).not.toContain("@");
    expect(result.current.error?.message).not.toContain("email");
  });

  it("should handle empty response data", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHookWithProviders(() =>
      useLabResultDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Empty lab result data");
  });

  it("should parse biomarkers correctly", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: mockLabResultDetail,
      error: null,
    });

    const { result } = renderHookWithProviders(() =>
      useLabResultDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const biomarkers = result.current.data?.biomarkers;
    expect(biomarkers).toBeDefined();
    expect(biomarkers?.crp).toBe(1.5);
    expect(biomarkers?.wbc).toBe(6.2);
    expect(biomarkers?.hemoglobin).toBe(14.5);
    expect(biomarkers?.glucose).toBe(95);
    expect(biomarkers?.vitamin_d).toBe(45);
  });

  it("should default empty biomarkers when none returned", async () => {
    const noMarkers = { ...mockLabResultDetail, biomarkers: undefined };
    hoisted.rpcMock.mockResolvedValue({ data: noMarkers, error: null });

    const { result } = renderHookWithProviders(() =>
      useLabResultDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.biomarkers).toEqual({});
  });

  it("should parse result with null optional fields", async () => {
    const minimalResult = {
      ...mockLabResultDetail,
      file_url: null,
      notes: null,
      result_date: null,
      results: null,
      reviewed_at: null,
      reviewed_by: null,
      reviewer_display_name: null,
      updated_at: null,
      test_type: null,
      lab_name: null,
      status: null,
      biomarkers: {},
    };
    hoisted.rpcMock.mockResolvedValue({ data: minimalResult, error: null });

    const { result } = renderHookWithProviders(() =>
      useLabResultDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.file_url).toBeNull();
    expect(result.current.data?.reviewed_by).toBeNull();
    expect(result.current.data?.biomarkers).toEqual({});
  });

  it("should handle pending status lab results", async () => {
    const pendingResult = {
      ...mockLabResultDetail,
      status: "pending",
      reviewed_at: null,
      reviewed_by: null,
      reviewer_display_name: null,
      biomarkers: {},
    };
    hoisted.rpcMock.mockResolvedValue({ data: pendingResult, error: null });

    const { result } = renderHookWithProviders(() =>
      useLabResultDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("pending");
    expect(result.current.data?.reviewed_at).toBeNull();
  });

  it("should reject invalid schema data", async () => {
    const invalidData = { id: 123, user_id: null }; // wrong types
    hoisted.rpcMock.mockResolvedValue({ data: invalidData, error: null });

    const { result } = renderHookWithProviders(() =>
      useLabResultDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Zod parse should throw
    expect(result.current.error).toBeDefined();
  });
});
