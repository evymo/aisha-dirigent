import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  MEMBER_PROFILE_DEFAULTS,
  MEMBER_PROFILE_QUERY_KEY,
  normalizeProfileInput,
  normalizeProfileRow,
  useMemberProfile,
} from "@/hooks/useMemberProfile";

const hoisted = vi.hoisted(() => ({
  rpc: vi.fn(),
  safeError: vi.fn(),
  useSession: vi.fn(),
  useSecureMode: vi.fn(),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => hoisted.useSession(),
}));

vi.mock("@/hooks/useSecureMode", () => ({
  useSecureMode: () => hoisted.useSecureMode(),
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: (...args: unknown[]) => hoisted.safeError(...args),
  };
});

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useMemberProfile", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();

    hoisted.useSession.mockReturnValue({
      user: { id: "user-1", email: "member@example.com" },
      isLoading: false,
    });

    hoisted.useSecureMode.mockReturnValue({
      isEnabled: true,
      secureClient: {
        rpc: hoisted.rpc,
      },
    });

    hoisted.rpc.mockImplementation((fn: string) => {
      if (fn === "get_my_profile_phi") {
        return Promise.resolve({
          data: [
            {
              display_name: "Test User",
              phone: "+420123123123",
              gender: "female",
              date_of_birth: "1990-01-01",
              preferred_language: "cs",
              primary_diagnosis: "Diagnosis",
              current_medications: "Med A",
              allergies: "None",
              medical_history: "History",
            },
          ],
          error: null,
        });
      }

      if (fn === "upsert_my_profile_phi") {
        return Promise.resolve({ data: null, error: null });
      }

      return Promise.resolve({ data: null, error: null });
    });
  });

  it("loads profile via audited RPC and normalizes response", async () => {
    const { result } = renderHook(() => useMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(hoisted.rpc).toHaveBeenCalledWith("get_my_profile_phi");
    expect(result.current.profile.display_name).toBe("Test User");
    expect(result.current.profile.preferred_language).toBe("cs");
    expect(result.current.error).toBeNull();
  });

  it("saves profile via audited RPC with normalized payload", async () => {
    const { result } = renderHook(() => useMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Mock re-fetch after mutation to return updated data
    hoisted.rpc.mockImplementation((fn: string) => {
      if (fn === "get_my_profile_phi") {
        return Promise.resolve({
          data: [
            {
              display_name: "Updated Name",
              phone: "",
              gender: "",
              date_of_birth: "",
              preferred_language: "en",
              primary_diagnosis: "",
              current_medications: "",
              allergies: "",
              medical_history: "",
            },
          ],
          error: null,
        });
      }
      if (fn === "upsert_my_profile_phi") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    await act(async () => {
      await result.current.saveProfile({
        display_name: "Updated Name",
        phone: "",
        gender: "",
        date_of_birth: "",
        preferred_language: "en",
        primary_diagnosis: "",
        current_medications: "",
        allergies: "",
        medical_history: "",
      });
    });

    expect(hoisted.rpc).toHaveBeenCalledWith("upsert_my_profile_phi", {
      p_patch: {
        display_name: "Updated Name",
        phone: "",
        gender: "",
        date_of_birth: "",
        preferred_language: "en",
        primary_diagnosis: "",
        current_medications: "",
        allergies: "",
        medical_history: "",
      },
    });

    // After mutation + invalidation + refetch, updated data should be present
    await waitFor(() => {
      expect(result.current.profile.display_name).toBe("Updated Name");
    });
  });

  it("skips profile fetch when secure mode is disabled (fail-closed)", async () => {
    hoisted.useSecureMode.mockReturnValue({
      isEnabled: false,
      secureClient: null,
    });

    const { result } = renderHook(() => useMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });

    // Query should never execute — stays in idle state with defaults
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(hoisted.rpc).not.toHaveBeenCalled();
    expect(result.current.profile).toEqual(MEMBER_PROFILE_DEFAULTS);
  });

  it("reports validation error on malformed RPC payload", async () => {
    hoisted.rpc.mockImplementation((fn: string) => {
      if (fn === "get_my_profile_phi") {
        return Promise.resolve({
          data: [{ display_name: 123 }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(hoisted.safeError).toHaveBeenCalledWith(
      "useMemberProfile.fetch.validation",
      expect.anything()
    );
  });

  it("returns defaults when RPC returns empty array", async () => {
    hoisted.rpc.mockImplementation((fn: string) => {
      if (fn === "get_my_profile_phi") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.profile).toEqual(MEMBER_PROFILE_DEFAULTS);
  });

  it("handles RPC error on fetch", async () => {
    hoisted.rpc.mockImplementation((fn: string) => {
      if (fn === "get_my_profile_phi") {
        return Promise.resolve({
          data: null,
          error: { message: "Database unavailable", code: "500" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.profile).toEqual(MEMBER_PROFILE_DEFAULTS);
  });

  it("rolls back optimistic update on save error", async () => {
    // First load succeeds
    const { result } = renderHook(() => useMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.profile.display_name).toBe("Test User");
    });

    // Then save fails
    hoisted.rpc.mockImplementation((fn: string) => {
      if (fn === "upsert_my_profile_phi") {
        return Promise.resolve({
          data: null,
          error: { message: "Write failed", code: "500" },
        });
      }
      // Re-fetch after rollback returns original
      if (fn === "get_my_profile_phi") {
        return Promise.resolve({
          data: [
            {
              display_name: "Test User",
              phone: "+420123123123",
              gender: "female",
              date_of_birth: "1990-01-01",
              preferred_language: "cs",
              primary_diagnosis: "Diagnosis",
              current_medications: "Med A",
              allergies: "None",
              medical_history: "History",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    await expect(
      act(async () => {
        await result.current.saveProfile({
          display_name: "Should Rollback",
        });
      })
    ).rejects.toThrow();

    // After rollback + refetch, original data should be restored
    await waitFor(() => {
      expect(result.current.profile.display_name).toBe("Test User");
    });

    expect(hoisted.safeError).toHaveBeenCalledWith(
      "useMemberProfile.save.error",
      expect.anything()
    );
  });

  it("prevents save without secure mode (fail-closed)", async () => {
    hoisted.useSecureMode.mockReturnValue({
      isEnabled: false,
      secureClient: null,
    });

    const { result } = renderHook(() => useMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.saveProfile({ display_name: "Nope" });
      })
    ).rejects.toThrow("Profile access requires secure mode.");
  });

  it("rejects save with invalid payload (Zod validation)", async () => {
    const { result } = renderHook(() => useMemberProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let caughtError = null as Error | null;
    await act(async () => {
      try {
        await result.current.saveProfile({
          display_name: "x".repeat(200), // exceeds max(100)
        });
      } catch (err) {
        caughtError = err instanceof Error ? err : new Error(String(err));
      }
    });

    expect(caughtError).not.toBeNull();
    expect(caughtError?.message).toBe("Invalid profile update payload.");

    // Validation-specific safeError should have been called inside mutationFn
    expect(hoisted.safeError).toHaveBeenCalledWith(
      "useMemberProfile.save.validation",
      expect.anything()
    );
  });
});

describe("useMemberProfile — normalizers", () => {
  it("normalizeProfileRow handles all null fields", () => {
    const result = normalizeProfileRow({
      display_name: null,
      phone: null,
      gender: null,
      date_of_birth: null,
      preferred_language: null,
      primary_diagnosis: null,
      current_medications: null,
      allergies: null,
      medical_history: null,
    });

    expect(result).toEqual(MEMBER_PROFILE_DEFAULTS);
  });

  it("normalizeProfileInput defaults missing fields", () => {
    const result = normalizeProfileInput({});
    expect(result).toEqual(MEMBER_PROFILE_DEFAULTS);
  });

  it("MEMBER_PROFILE_QUERY_KEY is stable", () => {
    expect(MEMBER_PROFILE_QUERY_KEY).toBe("member-profile-secure");
  });
});
