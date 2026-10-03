/**
 * Brána: cache zelených stromů v pre-push přeskočí sadu JEN při úplné shodě vstupu.
 *
 * Přeskočení sady je opakování měření nad týmž vstupem — poctivé jen tehdy, když
 * klíč zachytí VŠECHNO, co mění výsledek (strom, node, nainstalované závislosti,
 * sestavená dist, .env* soubory, proměnné sady, schopnosti prostředí). Brána proto
 * měří vlastnost MUTACÍ: každý díl klíče zvlášť změněný = MISS; HIT jen při shodě
 * všeho. A hlídá, že se nezapíše nic jiného než celá zelená sada.
 */
import { describe, expect, test } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DENIK, PROMENNE_SADY, TTL_MS, VYCHOZI_PG_PORT, postgrestUrl,
  REZIM_CELA_SADA, klic, najdi, souhrnDeniku, ulozStart, uklid, zapis, zapisDenik, zapisKonec,
} from "../../../scripts/lib/ci-zelene.mjs";

const ROOT = process.cwd();
const TED = Date.parse("2026-09-25T15:00:00Z");

const zaklad = () => ({
  strom: "a".repeat(40),
  spinavy: false,
  node: "v22.23.1 arm64",
  deps: "d".repeat(64),
  dist: "e".repeat(64),
  envSoubory: [[".env", "—"], [".env.coolify", "—"]],
  promenne: PROMENNE_SADY.map((k) => [k, k === "AISHA_SMOKE_SKIP_WARMUP" ? "1" : null]),
  schopnosti: { postgrest: false, postgres: false, mlx: false },
});
type Vstup = ReturnType<typeof zaklad>;
type Promenna = Vstup["promenne"][number];
const uloziste = () => mkdtempSync(join(tmpdir(), "ci-zelene-"));
const nastav = (v: Vstup, jmeno: string, hodnota: string | null): Vstup => ({
  ...v,
  promenne: v.promenne.map(([k, x]: Promenna) => [k, k === jmeno ? hodnota : x]),
});

describe("klíč: HIT jen při shodě VŠEHO", () => {
  test("kontrolní vzorek — tentýž vstup = HIT", () => {
    const d = uloziste();
    zapis(d, klic(zaklad()), { ted: TED });
    expect(najdi(d, klic(zaklad()), { ted: TED + 1000 }).hit).toBe(true);
  });

  test.each<[string, (v: Vstup) => Vstup]>([
    ["jiný strom", (v) => ({ ...v, strom: "b".repeat(40) })],
    ["jiná verze node", (v) => ({ ...v, node: "v22.24.0 arm64" })],
    ["jiná architektura", (v) => ({ ...v, node: "v22.23.1 x64" })],
    ["jiný otisk nainstalovaných závislostí", (v) => ({ ...v, deps: "f".repeat(64) })],
    ["jiný otisk sestavených dist", (v) => ({ ...v, dist: "0".repeat(64) })],
    ["jiný .env soubor", (v) => ({ ...v, envSoubory: [[".env", "x"], [".env.coolify", "—"]] })],
    ["proměnná sady nastavená", (v) => nastav(v, "AISHA_SKIP_ONLINE", "1")],
    ["proměnná sady chybí", (v) => nastav(v, "AISHA_SMOKE_SKIP_WARMUP", null)],
    ["jiná schopnost prostředí (DB běží)", (v) => ({ ...v, schopnosti: { ...v.schopnosti, postgres: true } })],
  ])("%s → MISS", (_popis, mutace) => {
    const d = uloziste();
    zapis(d, klic(zaklad()), { ted: TED });
    const r = najdi(d, klic(mutace(zaklad())), { ted: TED + 1000 });
    expect(r.hit).toBe(false);
  });

  test("špinavý pracovní strom nemá klíč — nepoužije se ani nezapíše", () => {
    const d = uloziste();
    const k = klic({ ...zaklad(), spinavy: true });
    expect(k).toBeNull();
    expect(zapis(d, k, { ted: TED })).toBe(false);
    expect(najdi(d, k).hit).toBe(false);
    expect(readdirSync(d)).toEqual([]);
  });

  test("záznam starší než TTL → MISS", () => {
    const d = uloziste();
    zapis(d, klic(zaklad()), { ted: TED });
    expect(najdi(d, klic(zaklad()), { ted: TED + TTL_MS + 1 }).hit).toBe(false);
    expect(najdi(d, klic(zaklad()), { ted: TED + TTL_MS - 1 }).hit).toBe(true);
  });

  test("MISS u téhož stromu řekne, KTERÝ díl se liší", () => {
    const d = uloziste();
    zapis(d, klic(zaklad()), { ted: TED });
    const r = najdi(d, klic({ ...zaklad(), deps: "f".repeat(64) }), { ted: TED });
    expect(r.duvod).toMatch(/liší se: deps/);
  });
});

describe("zápis: jen celá zelená sada a jen beze změny vstupu během běhu", () => {
  test("bez startu běhu se nezapíše nic", () => {
    const d = uloziste();
    expect(zapisKonec(d, "123", klic(zaklad()), { ted: TED, rezim: REZIM_CELA_SADA }).zapsano).toBe(false);
    expect(readdirSync(d).filter((n) => !n.startsWith("beh-"))).toEqual([]);
  });

  test("vstup se během běhu změnil → nezapíše se", () => {
    const d = uloziste();
    ulozStart(d, "123", klic(zaklad()), TED);
    const r = zapisKonec(d, "123", klic({ ...zaklad(), dist: "1".repeat(64) }), { ted: TED + 60000, rezim: REZIM_CELA_SADA });
    expect(r.zapsano).toBe(false);
    expect(najdi(d, klic(zaklad()), { ted: TED + 60000 }).hit).toBe(false);
  });

  test("start = konec → zapíše se a příští běh je HIT", () => {
    const d = uloziste();
    ulozStart(d, "123", klic(zaklad()), TED);
    expect(zapisKonec(d, "123", klic(zaklad()), { ted: TED + 60000, rezim: REZIM_CELA_SADA }).zapsano).toBe(true);
    expect(najdi(d, klic(zaklad()), { ted: TED + 120000 }).hit).toBe(true);
  });

  // Pre-push podle cest (#1073) často pustí jen VÝBĚR. Zápis výběru by strom prohlásil
  // za zelený celou sadou → push téhož stromu s širším výběrem by dal HIT a přeskočil
  // části, které nikdy neběžely (revize guru k #1075). Zapisuje JEN celá sada.
  test("⛔ běžel jen výběr (rezim=vyber) → nezapíše se a příští push je MISS", () => {
    const d = uloziste();
    ulozStart(d, "123", klic(zaklad()), TED);
    const r = zapisKonec(d, "123", klic(zaklad()), { ted: TED + 60000, rezim: "vyber" });
    expect(r.zapsano).toBe(false);
    expect(r.duvod).toMatch(/neběžela celá sada/);
    expect(najdi(d, klic(zaklad()), { ted: TED + 120000 }).hit).toBe(false);
  });

  test.each([["chybí", undefined], ["prázdný", ""], ["cizí hodnota", "VSE"]])(
    "⛔ režim %s → nezapíše se (fail-closed)", (_popis, rezim) => {
      const d = uloziste();
      ulozStart(d, "123", klic(zaklad()), TED);
      expect(zapisKonec(d, "123", klic(zaklad()), { ted: TED + 60000, rezim }).zapsano).toBe(false);
      expect(najdi(d, klic(zaklad()), { ted: TED + 120000 }).hit).toBe(false);
    });

  test("úložiště vzniká s právy 0700", () => {
    const d = join(uloziste(), "nove");
    zapis(d, klic(zaklad()), { ted: TED });
    expect(statSync(d).mode & 0o777).toBe(0o700);
  });

  test("úklid maže jen záznamy starší než TTL", () => {
    const d = uloziste();
    zapis(d, klic(zaklad()), { ted: TED });
    writeFileSync(join(d, "stary.json"), "{}");
    const stare = (Date.now() - TTL_MS - 60000) / 1000;
    utimesSync(join(d, "stary.json"), stare, stare);
    expect(uklid(d)).toBe(1);
    expect(readdirSync(d).length).toBe(1);
  });
});

describe("deník: dopad cache jde změřit (ne hádat z úbytku ve frontě)", () => {
  test("zásah, míjení i zápis jdou do deníku a souhrn sečte ušetřené sekundy", () => {
    const d = uloziste();
    zapisDenik(d, { udalost: "cache-miss", strom: "a", duvod: "tento strom tu celou sadou ještě neprošel" }, { ted: TED });
    zapisDenik(d, { udalost: "cache-zapis", strom: "a" }, { ted: TED + 1 });
    zapisDenik(d, { udalost: "cache-hit", strom: "a", uspora_s: 2400 }, { ted: TED + 2 });
    zapisDenik(d, { udalost: "cache-hit", strom: "a", uspora_s: 1800 }, { ted: TED + 3 });
    const radky = readFileSync(join(d, DENIK), "utf8").trim().split("\n").map((r) => JSON.parse(r));
    expect(radky.map((r) => r.udalost)).toEqual(["cache-miss", "cache-zapis", "cache-hit", "cache-hit"]);
    expect(radky[0].cas).toBe(new Date(TED).toISOString());
    const s = souhrnDeniku(d);
    expect(s).toMatchObject({ hit: 2, usporaS: 4200, miss: 1, zapis: 1 });
  });

  test("úklid podle TTL deník NEMAŽE — je to měření, ne cache", () => {
    const d = uloziste();
    zapisDenik(d, { udalost: "cache-hit", strom: "a", uspora_s: 60 }, { ted: TED });
    const stare = (Date.now() - TTL_MS - 60000) / 1000;
    utimesSync(join(d, DENIK), stare, stare);
    expect(uklid(d)).toBe(0);
    expect(readdirSync(d)).toContain(DENIK);
  });
});

describe("hook: cache obaluje CELOU sadu", () => {
  const hook = readFileSync(join(ROOT, ".husky/pre-push"), "utf8");
  const bezKomentaru = hook.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

  test("--over je PŘED první částí sady a --zapis až ZA poslední", () => {
    const over = bezKomentaru.indexOf("ci-zelene.mjs --over");
    const zapisI = bezKomentaru.indexOf("ci-zelene.mjs --zapis");
    expect(over).toBeGreaterThan(-1);
    expect(over).toBeLessThan(bezKomentaru.indexOf("npm run test:stack:ci"));
    expect(zapisI).toBeGreaterThan(bezKomentaru.indexOf("npm run build"));
    expect(zapisI).toBeLessThan(bezKomentaru.indexOf("OK Pre-push: vse OK"));
  });

  test("--zapis předává režim výběru a ten je v hooku PŘIŘAZENÝ (jinak by šel prázdný)", () => {
    const radek = bezKomentaru.split("\n").find((r) => r.includes("ci-zelene.mjs --zapis")) ?? "";
    expect(radek).toMatch(/--rezim "\$REZIM"/);
    expect(radek, "výchozí hodnota by při přejmenování proměnné zapisovala výběr jako celou sadu").not.toMatch(/\$\{REZIM:-/);
    const prirazeni = bezKomentaru.search(/^REZIM=/m);
    expect(prirazeni, "REZIM se v hooku nepřiřazuje").toBeGreaterThan(-1);
    expect(prirazeni).toBeLessThan(bezKomentaru.indexOf("ci-zelene.mjs --zapis"));
  });

  test("při REZIM != vyber hook nastaví VŠECHNY příznaky výběru na plný běh (jinak by „vse“ v záznamu lhalo)", () => {
    // příznaky = klíče, které hook bere jen jako true|false (`app|services_change|…)`),
    // přeložené na proměnné, do kterých je plní (`app) APP=$hodnota`)
    const klice = [...bezKomentaru.matchAll(/^\s*([a-z0-9_]+(?:\|[a-z0-9_]+)+)\)\s*$/gm)]
      .map((m) => m[1].split("|"))
      .find((k) => k.some((x) => x !== "true" && x !== "false")) ?? [];
    const priznaky = klice.map((k) => bezKomentaru.match(new RegExp(`\\b${k}\\)\\s+([A-Z0-9_]+)=\\$hodnota`))?.[1] ?? `?${k}`);
    expect(priznaky.length, "v hooku se nenašly příznaky výběru — test by nic neměřil").toBeGreaterThan(3);
    const zacatek = bezKomentaru.indexOf('if [ "$REZIM" != "vyber" ]; then');
    expect(zacatek).toBeGreaterThan(-1);
    const vetev = bezKomentaru.slice(zacatek, bezKomentaru.indexOf("\nelse", zacatek));
    const chybi = priznaky.filter((v) => !new RegExp(`\\b${v}=${v === "DOCS_ONLY" ? "false" : "true"}\\b`).test(vetev));
    expect(chybi, "tyhle příznaky ve větvi celé sady nejsou nastavené na plný běh").toEqual([]);
  });

  test("NEZMĚŘENO a červená sada končí DŘÍV, než se k zápisu dojde", () => {
    const zapisI = bezKomentaru.indexOf("ci-zelene.mjs --zapis");
    const exity = [...bezKomentaru.matchAll(/exit (1|75)\b/g)].map((m) => m.index ?? 0);
    expect(exity.length).toBeGreaterThan(3);
    expect(exity.every((i) => i < zapisI)).toBe(true);
  });
});

describe("úplnost klíče proti kódu (ne ručně)", () => {
  test("každý přepínač přeskočení, který čte testovací infrastruktura, je v PROMENNE_SADY", () => {
    const soubory = [
      ...readdirSync(join(ROOT, "scripts/test")).filter((f) => f.endsWith(".mjs")).map((f) => `scripts/test/${f}`),
      "src/tests/db/test-env-probe.ts",
      ".husky/pre-push",
    ];
    const ctene = new Set<string>();
    for (const f of soubory) {
      for (const m of readFileSync(join(ROOT, f), "utf8").matchAll(/\b(AISHA_[A-Z_]*SKIP[A-Z_]*)\b/g)) ctene.add(m[1]);
    }
    expect(ctene.size, "univerzum je prázdné — brána by nic neměřila").toBeGreaterThan(3);
    const chybi = [...ctene].filter((k) => !PROMENNE_SADY.includes(k));
    expect(chybi, "přepínač mění rozsah sady, ale klíč cache ho nezná → přidej do PROMENNE_SADY").toEqual([]);
  });

  test("výchozí adresy sond sedí se sondou testů (test-env-probe.ts)", () => {
    const sonda = readFileSync(join(ROOT, "src/tests/db/test-env-probe.ts"), "utf8");
    expect(sonda).toContain(`"${postgrestUrl({})}"`);
    // pořadí přednosti jako v sondě: AISHA_POSTGREST_URL > POSTGREST_URL > výchozí
    expect(sonda.indexOf("AISHA_POSTGREST_URL")).toBeLessThan(sonda.indexOf("process.env.POSTGREST_URL"));
    expect(postgrestUrl({ POSTGREST_URL: "http://b:2", AISHA_POSTGREST_URL: "http://a:1" })).toBe("http://a:1");
    expect(postgrestUrl({ POSTGREST_URL: "http://b:2" })).toBe("http://b:2");
    expect(sonda).toContain(`"${VYCHOZI_PG_PORT}"`);
  });
});
