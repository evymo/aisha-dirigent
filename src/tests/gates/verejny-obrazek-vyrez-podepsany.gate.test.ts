/**
 * Brána: výřez veřejného obrázku jde přes PODEPSANÝ imgproxy s BÍLOU LISTINOU
 * parametrů — a obrázek v úložišti se nemění.
 *
 * ⛔ CO SE NAMĚŘILO (2026-09-24): titulní obrázky se zobrazovaly `object-cover`
 * bez jakéhokoli ohniska (karta 16:9 uřízla hlavu), veřejná proxy je jen
 * streamovala z MinIO a imgproxy ve stacku (KEY+SALT nastavené) nikdo nevolal —
 * `getPublicUrl` skládal `/insecure/…`, které imgproxy s klíčem odmítá.
 *
 * Oprava má tři půlky a každá sama o sobě je tichá:
 *   • parametry `w/h/fx/fy/z` čte JEN bílá listina (jinak by kdokoli spouštěl
 *     libovolné transformace na náš účet), cesta se PODEPISUJE (HMAC-SHA256);
 *   • bez klíče se nic nedosazuje — 501, ne raw stream (u HEIC by prohlížeč dostal
 *     soubor, který neumí otevřít);
 *   • klient parametry přidává JEN k naší veřejné cestě; cizí adresy (import)
 *     se nemění, jinak by je nikdo nečetl a rozbily by klíč cache.
 *
 * Run: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const cti = (p: string): string => readFileSync(join(ROOT, p), "utf8");
/**
 * Kód bez komentářů. Blokový komentář se pozná podle `/*` následovaného `*` nebo
 * bílým znakem — `'/object/public/:bucket/*'` (wildcard routy) komentář NENÍ, a kdo
 * ho za něj vezme, smaže tělo handleru i s tím, co brána měří (naměřeno na téhle
 * bráně 2026-09-24: první verze hlásila „proxy nevolá overParametry").
 */
const bezKomentaru = (src: string): string =>
  src.replace(/\/\*(?=[\s*])[\s\S]*?\*\//g, " ").replace(/(^|[^:'"])\/\/[^\n]*/g, "$1");

/** Blok jedné služby v compose: od `  jméno:` po další službu na téže úrovni. */
function blokSluzby(compose: string, jmeno: string): string {
  const od = compose.indexOf(`\n  ${jmeno}:`);
  if (od === -1) return "";
  const dalsi = /\n {2}[A-Za-z][\w-]*:[ \t]*\n/g;
  dalsi.lastIndex = od + 1;
  const m = dalsi.exec(compose);
  return compose.slice(od, m ? m.index : compose.length);
}

const PROXY = "services/storage-auth/src/routes/public-proxy.ts";
const PODPIS = "services/storage-auth/src/lib/imgproxy-podpis.ts";
const CONFIG = "services/storage-auth/src/config.ts";
const COMPOSE = "docker-compose.coolify-domain-services.yml";
const KLIENT = "src/lib/media/verejnaAdresaObrazku.ts";
const BLOKY = [
  "src/components/web/blocks/NewsBrowserBlock.tsx",
  "src/components/web/blocks/NewsListBlock.tsx",
  "src/pages/NewsArticleDetail.tsx",
];

describe("výřez veřejného obrázku: podepsaný imgproxy, bílá listina, cizí adresy nedotčené", () => {
  it("podpis je HMAC-SHA256 se solí a bílá listina má meze", () => {
    const src = bezKomentaru(cti(PODPIS));
    expect(src).toMatch(/createHmac\(\s*'sha256'/);
    expect(src, "sůl musí být součástí podepisovaného").toMatch(/hmac\.update\(Buffer\.from\(saltHex/);
    expect(src).toMatch(/export function overParametry/);
    expect(src, "rozměr bez horní meze = export místo doručení").toMatch(/MAX_ROZMER\s*=\s*\d+/);
    expect(src, "přiblížení musí mít meze").toMatch(/desetinne\('z',\s*1,\s*4/);
    expect(src, "ohnisko musí být v 0..1").toMatch(/desetinne\('fx',\s*0,\s*1/);
  });

  it("proxy transformuje jen přes bílou listinu, podepsaně, a bez klíče odpoví 501", () => {
    const src = bezKomentaru(cti(PROXY));
    expect(src).toMatch(/overParametry\(/);
    expect(src).toMatch(/podepsanaAdresa\(/);
    expect(src, "nepodepsaná cesta nesmí do proxy").not.toMatch(/\/insecure\//);
    expect(src, "bez klíče se nic nedosazuje").toMatch(/imgproxyKey[\s\S]{0,200}501/);
    expect(src, "klíč objektu se před vložením do cesty ověřuje").toMatch(/BEZPECNY_KLIC\.test\(key\)/);
    expect(src, "výstup závisí na Accept — cache to musí vědět").toMatch(/'Vary',\s*'Accept'/);
    expect(src, "HEIC jde přes převod vždy").toMatch(/vyzadujePrevod\(key\)/);
    // Raw stream zůstává pro objekty bez parametrů — nezměněná cesta z 2026-09-21.
    expect(src).toMatch(/getObjectStream\(bucket, key\)/);
  });

  it("klíč a sůl jdou do storage-auth z prostředí bez dosazení a compose je vyžaduje", () => {
    const cfg = bezKomentaru(cti(CONFIG));
    expect(cfg).toMatch(/imgproxyKey:\s*process\.env\.IMGPROXY_KEY\s*\?\?\s*''/);
    expect(cfg).toMatch(/imgproxySalt:\s*process\.env\.IMGPROXY_SALT\s*\?\?\s*''/);
    expect(cfg, "HEIC z telefonů musí projít preflightem").toMatch(/'image\/heic'/);
    const blok = blokSluzby(cti(COMPOSE), "storage-auth");
    expect(blok.length, "blok storage-auth v compose nenalezen").toBeGreaterThan(200);
    // Tajemství HOLÉ `${…}`: `:?` v `environment:` ho vtáhne do build-time množiny
    // (Coolify ho zapeče do docker history), `:-` ho tiše vyprázdní — viz compose-notes
    // u STORAGE_UPLOAD_TOKEN_SECRET. Chybějící hodnotu hlásí storage-auth 501, ne tichý raw stream.
    expect(blok, "storage-auth bez IMGPROXY_KEY neumí podepsat").toMatch(/IMGPROXY_KEY:\s*\$\{IMGPROXY_KEY\}/);
    expect(blok).toMatch(/IMGPROXY_SALT:\s*\$\{IMGPROXY_SALT\}/);
  });

  it("klient přidává parametry jen k naší veřejné cestě a bloky ho používají", () => {
    const src = bezKomentaru(cti(KLIENT));
    expect(src).toMatch(/VEREJNA_CESTA_ULOZISTE\s*=\s*"\/storage\/v1\/object\/public\/"/);
    expect(src, "cizí adresa se musí vrátit beze změny").toMatch(/if \(!jeNaseUloziste\(url\)\) return url;/);
    for (const blok of BLOKY) {
      expect(existsSync(join(ROOT, blok)), `${blok} chybí`).toBe(true);
      const b = bezKomentaru(cti(blok));
      expect(b, `${blok}: titulní obrázek jde bez výřezu`).toMatch(/vyrezObrazku\(/);
      expect(b, `${blok}: obrázek nesmí jít do src přímo`).not.toMatch(/src=\{article\.image_url\}/);
    }
  });
});
