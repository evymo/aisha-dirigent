import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "../utils/test-utils";
import { useHostnameBranding } from "@/hooks/useHostnameBranding";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
  isUsingAishaDevFallback: false,
}));

/** Minimal valid branding profile row (matches brandingProfileSchema). */
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

const okEnvelope = (brand_variant: string) => ({
  data: {
    status: "ok",
    brand_variant,
    primary_route: "/poradna",
    secondary_route: null,
    profile: MOCK_PROFILE,
  },
  error: null,
});

describe("useHostnameBranding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves branding for a known brand_variant", async () => {
    hoisted.rpcMock.mockResolvedValue(okEnvelope("umbrella"));

    const { result } = renderHookWithProviders(() => useHostnameBranding());

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.brand_variant).toBe("umbrella");
    expect(result.current.data?.primary_route).toBe("/poradna");
    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_branding_for_hostname", {
      p_hostname: expect.any(String),
    });
  });

  it("resolves branding for a novel tenant slug (regression: no closed enum)", async () => {
    // Before the fix, brand_variant was z.enum(["umbrella","therapy-first"]),
    // so a new tenant slug failed safeParse → the whole branding resolved to
    // null and the SPA fell back to the default theme. Any DB-valid slug must
    // now resolve.
    for (const slug of ["alfa", "b2b", "b2c", "alfa-varianta"]) {
      hoisted.rpcMock.mockResolvedValue(okEnvelope(slug));
      const { result } = renderHookWithProviders(() => useHostnameBranding());
      await waitFor(() => expect(result.current.data).toBeTruthy());
      expect(result.current.data?.brand_variant).toBe(slug);
    }
  });

  it("accepts any instance-defined brand_variant string (open set — upstream fork-clean semantics)", async () => {
    // Upstream resolution (merge 2026-07-03): brand_variant is z.string() — an
    // OPEN set so downstream instances never edit this upstream file. Shape
    // enforcement lives in the DB CHECK (^[a-z][a-z0-9_-]*$); the client does
    // not second-guess rows the DB already accepted.
    hoisted.rpcMock.mockResolvedValue(okEnvelope("any_value-42"));
    const { result } = renderHookWithProviders(() => useHostnameBranding());
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.brand_variant).toBe("any_value-42");
  });

  it("returns null when the hostname is unmapped (RPC data null)", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHookWithProviders(() => useHostnameBranding());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  // RPC chyba NENÍ „žádná značka". Dřív ji hook spolkl a vrátil null, takže
  // React Query nikdy neviděla odmítnutý příslib → žádné opakování → jediný
  // přechodný 5xx během startovní špičky SPA nechal značku natrvalo prázdnou
  // (bez motivu, bez přesměrování, bez textu v hlavičce) až do ručního reloadu.
  //
  // Hook teď VYHAZUJE, RQ opakuje (retry: 3, exponenciální odstup) a když se
  // pokusy vyčerpají, dotaz skončí v isError — ne ve falešném „úspěchu s null".
  // Test tvrdí právě tenhle rozdíl: chyba se NESMÍ tvářit jako prázdná značka.
  it("chyba RPC skončí v isError, ne ve falešném úspěchu s null", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: { message: "db error" } });

    const { result } = renderHookWithProviders(() => useHostnameBranding());

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 20_000 });
    expect(result.current.isSuccess, "chyba se nesmí tvářit jako úspěch").toBe(false);
    expect(hoisted.rpcMock.mock.calls.length, "RQ musí pokus zopakovat").toBeGreaterThan(1);
  }, 30_000);
});
