import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useRequestPasswordChange } from "@/hooks/useRequestPasswordChange";

const mocks = vi.hoisted(() => ({
  getKcUser: vi.fn(),
  getAccountUrl: vi.fn(),
  safeError: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  t: vi.fn((key: string) => key),
  language: "cs",
}));

vi.mock("@/integrations/auth", () => ({
  getUser: (...args: unknown[]) => mocks.getKcUser(...args),
  getAccountUrl: (...args: unknown[]) => mocks.getAccountUrl(...args),
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: (...args: unknown[]) => mocks.safeError(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: mocks.language } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}));

describe("useRequestPasswordChange", () => {
  let locationHrefSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mocks.getKcUser).mockResolvedValue({ id: "u1", email: "user@aisha.guru" });
    vi.mocked(mocks.getAccountUrl).mockReturnValue("https://kc.example.com/account/password");
    locationHrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, set href(v: string) { locationHrefSpy(v); } },
      writable: true,
      configurable: true,
    });
  });

  it("redirects to KC account password page when user exists", async () => {
    const { result } = renderHook(() => useRequestPasswordChange());

    await act(async () => {
      await result.current.requestPasswordChange();
    });

    expect(vi.mocked(mocks.getKcUser)).toHaveBeenCalled();
    expect(vi.mocked(mocks.getAccountUrl)).toHaveBeenCalledWith("password");
    expect(result.current.isSuccess).toBe(true);
  });

  it("returns error when no user is signed in", async () => {
    vi.mocked(mocks.getKcUser).mockResolvedValue(null);

    const { result } = renderHook(() => useRequestPasswordChange());

    await act(async () => {
      await result.current.requestPasswordChange();
    });

    expect(vi.mocked(mocks.toastError)).toHaveBeenCalledWith(
      "auth.errors.noEmail",
      expect.anything()
    );
  });

  it("logs safeError on exception", async () => {
    vi.mocked(mocks.getKcUser).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useRequestPasswordChange());

    await act(async () => {
      await result.current.requestPasswordChange();
    });

    expect(vi.mocked(mocks.safeError)).toHaveBeenCalledWith("useRequestPasswordChange", expect.anything());
    expect(vi.mocked(mocks.toastError)).toHaveBeenCalledWith(
      "auth.errors.passwordResetFailed",
      expect.anything()
    );
  });
});
