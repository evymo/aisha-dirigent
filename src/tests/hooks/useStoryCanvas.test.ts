import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useUpdateStoryCanvas,
  parseCanvasData,
} from "@/hooks/useStoryCanvas";

// Create wrapper with QueryClientProvider
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// Mock Supabase RPC
const mockRpc = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// Mock safeError
vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: vi.fn(),
  };
});

// =====================================================
// Test Data
// =====================================================

const storyId = "11111111-1111-1111-1111-111111111111";

const mockCanvasData = {
  assets: [],
  pages: [
    {
      component: { type: "wrapper", components: [] },
      id: "page-1",
    },
  ],
  styles: [],
};

const mockCanvasResponse = {
  published: false,
  story_id: storyId,
  updated: true,
};

// =====================================================
// Tests
// =====================================================

describe("useUpdateStoryCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls update_story_canvas RPC with correct parameters", async () => {
    mockRpc.mockResolvedValueOnce({ data: mockCanvasResponse, error: null });

    const { result } = renderHook(() => useUpdateStoryCanvas(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        canvas_data: mockCanvasData,
        canvas_html: "<div>test</div>",
        canvas_css: ".test { color: red; }",
        publish: false,
        story_id: storyId,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_story_canvas", {
      p_canvas_css: ".test { color: red; }",
      p_canvas_data: mockCanvasData,
      p_canvas_html: "<div>test</div>",
      p_publish: false,
      p_story_id: storyId,
    });
  });

  it("returns validated response on success", async () => {
    mockRpc.mockResolvedValueOnce({ data: mockCanvasResponse, error: null });

    const { result } = renderHook(() => useUpdateStoryCanvas(), {
      wrapper: createWrapper(),
    });

    let response: unknown;
    await act(async () => {
      response = await result.current.mutateAsync({
        canvas_data: mockCanvasData,
        story_id: storyId,
      });
    });

    expect(response).toEqual(mockCanvasResponse);
  });

  it("handles publish=true correctly", async () => {
    const publishResponse = { ...mockCanvasResponse, published: true };
    mockRpc.mockResolvedValueOnce({ data: publishResponse, error: null });

    const { result } = renderHook(() => useUpdateStoryCanvas(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        canvas_data: mockCanvasData,
        publish: true,
        story_id: storyId,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_story_canvas", expect.objectContaining({
      p_publish: true,
    }));
  });

  it("passes null for optional fields when omitted", async () => {
    mockRpc.mockResolvedValueOnce({ data: mockCanvasResponse, error: null });

    const { result } = renderHook(() => useUpdateStoryCanvas(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        canvas_data: mockCanvasData,
        story_id: storyId,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_story_canvas", expect.objectContaining({
      p_canvas_css: undefined,
      p_canvas_html: undefined,
      p_publish: false,
    }));
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Story not found" },
    });

    const { result } = renderHook(() => useUpdateStoryCanvas(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          canvas_data: mockCanvasData,
          story_id: storyId,
        });
      }),
    ).rejects.toThrow("Story not found");
  });

  it("throws on invalid response shape", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { invalid: "shape" },
      error: null,
    });

    const { result } = renderHook(() => useUpdateStoryCanvas(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          canvas_data: mockCanvasData,
          story_id: storyId,
        });
      }),
    ).rejects.toThrow("Invalid canvas response");
  });
});

describe("parseCanvasData", () => {
  it("returns null for null input", () => {
    expect(parseCanvasData(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseCanvasData(undefined)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseCanvasData("string")).toBeNull();
    expect(parseCanvasData(42)).toBeNull();
  });

  it("parses valid canvas data", () => {
    const result = parseCanvasData(mockCanvasData);
    expect(result).toEqual(mockCanvasData);
  });

  it("parses minimal canvas data (empty object)", () => {
    const result = parseCanvasData({});
    expect(result).toEqual({});
  });

  it("preserves extra passthrough fields", () => {
    const dataWithExtra = { ...mockCanvasData, customField: "value" };
    const result = parseCanvasData(dataWithExtra);
    expect(result).toHaveProperty("customField", "value");
  });
});
