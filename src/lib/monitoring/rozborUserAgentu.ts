/**
 * Zařízení, prohlížeč a systém z User-Agentu uloženého v auditu přihlášení.
 *
 * Telefon se pozná sdílenou funkcí `platformaNavstevnika` (lib/zarizeni) —
 * PŘED obecnými systémy, jinak by Android vyšel jako Linux a iPhone jako macOS.
 *
 * Tablet: iPad, výslovné „Tablet“, nebo Android BEZ „Mobile“ (tak se tablety
 * s Androidem v UA hlásí). iPad v režimu „počítač“ (iPadOS 13+) se z uloženého
 * UA od Macu rozeznat nedá — vyjde jako počítač s macOS, což je to, co UA tvrdí.
 */
import { platformaNavstevnika } from "@/lib/zarizeni/platforma";

export interface RozborUserAgentu {
  device: string;
  browser: string;
  os: string;
}

export function parseUserAgent(userAgent: string | null): RozborUserAgentu {
  if (!userAgent) return { device: "Unknown", browser: "Unknown", os: "Unknown" };

  const telefon = platformaNavstevnika({ userAgent });

  const device =
    /iPad|Tablet/i.test(userAgent) || (telefon === "android" && !/Mobile/i.test(userAgent))
      ? "Tablet"
      : telefon !== "jina" || /Mobile/i.test(userAgent)
        ? "Mobile"
        : "Desktop";

  let browser = "Unknown";
  if (/Chrome/i.test(userAgent) && !/Chromium|Edge/i.test(userAgent)) browser = "Chrome";
  else if (/Firefox/i.test(userAgent)) browser = "Firefox";
  else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) browser = "Safari";
  else if (/Edge/i.test(userAgent)) browser = "Edge";
  else if (/MSIE|Trident/i.test(userAgent)) browser = "IE";

  let os = "Unknown";
  if (telefon === "ios") os = "iOS";
  else if (telefon === "android") os = "Android";
  else if (/Windows/i.test(userAgent)) os = "Windows";
  else if (/Mac OS/i.test(userAgent)) os = "macOS";
  else if (/Linux/i.test(userAgent)) os = "Linux";

  return { device, browser, os };
}
