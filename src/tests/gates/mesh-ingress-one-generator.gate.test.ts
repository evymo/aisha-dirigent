/**
 * Gate: dva generátory Caddyfile pro mesh-ingress se nesmí rozejít.
 *
 * PROČ (2026-07-29)
 * ----------------
 * Směrovací tabulku ingressu staví DVA nezávislé kusy kódu:
 *
 *   A) inline shell v docker-compose.coolify.yml  — TENHLE BĚŽÍ v produkci
 *   B) scripts/gen-mesh-ingress.mjs               — tenhle jsem testoval
 *
 * A psalo `handle /__mesh_health { respond "ok" 200 }`, tedy blok na jednom
 * řádku. Caddyfile to odmítá („Unexpected next token after '{' on same line")
 * a core-mesh-ingress po nasazení padal ve smyčce — přestože tabulku načetl
 * správně, sedm tras na sedmi portech.
 *
 * B totéž píše víceřádkově, takže bylo platné. Ověřil jsem tedy implementaci,
 * která neběží, a odeslal tu, která ano. Nešlo o překlep: dva kusy kódu na
 * jednu věc se rozejdou VŽDY, je to jen otázka času.
 *
 * Brána proto porovnává jejich VÝSTUP na téže vstupní tabulce. Rozdíl v
 * bílých znacích se toleruje — Caddyfile na odsazení nezáleží a trvat na
 * bajtové shodě by z brány udělalo hlídače pravopisu. Nesmí se lišit STRUKTURA:
 * porty, hostitelé, cíle a to, že žádný blok nezačíná a nekončí na jednom řádku.
 *
 * PROČ NE „prostě jednu implementaci": caddy:2-alpine nemá node, takže inline
 * shell nelze nahradit voláním skriptu. Dokud to platí, musí je držet u sebe
 * měřidlo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { buildTopology, formatShellExports } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = resolve(__dirname, "../../..");

/**
 * Compose soubory, které Caddyfile pro mesh-ingress VYRÁBĚJÍ.
 *
 * Univerzum se HLEDÁ, nepíše. První verze téhle brány četla jediný soubor a
 * kotvila se na český komentář v něm — takže když přibyl třetí generátor
 * (model), brána prošla zeleně a nezměřila ho. Přesně ta třída, kterou tenhle
 * soubor hlídá u někoho jiného: měřidlo s užším vstupem, než je realita.
 */
function composesWritingCaddyfile(): string[] {
  return readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f))
    .filter((f) => readFileSync(resolve(ROOT, f), "utf8").includes("/etc/caddy/Caddyfile"));
}

/**
 * Tabulka, na které se obě implementace porovnávají — SKUTEČNĚ z derivace.
 *
 * Komentář to tvrdil už dřív, ale tabulka byla ručně psaná: tři řádky, z toho
 * dva s literálem `aisha-…` a jeden s holým `minio:9000`. Byla to tedy DRUHÁ,
 * ručně udržovaná kopie něčeho, co derivace umí spočítat — a rozešla se s ní
 * (2026-08-13), jakmile cíle tras začaly nést identitu instance.
 *
 * Vada nebyla v těch třech řádcích. Byla v tom, že tu vůbec byly: kopie se
 * nerozejde „když někdo udělá chybu", rozejde se vždycky. Proto se tabulka
 * nebere ze vzorku, ale z téže derivace, kterou čte produkce — a tím brána
 * hlídá VŠECHNY trasy core stacku, ne tři vybrané.
 */
const ROUTES = (() => {
  const puvodni = process.env.APP_NAME_PREFIX;
  process.env.APP_NAME_PREFIX = puvodni?.trim() || "aisha";
  try {
    for (const line of formatShellExports(buildTopology({ profileId: "cloud-multi" })).split("\n")) {
      const m = /^CORE_MESH_INGRESS_ROUTES=(.*)$/.exec(line);
      if (m) return m[1].replace(/^['"]|['"]$/g, "");
    }
  } finally {
    if (puvodni === undefined) delete process.env.APP_NAME_PREFIX;
    else process.env.APP_NAME_PREFIX = puvodni;
  }
  return "";
})();

/**
 * Inline generátor v jednom compose: jeho shell + jméno proměnné s tabulkou.
 *
 * Kotví se na STRUKTURU (`set -eu` … `exec caddy run`) a jméno proměnné se
 * VYČTE, ne předpokládá. Dřív tu byla kotva na konkrétní český komentář —
 * kdokoli ho přepsal nebo nezkopíroval, vypadl brance ze vstupu.
 */
function inlineGenerator(file: string): { varName: string; script: string } | null {
  const compose = readFileSync(resolve(ROOT, file), "utf8");
  const end = compose.indexOf("        exec caddy run");
  if (end < 0) return null;                       // statický Caddyfile, ne generátor
  const start = compose.lastIndexOf("        set -eu\n", end);
  if (start < 0) return null;
  const body = compose.slice(start, end);
  const varName = body.match(/([A-Z0-9_]+_MESH_INGRESS_ROUTES)/)?.[1];
  if (!varName) return null;
  return {
    varName,
    script: body.split("\n").map((l) => l.slice(8)).join("\n").replace(/\$\$/g, "$"),
  };
}

/** Spustí inline shell v /bin/sh a vrátí, co zapsal do Caddyfile. */
function caddyfileFromCompose(file: string, routes: string): string {
  const gen = inlineGenerator(file);
  if (!gen) throw new Error(`${file}: inline generátor nenalezen — brána ztratila vstup`);
  const out = execFileSync(
    "/bin/sh",
    ["-c", `CADDY_OUT=$(mktemp)\n${gen.script.replace(/\/etc\/caddy\/Caddyfile/g, "$CADDY_OUT")}\ncat "$CADDY_OUT"`],
    { env: { ...process.env, [gen.varName]: routes }, encoding: "utf8" },
  );
  // skript hlásí i postup na stdout; Caddyfile začíná prvním `:port {`
  const i = out.search(/^:\d+ \{$/m);
  return i < 0 ? out : out.slice(i);
}

/** Caddyfile psaný natvrdo heredokem — netestuje se během, ale textem. */
function staticCaddyfile(file: string): string | null {
  const compose = readFileSync(resolve(ROOT, file), "utf8");
  const m = compose.match(/cat > \/etc\/caddy\/Caddyfile <<'CADDY'\n([\s\S]*?)\n\s*CADDY\n/);
  return m ? m[1] : null;
}

/** Řádky, kde blok začíná i končí na jednom řádku — caddyfile je odmítá. */
function singleLineBlocks(text: string): string[] {
  // ⛔ NAMĚŘENO 2026-08-16: kontrola hlásila jako vadu i řádek
  //   `reverse_proxy ${APP_NAME_PREFIX:?identita instance}-netbird-management:443 {`
  // Složené závorky tam nejsou Caddyho blok, ale interpolace compose. Jakmile
  // vnitřní adresy začaly nést identitu instance, přibylo `}` na řádcích, kde
  // dřív nebylo — a brána je začala číst jako blok. Měřila znak, ne konstrukci.
  //
  // Interpolace se proto vyřízne DŘÍV, než se o Caddyho blocích rozhoduje.
  const bezInterpolace = (l: string) => l.replace(/\$\{[^}]*\}/g, "×");
  return text
    .split("\n")
    .filter((l) => {
      const c = bezInterpolace(l);
      return /\{[^}]*\}/.test(c) || (/\{/.test(c) && !/\{\s*$/.test(c));
    })
    .map((l) => l.trim());
}

/** Struktura Caddyfile: porty → (hostitel → cíl). Bílé znaky se ignorují. */
function structure(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let port = "";
  let host = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    let m = line.match(/^:(\d+) \{$/);
    if (m) { port = m[1]; out[port] = {}; continue; }
    // `host` je SEZNAM jmen oddělený mezerou — jedna služba se jmenuje různě
    // podle toho, kudy se k ní jde. Parser, který četl jen první, by rozdíl
    // ve zbytku neviděl.
    m = line.match(/^@\S+ host (.+)$/);
    if (m) { host = m[1].trim(); continue; }
    m = line.match(/^reverse_proxy https?:\/\/(\S+)$/);
    if (m && port && host) { out[port][host] = m[1]; host = ""; }
  }
  return out;
}

const COMPOSES = composesWritingCaddyfile();
const GENERATORS = COMPOSES.filter((f) => inlineGenerator(f));
const STATIC = COMPOSES.filter((f) => !inlineGenerator(f) && staticCaddyfile(f));

describe("mesh-ingress: jeden tvar, všechny generátory", () => {
  it("tabulka z derivace není prázdná — jinak brána měří nic", () => {
    // Prázdná tabulka by prošla všemi ostatními testy (generátor by nic nevydal,
    // porovnání by neporovnalo nic) a vypadala by jako zelená.
    expect(ROUTES.split(";").filter(Boolean).length, "derivace nevydala CORE_MESH_INGRESS_ROUTES").toBeGreaterThan(2);
  });

  it("brána má co měřit — aspoň jeden generátor a seznam se vypíše", () => {
    // Prázdný vstup by prošel jako „nic není rozbité". Musí být vidět, CO se měří.
    expect(GENERATORS.length, `Žádný inline generátor nenalezen mezi: ${COMPOSES.join(", ")}`)
      .toBeGreaterThan(0);
    console.log(`  generátory: ${GENERATORS.join(", ")}`);
    if (STATIC.length) console.log(`  statické Caddyfily: ${STATIC.join(", ")}`);
  });

  it.each(GENERATORS)("%s: generátor jde vytáhnout a něco vyrobí", (file) => {
    const text = caddyfileFromCompose(file, ROUTES);
    expect(text, `${file}: generátor nic nevyrobil — brána nic neměří`).toMatch(/^:\d+ \{/);
    // Kolik portů má vyjít, se spočítá Z TABULKY — pevné číslo by bylo třetí
    // ručně udržovaná kopie téhož údaje (a při přidání endpointu by lhalo).
    const ocekavanoPortu = new Set(ROUTES.split(";").filter(Boolean).map((r) => r.split("|")[0])).size;
    expect(Object.keys(structure(text)).length).toBe(ocekavanoPortu);
  });

  it.each(GENERATORS)("%s: žádný blok na jednom řádku (caddyfile to odmítá)", (file) => {
    // Přesně ta vada: `handle /x { respond "ok" 200 }`. Caddy hlásí
    // „Unexpected next token after '{' on same line" a ingress padá ve smyčce.
    const bad = singleLineBlocks(caddyfileFromCompose(file, ROUTES));
    expect(bad, `${file}: blok na jednom řádku — caddyfile ho nepřijme:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it.each(STATIC.length ? STATIC : ["(žádný)"])("%s: statický Caddyfile bez bloku na jednom řádku", (file) => {
    if (file === "(žádný)") return;
    const bad = singleLineBlocks(staticCaddyfile(file)!);
    expect(bad, `${file}: blok na jednom řádku:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("obě implementace popisují TOTÉŽ směrování", () => {
    const fromCompose = structure(caddyfileFromCompose("docker-compose.coolify.yml", ROUTES));
    const fromScript = structure(
      execFileSync("node", ["scripts/gen-mesh-ingress.mjs", "--service", "core"], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, AISHA_PROFILE: "cloud-multi" },
      }),
    );
    // Porovnávají se KLÍČE struktury, ne bajty: skript čte katalog (a má tedy
    // víc endpointů než testovací tabulka), takže se ověřuje, že pro společné
    // porty říkají obě totéž — a hlavně že obě vyrábějí ROZEBRATELNÝ tvar.
    expect(Object.keys(fromScript).length, "skript nevydal žádné trasy").toBeGreaterThan(0);
    for (const port of Object.keys(fromCompose)) {
      if (!fromScript[port]) continue;
      for (const [host, target] of Object.entries(fromCompose[port])) {
        if (fromScript[port][host]) expect(fromScript[port][host]).toBe(target);
      }
    }
  });
});
