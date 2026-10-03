/**
 * Brána: vnitřní adresa musí nést identitu instance.
 *
 * TŘÍDA VADY. Adresa, jejíž host je JMÉNO KONTEJNERU bez prefixu instance, je
 * na sdíleném hostiteli adresa BEZ VLASTNÍKA — patří tomu, kdo na dané síti
 * odpoví první. Nic při tom neselže: spojení se naváže, odpoví cizí služba
 * a projeví se to o vrstvy dál jako porucha, která s adresou nesouvisí.
 *
 * Naměřeno 2026-08-21: katalog vydával `http://mesh-router:3001` jako
 * `edge_mesh_upstream` jádra. Dnes ten alias nese jediný kontejner, takže se
 * „nic nedělo" — a přesně proto to bylo nebezpečné: vada bez příznaku.
 * Táž třída jako vnitřní jména propadající přes wildcard na cizí stroj
 * (viz `scripts/mesh-routing-doctor.mjs`), jenom tady by šlo o cizí ROUTER,
 * tedy o cizí mesh.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis):
 *   Pro KAŽDOU adresu v katalogu, jejíž host je jméno kontejneru (nemá tečku,
 *   tedy není doména), musí host nést `${APP_NAME_PREFIX}`.
 *
 * Univerzum se HLEDÁ — projdou se všechny řetězcové hodnoty katalogu, ne
 * vyjmenovaná pole. Kdyby se identita doplňovala výčtem, další pole by ji
 * beze slova postrádalo.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildTopology, formatShellExports } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = resolve(__dirname, "../../..");
const KATALOG = "config/services.json";

/** Host adresy, nebo null když to adresa není. */
function hostAdresy(hodnota: string): string | null {
  const m = /^https?:\/\/([^/?#]+)/.exec(hodnota);
  if (!m) return null;
  return m[1].replace(/:\d+$/, "");
}

/** Je to jméno kontejneru (a ne doména)? Domény mají tečku. */
function jeJmenoKontejneru(host: string): boolean {
  return !host.includes(".");
}

function vsechnyRetezce(uzel: unknown, cesta: string[] = []): Array<{ cesta: string; hodnota: string }> {
  if (typeof uzel === "string") return [{ cesta: cesta.join("."), hodnota: uzel }];
  if (Array.isArray(uzel)) return uzel.flatMap((v, i) => vsechnyRetezce(v, [...cesta, String(i)]));
  if (uzel && typeof uzel === "object") {
    return Object.entries(uzel).flatMap(([k, v]) => vsechnyRetezce(v, [...cesta, k]));
  }
  return [];
}

/**
 * Adresy, které derivace SKUTEČNĚ VYDÁ — pod umělou identitou instance.
 *
 * Katalog na služby jen ukazuje; jméno kontejneru se skládá až tady. Měřit
 * proto výstup je silnější než měřit zápis: chytí i adresu, kterou si derivace
 * složí sama (a která by v katalogu nebyla vidět).
 *
 * @returns dvojice {klic, host} pro hodnoty, jejichž host je jméno kontejneru
 */
function vydaneAdresy(): Array<{ klic: string; host: string }> {
  const puvodni = process.env.APP_NAME_PREFIX;
  // Identita se volí SMYŠLENÁ a nápadná: kdyby se prefix někde nedosadil,
  // ukáže se to jako jméno bez ní, ne jako jméno jiné živé instance.
  process.env.APP_NAME_PREFIX = "zkouska";
  try {
    const topo = buildTopology({ profileId: "cloud-multi", meshEnabled: true });
    const out = formatShellExports(topo) as string;
    const nalezene: Array<{ klic: string; host: string }> = [];
    for (const radek of out.split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(radek);
      if (!m) continue;
      const hodnota = m[2].replace(/^'([\s\S]*)'$/, "$1");
      // Jedna hodnota může nést víc adres (např. směrovací tabulky ingressu).
      for (const kus of hodnota.split(/[;,\s]+/)) {
        const host = hostAdresy(kus);
        if (host && jeJmenoKontejneru(host)) nalezene.push({ klic: m[1], host });
      }
    }
    return nalezene;
  } finally {
    if (puvodni === undefined) delete process.env.APP_NAME_PREFIX;
    else process.env.APP_NAME_PREFIX = puvodni;
  }
}

describe("vnitřní adresa nese identitu instance", () => {
  const katalog = JSON.parse(readFileSync(join(ROOT, KATALOG), "utf8"));
  const retezce = vsechnyRetezce(katalog);

  test("univerzum není prázdné — jinak brána neměří nic", () => {
    // Sonda musí umět odpovědět „ne": kdyby se katalog přejmenoval nebo změnil
    // tvar, seznam by osiřel a brána by tiše zezelenala nad nulou.
    //
    // ⛔ NAMĚŘENO 2026-08-21: katalog přestal nést JAKOUKOLI adresu (poslední
    // byl `edge_mesh_upstream`, nahrazený strukturovaným `public_face`), a
    // tenhle test na to spadl. Je to ŽÁDOUCÍ stav — katalog má UKAZOVAT, ne
    // opisovat — ale znamená, že katalog sám už není celé univerzum. Skutečné
    // adresy vznikají až v DERIVACI, takže se měří tam (test níže). Katalog
    // zůstává hlídaný pro případ, že by se do něj adresa vrátila.
    expect(retezce.length).toBeGreaterThan(0);
    expect(
      vydaneAdresy().length,
      "derivace nevydala ANI JEDNU adresu na jméno kontejneru — sonda přestala měřit",
    ).toBeGreaterThan(0);
  });

  test("měřidlo pozná adresu BEZ identity (fixtura, která umí říct ne)", () => {
    expect(hostAdresy("http://mesh-router:3001")).toBe("mesh-router");
    expect(jeJmenoKontejneru("mesh-router")).toBe(true);
    // doména se nehlídá — ta identitu nese jinak (TLD instance)
    expect(jeJmenoKontejneru("api.riqi.example.cz")).toBe(false);
    // a adresa s identitou projde
    const sIdentitou = hostAdresy("http://${APP_NAME_PREFIX}-mesh-router:3001");
    expect(sIdentitou).toContain("APP_NAME_PREFIX");
  });

  test("každá adresa na jméno kontejneru nese ${APP_NAME_PREFIX}", () => {
    const bezIdentity: string[] = [];
    for (const { cesta, hodnota } of retezce) {
      const host = hostAdresy(hodnota);
      if (!host || !jeJmenoKontejneru(host)) continue;
      if (host.includes("${APP_NAME_PREFIX")) continue;
      bezIdentity.push(`${cesta} = ${hodnota}`);
    }

    expect(
      bezIdentity,
      [
        "Tyhle adresy míří na jméno kontejneru BEZ identity instance:",
        ...bezIdentity.map((r) => `  - ${r}`),
        "",
        "Na sdíleném hostiteli je takové jméno adresa BEZ VLASTNÍKA: patří tomu,",
        "kdo na dané síti odpoví první. Nic neselže — jen se mluví s někým jiným.",
        "",
        "CO S TÍM: napiš adresu jako `http://${APP_NAME_PREFIX}-<služba>:<port>`.",
        "  Identitu dosazuje `dosadIdentitu()` v scripts/lib/derive-domains.mjs",
        "  a při jejím chybění vrátí null — konzument pak selže nahlas místo",
        "  aby poslal dál literál se šablonou.",
        "",
        "NEDĚLEJ: nedosazuj prefix natvrdo do katalogu. Katalog je instančně",
        "neutrální; jméno konkrétní instance v něm hlídá jiná brána a fork se",
        "do upstreamu vrací JEDNÍM merge, takže by se rozšířilo všude.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("KAŽDÁ adresa, kterou derivace vydá, nese identitu instance", () => {
    const bezIdentity = vydaneAdresy()
      .filter(({ host }) => !host.startsWith("zkouska-"))
      .map(({ klic, host }) => `${klic} → ${host}`);

    expect(
      [...new Set(bezIdentity)].sort(),
      [
        "Derivace vydala adresu na jméno kontejneru BEZ identity instance:",
        ...[...new Set(bezIdentity)].sort().map((r) => `  - ${r}`),
        "",
        "Na sdíleném hostiteli je holé jméno adresa BEZ VLASTNÍKA: patří tomu,",
        "kdo na dané síti odpoví první. Nic neselže — jen se mluví s někým jiným.",
        "",
        "CO S TÍM: adresu skládej z identity (`dosadIdentitu` / `containerNameFrom`",
        "  v scripts/lib/derive-domains.mjs), ne z literálu. Katalog na compose",
        "  službu UKAZUJE (`service:`), jméno se vyrábí až tady.",
      ].join("\n"),
    ).toEqual([]);
  });
});
