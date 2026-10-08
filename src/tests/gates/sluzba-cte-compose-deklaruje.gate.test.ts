/**
 * Brána: proměnná, kterou služba čte ze svého prostředí, musí být v jejím bloku
 * v compose — jinak se do kontejneru NIKDY nedostane a kód za ní je tichý mrtvý kód.
 *
 * ⛔ PROČ (naměřeno 2026-09-29 na riq, kolo 11): gateway pouští ohlášení tabletu jen
 * za otevřenými dveřmi (`KNOCK_UPSTREAM`). Doktor klíč znal, edge i svc-knock ho měly —
 * blok `gateway` v docker-compose.coolify.yml ne. Compose je jediná cesta do kontejneru
 * (žádný env_file), gateway dostala '' a ohlášení vracelo VŽDY 403. Upstream gateway
 * tentýž klíč čte v `lib/najem-adresy.ts` — prodloužení nájmu adresy tam bylo tiše
 * vypnuté stejně. Testy služeb to nevidí: čtou prostředí testu, ne kontejneru.
 *
 * Třída je velká (změřeno na 9087ef3df: 325 čtených proměnných bez řádku v compose
 * ve 26 službách), proto ROHATKA po službách: dnešní dluh v baseline smí jen ubývat,
 * nová čtená proměnná bez řádku v compose = ČERVENÁ, co compose doplní nebo kód
 * přestane číst, musí zmizet i z baseline (oboustranně, vzor cislo-z-prostredi-ma-straz).
 * Služba, jejíž blok compose nenajde, je MĚŘIDLO bez dosahu — i ta má rohatku.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const baseline = JSON.parse(
  readFileSync(join(__dirname, "sluzba-cte-compose-deklaruje.baseline.json"), "utf8"),
) as { $comment: string; sluzby: Record<string, string[]>; bez_bloku: string[] };

/**
 * Produkční compose (Coolify) — lokální a e2e varianty se nepočítají. Čte se PARSEREM
 * YAML: bloky služeb domén přebírají proměnné kotvou (`<<: *svc-env`) a řádkové čtení
 * by je hlásilo jako chybějící (naměřeno: svc-push „bez“ POSTGREST_SERVICE_TOKEN,
 * přitom ho má z kotvy).
 */
type Sluzby = Record<string, { environment?: Record<string, unknown> | string[]; env_file?: unknown; build?: string | { dockerfile?: string }; entrypoint?: unknown; command?: unknown }>;

/**
 * Co blok z kódu služby SPOUŠTÍ (jeden obraz, víc rolí — vstup lane: VB, hlídač, one-shoty):
 *   - `false` = blok má vlastní entrypoint, který node nespouští (`chown`, shellový skript) — kód
 *     služby v kontejneru neběží, není co měřit;
 *   - `"<x>"` = příkaz nebo entrypoint jmenuje vstupní soubor `dist/<x>.js` — měří se čtení
 *     `src/<x>.ts` a jeho místních importů;
 *   - `null` = výchozí příkaz obrazu, měří se celá služba.
 */
export function coBlokSpousti(def: Sluzby[string] | undefined): string | false | null {
  const slova = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/\s+/) : []);
  const ep = slova(def?.entrypoint);
  const prikaz = [...ep, ...slova(def?.command)];
  const soubor = prikaz.map((x) => /^(?:\.\/)?dist\/([A-Za-z0-9_-]+)\.js$/.exec(x)?.[1]).find(Boolean);
  if (soubor) return soubor;
  if (ep.length > 0 && !ep.some((x) => /(^|\/)node$/.test(x))) return false;
  return null;
}
/**
 * Přepisový fragment (`docker-compose.coolify[-x].<fragment>.yml`, např. `.netseg`) se nasazuje
 * SPOLU se svým základním souborem — jeho bloky se do základu slučují (prostředí sjednoceně),
 * neměří se jako samostatný kontejner. Bloky se pak měří každý zvlášť (`chybiVBlocich`).
 */
export function slucFragmenty(soubory: [string, Sluzby][]): Sluzby[] {
  const zaklady = new Map<string, Sluzby>();
  const fragmenty: [string, Sluzby][] = [];
  for (const [f, sl] of soubory) {
    const m = /^(docker-compose\.coolify(?:-[a-z0-9-]+)?)\.[a-z0-9-]+\.yml$/.exec(f);
    if (m) fragmenty.push([`${m[1]}.yml`, sl]);
    else zaklady.set(f, structuredClone(sl));
  }
  for (const [zaklad, sl] of fragmenty) {
    const cil = zaklady.get(zaklad);
    if (!cil) throw new Error(`přepisový fragment bez základního souboru ${zaklad}`);
    for (const [jmeno, def] of Object.entries(sl)) {
      const puvodni = cil[jmeno];
      if (!puvodni) { cil[jmeno] = def; continue; }
      const env = (x: unknown) => (Array.isArray(x) ? Object.fromEntries(x.map((v) => [String(v).split("=")[0], ""])) : (x as Record<string, unknown>) ?? {});
      if (def?.environment !== undefined) puvodni.environment = { ...env(puvodni.environment), ...env(def.environment) };
      if (def?.env_file !== undefined) puvodni.env_file = def.env_file;
    }
  }
  return [...zaklady.values()];
}
const COMPOSE: Sluzby[] = slucFragmenty(
  readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f))
    .map((f): [string, Sluzby] => [f, ((yaml.load(readFileSync(join(ROOT, f), "utf8")) as { services?: Sluzby } | null)?.services ?? {})]),
);

function zdrojaky(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return ["node_modules", "dist", "__tests__"].includes(e) ? [] : zdrojaky(p);
    return /\.(ts|mts|js|mjs)$/.test(e) && !/\.(test|spec)\.(ts|mts|js|mjs)$/.test(e) ? [p] : [];
  });
}

/** Kód bez komentářů (`//` až za ne-dvojtečkou, aby `https://` v řetězci přežilo). */
export function bezKomentaru(zdroj: string): string {
  return zdroj.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Pomocníci, kteří čtou `process.env[<parametr>]` — jejich řetězcové argumenty jsou
 * čtené klíče (gateway: `envValue('A', 'B')`, `vyzadovanaAdresa('X')`). Hledá se
 * TŘÍDA, ne výčet jmen: nový pomocník se započítá sám.
 */
export function pomocnici(zdroj: string): string[] {
  const jmena = new Set<string>();
  const re = /(?:function\s+(\w+)\s*\(([^)]*)\)|const\s+(\w+)\s*=\s*\(([^)]*)\)\s*(?::[^=]*)?=>)/g;
  for (const m of zdroj.matchAll(re)) {
    const jmeno = m[1] ?? m[3];
    const params = (m[2] ?? m[4] ?? "").match(/\.{0,3}\b[a-zA-Z_]\w*/g)?.map((x) => x.replace(/^\.+/, "")) ?? [];
    const telo = zdroj.slice(m.index ?? 0, (m.index ?? 0) + 600);
    for (const par of params) {
      if (new RegExp(`process\\.env\\[\\s*${par}\\s*\\]`).test(telo)) jmena.add(jmeno!);
    }
  }
  return [...jmena];
}

/**
 * Klíče, které kód čte: process.env.X / process.env['X'], env.X / env['X'] (config
 * s parametrem `env = process.env`), req(env, 'X') a řetězcové argumenty pomocníků,
 * kteří čtou process.env[<parametr>] (viz `pomocnici`). Komentáře se nepočítají.
 */
export function ctene(surovy: string, pomocniciJmena: string[] = []): Set<string> {
  const zdroj = bezKomentaru(surovy);
  const k = new Set<string>();
  for (const re of [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /process\.env\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g,
    /\benv\.([A-Z][A-Z0-9_]+)\b/g,
    /\benv\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g,
    /\breq\(\s*env\s*,\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  ]) {
    for (const m of zdroj.matchAll(re)) k.add(m[1]);
  }
  for (const jmeno of ["envValue", ...pomocniciJmena]) {
    for (const volani of zdroj.matchAll(new RegExp(`\\b${jmeno}\\(([^)]*)\\)`, "g"))) {
      for (const x of volani[1].matchAll(/['"]([A-Z][A-Z0-9_]{2,})['"]/g)) k.add(x[1]);
    }
  }
  return k;
}

/** Klíče z `environment:` služby (mapa i seznam `KEY=…`, kotvy rozbalené); null = služba v souboru není. */
export function deklarovane(sluzby: Sluzby, sluzba: string): Set<string> | null {
  const def = sluzby[sluzba];
  if (!def) return null;
  const k = new Set<string>();
  const env = def.environment;
  if (Array.isArray(env)) for (const x of env) k.add(String(x).split("=")[0]);
  else if (env && typeof env === "object") for (const x of Object.keys(env)) k.add(x);
  if (def.env_file !== undefined) k.add("*"); // env_file = všechno z aplikace; měřidlo nemá co říct
  return k;
}

/**
 * Bloky, které službu STAVÍ z jejího Dockerfilu (`build.dockerfile: services/<s>/Dockerfile`).
 * Jméno bloku v compose je jméno ROLE, ne adresáře — tenký stack forku staví
 * svc-lane-klient jako `svc-model`. Co blok staví, je jediný domov té vazby; žádná mapa jmen.
 */
export function blokyStavejiciSluzbu(sluzby: Sluzby, sluzba: string): string[] {
  return Object.entries(sluzby)
    .filter(([, def]) => {
      const b = def?.build;
      const df = b && typeof b === "object" ? String(b.dockerfile ?? "").replace(/^\.\//, "") : "";
      return df === `services/${sluzba}/Dockerfile`;
    })
    .map(([jmeno]) => jmeno);
}

/**
 * Bloky služby: přesné jméno adresáře, jinak bez předpony `svc-` (pki-bridge, openclaw…),
 * a k tomu každý blok, který ji staví z jejího Dockerfilu. Každý blok se měří ZVLÁŠŤ —
 * kontejner dostane jen to, co deklaruje jeho vlastní blok, ne sjednocení všech.
 */
export function blokySluzby(sluzba: string, compose: Sluzby[] = COMPOSE): { blok: string; klice: Set<string>; spousti: string | false | null }[] | null {
  const nalezene: { blok: string; klice: Set<string>; spousti: string | false | null }[] = [];
  const jmena = [sluzba, sluzba.replace(/^svc-/, "")];
  for (const jmeno of jmena) {
    for (const c of compose) {
      const d = deklarovane(c, jmeno);
      if (d) nalezene.push({ blok: jmeno, klice: d, spousti: coBlokSpousti(c[jmeno]) });
    }
    if (nalezene.length > 0) break;
  }
  for (const c of compose) {
    for (const jmeno of blokyStavejiciSluzbu(c, sluzba)) {
      if (jmena.includes(jmeno)) continue; // blok téhož jména už je započtený výš
      const d = deklarovane(c, jmeno);
      if (d) nalezene.push({ blok: jmeno, klice: d, spousti: coBlokSpousti(c[jmeno]) });
    }
  }
  return nalezene.length > 0 ? nalezene : null;
}

/**
 * Klíče, které služba čte a některý její blok nedeklaruje (sjednocení chybějících přes bloky).
 * `ctePodle(vstup)` = čtení vstupního souboru a jeho místních importů (blok jmenuje `dist/<x>.js`);
 * blok, který kód služby nespouští (`spousti: false`), se neměří.
 */
export function chybiVBlocich(
  cte: Set<string>,
  bloky: { klice: Set<string>; spousti?: string | false | null }[],
  ctePodle: (vstup: string) => Set<string> | null = () => null,
): string[] {
  const ch = new Set<string>();
  // Zúžení po rolích JEN u obrazu s víc rolemi (bloky téže služby spouštějí různé věci). Služba
  // s jednou rolí se měří celá, ať příkaz jmenuje cokoli — jinak by měřidlo tiše oslepl na vše,
  // co vstupní soubor jen importuje.
  const vicRoli = new Set(bloky.map((b) => b.spousti ?? null)).size > 1;
  for (const { klice, spousti } of bloky) {
    if (klice.has("*") || (vicRoli && spousti === false)) continue;
    const mer = (vicRoli && typeof spousti === "string" && ctePodle(spousti)) || cte;
    for (const k of mer) if (!klice.has(k)) ch.add(k);
  }
  return [...ch].sort();
}

/** Čtení vstupního souboru `src/<vstup>.ts` a jeho místních importů (`./x.js` → `src/x.ts`); null = soubor není. */
function cteniVstupu(srcDir: string, vstup: string, pom: string[]): Set<string> | null {
  const najdi = (jm: string) => [".ts", ".mts", ".js", ".mjs"].map((p) => jm + p).find((f) => existsSync(f));
  const start = najdi(join(srcDir, vstup));
  if (!start) return null;
  const videne = new Set<string>();
  const cte = new Set<string>();
  const fronta = [start];
  while (fronta.length > 0) {
    const f = fronta.pop()!;
    if (videne.has(f)) continue;
    videne.add(f);
    const t = readFileSync(f, "utf8");
    for (const k of ctene(t, pom)) cte.add(k);
    // Každý relativní import (`./x.js`, `../lib/y.js`, `import('./z.js')`), cesta od importujícího souboru.
    for (const m of t.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[A-Za-z0-9_./-]+?)(?:\.js|\.ts|\.mjs|\.mts)?['"]/g)) {
      const dalsi = najdi(resolve(dirname(f), m[1]));
      if (dalsi) fronta.push(dalsi);
    }
  }
  return cte;
}

interface Mereni { chybi: Map<string, string[]>; kde: Map<string, string>; bezBloku: string[] }
function zmer(): Mereni {
  const chybi = new Map<string, string[]>();
  const kde = new Map<string, string>();
  const bezBloku: string[] = [];
  for (const s of readdirSync(join(ROOT, "services")).sort()) {
    const soubory = zdrojaky(join(ROOT, "services", s, "src"));
    if (soubory.length === 0) continue;
    const texty = soubory.map((f) => ({ f, t: readFileSync(f, "utf8") }));
    const pom = [...new Set(texty.flatMap((x) => pomocnici(bezKomentaru(x.t))))];
    const cte = new Set<string>();
    for (const { f, t } of texty) {
      for (const k of ctene(t, pom)) {
        cte.add(k);
        if (!kde.has(`${s}:${k}`)) kde.set(`${s}:${k}`, relative(ROOT, f));
      }
    }
    const bloky = blokySluzby(s);
    if (bloky === null) {
      bezBloku.push(s);
      continue;
    }
    const ch = chybiVBlocich(cte, bloky, (vstup) => cteniVstupu(join(ROOT, "services", s, "src"), vstup, pom));
    if (ch.length > 0) chybi.set(s, ch);
  }
  return { chybi, kde, bezBloku };
}
const m = zmer();

describe("služba čte z prostředí ⇒ její blok v compose to deklaruje (rohatka po službách)", () => {
  // Baseline vzniká TOUŽ logikou jako kontrola — žádný druhý generátor, který by se rozešel.
  // Jen výslovně: PREPSAT_BASELINE=1 (a diff baseline pak projde revizí jako každý dluh).
  it.runIf(process.env.PREPSAT_BASELINE === "1")("přepíše baseline podle dnešního měření", () => {
    const sluzby = Object.fromEntries([...m.chybi.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const celkem = [...m.chybi.values()].reduce((n, v) => n + v.length, 0);
    writeFileSync(join(__dirname, "sluzba-cte-compose-deklaruje.baseline.json"), JSON.stringify({
      $comment: baseline.$comment,
      $proc: `Naměřeno ${new Date().toISOString().slice(0, 10)}: ${celkem} proměnných v ${m.chybi.size} službách (měřidlo počítá i pomocníky čtoucí process.env[parametr], komentáře ne). Spouštěč: kolo forku 11 — gateway bez KNOCK_UPSTREAM (ohlášení tabletů vždy 403); klasifikace dluhu gatewaye je v popisu PR. Rozšířeno 2026-10-06: každý blok se měří zvlášť a blok, který službu staví z jejího Dockerfilu, je také její blok (domain-services-blockchain).`,
      sluzby,
      bez_bloku: m.bezBloku,
    }, null, 2) + "\n");
  });

  it("měřidlo měří (kontrolní vzorky)", () => {
    expect(ctene("process.env.AA_B; process.env['CC']; env.DD; env['EE']; envValue('FFF', 'FF2'); req(env, 'GG')"))
      .toEqual(new Set(["AA_B", "CC", "DD", "EE", "FFF", "FF2", "GG"]));
    // Komentář NENÍ čtení (falešný nález KC_ADMIN_TOKEN); URL v řetězci komentář není.
    expect(ctene("// process.env.JEN_KOMENTAR\n/* process.env.TAKY */ const u = 'https://x'; process.env.SKUTECNE"))
      .toEqual(new Set(["SKUTECNE"]));
    // Pomocník čtoucí process.env[parametr] se najde sám a jeho argumenty se počítají.
    const kod = "function vyzadovanaAdresa(klic: string) { const v = process.env[klic]; return v; }\nvyzadovanaAdresa('STRIPE_SERVICE_URL');";
    expect(pomocnici(kod)).toEqual(["vyzadovanaAdresa"]);
    expect(ctene(kod, pomocnici(kod))).toEqual(new Set(["STRIPE_SERVICE_URL"]));
    const r = (yaml.load(
      "x-env: &spolecne\n  Z: 1\nservices:\n  gw:\n    environment:\n      <<: *spolecne\n      A: x\n  lst:\n    environment:\n      - B=y\n",
    ) as { services: Sluzby }).services;
    expect(deklarovane(r, "gw"), "kotva se musí rozbalit").toEqual(new Set(["Z", "A"]));
    expect(deklarovane(r, "lst")).toEqual(new Set(["B"]));
    expect(deklarovane(r, "neni")).toBeNull();
    expect(m.chybi.size + m.bezBloku.length, "měřidlo nic nenašlo — slepé").toBeGreaterThan(0);
  });

  it("každý blok se měří ZVLÁŠŤ; fragment se slučuje do základu; blok podle Dockerfilu se počítá", () => {
    const A = new Set(["A", "B"]);
    // dva bloky téže služby: druhý B nedeklaruje → chybí (sjednocení by řeklo „vše deklarováno“)
    expect(chybiVBlocich(A, [{ klice: new Set(["A", "B"]) }, { klice: new Set(["A"]) }])).toEqual(["B"]);
    expect(chybiVBlocich(A, [{ klice: new Set(["*"]) }, { klice: new Set(["A", "B"]) }])).toEqual([]);
    // přepisový fragment (jen sítě) není samostatný kontejner — splyne se základem
    const spojene = slucFragmenty([
      ["docker-compose.coolify.yml", { x: { environment: { A: "1" } } }],
      ["docker-compose.coolify.netseg.yml", { x: { environment: undefined } }],
    ]);
    expect(spojene).toHaveLength(1);
    expect(deklarovane(spojene[0], "x")).toEqual(new Set(["A"]));
    expect(() => slucFragmenty([["docker-compose.coolify-z.netseg.yml", {}]])).toThrow(/bez základního souboru/);
    // blok jiného jména, který službu staví z jejího Dockerfilu, je její blok
    const tenky = { "svc-model": { build: { dockerfile: "services/svc-lane-klient/Dockerfile" }, environment: { X: "" } } };
    expect(blokySluzby("svc-lane-klient", [tenky])?.map((b) => b.blok)).toEqual(["svc-model"]);
  });

  it("jeden obraz, víc rolí: blok bez kódu služby se neměří, blok se vstupem `dist/<x>.js` jen proti <x> a jeho importům", () => {
    expect(coBlokSpousti({ entrypoint: ["chown", "-R", "1000:1000", "/vahy"] })).toBe(false);
    expect(coBlokSpousti({ entrypoint: ["/bin/sh", "-c", "printf x"] })).toBe(false);
    expect(coBlokSpousti({ command: ["node", "dist/hlidac-main.js"] })).toBe("hlidac-main");
    expect(coBlokSpousti({ entrypoint: ["node"], command: ["dist/server.js"] })).toBe("server");
    expect(coBlokSpousti({ environment: { A: "" } }), "výchozí příkaz obrazu = celá služba").toBe(null);
    const cte = new Set(["VB", "HL"]);
    const podle = (v: string) => (v === "server" ? new Set(["VB"]) : v === "hlidac-main" ? new Set(["HL"]) : null);
    expect(chybiVBlocich(cte, [
      { klice: new Set(), spousti: false },
      { klice: new Set(["VB"]), spousti: "server" },
      { klice: new Set(["HL"]), spousti: "hlidac-main" },
    ], podle), "každá role deklaruje svoje").toEqual([]);
    expect(chybiVBlocich(cte, [{ klice: new Set(), spousti: "hlidac-main" }, { klice: new Set(["VB"]), spousti: "server" }], podle), "mutace: hlídač bez své proměnné").toEqual(["HL"]);
    expect(chybiVBlocich(cte, [{ klice: new Set(["VB"]), spousti: "server" }], podle), "kotva: JEDNA role se měří celá (zúžení jen u víc rolí)").toEqual(["HL"]);
    expect(chybiVBlocich(cte, [{ klice: new Set(["VB"]), spousti: null }], podle), "kotva: výchozí příkaz měří celou službu").toEqual(["HL"]);
    const vstup = blokySluzby("svc-accel-vstup");
    expect(vstup?.map((b) => [b.blok, b.spousti]), "měřidlo: skutečné bloky vstupu lane").toEqual(
      expect.arrayContaining([["accel-prava", false], ["accel-deklarace", false], ["accel-vstup", "server"], ["accel-hlidac", "hlidac-main"]]),
    );
  });

  it("⛔ nová čtená proměnná bez řádku v compose nesmí PŘIBÝT", () => {
    const nove: string[] = [];
    for (const [s, klice] of m.chybi) {
      const dluh = new Set(baseline.sluzby[s] ?? []);
      for (const k of klice) if (!dluh.has(k)) nove.push(`${s}: ${k} (${m.kde.get(`${s}:${k}`)})`);
    }
    expect(nove, "přidej `KLIC: ${KLIC:?důvod}` nebo `${KLIC:-}` do bloku služby v docker-compose.coolify*.yml").toEqual([]);
  });

  it("⛔ rohatka je oboustranná: co už compose má (nebo kód nečte), musí zmizet z baseline", () => {
    const splaceno: string[] = [];
    for (const [s, dluh] of Object.entries(baseline.sluzby)) {
      const ted = new Set(m.chybi.get(s) ?? []);
      for (const k of dluh) if (!ted.has(k)) splaceno.push(`${s}: ${k}`);
    }
    expect(splaceno, "smaž je ze sluzba-cte-compose-deklaruje.baseline.json").toEqual([]);
  });

  it("⛔ služba bez nalezeného bloku v compose je měřidlo bez dosahu — nesmí přibýt a splacená musí z baseline", () => {
    expect(m.bezBloku.filter((s) => !baseline.bez_bloku.includes(s)), "nová služba bez bloku v compose").toEqual([]);
    expect(baseline.bez_bloku.filter((s) => !m.bezBloku.includes(s)), "blok už existuje — smaž ze bez_bloku").toEqual([]);
  });

  it("⛔ gateway: KNOCK_UPSTREAM dostane (dveře: prodloužení nájmu adresy i ohlášení zařízení)", () => {
    expect(m.chybi.get("gateway") ?? []).not.toContain("KNOCK_UPSTREAM");
  });
});
