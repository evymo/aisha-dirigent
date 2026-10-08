/**
 * Přehled přihlášení: systém a zařízení ze skutečných User-Agentů.
 *
 * ⛔ Naměřeno 2026-10-01: Android vycházel jako „Linux“ (jeho UA nese i Linux)
 * a iPhone jako „macOS“ (nese „like Mac OS X“); iPad byl „Mobile“, ačkoli
 * přehled má pro tablety vlastní ikonu.
 */
import { describe, expect, it } from "vitest";
import { parseUserAgent } from "@/lib/monitoring/rozborUserAgentu";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  androidTelefon: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
};

describe("parseUserAgent — přehled přihlášení", () => {
  it("telefon dostane svůj systém, ne obecnější, který UA zmiňuje taky", () => {
    expect(parseUserAgent(UA.iphone)).toEqual({ device: "Mobile", browser: "Safari", os: "iOS" });
    expect(parseUserAgent(UA.androidTelefon)).toEqual({ device: "Mobile", browser: "Chrome", os: "Android" });
  });

  it("iPad a Android bez „Mobile“ jsou tablety", () => {
    expect(parseUserAgent(UA.ipad)).toEqual({ device: "Tablet", browser: "Safari", os: "iOS" });
    expect(parseUserAgent(UA.androidTablet)).toEqual({ device: "Tablet", browser: "Chrome", os: "Android" });
  });

  it("počítače zůstávají, jak byly", () => {
    expect(parseUserAgent(UA.windows)).toEqual({ device: "Desktop", browser: "Chrome", os: "Windows" });
    expect(parseUserAgent(UA.macSafari)).toEqual({ device: "Desktop", browser: "Safari", os: "macOS" });
    expect(parseUserAgent(UA.linuxFirefox)).toEqual({ device: "Desktop", browser: "Firefox", os: "Linux" });
  });

  it("chybějící UA → Unknown", () => {
    expect(parseUserAgent(null)).toEqual({ device: "Unknown", browser: "Unknown", os: "Unknown" });
  });
});
