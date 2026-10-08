/**
 * Brána: izolovaný runner nese jen ČISTÉ joby a nikdy PR z forku
 *
 * ⛔ PROČ (bezpečnostní verdikt 2026-10-03): izolovaný runner na GPU uzlu běží
 * v izolované VM (libvirt) a joby pouští jako sourozenecké kontejnery bez socketu
 * a bez privileged. Ani tak na něj nesmí nic, co by z jobu udělalo cestu dál:
 *
 *   1. ŽÁDNÉ TAJEMSTVÍ (`secrets.*`): kód z PR běží na stroji, který nemá být
 *      ve stejné důvěře jako výchozí runner; produkční pověření (Coolify, repo, AI klíče)
 *      tam nepatří.
 *   2. ŽÁDNÝ DOCKER, `services`, `container`, throwaway DB: socket = root nad VM.
 *   3. PR Z FORKU NIKDY: po veřejném vydání přijde cizí kód. Výraz `runs-on` pošle
 *      na izolovaný runner jen pull_request, jehož hlava je v TOMTO repu, a push do main.
 *   4. ŽÁDNÁ CACHE Z CACHE SERVERU (`actions/cache`, `actions/setup-*` s cache):
 *      runner push je sdílený všemi repy organizace a záznam cache je cizí kód
 *      (Go build cache, prohlížeče, výsledky lintu se neověřují). Sdílí se jen npm
 *      cache svazkem — tu ověřuje lockfile (2026-10-03). Cache server mají
 *      oba runnery vypnutý; brána je obrana do hloubky, kdyby ho někdo zapnul.
 *      setup-go od v4 cachuje i BEZ `cache:` — tam se vyžaduje výslovné `false`.
 *   5. PŘEPÍNAČ JE NEAKTIVNÍ, dokud instance nenastaví proměnné z `.forgejo/ci-drahy.json`
 *      (izolovany_pr / izolovany_push). Do té doby jdou tytéž joby na výchozí štítek.
 *      Aktivace = samostatný krok po měřeních (declare štítků, práva tokenu jobu,
 *      síť z jobu, bez GPU/vah) a po revizi.
 *
 * Výraz se porovnává PŘESNĚ s kanonickým tvarem (src/tests/gates/lib/ci-drahy.ts):
 * vypuštěná kontrola forku nebo prohozené události = nález.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { izolovanyVyraz, drahyUlohy, nactiDeklaraci } from "./lib/ci-drahy";

const ROOT = process.cwd();
const DEKLARACE = nactiDeklaraci(ROOT);
type Krok = { run?: string; uses?: string; with?: Record<string, unknown> };
type Uloha = { "runs-on"?: string | string[]; "timeout-minutes"?: unknown; services?: unknown; container?: unknown; steps?: Krok[] };

const workflowy = () =>
  readdirSync(join(ROOT, ".forgejo/workflows")).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.forgejo/workflows/${f}`);
const vsechnyUlohy = (): Array<[string, Uloha]> =>
  workflowy().flatMap((f) => Object.entries((parse(readFileSync(join(ROOT, f), "utf8")) as { jobs?: Record<string, Uloha> }).jobs ?? {}).map(([id, u]) => [`${f} › ${id}`, u] as [string, Uloha]));
const naIzolovany = (u: Uloha) => drahyUlohy(u["runs-on"], DEKLARACE).some((d) => d.draha === "izolovany_pr" || d.draha === "izolovany_push");

/** Příkazy bez komentářů a bez obsahu uvozovek — zmínka v textu echo/komentáři není volání. */
const prikazy = (u: Uloha) =>
  (u.steps ?? [])
    .map((k) => String(k.run ?? "").split("\n").filter((r) => !r.trim().startsWith("#")).join("\n").replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""'))
    .join("\n");
const ZAKAZANE: Array<[RegExp, string]> = [
  [/\bdocker\b/, "volá docker"],
  [/with-throwaway|db-kontrakt-jmenovite|testcontainers/, "staví throwaway DB nebo kontejnery"],
  [/run-service-tests|verify-cold-start|aisha-cold-start\.sh/, "pouští sadu, která potřebuje docker"],
];
function proc(u: Uloha): string[] {
  const d: string[] = [];
  if (JSON.stringify(u).includes("secrets.")) d.push("nese `secrets.*`");
  if (u.services) d.push("má `services:`");
  if (u.container) d.push("má `container:`");
  for (const k of u.steps ?? []) {
    const uses = String(k.uses ?? "");
    if (uses.startsWith("docker://")) d.push(`akce z obrazu (${uses})`);
    if (/^actions\/cache(@|\/)/.test(uses)) d.push(`cache ze serveru runneru (${uses})`);
    const setup = /^actions\/setup-([a-z]+)@/.exec(uses);
    if (setup) {
      const cache = k.with?.cache;
      const vypnuta = cache === false || cache === "false";
      // setup-go od v4 cachuje i bez `cache:` — mlčení tam znamená ZAPNUTO.
      const zapnuta = setup[1] === "go" ? !vypnuta : cache !== undefined && cache !== "" && !vypnuta;
      if (zapnuta) d.push(`${uses} s cache (${cache === undefined ? "výchozí = zapnuto" : String(cache)})`);
    }
  }
  const p = prikazy(u);
  for (const [vzor, popis] of ZAKAZANE) if (vzor.test(p)) d.push(popis);
  return d;
}

describe("izolovaný runner nese jen čisté joby", () => {
  const U = vsechnyUlohy();
  const izolovane = U.filter(([, u]) => naIzolovany(u));

  it("deklarace zná obě izolované dráhy a univerzum není prázdné", () => {
    expect(DEKLARACE.izolovany_pr?.promenna).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(DEKLARACE.izolovany_push?.promenna).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(DEKLARACE.izolovany_pr?.promenna).not.toBe(DEKLARACE.izolovany_push?.promenna);
    expect(izolovane.length, "na izolovaný runner nemíří skoro nic — měřidlo nevidí kanonický výraz").toBeGreaterThanOrEqual(5);
  });

  it("kanonický výraz: PR jen z TOHOTO repa → izolovany_pr, push do main → izolovany_push, jinak výchozí štítek", () => {
    const v = izolovanyVyraz(DEKLARACE, "ubuntu-latest");
    expect(v).toContain(`github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && vars.${DEKLARACE.izolovany_pr!.promenna}`);
    expect(v).toContain(`github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.${DEKLARACE.izolovany_push!.promenna}`);
    expect(v, "bez nastavené proměnné (a pro jiné události) musí výraz spadnout na výchozí štítek").toMatch(/\|\| 'ubuntu-latest' \}\}$/);
  });

  it("⛔ výraz, který jmenuje proměnnou izolovaného runneru, je PŘESNĚ kanonický (kontrolu forku nejde vypustit)", () => {
    const promenne = [DEKLARACE.izolovany_pr!.promenna, DEKLARACE.izolovany_push!.promenna];
    const nekanonicke = U.filter(([, u]) => promenne.some((p) => JSON.stringify(u["runs-on"] ?? "").includes(p)) && !naIzolovany(u)).map(([k]) => k);
    expect(nekanonicke, `runs-on jmenuje proměnnou izolovaného runneru mimo kanonický tvar (src/tests/gates/lib/ci-drahy.ts → izolovanyVyraz):\n  ${nekanonicke.join("\n  ")}`).toEqual([]);
  });

  it("⛔ na izolovaný runner jen joby bez tajemství, dockeru, services, container, throwaway DB a cache serveru", () => {
    const spatne = izolovane.map(([k, u]) => [k, proc(u)] as const).filter(([, d]) => d.length).map(([k, d]) => `  ${k}: ${d.join(", ")}`);
    expect(spatne, `Tyhle joby mohou vyjít na izolovaný runner, ale nesmí:\n${spatne.join("\n")}`).toEqual([]);
  });

  it("strop úlohy se vejde pod strop izolovaného runneru", () => {
    const strop = Math.min(DEKLARACE.izolovany_pr!.strop_min, DEKLARACE.izolovany_push!.strop_min);
    const dlouhe = izolovane.filter(([, u]) => typeof u["timeout-minutes"] !== "number" || (u["timeout-minutes"] as number) > strop).map(([k, u]) => `  ${k}: ${String(u["timeout-minutes"])}`);
    expect(dlouhe, `timeout-minutes musí být číslo ≤ ${strop}`).toEqual([]);
  });
});
