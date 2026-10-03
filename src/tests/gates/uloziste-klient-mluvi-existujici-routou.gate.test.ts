/**
 * Brána: KAŽDÉ volání úložiště z klienta musí mít ve `storage-auth` routu.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-09-21 na živé instanci).
 *
 * `src/integrations/api/storage.ts` je „drop-in za hostované storage SDK" — a tři
 * z jeho čtyř metod mluvily kontraktem TOHO SDK, ne našeho `storage-auth`:
 *   • `upload()`   → `POST /storage/v1/object/{bucket}/{path}` s tělem souboru → **404**
 *   • `remove()`   → `DELETE /storage/v1/object/{bucket}` s `{prefixes:[…]}`   → **404**
 *   • `createSignedUrl()` → `POST /object/sign/…`, zatímco routa je `GET`
 * Fungoval jen `getPublicUrl()`, který nic nevolá (skládá řetězec).
 *
 * Důsledek nebyl teoretický: nahrávání obrázků do editoru stránek bylo mrtvé od
 * začátku a NIKDO si toho nevšiml — obsah webu se udržoval ručně v SQL a obrázky
 * se hotlinkovaly z cizího WordPressu (naměřeno v živé DB 2026-09-21: 256 výskytů
 * `<img src>` na cizím webu jedné instance, z toho 185 unikátních obrázků, + 51 titulních).
 * Test s `vi.fn()` místo `fetch` by byl zelený: mock odpoví na jakoukoli cestu.
 *
 * ⚠️ JEDINÝ SOUDCE JE REPO, NE MOCK. Tahle brána porovnává cesty a metody, které
 * klient SKLÁDÁ, s cestami a metodami, které server REGISTRUJE. Obojí čte ze
 * zdroje, bez sítě a bez databáze — takže rozejití kontraktu je vidět v repu,
 * ne až na živé instanci.
 *
 * ⚠️ Kdyby se změnil ZPŮSOB, jak klient volání skládá (dnes: URL do proměnné
 * a hned pod ní `fetch` s `method:`), brána NESMÍ zezelenat mlčením — když
 * u nalezené URL nenajde metodu, padá s vysvětlením. „Nenašel jsem" tu není
 * „je to v pořádku".
 *
 * Run: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const KLIENT = "src/integrations/api/storage.ts";
const ROUTY_DIR = "services/storage-auth/src/routes";
const SERVER = "services/storage-auth/src/server.ts";

const cti = (p: string): string => readFileSync(join(ROOT, p), "utf8");

/**
 * Kód bez komentářů. ⛔ Naměřeno na téhle bráně samotné (2026-09-21): první
 * verze hlásila „proxy přesměrovává", protože v souboru našla `reply.redirect`
 * — ve VYSVĚTLUJÍCÍM komentáři, který popisuje, že se tam přesměrování být nesmí.
 * Próza měnila verdikt. Brána proto čte kód, ne text o kódu.
 */
const bezKomentaru = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Cesta rozdělená na segmenty; `${…}` a `:param` a `*` jsou zástupné. */
interface Cesta {
  segmenty: string[];
  /** Poslední segment je `*` = pohltí zbytek cesty (fastify wildcard). */
  zbytek: boolean;
}

function rozlozCestu(cesta: string, zastupne: RegExp): Cesta {
  const cista = cesta.replace(/^\/+|\/+$/g, "");
  const segmenty = cista.length === 0 ? [] : cista.split("/").map((s) => (zastupne.test(s) ? "*" : s));
  const zbytek = segmenty.length > 0 && segmenty[segmenty.length - 1] === "*" && /\*$/.test(cista);
  return { segmenty, zbytek };
}

/**
 * Volání klienta: každý výskyt `${gatewayUrl}/storage/v1/…` a metoda z nejbližšího
 * následujícího `method: '…'`. Okno je krátké schválně — kdyby URL a fetch od sebe
 * někdo oddělil, brána spadne a někdo se na to podívá.
 */
function volaniKlienta(): Array<{ metoda: string; cesta: Cesta; radek: number }> {
  const src = bezKomentaru(cti(KLIENT));
  const out: Array<{ metoda: string; cesta: Cesta; radek: number }> = [];
  for (const m of src.matchAll(/\$\{gatewayUrl\}\/storage\/v1\/([^`]*)`/g)) {
    const surova = m[1];
    const odsud = (m.index ?? 0) + m[0].length;
    // Okno končí u DALŠÍ adresy brány — jinak by se `fetch` z následující metody
    // připsal adrese, která se jen skládá (`getPublicUrl`). Naměřeno na kanárkovi
    // téhle brány: bez tohohle řezu dostala skládaná adresa metodu POST od
    // volání o 40 řádků níž.
    const dalsi = src.indexOf("${gatewayUrl}", odsud);
    const konec = dalsi === -1 ? odsud + 900 : Math.min(dalsi, odsud + 900);
    const okno = src.slice(odsud, konec);
    const radek = src.slice(0, m.index ?? 0).split("\n").length;
    // `getPublicUrl()` adresu jen SKLÁDÁ a vrací — nic nevolá. Volání poznáme
    // podle `fetch(` a MUSÍME počítat s oběma podobami, které v souboru jsou:
    // adresa do proměnné a `fetch(url, …)` pod ní, NEBO adresa přímo v argumentu
    // `fetch(\`…\`, …)`. První verze brány znala jen tu první a volání preflightu
    // proto neviděla — a to je právě to volání, o kterém je celá tahle brána.
    const pred = src.slice(Math.max(0, (m.index ?? 0) - 120), m.index ?? 0);
    if (!/\bfetch\s*\(\s*`?$/.test(pred) && !/\bfetch\s*\(/.test(okno)) continue;
    const metoda = /method:\s*['"]([A-Z]+)['"]/.exec(okno)?.[1];
    expect(
      metoda,
      `${KLIENT}:${radek} — u volání /storage/v1/${surova} následuje fetch, ale v 900 znacích ` +
        `není žádné \`method:\`. Vzor, který tahle brána čte, se změnil; oprav bránu, ` +
        `nebo volání skládej jako dosud. Mlčky zelená tu není na výběr.`,
    ).toBeTruthy();
    // Dotaz (?x=…) není součástí routy.
    const bezDotazu = surova.split("?")[0];
    out.push({ metoda: metoda!, cesta: rozlozCestu(bezDotazu, /\$\{/), radek });
  }
  return out;
}

/**
 * Úplnost: KAŽDÝ `fetch` v klientovi musí být buď volání brány (a to porovnáme
 * s routami), nebo PUT na podepsanou adresu z preflightu. Bez tohohle součtu by
 * brána mohla zezelenat tím, že nové volání prostě nenajde.
 */
function pocetFetchu(): { celkem: number; naPodepsanou: number } {
  const src = bezKomentaru(cti(KLIENT));
  return {
    celkem: [...src.matchAll(/\bfetch\s*\(/g)].length,
    naPodepsanou: [...src.matchAll(/\bfetch\s*\(\s*uploadUrl\b/g)].length,
  };
}

/** Routy serveru: `app.get('/cesta'`, `app.post<{…}>('/cesta'`, `app.delete('/cesta'`. */
function routyServeru(): Array<{ metoda: string; cesta: Cesta; zdroj: string }> {
  const soubory = readdirSync(join(ROOT, ROUTY_DIR))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `${ROUTY_DIR}/${f}`);
  soubory.push(SERVER);

  const out: Array<{ metoda: string; cesta: Cesta; zdroj: string }> = [];
  for (const soubor of soubory) {
    if (!existsSync(join(ROOT, soubor))) continue;
    const src = cti(soubor);
    for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]/g)) {
      out.push({ metoda: m[1].toUpperCase(), cesta: rozlozCestu(m[2], /^[:*]/), zdroj: soubor });
    }
  }
  return out;
}

/**
 * Sedí klientská cesta na routu? Zástupný segment klienta smí sednout JEN na
 * zástupný segment routy — `${bucket}` není doklad, že tam bude „public".
 */
function sedi(klient: Cesta, routa: Cesta): boolean {
  const k = klient.segmenty;
  const r = routa.segmenty;
  if (routa.zbytek) {
    if (k.length < r.length) return false;
  } else if (k.length !== r.length) {
    return false;
  }
  for (let i = 0; i < r.length; i++) {
    const rs = r[i];
    const ks = k[i];
    if (routa.zbytek && i === r.length - 1) return true; // pohltí zbytek
    if (rs === "*") continue; // parametr routy vezme cokoli
    if (ks === "*") return false; // klient posílá proměnnou tam, kde routa chce konstantu
    if (ks !== rs) return false;
  }
  return true;
}

describe("klient úložiště mluví jen routami, které existují", () => {
  it("každé volání /storage/v1/* má ve storage-auth routu se stejnou metodou", () => {
    const volani = volaniKlienta();
    const routy = routyServeru();

    expect(volani.length, `${KLIENT}: nenašel jsem ŽÁDNÉ volání — brána by pak měřila prázdno`)
      .toBeGreaterThan(2);
    expect(routy.length, `${ROUTY_DIR}: nenašel jsem žádnou routu`).toBeGreaterThan(2);

    const chybi = volani.filter(
      (v) => !routy.some((r) => r.metoda === v.metoda && sedi(v.cesta, r.cesta)),
    );

    expect(
      chybi.map((v) => `${v.metoda} /storage/v1/${v.cesta.segmenty.join("/")} (${KLIENT}:${v.radek})`),
      "klient volá cestu, kterou storage-auth neregistruje — na živé instanci to je 404/405, " +
        "v testu s mockem zelená. Přidej routu, nebo volej existující.",
    ).toEqual([]);

    const fetche = pocetFetchu();
    expect(
      fetche.celkem,
      `v ${KLIENT} je ${fetche.celkem} fetchů, ale brána jich přiřadila ` +
        `${volani.length} k bráně + ${fetche.naPodepsanou} na podepsanou adresu. ` +
        "Nějaké volání brána nevidí — to nesmí projít mlčením.",
    ).toBe(volani.length + fetche.naPodepsanou);
  });

  it("nahrávání jde přes preflight a podepsané PUT, ne jedním POSTem s tělem souboru", () => {
    const src = cti(KLIENT);
    expect(src).toMatch(/\/storage\/v1\/upload-preflight/);
    expect(src).toMatch(/method:\s*'PUT'/);
    // Klíč objektu razí server; klient si ho nesmí vymýšlet.
    expect(src).toMatch(/objectKey/);
  });

  it("veřejná proxy obsah STREAMUJE — nepřesměrovává na vnitřní adresu", () => {
    const proxy = cti(`${ROUTY_DIR}/public-proxy.ts`);
    const kod = bezKomentaru(proxy);
    const verejnyBlok = kod.slice(0, kod.indexOf("/object/sign"));
    expect(
      /reply\.redirect/.test(verejnyBlok),
      "GET /object/public/* nesmí přesměrovat na getPublicUrl() — ta míří na imgproxy/minio, " +
        "což jsou VNITŘNÍ adresy bez veřejné routy (naměřeno: 302 na *.mesh.*.internal:8080).",
    ).toBe(false);
    expect(verejnyBlok).toMatch(/getObjectStream/);
  });

  it("do veřejného bucketu smí nahrávat a mazat jen admin/staff", () => {
    for (const soubor of ["upload-preflight.ts", "object-delete.ts"]) {
      const src = cti(`${ROUTY_DIR}/${soubor}`);
      expect(src, `${soubor}: chybí role-check`).toMatch(/isAdminOrStaff\(/);
      expect(src, `${soubor}: role-check musí odmítnout 403`).toMatch(/403/);
    }
  });

  it("klientský seznam typů je podmnožinou serverového allowlistu", () => {
    const hook = cti("src/hooks/usePageAssetUpload.ts");
    const config = cti("services/storage-auth/src/config.ts");

    const klientske = [...hook.matchAll(/"(image\/[a-z0-9.+-]+)"/g)].map((m) => m[1]);
    const blok = /allowedMimeTypes:\s*new Set\(\[([^\]]*)\]/.exec(config)?.[1] ?? "";
    const serverove = new Set([...blok.matchAll(/'([a-z0-9./+-]+)'/g)].map((m) => m[1]));

    expect(klientske.length, "v hooku jsem nenašel žádný MIME typ — brána by měřila prázdno")
      .toBeGreaterThan(2);
    expect(
      klientske.filter((t) => !serverove.has(t)),
      "klient nabízí typ, který preflight odmítne 415: uživatel vybere soubor a dozví se " +
        "„nahrání selhalo" + " bez důvodu. Buď typ nabízet přestaň, nebo ho povol i na serveru.",
    ).toEqual([]);
  });
});
