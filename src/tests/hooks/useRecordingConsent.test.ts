import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRecordingConsent } from "@/hooks/useRecordingConsent";

// ── Hoisted mocks ──────────────────────────────────────────────

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

vi.mock("@/integrations/api/edge", () => ({
  invokeEdgeFunction: vi.fn(),
}));

// ── Wrapper ────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("useRecordingConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with idle state and no consent", () => {
    const { result } = renderHook(
      () => useRecordingConsent("session-123", "user-123"),
      { wrapper: createWrapper() },
    );

    expect(result.current.recordingState.status).toBe("idle");
    expect(result.current.recordingState.consentGiven).toBe(false);
    expect(result.current.recordingState.egressId).toBeNull();
  });

  it("should expose grantConsent callback and startRecording mutation", () => {
    const { result } = renderHook(
      () => useRecordingConsent("session-123", "user-123"),
      { wrapper: createWrapper() },
    );

    expect(typeof result.current.grantConsent).toBe("function");
    expect(result.current.startRecording).toBeDefined();
    expect(typeof result.current.startRecording.mutateAsync).toBe("function");
  });
});
