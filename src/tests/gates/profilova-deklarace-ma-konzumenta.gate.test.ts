/**
 * Brána: co profil deklaruje, to někdo MUSÍ číst
 *
 * ⛔ NAMĚŘENO 2026-09-04 na produkci forku. `mesh_default` je deklarovaný
 * v `config/profiles.schema.json` i ve VŠECH profilech — a nečetl ho NIKDO.
 * `derive-domains.mjs` počítal mesh výhradně z `process.env.MESH_ENABLED`
 * a bez něj padal na `false`:
 *
 *     const MESH = meshEnabled ?? (
 *       String(process.env.MESH_ENABLED ?? "false").toLowerCase() === "true"
 *     );
 *
 * Profil, který mesh chce, ho tedy nedostal. Produkce běžela mesh-less, přestože
 * mesh je výchozí stav (by design) — a edge přesto dostával MESH adresy
 * (`*_UPSTREAM = <svc>.<slot>.<tld>`), které se bez mesh-dns nemají kde rozložit:
 * `i/o timeout` → 502 na api, mcp i dirigent. Většina nálezů z toho nasazení
 * (PKI_BUNDLE_REQUIRED, CORE_MESH_IP, chybějící mesh-dns síť, mesh-ingress
 * sidecary) byla léčba příznaků režimu, který vůbec neměl vzniknout.
 *
 * PRAVIDLO: deklarace bez konzumenta je HORŠÍ než chybějící — tvrdí, že něco
 * řídí. Táž třída jako `ENABLE_GOOGLE_OAUTH`, které bylo osm měsíců zapnuté,
 * mělo dokumentaci i šablonu realmu, a přihlašovací stránka nabízela jen heslo
 * (viz instance-rollout.sh ř. 361).
 *
 * Brána proto žádá, aby každý klíč deklarovaný ve schématu profilu byl někde
 * ve `scripts/` skutečně přečtený. Prózu (`_notes`, `description`, `$schema`)
 * a klíče, které jsou samy o sobě strukturou pro resolver, vynechává.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCHEMA = join(ROOT, "config/profiles.schema.json");

/**
 * Klíče, které se NEČTOU jménem, protože jimi resolver prochází strukturálně
 * (iteruje mapu, ne konkrétní klíč). Každý tu má důvod — seznam smí jen ubývat.
 */
const STRUKTURALNI = new Set([
  "$schema",
  "id",
  "description",
  "domain", // resolver čte jeho VNITŘNÍ klíče (public_tld…), ne jeho samotný
  "service_overrides", // iteruje se přes služby
]);

function kliceSchematu(): string[] {
  const s = JSON.parse(readFileSync(SCHEMA, "utf8"));
  const props = s?.properties ?? {};
  return Object.keys(props).filter((k) => !k.startsWith("_") && !STRUKTURALNI.has(k));
}

/** Rekurzivně posbírá zdrojáky ve scripts/ (kód, ne dokumentace). */
function zdrojaky(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const p of readdirSync(dir)) {
    if (p === "node_modules" || p === "dist") continue;
    const cesta = join(dir, p);
    if (statSync(cesta).isDirectory()) zdrojaky(cesta, out);
    else if (/\.(mjs|cjs|js|ts|sh)$/.test(p)) out.push(cesta);
  }
  return out;
}

const SOUBORY = zdrojaky(join(ROOT, "scripts"));
const KOD = SOUBORY.map((f) => readFileSync(f, "utf8")).join("\n");

describe("profilová deklarace má konzumenta", () => {
  test("schéma i zdrojáky se našly (jinak brána nic neměří)", () => {
    expect(existsSync(SCHEMA), "config/profiles.schema.json musí existovat").toBe(true);
    expect(SOUBORY.length, "scripts/ neobsahuje žádné zdrojáky").toBeGreaterThan(10);
    expect(kliceSchematu().length, "schéma nedeklaruje žádný měřitelný klíč").toBeGreaterThan(0);
  });

  test("každý klíč schématu někdo ve scripts/ čte", () => {
    // `profile.klic`, `profile?.klic`, `["klic"]`, `.klic` — stačí jakákoli zmínka
    // jménem: brána hlídá EXISTENCI konzumenta, ne jeho správnost.
    const nemaKonzumenta = kliceSchematu().filter((k) => !KOD.includes(k));
    expect(
      nemaKonzumenta,
      `Tyhle klíče profil deklaruje, ale nikdo ve scripts/ je nečte:\n` +
        nemaKonzumenta.map((k) => `  ${k}`).join("\n") +
        `\n\nDeklarace bez konzumenta je HORŠÍ než chybějící — tvrdí, že něco řídí.\n` +
        `Naměřeno 2026-09-04: mesh_default byl ve schématu i ve všech profilech a\n` +
        `nečetl ho nikdo, takže produkce běžela mesh-less proti záměru — a edge\n` +
        `přesto dostával mesh adresy, které se neměly kde rozložit (502).\n` +
        `Buď klíč zapoj, nebo ho ze schématu smaž.`,
    ).toEqual([]);
  });

  test("umí zčervenat: vymyšlený klíč ve schématu se pozná", () => {
    const vymysleny = "profil_klic_ktery_nikdo_necte_" + "x".repeat(3);
    expect(
      KOD.includes(vymysleny),
      "kontrolní klíč se ve zdrojácích nesmí vyskytovat, jinak test nic neměří",
    ).toBe(false);
    // Kdyby takový klíč ve schématu byl, filtr výš by ho vrátil jako nález.
    expect([vymysleny].filter((k) => !KOD.includes(k))).toEqual([vymysleny]);
  });
});
