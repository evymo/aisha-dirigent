/**
 * Brána: main visí na JEDNÉ kontrole a ta kontrola vidí na VŠECHNY úlohy PR
 *
 * ⛔ NAMĚŘENO 2026-09-20 v nastavení větve `main`:
 *     enable_status_check   = false   (slití nevisí na žádné kontrole)
 *     status_check_contexts = null
 *     enable_push           = true    (přímý push do mainu je povolený)
 * Držela to jen kázeň těch, kdo PR slévají — a kázeň není záruka.
 *
 * Naivní náprava („zapni povinné testy") je past: většina úloh je podmíněná
 * cestami, takže se u PR bez webu nebo bez DB ZÁMĚRNĚ přeskočí, a přeskočená
 * POVINNÁ kontrola slití zablokuje napořád. Main proto visí na JEDNÉ úloze
 * (`pr-verdikt`), která běží vždy a vezme verdikt za ostatní.
 *
 * CO TAHLE BRÁNA HLÍDÁ — vadu, která by vznikla ticho: kdo přidá novou úlohu
 * a zapomene ji do `needs` verdiktu, vyrobí úlohu, na které slití NEVISÍ.
 * Zelený verdikt by pak znamenal „nevím o ní", ne „prošla". Deklarace, kterou
 * nikdo neplní, je ozdoba — tady by to byla ozdoba na jediné bráně mainu.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const CI = join(ROOT, ".forgejo/workflows/ci.yml");
const VERDIKT = "pr-verdikt";

interface Uloha {
  name?: string;
  if?: string;
  needs?: string | string[];
}

function ulohy(): Record<string, Uloha> {
  const d = parse(readFileSync(CI, "utf-8")) as { jobs?: Record<string, Uloha> };
  const j = d.jobs;
  if (!j || Object.keys(j).length === 0) {
    throw new Error("ci.yml nemá jedinou úlohu — měřidlo se dívá na špatný soubor");
  }
  return j;
}

/** Úloha jen pro push do mainu (nasazení) se PR verdiktu netýká. */
function jenProPush(u: Uloha): boolean {
  const podm = String(u.if ?? "");
  return podm.includes("event_name == 'push'") || podm.includes("refs/heads/main");
}

describe("main visí na jedné kontrole a ta vidí na všechny úlohy PR", () => {
  it("verdiktová úloha vůbec existuje a běží jen nad PR", () => {
    const j = ulohy();
    expect(Object.keys(j), `v ci.yml chybí úloha ${VERDIKT}`).toContain(VERDIKT);
    expect(String(j[VERDIKT].if ?? ""), "verdikt musí běžet nad PR").toContain("pull_request");
  });

  /**
   * ⛔ NAMĚŘENO NA CIZÍM PR 2026-09-21: z 22 úloh se jich podle cest přeskočilo
   * TŘINÁCT. Bez `always()` platí výchozí pravidlo „všechny `needs` musely
   * uspět", takže by se verdikt sám přeskočil skoro vždycky — a přeskočená
   * POVINNÁ kontrola je horší než žádná: buď slití zablokuje napořád, nebo se
   * tiše počítá za úspěch. Obojí vypadá jako záruka a není.
   *
   * Tohle tvrzení je tu proto, že tu vadu NELZE poznat z výsledku: zelený
   * (nebo chybějící) verdikt vypadá stejně, ať se přeskočil, nebo prošel.
   */
  it("verdikt běží i tehdy, když se jeho závislosti přeskočí", () => {
    const j = ulohy();
    expect(
      String(j[VERDIKT].if ?? ""),
      "bez `always()` se agregátor přeskočí spolu s první přeskočenou závislostí — " +
        "a povinná kontrola, která nevznikne, nic nehlídá",
    ).toMatch(/always\(\)/);
  });

  it("každá úloha, která může běžet nad PR, je ve `needs` verdiktu", () => {
    const j = ulohy();
    const needs = new Set(
      Array.isArray(j[VERDIKT].needs) ? (j[VERDIKT].needs as string[]) : [j[VERDIKT].needs as string],
    );
    const chybi = Object.entries(j)
      .filter(([jmeno, u]) => jmeno !== VERDIKT && !jenProPush(u) && !needs.has(jmeno))
      .map(([jmeno]) => jmeno)
      .sort();
    expect(
      chybi,
      `Tyhle úlohy běží nad PR, ale verdikt o nich NEVÍ:\n` +
        chybi.map((c) => `  ${c}`).join("\n") +
        `\nZelený verdikt by u nich znamenal „nevím o ní", ne „prošla" — a main visí ` +
        `právě na tom verdiktu. Doplň je do needs, nebo jim dej podmínku jen pro push.`,
    ).toEqual([]);
  });

  it("univerzum není prázdné — měřidlo vidí i úlohy mimo verdikt", () => {
    // Kdyby filtr vyhodil všechno, druhý test by prošel tím, že se nedívá.
    const j = ulohy();
    const pr = Object.entries(j).filter(([jmeno, u]) => jmeno !== VERDIKT && !jenProPush(u));
    const push = Object.entries(j).filter(([, u]) => jenProPush(u));
    expect(pr.length, "žádná úloha nad PR — filtr měří prázdno").toBeGreaterThan(10);
    expect(push.length, "žádná úloha jen pro push — filtr nerozlišuje").toBeGreaterThan(0);
  });

  it("verdikt se NEROZHODUJE bez vstupu", () => {
    // Prázdný `needs` nesmí znamenat „nic neselhalo" — to je táž vada jako
    // zelená z nezměřeného běhu.
    const j = ulohy();
    const krok = JSON.stringify(j[VERDIKT]);
    expect(krok, "verdikt musí odmítnout prázdný vstup").toMatch(/NEZMĚŘENO|NEZMĚŘENO/);
  });
});
