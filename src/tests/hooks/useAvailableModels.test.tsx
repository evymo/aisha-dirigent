import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/tests/utils/test-utils";

/* ------------------------------------------------------------------ */
/* Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */
const hoisted = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    functions: {
      invoke: (...args: unknown[]) => hoisted.invokeMock(...args),
    },
  },
}));

import { useAvailableModels } from "@/hooks/useAvailableModels";

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */
describe("useAvailableModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns models from the edge function on success", async () => {
    const mockModels = [
      { id: "gpt-4.1", created: 1700000000, owned_by: "openai" },
      { id: "gpt-5-nano", created: 1700000001, owned_by: "openai" },
    ];

    hoisted.invokeMock.mockResolvedValue({
      data: { models: mockModels },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useAvailableModels());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.isFallback).toBe(false);
    expect(result.current.data?.models).toEqual(mockModels);
    expect(hoisted.invokeMock).toHaveBeenCalledWith("list-openai-models");
  });

  it("returns fallback models when edge function errors", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: null,
      error: new Error("Function not found"),
    });

    const { result } = renderHookWithProviders(() => useAvailableModels());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.isFallback).toBe(true);
    expect(result.current.data?.models.length).toBeGreaterThan(0);
    // Verify fallback list contains known models
    const ids = result.current.data?.models.map((m) => m.id) ?? [];
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-5-nano");
  });

  it("returns fallback models when API returns empty array", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: { models: [] },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useAvailableModels());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.isFallback).toBe(true);
    expect(result.current.data?.models.length).toBeGreaterThan(0);
  });

  it("returns fallback models when invoke throws an exception", async () => {
    hoisted.invokeMock.mockRejectedValue(new Error("Network error"));

    const { result } = renderHookWithProviders(() => useAvailableModels());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.isFallback).toBe(true);
  });

  it("returns fallback models when data has no models property", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: { something: "else" },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useAvailableModels());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.isFallback).toBe(true);
  });
});
