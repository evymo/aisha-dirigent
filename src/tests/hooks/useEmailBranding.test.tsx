import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "../utils/test-utils";
import {
  DEFAULT_EMAIL_BRANDING,
  useEmailBrandingConfig,
  useUpdateEmailBranding,
  useEmailBrandingUpload,
} from "@/hooks/useEmailBranding";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://example.com/storage/${path}` },
        }),
        upload: (...args: unknown[]) => hoisted.uploadMock(...args),
      }),
    },
  },
  isUsingAishaDevFallback: false,
}));

/** Minimal branding profile for bridge testing. */
const MOCK_BRANDING_PROFILE = {
  id: "00000000-0000-0000-0000-000000000001",
  partner_id: null,
  status: "published" as const,
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
  logo_path: "branding/logo.png",
  operator_address: null,
  operator_email: "support@test.com",
  operator_name: "TestBrand",
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

describe("useEmailBranding (bridge from branding profile)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default branding when branding profile fetch fails", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: { message: "fail" } });

    const { result } = renderHookWithProviders(() => useEmailBrandingConfig());

    await waitFor(() => {
      expect(result.current.data).toEqual(DEFAULT_EMAIL_BRANDING);
    });
  });

  it("maps branding profile fields to email branding shape", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { status: "ok", profile: MOCK_BRANDING_PROFILE },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useEmailBrandingConfig());

    await waitFor(() => {
      expect(result.current.data?.brand_name).toBe("TestBrand");
    });

    expect(result.current.data?.support_email).toBe("support@test.com");
    expect(result.current.data?.logo_path).toBe("branding/logo.png");
  });

  it("appends .png to logo_path without extension", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: {
        status: "ok",
        profile: { ...MOCK_BRANDING_PROFILE, logo_path: "branding/logo" },
      },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useEmailBrandingConfig());

    await waitFor(() => {
      expect(result.current.data?.logo_path).toBe("branding/logo.png");
    });
  });

  it("returns defaults when branding profile not found", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { status: "not_found" },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useEmailBrandingConfig());

    await waitFor(() => {
      expect(result.current.data).toEqual(DEFAULT_EMAIL_BRANDING);
    });
  });

  it("updates branding via legacy admin RPC (backward compat)", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: { success: true }, error: null });

    const { result } = renderHookWithProviders(() => useUpdateEmailBranding());

    await result.current.mutateAsync(DEFAULT_EMAIL_BRANDING);

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "set_system_config_admin",
      expect.objectContaining({
        p_key: "email_branding",
        p_value: DEFAULT_EMAIL_BRANDING,
        p_is_public: true,
      })
    );
  });

  describe("useEmailBrandingUpload", () => {
    it("returns storagePath and publicUrl after successful upload", async () => {
      hoisted.uploadMock.mockResolvedValue({ data: { path: "branding/logo.png" }, error: null });

      const { result } = renderHookWithProviders(() => useEmailBrandingUpload());

      const file = new File(["img"], "test.png", { type: "image/png" });
      const uploadResult = await result.current.uploadLogo(file);

      expect(uploadResult.storagePath).toBe("branding/logo.png");
      expect(uploadResult.publicUrl).toMatch(/^https:\/\/example\.com\/storage\/branding\/logo\.png\?v=\d+$/);
    });

    it("always uploads to fixed DEFAULT_EMAIL_LOGO_PATH regardless of MIME type", async () => {
      hoisted.uploadMock.mockResolvedValue({ data: { path: "branding/logo.png" }, error: null });

      const { result } = renderHookWithProviders(() => useEmailBrandingUpload());

      const file = new File(["img"], "photo.jpeg", { type: "image/jpeg" });
      const uploadResult = await result.current.uploadLogo(file);

      expect(uploadResult.storagePath).toBe("branding/logo.png");
      expect(uploadResult.publicUrl).toContain("branding/logo.png");
      expect(hoisted.uploadMock).toHaveBeenCalledWith(
        "branding/logo.png",
        expect.any(File),
        expect.objectContaining({ upsert: true, contentType: "image/jpeg" })
      );
    });

    it("throws on unsupported file type", async () => {
      const { result } = renderHookWithProviders(() => useEmailBrandingUpload());

      const file = new File(["data"], "test.gif", { type: "image/gif" });
      await expect(result.current.uploadLogo(file)).rejects.toThrow("Unsupported logo file type");
    });

    it("throws on file too large", async () => {
      const { result } = renderHookWithProviders(() => useEmailBrandingUpload());

      const largeContent = new Uint8Array(3 * 1024 * 1024); // 3MB
      const file = new File([largeContent], "huge.png", { type: "image/png" });
      await expect(result.current.uploadLogo(file)).rejects.toThrow("Logo file too large");
    });

    it("throws on storage upload error", async () => {
      hoisted.uploadMock.mockResolvedValue({
        data: null,
        error: { message: "Storage full", statusCode: 500 },
      });

      const { result } = renderHookWithProviders(() => useEmailBrandingUpload());

      const file = new File(["img"], "ok.png", { type: "image/png" });
      await expect(result.current.uploadLogo(file)).rejects.toEqual(
        expect.objectContaining({ message: "Storage full" })
      );
    });
  });
});
