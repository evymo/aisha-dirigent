/**
 * Nabídka mobilní aplikace na webu — co návštěvník uvidí podle zařízení.
 *
 * Zadání (2026-10-01, naměřeno na instanci): iPhone → App Store, Android → Google Play,
 * počítač nebo nepoznané zařízení → oba. Bez vyplněné adresy se nekreslí nic,
 * adresa jiná než http(s) se do odkazu nepustí, zavření si prohlížeč pamatuje
 * a nedostupné úložiště banner neshodí.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPreklady = vi.fn((): Record<string, string> => ({}));

vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: () => mockPreklady(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { AppBannerBlock, KLIC_ZAVRENI } from "@/components/web/blocks/AppBannerBlock";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

const ODKAZY = { iosUrl: "https://apps.apple.com/app/id1", androidUrl: "https://play.google.com/store/apps/details?id=x" };

function zarizeni(userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  // jsdom `maxTouchPoints` vůbec nemá — spyOn by nebylo na čem zachytit
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => maxTouchPoints });
}

function obchody(): string[] {
  return screen.queryAllByRole("link").map((a) => a.getAttribute("data-obchod") ?? "");
}

describe("AppBannerBlock", () => {
  beforeEach(() => {
    mockPreklady.mockReturnValue({});
    window.localStorage.removeItem(KLIC_ZAVRENI);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("iPhone dostane jen App Store, Android jen Google Play", () => {
    zarizeni(UA.iphone, 5);
    const { unmount } = render(<AppBannerBlock config={ODKAZY} />);
    expect(obchody()).toEqual(["ios"]);
    expect(screen.getByRole("link")).toHaveAttribute("href", ODKAZY.iosUrl);
    unmount();

    zarizeni(UA.android, 5);
    render(<AppBannerBlock config={ODKAZY} />);
    expect(obchody()).toEqual(["android"]);
  });

  it("počítač dostane oba obchody", () => {
    zarizeni(UA.windows);
    render(<AppBannerBlock config={ODKAZY} />);
    expect(obchody()).toEqual(["ios", "android"]);
  });

  it("bez adres se nevykreslí nic; adresa mimo http(s) se nepočítá", () => {
    zarizeni(UA.windows);
    const { container, unmount } = render(<AppBannerBlock config={{}} />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    const { container: c2 } = render(<AppBannerBlock config={{ iosUrl: "javascript:alert(1)", androidUrl: " " }} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("texty bere z obsahu instance, jinak z výchozích textů platformy", () => {
    zarizeni(UA.windows);
    const { unmount } = render(<AppBannerBlock config={ODKAZY} />);
    expect(screen.getByText("appBanner.title")).toBeInTheDocument();
    unmount();

    mockPreklady.mockReturnValue({ "web.appBanner.title": "Get the Lotos app" });
    render(<AppBannerBlock config={ODKAZY} />);
    expect(screen.getByText("Get the Lotos app")).toBeInTheDocument();
  });

  it("zavření se zapamatuje; nezavíratelný banner tlačítko nemá", () => {
    zarizeni(UA.windows);
    const { unmount } = render(<AppBannerBlock config={ODKAZY} />);
    fireEvent.click(screen.getByRole("button", { name: "appBanner.close" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(window.localStorage.getItem(KLIC_ZAVRENI)).toBe("1");
    unmount();

    render(<AppBannerBlock config={ODKAZY} />);
    expect(screen.queryByRole("complementary")).toBeNull();

    window.localStorage.removeItem(KLIC_ZAVRENI);
    render(<AppBannerBlock config={{ ...ODKAZY, dismissible: false }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("nedostupné úložiště prohlížeče banner neshodí", () => {
    zarizeni(UA.windows);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<AppBannerBlock config={ODKAZY} />);
    fireEvent.click(screen.getByRole("button", { name: "appBanner.close" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
