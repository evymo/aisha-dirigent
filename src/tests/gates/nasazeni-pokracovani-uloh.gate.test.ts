/**
 * Brána: každá PŘÍMÁ nasazovací úloha má právě jedno POKRAČOVÁNÍ, které navazuje
 * na nasazení téhož běhu — a verdikt čte celé nasazení
 *
 * ⛔ PROČ (2026-10-01/02): tvrdý strop sdíleného runneru (1 h) přebíjí
 * timeout-minutes, takže druhý pokus nasazení v téže úloze se nevešel NIKDY
 * (deploy-and-verify má OPAKOVANI=0, úloha = jeden pokus). Opakování přechodného
 * pádu (závod s vydáním v npm, síť registru) se proto vrací jako POKRAČOVACÍ
 * úloha — vzor Stacky po vlnách, jedno pravidlo pro všechny deploy joby:
 *
 *   1. Razítko běhu bere JEDINÁ úloha deploy-razitko, DŘÍV než cokoli nasadí
 *      Kořen/Core/Edge/Extranet (output utnuté úlohy není jistý). Otevře taky
 *      kontext deploy-verdikt = pending.
 *   2. `<úloha>-pokracovani` běží jen po failure/cancelled své úlohy a naváže
 *      `--navazat-od <razítko>`: běžící dočká, hotové ověří, spadlé nasadí
 *      PRÁVĚ JEDNOU znovu, cizí revize = pád. Samo už nepokračuje.
 *   3. Navazující úlohy přijmou úlohu NEBO její pokračování (jinak by úspěšné
 *      pokračování nic neodblokovalo).
 *   4. deploy-verdikt čte celé nasazení — každá úloha má ověření z tohoto běhu,
 *      vlastní nebo pokračováním.
 *
 * Chování navázání měří brána ci-nasazuje-podle-vln a testy nasazeni-navazani.
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { vyhodnotit, type Hodnota } from "./lib/ci-vyraz";

const ROOT = process.cwd();
type Krok = { id?: string; run?: string; env?: Record<string, string> };
type Uloha = { name?: string; "runs-on"?: unknown; "timeout-minutes"?: unknown; needs?: string[] | string; if?: string; outputs?: Record<string, string>; steps?: Krok[] };
const CI_TEXT = readFileSync(join(ROOT, ".forgejo/workflows/ci.yml"), "utf8");
const J = (parse(CI_TEXT) as { jobs: Record<string, Uloha> }).jobs;
const needs = (u: Uloha) => (Array.isArray(u.needs) ? u.needs : u.needs ? [u.needs] : []);
const kdy = (u: Uloha) => String(u.if ?? "").replace(/\s+/g, " ");
const behy = (u: Uloha) => (u.steps ?? []).map((k) => k.run ?? "").join("\n");
const nasazovaciKrok = (u: Uloha) => (u.steps ?? []).find((k) => /bash scripts\/ci\/(deploy-and-verify|nasad-podle-vln)\.sh\b/.test(k.run ?? ""));
const NAVAZANI = ' --navazat-od "$DEPLOY_RAZITKO"';

/** Přímé úlohy: volají deploy-and-verify přímo, nebo jsou vlnami PŘED řetězem stacků (Kořen). */
const PRIME = Object.entries(J)
  .filter(([id, u]) => !id.endsWith("-pokracovani") && !id.startsWith("deploy-stacky-"))
  .filter(([, u]) => {
    const r = behy(u);
    return /^\s*(run:\s*)?bash scripts\/ci\/deploy-and-verify\.sh [a-z]/m.test(r) || /nasad-podle-vln\.sh[^\n]*--vlny 0-/.test(r);
  })
  .map(([id]) => id)
  .sort();

describe("každá přímá nasazovací úloha má právě jedno pokračování", () => {
  it("univerzum: přímé úlohy jsou Kořen, Core, Edge, Extranet", () => {
    expect(PRIME).toEqual(["deploy-core", "deploy-edge", "deploy-extranet", "deploy-koren"]);
  });

  it("razítko běhu bere JEDINÁ úloha deploy-razitko — před přímými úlohami, po testech", () => {
    const R = J["deploy-razitko"];
    expect(R, "deploy-razitko chybí").toBeTruthy();
    expect(R.outputs?.razitko).toBe("${{ steps.razitko.outputs.razitko }}");
    expect(behy(R), "razítko otevírá kontext deploy-verdikt jako pending").toContain('"state":"pending","context":"deploy-verdikt"');
    for (const t of ["test-web", "test-web-brany", "build-web"]) expect(needs(R), `razítko (= začátek nasazení) až po ${t}`).toContain(t);
    for (const id of PRIME) {
      expect(needs(J[id]), `${id} nečeká na razítko`).toContain("deploy-razitko");
      expect(kdy(J[id]), `${id} se spustí i bez razítka`).toContain("needs.deploy-razitko.result == 'success'");
    }
    const razitka = Object.entries(J).filter(([, u]) => (u.steps ?? []).some((k) => k.id === "razitko")).map(([id]) => id);
    expect(razitka, "v běhu je víc razítek").toEqual(["deploy-razitko"]);
  });

  it.each(PRIME)("%s: pokračování existuje, spouští se jen po pádu a navazuje na TENTÝŽ cíl", (id) => {
    const P = J[`${id}-pokracovani`];
    expect(P, `${id}-pokracovani chybí — po pádu by se přechodná chyba už nezopakovala`).toBeTruthy();
    expect(needs(P)).toEqual(expect.arrayContaining(["deploy-razitko", id]));
    const k = kdy(P);
    expect(k, "pokračování musí rozhodnout i po pádu své úlohy").toMatch(/^always\(\)/);
    for (const c of ["github.event_name == 'push'", "github.ref == 'refs/heads/main'", "needs.deploy-razitko.result == 'success'", `needs.${id}.result == 'failure'`, `needs.${id}.result == 'cancelled'`]) {
      expect(k, `pokračování ${id}: chybí ${c}`).toContain(c);
    }
    const o = nasazovaciKrok(J[id])!;
    const p = nasazovaciKrok(P)!;
    expect(p.run, `${id}-pokracovani nenavazuje (--navazat-od z razítka)`).toContain(NAVAZANI);
    expect(p.env?.DEPLOY_RAZITKO).toBe("${{ needs.deploy-razitko.outputs.razitko }}");
    expect(p.run?.replace(NAVAZANI, ""), "pokračování nasazuje JINÝ cíl než jeho úloha").toBe(o.run);
    expect(o.run, `${id} sama navazuje — tím by pokračování nebylo jediné`).not.toContain("--navazat-od");
    expect(P["runs-on"], "pokračování na jiné dráze než úloha").toEqual(J[id]["runs-on"]);
    expect(P["timeout-minutes"], "pokračování s jiným stropem než úloha").toEqual(J[id]["timeout-minutes"]);
  });

  it("⛔ pokračování samo nepokračuje (žádný řetěz opakování)", () => {
    const retez = Object.entries(J)
      .filter(([, u]) => /needs\.[a-z0-9-]+-pokracovani\.result == '(failure|cancelled)'/.test(kdy(u)))
      .map(([id]) => id);
    expect(retez).toEqual([]);
    expect(Object.keys(J).filter((id) => id.endsWith("-pokracovani-pokracovani"))).toEqual([]);
  });
});

describe("navazující úlohy a verdikt přijmou úlohu NEBO její pokračování", () => {
  it("Core, Edge, Extranet stojí na Kořeni nebo jeho pokračování", () => {
    for (const id of ["deploy-core", "deploy-edge", "deploy-extranet"]) {
      expect(needs(J[id])).toContain("deploy-koren-pokracovani");
      expect(kdy(J[id])).toContain("(needs.deploy-koren.result == 'success' || needs.deploy-koren-pokracovani.result == 'success')");
      expect(kdy(J[id]), `${id}: stará podmínka by úspěšné pokračování Kořene ignorovala`).not.toContain("needs.deploy-koren.result != 'failure'");
    }
  });

  it("stacky (deploy-zacatek) přijmou každou přímou úlohu nebo její pokračování", () => {
    const Z = J["deploy-zacatek"];
    expect(kdy(Z)).toContain("needs.deploy-razitko.result == 'success'");
    expect(kdy(Z)).toContain("(needs.deploy-koren.result == 'success' || needs.deploy-koren-pokracovani.result == 'success')");
    for (const a of ["core", "edge", "extranet"]) {
      expect(needs(Z)).toContain(`deploy-${a}-pokracovani`);
      expect(kdy(Z)).toContain(`(needs.deploy-${a}.result == 'success' || needs.deploy-${a}.result == 'skipped' || needs.deploy-${a}-pokracovani.result == 'success')`);
      expect(kdy(Z)).not.toContain(`needs.deploy-${a}.result != 'failure'`);
    }
  });

  it("⛔ deploy-verdikt čte CELÉ nasazení: každou přímou úlohu i její pokračování", () => {
    const V = J["deploy-verdikt"];
    expect(kdy(V)).toMatch(/^always\(\)/);
    expect(kdy(V)).toContain("needs.deploy-razitko.result == 'success'");
    const krok = (V.steps ?? []).find((k) => /deploy-verdikt/.test(k.run ?? ""))!;
    const env = Object.values(krok.env ?? {});
    for (const id of PRIME) {
      for (const u of [id, `${id}-pokracovani`]) {
        expect(needs(V), `verdikt nečeká na ${u}`).toContain(u);
        expect(env, `verdikt nečte výsledek ${u}`).toContain(`\${{ needs.${u}.result }}`);
      }
    }
    expect(krok.run, "verdikt musí vyslovit neověřenou úlohu").toContain("NEOVĚŘENO (úloha:");
  });
});

describe("⛔ pending vzniká JEN tam, kde se nasazuje — a vždy se uzavře", () => {
  // Pravidlo slučování („do mainu až po terminálním deploy-verdikt“) by se zaseklo
  // navždy, kdyby na commitu, který nic nenasazuje (docs-only, jen testy), visel
  // pending (2026-10-02). Měří se SKUTEČNÉ podmínky úloh vyhodnocovačem.
  const svet = (deployApps: string, vysledky: Record<string, string> = {}): Record<string, Hodnota> => {
    const s: Record<string, Hodnota> = {
      "github.event_name": "push",
      "github.ref": "refs/heads/main",
      "needs.detect.outputs.deploy_apps": deployApps,
    };
    for (const m of CI_TEXT.matchAll(/needs\.detect\.outputs\.([A-Za-z0-9_]+)/g)) {
      if (m[1] !== "deploy_apps") s[`needs.detect.outputs.${m[1]}`] = "false";
    }
    for (const id of Object.keys(J)) s[`needs.${id}.result`] = "success";
    return Object.assign(s, vysledky);
  };

  it("pending publikuje JEN deploy-razitko", () => {
    const pending = Object.entries(J)
      .filter(([, u]) => behy(u).includes('"state":"pending","context":"deploy-verdikt"'))
      .map(([id]) => id);
    expect(pending).toEqual(["deploy-razitko"]);
  });

  it("commit, který nic nenasazuje (deploy_apps ',,'), pending NEOTEVŘE — ani při zelených testech", () => {
    expect(vyhodnotit(kdy(J["deploy-razitko"]), svet(",,"))).toBe(false);
  });

  it("commit, který nasazuje, pending otevře (kontrolní vzorek — jinak by test výš byl vakuový)", () => {
    expect(vyhodnotit(kdy(J["deploy-razitko"]), svet(",core,"))).toBe(true);
  });

  it("⛔ otevřený pending se VŽDY uzavře: verdikt běží při jakémkoli výsledku ostatních úloh", () => {
    const ostatni = needs(J["deploy-verdikt"]).filter((n) => n !== "deploy-razitko");
    for (const r of ["success", "failure", "cancelled", "skipped"]) {
      const s = svet(",core,", Object.fromEntries(ostatni.map((n) => [`needs.${n}.result`, r])));
      expect(vyhodnotit(kdy(J["deploy-verdikt"]), s), `verdikt se nespustí, když ostatní úlohy jsou ${r} — pending by visel`).toBe(true);
    }
    // Bez razítka (nic se nenasazuje) verdikt neběží a nic nepublikuje.
    expect(vyhodnotit(kdy(J["deploy-verdikt"]), svet(",,", { "needs.deploy-razitko.result": "skipped" }))).toBe(false);
  });
});
