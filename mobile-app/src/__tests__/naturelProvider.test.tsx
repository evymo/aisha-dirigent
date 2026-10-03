/**
 * NaturelProvider — load/persist round-trip against mocked gateway + offline.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { NaturelProvider, useNaturel } from "@/naturel/NaturelProvider";
import { createQueryWrapper } from "@/__tests__/testUtils";

import type { ReactNode } from "react";

const mockRpc = jest.fn();
const mockEnqueue = jest.fn();
let mockOnline = true;

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
jest.mock("@/services/offline", () => ({
  enqueueMutation: (...args: unknown[]) => mockEnqueue(...args),
  isNetworkConnected: async () => mockOnline,
}));
jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: null }),
}));

function makeWrapper() {
  const QueryWrapper = createQueryWrapper();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryWrapper>
        <NaturelProvider>{children}</NaturelProvider>
      </QueryWrapper>
    );
  };
}

describe("NaturelProvider", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockEnqueue.mockReset();
    mockOnline = true;
  });

  it("loads the stored style and resolves a mobile-biased policy", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        sync_enabled: false,
        storyloop_settings: {
          naturel: { profile: { axes: { grain: { v: 0.6, c: 0.6 } }, source: "calibration-z6" } },
        },
      },
      error: null,
    });

    const { result } = renderHook(() => useNaturel(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.decided).toBe(true);
    // grain 0.6 resolves rich; mobile bias shortens to standard (E8 keeps evidence inline)
    expect(result.current.policy.message.length).toBe("standard");
    expect(result.current.policy.message.evidence).toBe("inline");
  });

  it("saveProfile writes the COMPLETE naturel object (shallow-merge contract)", async () => {
    mockRpc.mockResolvedValueOnce({ data: { storyloop_settings: {} }, error: null }); // load
    mockRpc.mockResolvedValueOnce({ data: {}, error: null }); // update

    const { result } = renderHook(() => useNaturel(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveProfile({ axes: { choice: { v: -0.6, c: 0.6 } }, source: "calibration-z6" });
    });

    const updateCall = mockRpc.mock.calls.find((c) => c[0] === "update_my_storyloop_ui_preferences");
    expect(updateCall).toBeDefined();
    const settings = (updateCall![1] as { p_storyloop_settings: { naturel: { profile: unknown; skippedAt: null } } })
      .p_storyloop_settings;
    expect(settings.naturel.profile).toMatchObject({ axes: { choice: { v: -0.6, c: 0.6 } } });
    expect(settings.naturel.skippedAt).toBeNull();
    // The policy follows (class A wins; react-query notifies on the next tick)
    await waitFor(() => expect(result.current.policy.choice.mode).toBe("variants"));
  });

  it("offline → queues the write instead of dropping it", async () => {
    mockOnline = false;
    mockRpc.mockResolvedValueOnce({ data: { storyloop_settings: {} }, error: null }); // load

    const { result } = renderHook(() => useNaturel(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.skipCalibration();
    });

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.stringMatching(/^naturel-/),
      expect.objectContaining({ settings: expect.objectContaining({ naturel: expect.anything() }) }),
      "save_naturel_style",
    );
    // No update RPC went out while offline
    expect(mockRpc.mock.calls.filter((c) => c[0] === "update_my_storyloop_ui_preferences")).toHaveLength(0);
    await waitFor(() => expect(result.current.decided).toBe(true));
  });

  it("reset (E7) clears the stored style", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { storyloop_settings: { naturel: { profile: { source: "override" } } } },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: {}, error: null });

    const { result } = renderHook(() => useNaturel(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.decided).toBe(true));

    await act(async () => {
      await result.current.reset();
    });

    const updateCall = mockRpc.mock.calls.find((c) => c[0] === "update_my_storyloop_ui_preferences");
    const settings = (updateCall![1] as { p_storyloop_settings: { naturel: { profile: null } } }).p_storyloop_settings;
    expect(settings.naturel.profile).toBeNull();
    await waitFor(() => expect(result.current.profile).toBeNull());
  });
});
