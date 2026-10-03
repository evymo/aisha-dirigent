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

import { useConsentDetail } from "@/hooks/useConsentDetail";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConsentDetail = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  user_id: "660e8400-e29b-41d4-a716-446655440002",
  consent_type: "data_processing",
  version: "1.0",
  granted: true,
  granted_at: "2026-02-20T10:00:00Z",
  revoked_at: null,
  document_url: "https://example.com/consent.pdf",
  created_at: "2026-02-20T09:55:00Z",
  study_id: "770e8400-e29b-41d4-a716-446655440003",
  study_name: "Immunity Study",
  study_name_key: "studies.immunity_study",
  study_code: "IMM-001",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useConsentDetail", () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it("should fetch consent detail via audited RPC", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: mockConsentDetail,
      error: null,
    });

    const { result } = renderHookWithProviders(() =>
      useConsentDetail("550e8400-e29b-41d4-a716-446655440001"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "get_consent_detail_audited",
      { p_consent_id: "550e8400-e29b-41d4-a716-446655440001" },
    );

    expect(result.current.data).toBeDefined();
    expect(result.current.data?.id).toBe(
      "550e8400-e29b-41d4-a716-446655440001",
    );
    expect(result.current.data?.consent_type).toBe("data_processing");
    expect(result.current.data?.granted).toBe(true);
    expect(result.current.data?.study_name).toBe("Immunity Study");
  });

  it("should not fetch when consentId is null", () => {
    const { result } = renderHookWithProviders(() =>
      useConsentDetail(null),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe("idle");
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("should not fetch when enabled is false", () => {
    const { result } = renderHookWithProviders(() =>
      useConsentDetail("some-id", { enabled: false }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe("idle");
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("should handle RPC errors safely", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Access denied to consent data", code: "42501" },
    });

    const { result } = renderHookWithProviders(() =>
      useConsentDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe(
      "Access denied to consent data",
    );
    // No sensitive data in error message
    expect(result.current.error?.message).not.toContain("@");
    expect(result.current.error?.message).not.toContain("email");
  });

  it("should handle empty response data", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHookWithProviders(() =>
      useConsentDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Empty consent data");
  });

  it("should parse consent with null optional fields", async () => {
    const minimalConsent = {
      ...mockConsentDetail,
      granted_at: null,
      revoked_at: null,
      document_url: null,
      study_id: null,
      study_name: null,
      study_name_key: null,
      study_code: null,
      version: null,
    };
    hoisted.rpcMock.mockResolvedValue({ data: minimalConsent, error: null });

    const { result } = renderHookWithProviders(() =>
      useConsentDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.granted_at).toBeNull();
    expect(result.current.data?.study_name).toBeNull();
    expect(result.current.data?.document_url).toBeNull();
  });

  it("should handle revoked consent correctly", async () => {
    const revokedConsent = {
      ...mockConsentDetail,
      granted: false,
      revoked_at: "2026-03-01T12:00:00Z",
    };
    hoisted.rpcMock.mockResolvedValue({ data: revokedConsent, error: null });

    const { result } = renderHookWithProviders(() =>
      useConsentDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.granted).toBe(false);
    expect(result.current.data?.revoked_at).toBe("2026-03-01T12:00:00Z");
  });

  it("should reject invalid schema data", async () => {
    const invalidData = { id: 123, user_id: null }; // wrong types
    hoisted.rpcMock.mockResolvedValue({ data: invalidData, error: null });

    const { result } = renderHookWithProviders(() =>
      useConsentDetail("some-id"),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Zod parse should throw
    expect(result.current.error).toBeDefined();
  });
});
