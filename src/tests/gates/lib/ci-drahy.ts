/**
 * Dráhy runnerů CI — jedno místo, kde se čte deklarace `.forgejo/ci-drahy.json`
 * a kde se z `runs-on` pozná, na které dráhy může úloha vyjít.
 *
 * Používají ho brány lehka-draha-nese-jen-lehke-joby (stropy, lehká dráha) a
 * izolovany-runner-nese-jen-ciste-joby (izolovaný runner). Výrazy se porovnávají
 * PŘESNĚ s kanonickým tvarem: odchylka (třeba vypuštěná kontrola forku) je
 * neznámý štítek, tedy nález — ne „asi to sedí“.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Draha = { stitky?: string[]; promenna?: string; strop_min: number };
export type Deklarace = {
  vychozi: Draha & { stitky: string[] };
  lehka: Draha & { promenna: string };
  izolovany_pr?: Draha & { promenna: string };
  izolovany_push?: Draha & { promenna: string };
  nespousti_se?: Array<{ soubor: string; job: string; promenna: string }>;
};
export type JmenoDrahy = "vychozi" | "lehka" | "izolovany_pr" | "izolovany_push";
export type DrahaUlohy = { draha: JmenoDrahy | "?"; stitek: string };

export const nactiDeklaraci = (root: string): Deklarace => JSON.parse(readFileSync(join(root, ".forgejo/ci-drahy.json"), "utf8"));

/**
 * Kanonický výraz izolovaného runneru (2026-10-03): pull_request
 * NE z forku → štítek z `izolovany_pr.promenna`, push do main → `izolovany_push.promenna`,
 * jinak (a když proměnná není nastavená) výchozí štítek. PR z forku nikdy.
 */
export function izolovanyVyraz(d: Deklarace, vychozi: string): string {
  if (!d.izolovany_pr || !d.izolovany_push) throw new Error("deklarace nezná dráhy izolovany_pr/izolovany_push");
  return (
    `\${{ (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && vars.${d.izolovany_pr.promenna})` +
    ` || (github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.${d.izolovany_push.promenna}) || '${vychozi}' }}`
  );
}

/** Na které dráhy může vyjít jeden štítek `runs-on`: deklarované dráhy, nebo `?` (nález). */
export function drahyStitku(stitek: string, d: Deklarace): DrahaUlohy[] {
  const s = stitek.trim();
  const vychozi = (x: string): DrahaUlohy => ({ draha: d.vychozi.stitky.includes(x) ? "vychozi" : "?", stitek: x });
  const lehka = new RegExp(`^\\$\\{\\{\\s*vars\\.${d.lehka.promenna}\\s*\\|\\|\\s*'([^']+)'\\s*\\}\\}$`).exec(s);
  if (lehka) return [{ draha: "lehka", stitek: `vars.${d.lehka.promenna}` }, vychozi(lehka[1])];
  if (d.izolovany_pr && d.izolovany_push) {
    for (const v of d.vychozi.stitky) {
      if (s === izolovanyVyraz(d, v)) {
        return [
          { draha: "izolovany_pr", stitek: `vars.${d.izolovany_pr.promenna}` },
          { draha: "izolovany_push", stitek: `vars.${d.izolovany_push.promenna}` },
          vychozi(v),
        ];
      }
    }
  }
  // Jiný výraz deklarace nezná — i odchylka od kanonického tvaru je nález.
  if (s.includes("${{")) return [{ draha: "?", stitek: s }];
  return [vychozi(s)];
}

export function drahyUlohy(runsOn: string | string[] | undefined, d: Deklarace): DrahaUlohy[] {
  const stitky = Array.isArray(runsOn) ? runsOn : runsOn ? [runsOn] : [];
  return stitky.flatMap((s) => drahyStitku(s, d));
}
