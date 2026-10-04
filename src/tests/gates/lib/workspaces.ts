/**
 * Adresáře npm workspaces podle kořenového `package.json` — TAK, JAK JE ROZBALÍ npm.
 *
 * ⛔ NAMĚŘENO 2026-10-04: dvě brány (lockfile-platform-optionals,
 * zamek-zna-kazdy-workspace) si vzory rozbalovaly každá po svém a obě se mýlily
 * jinak než npm, jakmile workspaces přestaly být jen `adresar/*`:
 *   · `!packages/extranet-sdk` (negace — kořen SDK monorepa NENÍ workspace)
 *     ignorovaly, takže `packages/*` z něj udělalo workspace, který zámek nezná;
 *   · doslovnou cestu `packages/extranet-sdk/packages/ui` jedna z nich četla jako
 *     adresář, jehož PODADRESÁŘE jsou workspaces.
 * npm (@npmcli/map-workspaces) dělá: kladné vzory (glob i doslovná cesta) přidají
 * adresáře s `package.json`, vzory s `!` je odeberou. Tady totéž, jeden domov.
 */
import { existsSync, globSync } from "node:fs";
import { join } from "node:path";

const bezKoncovehoLomitka = (cesta: string): string => cesta.replace(/\/+$/, "");

/** Adresáře workspaces (relativní ke `root`, seřazené) pro dané vzory. */
export function workspaceAdresare(vzory: string[], root: string): string[] {
  const kladne = vzory.filter((v) => !v.startsWith("!"));
  const vyrazene = new Set(
    vzory
      .filter((v) => v.startsWith("!"))
      .flatMap((v) => globSync(v.slice(1), { cwd: root }))
      .map(bezKoncovehoLomitka),
  );
  const out = new Set<string>();
  for (const vzor of kladne) {
    for (const nalez of globSync(vzor, { cwd: root })) {
      const adresar = bezKoncovehoLomitka(nalez);
      if (vyrazene.has(adresar)) continue;
      if (existsSync(join(root, adresar, "package.json"))) out.add(adresar);
    }
  }
  return [...out].sort();
}

/** Vzory workspaces z kořenového package.json (pole i tvar `{ packages: [] }`). */
export function vzoryWorkspaces(pkg: { workspaces?: string[] | { packages?: string[] } }): string[] {
  return Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
}
