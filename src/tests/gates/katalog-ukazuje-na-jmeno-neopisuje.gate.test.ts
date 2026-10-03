/**
 * Katalog na jméno kontejneru UKAZUJE — neopisuje ho
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Jméno kontejneru má JEDEN domov: `container_name` v compose. Katalog říká,
 * KTERÁ compose služba to je (`service:`), a jméno se složí až při derivaci
 * z identity instance. Opis jména v katalogu je zakázaný — druhý domov téhož
 * údaje se dřív nebo později rozejde s prvním.
 *
 * ── PROČ (naměřeno 2026-08-13, všech 38 výskytů) ──────────────────────────────
 * Katalog držel opis a rozešel se s compose v KAŽDÉM z nich:
 *
 *    6× opis == skutečnost, ale JEN protože prefix téhle instance je „aisha";
 *       na jakékoli jiné instanci to byla adresa cizího stacku, nebo mrtvá,
 *   31× opis byl HOLÉ jméno (`minio`, `svc-model`, `event-worker`) — nárok na
 *       sdílené síti, o který se přetahují všichni nájemníci. Táž třída, kvůli
 *       které se OpenXPKI půlkou spojení trefovala do CIZÍ databáze (alias
 *       `pki-db` se rozřešil na dvě adresy, 2026-08-10) → realm CA nevznikla
 *       → `pki-init` fail-closed → core nenaběhl,
 *    1× opis neodpovídal ničemu (`backend--integration--ragnarok`; kontejner se
 *       jmenuje `<prefix>-integration--ragnarok`) — prostě zastaralý
 *       řetězec, který nikdo neměl jak odhalit.
 *
 * Ty cíle nejsou dekorace: jdou do `<ID>_MESH_INGRESS_ROUTES` a mesh-ingress
 * podle nich posílá provoz. Holý cíl = provoz může skončit u jiného nájemníka.
 *
 * ── PROČ TO NECHYTILA ŽÁDNÁ STÁVAJÍCÍ BRÁNA ───────────────────────────────────
 * `internal-url-topology` ty literály PINOVALA jako očekávaný výsledek
 * (`expect(internalUrlFor("openclaw")).toBe("http://aisha-openclaw:5210")`).
 * Nedržela pravidlo — držela na místě vadu. Táž třída jako „brána měří vzorek,
 * ne vlastnost": tenhle test proto měří VLASTNOST (jméno se mění s identitou),
 * ne konkrétní řetězec.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { buildTopology, formatShellExports } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const katalog = JSON.parse(readFileSync(path.join(ROOT, "config/services.json"), "utf8")).services as Record<
  string,
  {
    compose?: string;
    internal_url?: { service?: string; container?: string; port?: number };
    internal_endpoints?: Array<{ service?: string; container?: string; port?: number; subdomain?: string }>;
  }
>;

/** `container_name` compose služeb — čteno po řádcích, stejně jako to dělá derivace. */
function containerNames(composeFile: string): Map<string, string> {
  const map = new Map<string, string>();
  const p = path.join(ROOT, composeFile);
  if (!existsSync(p)) return map;
  let vSluzbach = false;
  let aktualni: string | null = null;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (/^\S/.test(line)) {
      vSluzbach = /^services:\s*$/.test(line);
      aktualni = null;
      continue;
    }
    if (!vSluzbach) continue;
    const s = /^ {2}([A-Za-z0-9._-]+):\s*$/.exec(line);
    if (s) {
      aktualni = s[1];
      continue;
    }
    const cn = /^ {4,}container_name:\s*(\S.*?)\s*$/.exec(line);
    if (cn && aktualni) map.set(aktualni, cn[1].replace(/^["']|["']$/g, ""));
  }
  return map;
}

/** Všechny odkazy na compose službu, které katalog drží. */
function odkazy(): Array<{ id: string; kde: string; compose?: string; service?: string; container?: string }> {
  const out: Array<{ id: string; kde: string; compose?: string; service?: string; container?: string }> = [];
  for (const [id, svc] of Object.entries(katalog)) {
    if (svc.internal_url) {
      out.push({ id, kde: "internal_url", compose: svc.compose, service: svc.internal_url.service, container: svc.internal_url.container });
    }
    for (const ep of svc.internal_endpoints ?? []) {
      out.push({ id, kde: `endpoint:${ep.subdomain ?? "?"}`, compose: svc.compose, service: ep.service, container: ep.container });
    }
  }
  return out;
}

/** Cíle tras (`kontejner:port`) z vydané topologie pro danou identitu. */
function cileTras(prefix: string): string[] {
  const puvodni = process.env.APP_NAME_PREFIX;
  process.env.APP_NAME_PREFIX = prefix;
  try {
    const out: string[] = [];
    for (const line of formatShellExports(buildTopology({ profileId: "cloud-multi" })).split("\n")) {
      const m = /^[A-Z0-9_]+_MESH_INGRESS_ROUTES=(.*)$/.exec(line);
      if (!m) continue;
      for (const t of m[1].replace(/^['"]|['"]$/g, "").split(";")) {
        const p = t.split("|");
        if (p.length === 3 && p[2]) out.push(p[2]);
      }
    }
    return out;
  } finally {
    if (puvodni === undefined) delete process.env.APP_NAME_PREFIX;
    else process.env.APP_NAME_PREFIX = puvodni;
  }
}

describe("katalog na jméno kontejneru ukazuje, neopisuje ho", () => {
  const vsechny = odkazy();

  it("extraktor vidí odkazy — prázdno by vypadalo jako čistý strom", () => {
    // Přejmenované pole nebo jiný tvar katalogu by dal nula nálezů, což se
    // nedá odlišit od „vše v pořádku" (feedback_tool_failure_read_as_data).
    expect(vsechny.length, "katalog nemá žádný odkaz na compose službu — extraktor je rozbitý").toBeGreaterThan(30);
  });

  it("žádný odkaz neopisuje jméno kontejneru", () => {
    const opisy = vsechny.filter((o) => o.container).map((o) => `${o.id} :: ${o.kde} = ${o.container}`);
    expect(
      opisy,
      "Katalog opisuje jméno kontejneru. To jméno má jediný domov — `container_name`\n" +
        "v compose. Opis se s ním rozejde: buď ponese cizí identitu, nebo bude holý\n" +
        "a bude kolidovat s jiným nájemníkem. Nahraď ho `service: \"<klíč compose služby>\"`.",
    ).toEqual([]);
  });

  it("každý odkaz míří na compose službu, která existuje a má container_name", () => {
    const rozbite: string[] = [];
    for (const o of vsechny) {
      if (!o.service) continue;
      if (!o.compose) {
        rozbite.push(`${o.id} :: ${o.kde} — služba nemá 'compose'`);
        continue;
      }
      const cn = containerNames(o.compose).get(o.service);
      if (!cn) rozbite.push(`${o.id} :: ${o.kde} → '${o.service}' v ${o.compose} neexistuje nebo nemá container_name`);
    }
    expect(rozbite, "odkaz do prázdna — derivace by z něj nepostavila trasu").toEqual([]);
  });

  it("každé odkazované container_name nese identitu instance", () => {
    const beziIdentity: string[] = [];
    for (const o of vsechny) {
      if (!o.service || !o.compose) continue;
      const cn = containerNames(o.compose).get(o.service);
      if (cn && !/\$\{APP_NAME_PREFIX/.test(cn)) beziIdentity.push(`${o.id} :: ${o.kde} → ${cn}`);
    }
    expect(
      beziIdentity,
      "Kontejner, na který někdo routuje, se jmenuje bez identity instance —\n" +
        "na sdíleném hostiteli je to globální nárok a druhý nájemník ho přebije.\n" +
        "Slož jméno z ${APP_NAME_PREFIX:?…}.",
    ).toEqual([]);
  });

  it("dvě identity nesdílejí ANI JEDEN cíl trasy", () => {
    // Tohle je ta vlastnost, kvůli které to všechno je. Kdyby se jediné jméno
    // shodovalo, znamená to literál — a mesh-ingress jedné instance by mohl
    // poslat provoz do kontejneru druhé.
    const a = cileTras("aisha");
    const b = cileTras("testfork");
    expect(a.length, "žádné trasy — brána by měřila prázdno").toBeGreaterThan(20);
    expect(b.length, "cizí identita nevydala trasy").toBe(a.length);
    const prunik = a.filter((x) => b.includes(x));
    expect(
      prunik,
      "Tyhle cíle jsou pro obě instance STEJNÉ, tedy literál. Na sdíleném hostiteli\n" +
        "míří obě instance na týž kontejner — a jedna z nich na cizí.",
    ).toEqual([]);
  });
});
