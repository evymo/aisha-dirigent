import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useInsertQuestionnaireResponse } from "@/hooks/useDynamicOnboarding";

// --- Mocks ---

const mockRpc = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: vi.fn(() => ({
    user: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  })),
}));

// --- Helpers ---

function createTestContext() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  // Spy on invalidateQueries
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, invalidateSpy, wrapper };
}

// --- Tests ---

describe("useInsertQuestionnaireResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls insert_questionnaire_response_secure RPC", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { wrapper } = createTestContext();

    const { result } = renderHook(() => useInsertQuestionnaireResponse(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        questionnaireId: "00000000-0000-0000-0000-000000000001",
        responses: { q1: "answer1" },
        studyRegistrationId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("insert_questionnaire_response_secure", {
      p_questionnaire_id: "00000000-0000-0000-0000-000000000001",
      p_responses: { q1: "answer1" },
      p_study_registration_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    });
  });

  it("invalidates questionnaire completion cache on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { wrapper, invalidateSpy } = createTestContext();

    const { result } = renderHook(() => useInsertQuestionnaireResponse(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        questionnaireId: "00000000-0000-0000-0000-000000000001",
        responses: { q1: "answer1" },
      });
    });

    // Should invalidate rii-questionnaire-completed, rii-membership, and check_umbrella_registration
    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => (call[0] as { queryKey: string[] }).queryKey
    );

    expect(invalidatedKeys).toContainEqual(["rii-questionnaire-completed"]);
    expect(invalidatedKeys).toContainEqual(["rii-membership"]);
    expect(invalidatedKeys).toContainEqual(["check_umbrella_registration"]);
  });

  it("does NOT invalidate cache on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "insert failed", code: "42000" },
    });
    const { wrapper, invalidateSpy } = createTestContext();

    const { result } = renderHook(() => useInsertQuestionnaireResponse(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          questionnaireId: "00000000-0000-0000-0000-000000000001",
          responses: { q1: "answer1" },
        });
      })
    ).rejects.toThrow();

    // onSuccess should NOT have been called
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("throws error on RPC failure", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Unauthorized", code: "42501" },
    });
    const { wrapper } = createTestContext();

    const { result } = renderHook(() => useInsertQuestionnaireResponse(), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          questionnaireId: "00000000-0000-0000-0000-000000000001",
          responses: {},
        });
      })
    ).rejects.toThrow();
  });
});
