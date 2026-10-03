/**
 * Gate: co kód čte s aliasovým fallbackem, to musí derivace VYDÁVAT.
 *
 * PROČ (2026-07-29)
 * ----------------
 * Zdroj je plný tvarů
 *
 *     upstream: process.env.STRIPE_SERVICE_URL ?? 'http://svc-stripe:3010'
 *
 * což je správně napsané: proměnná je primární, alias jen záchrana. Jenže když
 * tu proměnnou nikdo neemituje, sáhne se VŽDYCKY po fallbacku — tedy po holém
 * container aliasu na sdílené ploché síti. Ten platí jen na jednom stroji a je
 * to zároveň cesta, kterou má segmentace zavřít.
 *
 * Vada je tichá dvojnásob: kód vypadá korektně, běh funguje (na jednom uzlu),
 * a projeví se to teprve na rozprostřené instalaci — nebo vůbec ne, jen zůstane
 * díra v izolaci. Dnes se takhle našly KEYCLOAK_INTERNAL_URL (derivace ho
 * vydávala, ale nikdo ho nedoručoval do .env) a celá rodina *_SERVICE_URL
 * (nevydával je nikdo).
 *
 * MĚŘIDLO MÍSTO HLEDÁNÍ
 * ---------------------
 * Tahle brána existuje proto, aby se ta třída nehledala očima. Univerzum se
 * seeduje ze zdroje na disku, ne z ručního výčtu — jinak by zdědila jeho díry.
 *
 * DVA DODAVATELÉ, NE JEDEN
 * ------------------------
 * Brána nejdřív porovnávala konzumenty jen proti VÝSTUPU DERIVACE, a proto
 * hlásila `KEYCLOAK_URL` jako nedodávaný — přestože ho `aisha-env-doctor.mjs`
 * má v CONTRACT a doručuje. To byla vada MĚŘIDLA, ne stacku, a řešila se
 * výjimkou se jménem v testu.
 *
 * Do env souboru přitom vedou dvě cesty a obě jsou legitimní:
 *   derivace  — jména odvozená z TOPOLOGIE (mění se s katalogem a profilem)
 *   CONTRACT  — hodnoty statické či generované (hesla, veřejné domény, klíče)
 *
 * `KEYCLOAK_URL` patří do druhé: je to VEŘEJNÝ issuer, ze kterého se stává
 * `iss` claim v JWT. Odvodit ho jako vnitřní adresu by rozbilo ověřování
 * podpisů — proto vedle něj stojí samostatný `KEYCLOAK_INTERNAL_URL`.
 *
 * Otázka tedy nezní „vydá to derivace?", ale „DORAZÍ ta proměnná?". Univerzum
 * dodaných klíčů je proto sjednocení obou zdrojů — čtené z nich, ne opsané.
 *
 * CO SE JEŠTĚ KONTROLUJE
 * ----------------------
 * Že derivace nevydává týž klíč dvakrát. `env_aliases` v katalogu smí přidat
 * jména, ale když se alias rovná automaticky odvozenému `<ID>_URL`, vznikne
 * duplicita — a která hodnota vyhraje, záleží na tom, kdo soubor parsuje.
 * Řeší to `collapseDuplicateEmissions()` v derivaci: shodné vydání sloučí,
 * rozporné shodí. Tahle brána hlídá, že ta vlastnost platí.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildTopology, formatShellExports } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = resolve(__dirname, "../../..");

/** Všechny .ts soubory pod services/ — univerzum ze skutečnosti. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|mjs|js)$/.test(entry) && !/\.(test|spec)\./.test(entry)) acc.push(full);
  }
  return acc;
}

type Consumer = { file: string; variable: string; fallback: string };

/** `process.env.X ?? 'http://host:port'` — proměnná s aliasovým fallbackem. */
function consumersWithAliasFallback(): Consumer[] {
  const found: Consumer[] = [];
  const svcDir = resolve(ROOT, "services");
  for (const file of sourceFiles(svcDir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(
      /process\.env\.([A-Z_][A-Z0-9_]*)\s*(?:\?\?|\|\|)\s*["'`](https?:\/\/([a-zA-Z0-9._-]+)(?::\d+)?[^"'`]*)["'`]/g,
    )) {
      const [, variable, fallback, host] = m;
      if (host.includes(".")) continue;        // doménové jméno — řeší DNS, ne alias
      if (host === "localhost" || host === "127.0.0.1") continue;
      found.push({ file: file.replace(`${ROOT}/`, ""), variable, fallback });
    }
  }
  return found;
}

function emittedKeys(profileId: string): Map<string, number> {
  const out = formatShellExports(buildTopology({ profileId, meshEnabled: true }));
  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
}

/**
 * Klíče, které do .env doručí env-doctor ze svého CONTRACT.
 *
 * Čte se ZDROJ (`scripts/aisha-env-doctor.mjs`), ne kopie: doktor se při
 * importu sám spustí, takže se nedá načíst jako modul, a opsaný seznam by se
 * rozešel — táž třída, kvůli které tahle brána vznikla. Stejný postup jako
 * čtení WAVES v startup-order-two-lists-agree.
 */
function contractKeys(): Set<string> {
  const src = readFileSync(resolve(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
  const block = src.match(/const CONTRACT\s*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error("CONTRACT v aisha-env-doctor.mjs nenalezen — brána ztratila vstup");
  return new Set([...block[1].matchAll(/\[\s*"([A-Z_][A-Z0-9_]*)"/g)].map((m) => m[1]));
}

/** Proměnná DORAZÍ, vydá-li ji derivace NEBO ji doručí env-doctor z CONTRACT. */
function deliveredKeys(profileId: string): Set<string> {
  return new Set([...emittedKeys(profileId).keys(), ...contractKeys()]);
}

describe("kontrakt odvozených URL", () => {
  it("univerzum se seeduje ze zdroje a není prázdné", () => {
    const consumers = consumersWithAliasFallback();
    expect(consumers.length, "žádný konzument nenalezen — sonda přestala měřit").toBeGreaterThan(5);
    expect(emittedKeys("cloud-multi").size).toBeGreaterThan(50);
    // Druhý dodavatel se čte stejně ze zdroje — a stejně může tiše přestat měřit.
    expect(contractKeys().size, "CONTRACT vyšel prázdný — extrakce se rozešla se zdrojem")
      .toBeGreaterThan(100);
  });

  it("derivace nevydává žádný klíč dvakrát", () => {
    const dups = [...emittedKeys("cloud-multi")]
      .filter(([, n]) => n > 1)
      .map(([k, n]) => `${k} (${n}×)`)
      .sort();
    expect(dups, `Derivace vydává klíč vícekrát — která hodnota vyhraje, závisí na parseru:\n  ${dups.join("\n  ")}`)
      .toEqual([]);
  });

  it("mesh lane přes hop nese Host cílového endpointu, ne jméno hopu", () => {
    // Přísný mesh-ingress routuje podle Host = <endpoint>.<zóna> a vše ostatní
    // odmítá 421 — první deploy toho ingressu zhasl celé veřejné API, protože
    // edge dál posílal Host "mesh-router" (změřeno 2026-07-29). Vlastnost:
    // kdykoli port VEŘEJNÉ TVÁŘE služby core (`public_face`, jinak
    // `internal_url`) sedí na deklarovaný internal_endpoint, derivace vydá
    // API_MESH_HOST = jméno endpointu v zóně.
    // Očekávání se čte z KATALOGU, ne z pravopisu v testu.
    const topo = buildTopology({ profileId: "cloud-multi", meshEnabled: true });
    const out = formatShellExports(topo);
    const line = out.split("\n").find((l) => l.startsWith("API_MESH_HOST="));
    const core = topo.services.core;
    const face = core.public_face ?? core.internal_url;
    const port = Number(face?.port);
    const ep = (core.internal_endpoints ?? []).find(
      (e: { port: number; subdomain?: string }) => Number(e.port) === port && e.subdomain,
    );
    if (!ep) {
      // Katalog portovou vazbu zrušil — pak se Host vydávat NEMÁ (mezera > trefa vedle).
      expect(line).toBeUndefined();
      return;
    }
    expect(line, "port veřejné tváře sedí na endpoint, ale API_MESH_HOST se nevydává").toBeDefined();
    // Resolver hodnoty uvozuje (výstup se sourcuje) — čteme hodnotu, ne literál.
    const host = (line as string).slice("API_MESH_HOST=".length).replace(/^'([\s\S]*)'$/, "$1");
    expect(host.startsWith(`${ep.subdomain}.`)).toBe(true);
    expect(host.includes("mesh-router")).toBe(false);
  });

  it("každá proměnná čtená s aliasovým fallbackem je DORUČOVANÁ", () => {
    const delivered = deliveredKeys("cloud-multi");
    const missing = [...new Set(
      consumersWithAliasFallback()
        .filter((c) => !delivered.has(c.variable))
        .map((c) => `${c.variable} (fallback ${c.fallback}, ${c.file})`),
    )].sort();

    // Bez výjimek. Každá položka znamená: kód se VŽDY vrátí k holému container
    // aliasu, protože proměnná nikdy nedorazí. Na jednom uzlu to funguje, na
    // rozprostřené instalaci ne — a izolaci to brání vždy.
    //
    // Odstraňuje se doplněním `internal_url` / `internal_endpoints` do
    // config/services.json (derivace pak jméno vydá sama, kolokačně správně),
    // nebo doplněním do CONTRACT v aisha-env-doctor.mjs, jde-li o hodnotu,
    // která se neodvozuje z topologie. Konzument se v obou případech nemění.
    expect(
      missing,
      `Proměnná se čte s aliasovým fallbackem, ale NIKDO ji nedoručuje — ` +
      `kód tedy vždy skončí na holém aliasu:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
