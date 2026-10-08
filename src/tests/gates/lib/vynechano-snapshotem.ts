/**
 * Soubory, které veřejný snapshot záměrně NEVEZE — a proč to bráně nevadí.
 *
 * Veřejné zrcadlo (github.com/evymo/aisha-orchestrator) vzniká ze stromu
 * upstreamu přes scripts/release/public-snapshot.mjs a `config/public-snapshot.exclude`
 * z něj vyřazuje cesty. Do 2026-10-08 (rozhodnutí majitele 2026-10-03: na GitHubu
 * nic neběží) vyřazoval `.github/workflows/` i `.github/dependabot.yml`; od přesunu CI
 * na GitHub Actions snapshot workflow nese a vyřazení platí pro Dependabot a podpisový
 * workflow, který tenhle strom nemá. Co přesně
 * vyřazuje, říká jen ten soubor. Brány, které vyřazené soubory čtou (podpis kontejnerů,
 * SBOM, deploy lane, Dependabot), ve veřejném klonu NEMAJÍ CO MĚŘIT.
 *
 * ⛔ TŘI ODPOVĚDI, NE DVĚ — týž princip jako `stack-nesmi-znat-jmeno-instance`:
 *   · soubor ve stromu je            → brána měří (upstream, nebo CI přibylo na GitHubu)
 *   · soubor chybí a snapshot ho vyřazuje → SKIPPED s důvodem v názvu testu
 *   · soubor chybí a nic ho nevyřazuje → brána PADÁ (skutečná vada, ne snapshot)
 * Prohlásit vyřazený soubor za „v pořádku" by byl fail-open; padat na něm by
 * blokovalo každý push z veřejného klonu za něco, co vadou není.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Kořen repa — `src/tests/gates/lib` → 4 úrovně výš. */
export const ROOT = join(__dirname, "../../../..");
export const SNAPSHOT_EXCLUDE = "config/public-snapshot.exclude";

/** Vzory ze souboru vyřazení (gitignore tvar, bez komentářů a prázdných řádků). Čistá funkce. */
export function vzorySnapshotu(obsah: string): string[] {
  return obsah
    .split("\n")
    .map((radek) => radek.trim())
    .filter((radek) => radek && !radek.startsWith("#"));
}

/**
 * Vyřazuje některý vzor cestu? Podporuje přesnou cestu a adresář (`a/b/` →
 * všechno pod ním i samotné `a/b`). Glob vzory snapshot pro CI nepoužívá; neznámý
 * tvar se proto NEVYKLÁDÁ (vrací false → brána padá, nemlčí). Čistá funkce.
 */
export function vyrazenoVzorem(cesta: string, vzory: string[]): boolean {
  const c = cesta.replace(/^\/+/, "").replace(/\/+$/, "");
  return vzory.some((vzor) => {
    if (/[*?[\]!]/.test(vzor)) return false;
    const v = vzor.replace(/^\/+/, "");
    if (v.endsWith("/")) {
      const adresar = v.replace(/\/+$/, "");
      return c === adresar || c.startsWith(`${adresar}/`);
    }
    return c === v;
  });
}

/**
 * Důvod pro `skipIf`, když cesta ve stromu chybí PROTO, že ji snapshot vyřazuje;
 * jinak `null` (soubor je, nebo chybí bez důvodu → brána má měřit a padnout).
 */
export function duvodVynechanoSnapshotem(cesta: string, root: string = ROOT): string | null {
  if (existsSync(join(root, cesta))) return null;
  const exclude = join(root, SNAPSHOT_EXCLUDE);
  if (!existsSync(exclude)) return null;
  return vyrazenoVzorem(cesta, vzorySnapshotu(readFileSync(exclude, "utf8")))
    ? `${cesta} veřejný snapshot nevozí (${SNAPSHOT_EXCLUDE})`
    : null;
}
