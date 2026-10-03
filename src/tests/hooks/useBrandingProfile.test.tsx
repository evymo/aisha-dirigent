import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "../utils/test-utils";
import {
  useBrandingProfile,
  useUpdateBrandingProfile,
  DEFAULT_BRANDING_PROFILE,
} from "@/hooks/useBrandingProfile";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
  isUsingAishaDevFallback: false,
}));

/** Minimal valid branding profile payload matching Zod schema. */
const MOCK_PROFILE = {
  id: "00000000-0000-0000-0000-000000000001",
  partner_id: null,
  status: "published",
  color_accent: "22 100% 88%",
  color_background: "210 20% 98%",
  color_destructive: "0 85% 66%",
  color_foreground: "0 0% 10%",
  color_muted: "220 9% 46%",
  color_primary: "23 100% 55%",
  color_secondary: "210 16% 95%",
  color_surface: "0 0% 100%",
  dark_color_background: null,
  dark_color_foreground: null,
  dark_color_muted: null,
  dark_color_primary: null,
  dark_color_surface: null,
  font_family_body: "Nunito Sans, sans-serif",
  font_family_brand: "Nunito Sans, sans-serif",
  font_family_code: "JetBrains Mono, monospace",
  favicon_path: null,
  login_logo_path: null,
  logo_dark_path: null,
  logo_path: null,
  operator_address: null,
  operator_email: "support@platform.com",
  operator_name: "Platform",
  operator_phone: null,
  operator_url: null,
  email_footer_text: null,
  email_header_bg: null,
  login_accent_color: null,
  login_background_color: null,
  login_card_bg: null,
  profile_version: 1,
  published_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("useBrandingProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns profile when RPC responds with ok status", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { status: "ok", profile: MOCK_PROFILE },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useBrandingProfile());

    await waitFor(() => {
      expect(result.current.data).toBeTruthy();
    });

    expect(result.current.data?.operator_name).toBe("Platform");
    expect(result.current.data?.color_primary).toBe("23 100% 55%");
    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_branding_profile", {
      p_partner_id: undefined,
    });
  });

  it("returns null when RPC responds with not_found", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { status: "not_found" },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useBrandingProfile());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeNull();
  });

  it("returns null when RPC returns error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "db error" },
    });

    const { result } = renderHookWithProviders(() => useBrandingProfile());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeNull();
  });

  it("passes partner_id when provided", async () => {
    const partnerId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    hoisted.rpcMock.mockResolvedValue({
      data: { status: "ok", profile: { ...MOCK_PROFILE, partner_id: partnerId } },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useBrandingProfile(partnerId));

    await waitFor(() => {
      expect(result.current.data).toBeTruthy();
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_branding_profile", {
      p_partner_id: partnerId,
    });
  });

  it("returns null on Zod parse failure (invalid profile shape)", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { status: "ok", profile: { invalid: true } },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useBrandingProfile());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeNull();
  });
});

describe("useUpdateBrandingProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls set_branding_profile_admin with correct params", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { success: true, profile_id: "test-id", profile_version: 2 },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useUpdateBrandingProfile());

    const outcome = await result.current.mutateAsync({
      formData: DEFAULT_BRANDING_PROFILE,
      publish: true,
    });

    expect(outcome.profileId).toBe("test-id");
    expect(outcome.version).toBe(2);
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "set_branding_profile_admin",
      expect.objectContaining({
        p_operator_name: "Platform",
        p_publish: true,
        p_color_primary: "23 100% 55%",
        p_partner_id: undefined,
      })
    );
  });

  it("throws on RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });

    const { result } = renderHookWithProviders(() => useUpdateBrandingProfile());

    await expect(
      result.current.mutateAsync({
        formData: DEFAULT_BRANDING_PROFILE,
        publish: false,
      })
    ).rejects.toThrow("permission denied");
  });
});
