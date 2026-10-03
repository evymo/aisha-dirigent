/**
 * Appka v kiosku smí záviset na systémové appce jen tehdy, když ji hlídač
 * POVOLÍ a PUSTÍ do kiosku (lock task) — a kiosk smí jen to, co majitel rozhodl.
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA (2026-09-23, první tablet). Zavedení z QR
 * (`LEAVE_ALL_SYSTEM_APPS_ENABLED=false`) vypne systémové appky. Fotoaparát
 * hlídač znovu povoloval — prohlížeč NE. Řidič se tak nedokázal přihlásit:
 * přihlášení běželo v Custom Tab a appka hlásila „No matching browser activity
 * found". Nic nespadlo při buildu; vada byla vidět až na tabletu.
 *
 * ⭐ ROZHODNUTÍ MAJITELE (2026-09-28, měřeno na zkušebním tabletu SM-X115):
 *   · Řidič na Androidu se přihlašuje JEN jménem a heslem RIQ ID, ve VLOŽENÉM
 *     WebView — v kiosku žádný prohlížeč (do zámku se dřív dostal i průvodce
 *     nastavením Samsungu, protože ho vrátil resolveActivity(https));
 *   · bez Google Play — Play Protect každou tichou instalaci z Kiosk Admina
 *     podržel na ťuknutí a bez něj zamítl. Device owner ho vypnout nesmí, jen
 *     SKRÝT; po timeoutu ověřovatele pak platí výchozí POVOLIT — pokud nikdo
 *     nenastaví `ENSURE_VERIFY_APPS` (to by výchozí otočilo na ZAMÍTNOUT).
 *
 * Mapa „závislost appky → systémová schopnost" je psaná, ale vstup (co appka
 * opravdu instaluje) se čte z `mobile-app/package.json`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const KOREN = path.resolve(__dirname, "..", "..", "..");
const POLITIKA = path.join(KOREN, "apps/hlidac/app/src/main/java/platforma/hlidac/Politika.java");
const MANIFEST = path.join(KOREN, "apps/hlidac/app/src/main/AndroidManifest.xml");
const APPKA = path.join(KOREN, "mobile-app/package.json");
const LOGIN = path.join(KOREN, "mobile-app/src/app/(auth)/login.tsx");
const OIDC = path.join(KOREN, "mobile-app/src/config/oidc.ts");

/** Závislost appky → co musí hlídač udělat (povolit, najít, pustit do kiosku, vidět). */
const SCHOPNOSTI: Record<string, { povol: RegExp; najdi: RegExp; kiosk: RegExp; vidi: RegExp }> = {
  "expo-image-picker": {
    povol: /enableSystemApp\(a,\s*new Intent\(MediaStore\.ACTION_IMAGE_CAPTURE\)\)/,
    najdi: /String kamera = fotoaparat\(ctx\)/,
    kiosk: /smi\.add\(kamera\)/,
    vidi: /android\.media\.action\.IMAGE_CAPTURE/,
  },
};

export function chybi(politika: string, manifest: string, zavislosti: string[]): string[] {
  const out: string[] = [];
  for (const z of zavislosti) {
    const s = SCHOPNOSTI[z];
    if (!s) continue;
    if (!s.povol.test(politika)) out.push(`${z}: hlídač systémovou appku nepovolí`);
    if (!s.najdi.test(politika)) out.push(`${z}: hlídač ji nehledá`);
    if (!s.kiosk.test(politika)) out.push(`${z}: v kiosku se nesmí spustit`);
    if (!s.vidi.test(manifest)) out.push(`${z}: hlídač ji nevidí (<queries>)`);
  }
  return out;
}

/** Java bez komentářů — zákaz se měří na KÓDU, ne na vysvětlení, proč ho nepoužíváme. */
export function bezKomentaru(java: string): string {
  return java.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Co kiosk podle rozhodnutí majitele 2026-09-28 dělat NESMÍ / MUSÍ. */
export function porusuje(politika: string, login: string, oidc: string, zavislosti: string[]): string[] {
  const kod = bezKomentaru(politika);
  const out: string[] = [];
  const zaklad = kod.slice(kod.indexOf("static List<String> zaklad("), kod.indexOf("static void skryjObchod("));
  if (/ACTION_VIEW|KIOSK_BROWSER|zamerProhlizece|prohlizec/.test(kod)) out.push("hlídač povoluje nebo hledá prohlížeč");
  if ((zaklad.match(/smi\.add\(/g) ?? []).length !== 3) out.push("zámek kiosku pouští víc než hlídače, appku a fotoaparát");
  if (/enableSystemApp\(a,\s*OBCHOD\)/.test(zaklad)) out.push("hlídač zapíná Obchod Play");
  if (!/skryjObchod\(ctx,\s*dpm,\s*a,\s*zprava\)/.test(zaklad) || !/setApplicationHidden\(a,\s*OBCHOD,\s*true\)/.test(kod)) {
    out.push("hlídač Obchod Play neskrývá");
  }
  if (/ENSURE_VERIFY_APPS/.test(kod)) out.push("hlídač vynucuje ověřování aplikací (tichá instalace by umřela)");
  if (/DISALLOW_INSTALL_APPS/.test(kod)) out.push("hlídač zakazuje instalace (i tichou z device ownera)");
  if (!zavislosti.includes("react-native-webview")) out.push("appka nemá react-native-webview");
  if (!/JEN_RIQ_ID\s*=\s*Platform\.OS\s*===\s*"android"/.test(login) || !/<PrihlaseniWebView/.test(login)) {
    out.push("appka se na Androidu nepřihlašuje ve WebView");
  }
  if (!/Platform\.OS === "android"\)[\s\S]*?end_session_endpoint[\s\S]*?refresh_token/.test(oidc)) {
    out.push("appka se na Androidu odhlašuje přes prohlížeč");
  }
  return out;
}

describe("appka v kiosku má systémové appky od hlídače", () => {
  const zavislosti = Object.keys(JSON.parse(readFileSync(APPKA, "utf8")).dependencies ?? {});
  const politika = readFileSync(POLITIKA, "utf8");
  const manifest = readFileSync(MANIFEST, "utf8");

  it("měřidlo vidí závislosti appky — jinak by prošlo naprázdno", () => {
    expect(zavislosti).toContain("expo-image-picker");
    expect(zavislosti).toContain("react-native-webview");
  });

  it("každou systémovou schopnost, na které appka závisí, hlídač povolí a pustí do kiosku", () => {
    expect(chybi(politika, manifest, zavislosti)).toEqual([]);
  });

  it("negativní sonda: fotoaparát nepovolený zčervená", () => {
    const bez = politika.replace(/krok\(zprava, "fotoaparát povolen".*\n/, "");
    expect(bez).not.toBe(politika);
    expect(chybi(bez, manifest, ["expo-image-picker"])).toContain("expo-image-picker: hlídač systémovou appku nepovolí");
    expect(chybi(politika, "<manifest/>", ["expo-image-picker"])).toContain("expo-image-picker: hlídač ji nevidí (<queries>)");
  });
});

describe("⛔ kiosk bez prohlížeče a bez Google Play (rozhodnutí majitele 2026-09-28)", () => {
  const zavislosti = Object.keys(JSON.parse(readFileSync(APPKA, "utf8")).dependencies ?? {});
  const politika = readFileSync(POLITIKA, "utf8");
  const login = readFileSync(LOGIN, "utf8");
  const oidc = readFileSync(OIDC, "utf8");

  it("dnešní kód rozhodnutí drží", () => {
    expect(porusuje(politika, login, oidc, zavislosti)).toEqual([]);
  });

  it("zákaz se měří na kódu, ne v komentáři (komentář smí vysvětlovat, proč ENSURE_VERIFY_APPS ne)", () => {
    expect(politika).toMatch(/ENSURE_VERIFY_APPS/);
    expect(bezKomentaru(politika)).not.toMatch(/ENSURE_VERIFY_APPS/);
  });

  it.each([
    ["prohlížeč v zámku", (p: string) => p.replace("if (kamera != null) smi.add(kamera);", "if (kamera != null) smi.add(kamera);\n        smi.add(\"com.android.chrome\");"), "zámek kiosku pouští víc než hlídače, appku a fotoaparát"],
    ["povolení prohlížeče záměrem", (p: string) => p.replace("skryjObchod(ctx, dpm, a, zprava);", "skryjObchod(ctx, dpm, a, zprava);\n        dpm.enableSystemApp(a, new Intent(Intent.ACTION_VIEW));"), "hlídač povoluje nebo hledá prohlížeč"],
    ["zapnutí Obchodu Play", (p: string) => p.replace("skryjObchod(ctx, dpm, a, zprava);", "skryjObchod(ctx, dpm, a, zprava);\n        dpm.enableSystemApp(a, OBCHOD);"), "hlídač zapíná Obchod Play"],
    ["Obchod Play neskrytý", (p: string) => p.replace("skryjObchod(ctx, dpm, a, zprava);", ""), "hlídač Obchod Play neskrývá"],
    ["vynucené ověřování aplikací", (p: string) => p.replace("UserManager.DISALLOW_SAFE_BOOT,", "UserManager.DISALLOW_SAFE_BOOT,\n        UserManager.ENSURE_VERIFY_APPS,"), "hlídač vynucuje ověřování aplikací (tichá instalace by umřela)"],
    ["zákaz instalací", (p: string) => p.replace("UserManager.DISALLOW_SAFE_BOOT,", "UserManager.DISALLOW_SAFE_BOOT,\n        UserManager.DISALLOW_INSTALL_APPS,"), "hlídač zakazuje instalace (i tichou z device ownera)"],
  ])("⛔ negativní sonda: %s zčervená", (_n, zmena, nalez) => {
    const zlomena = zmena(politika);
    expect(zlomena).not.toBe(politika);
    expect(porusuje(zlomena, login, oidc, zavislosti)).toContain(nalez);
  });

  it("⛔ negativní sonda: přihlášení a odhlášení na Androidu přes prohlížeč zčervená", () => {
    const loginPrusProhlizec = login.replace(/<PrihlaseniWebView/, "<ZadnyWebView");
    expect(porusuje(politika, loginPrusProhlizec, oidc, zavislosti)).toContain("appka se na Androidu nepřihlašuje ve WebView");
    const odhlaseniPrusProhlizec = oidc.replace(/else if \(Platform\.OS === "android"\)/, "else if (false)");
    expect(odhlaseniPrusProhlizec).not.toBe(oidc);
    expect(porusuje(politika, login, odhlaseniPrusProhlizec, zavislosti)).toContain("appka se na Androidu odhlašuje přes prohlížeč");
  });
});
