/**
 * Brána: stacky se nasazují v ŘADĚ ÚLOH po vlnách, žádná nečeká na zabití
 * runnerem, a výsledek nasazení čte JEN deploy-verdikt
 *
 * ⛔ NAMĚŘENO 2026-09-30: jediná úloha „Deploy: Stacky po
 * vlnách (vlny 3+)“ měla `timeout-minutes: 240`, jenže strop runneru je TVRDÁ
 * 1 h a timeout-minutes přebíjí. Runner ji utnul přesně v 60. minutě uprostřed
 * vlny 8 — Coolify nasazení doběhla, ale nikdo je neověřil a běh skončil
 * `cancelled`. Na 10 nasazeních: běžně 4–17 min, vlna 7 se 6–9 appkami sama
 * 35–49 min. Proto:
 *
 *   1. Řetěz úloh deploy-zacatek → vlny 3–6 → vlna 7 → [pokračování] → vlny 8+
 *      → deploy-verdikt. Rozsahy pokrývají vlny 3+ beze mezer a překryvů.
 *   2. Každá vlnová úloha má MĚKKÝ TERMÍN odvozený ze SVÉHO stropu
 *      (STROP_ULOHY_MIN = timeout-minutes) — skončí sama a řekne, co zůstalo.
 *   3. Předává JEN vlna 7 a pokračování je JEDNO: navazuje na nasazení téhož
 *      běhu (razítko z deploy-razitko, převzaté deploy-zacatek) a samo už nepředává.
 *   4. Vlna s předáním končí ZELENĚ, i když ještě není ověřená — výsledek proto
 *      smí číst jen deploy-verdikt. Kdo čte jednotlivé vlnové úlohy, čte
 *      polovičatou pravdu (pravidlo slučování: až po terminálním verdiktu).
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const CI = ".forgejo/workflows/ci.yml";
type Krok = { run?: string; env?: Record<string, string> };
type Uloha = { needs?: string[] | string; if?: string; "timeout-minutes"?: unknown; outputs?: Record<string, string>; steps?: Krok[] };
const ulohy = (soubor: string): Record<string, Uloha> =>
  (parse(readFileSync(join(ROOT, soubor), "utf8")) as { jobs?: Record<string, Uloha> }).jobs ?? {};
const J = ulohy(CI);
const needs = (u: Uloha) => (Array.isArray(u.needs) ? u.needs : u.needs ? [u.needs] : []);
const volani = (u: Uloha) => (u.steps ?? []).map((k) => k.run ?? "").find((r) => /nasad-podle-vln\.sh/.test(r)) ?? "";
const krokVln = (u: Uloha) => (u.steps ?? []).find((k) => /nasad-podle-vln\.sh/.test(k.run ?? ""));
const rozsah = (u: Uloha): [number, number] => {
  const m = /--vlny (\d+)-(\d*)/.exec(volani(u));
  if (!m) throw new Error("volání bez --vlny OD-DO");
  return [Number(m[1]), m[2] === "" ? Infinity : Number(m[2])];
};

const VLNOVE = Object.entries(J).filter(([id, u]) => id.startsWith("deploy-stacky-") && volani(u));
const POKRACOVANI = VLNOVE.filter(([, u]) => /--navazat-od/.test(volani(u)));
const ZAKLADNI = VLNOVE.filter(([, u]) => !/--navazat-od/.test(volani(u)));
const RETEZ = new Set(["deploy-zacatek", "deploy-verdikt", ...VLNOVE.map(([id]) => id)]);

describe("stacky po vlnách v řadě úloh", () => {
  it("univerzum: řetěz existuje a dřívější jediná úloha zmizela", () => {
    expect(J["deploy-zacatek"], "deploy-zacatek chybí").toBeTruthy();
    expect(J["deploy-verdikt"], "deploy-verdikt chybí").toBeTruthy();
    expect(ZAKLADNI.length, "vlnových úloh je podezřele málo").toBeGreaterThanOrEqual(3);
    expect(J["deploy-stacky"], "stará jediná úloha vlny 3+ se vrátila").toBeUndefined();
  });

  it("rozsahy vlnových úloh pokrývají vlny 3+ beze mezer a překryvů, v pořadí needs", () => {
    const rs = ZAKLADNI.map(([id, u]) => ({ id, r: rozsah(u) })).sort((a, b) => a.r[0] - b.r[0]);
    expect(rs[0].r[0], "první vlnová úloha nezačíná vlnou 3").toBe(3);
    for (let i = 1; i < rs.length; i++) {
      expect(rs[i].r[0], `${rs[i].id} nenavazuje na ${rs[i - 1].id}`).toBe(rs[i - 1].r[1] + 1);
      expect(needs(J[rs[i].id]), `${rs[i].id} musí čekat na ${rs[i - 1].id} — vlny jdou v řadě`).toContain(rs[i - 1].id);
    }
    expect(rs[rs.length - 1].r[1], "poslední úloha musí být otevřená („8-“), jinak nová vlna nemá kam").toBe(Infinity);
  });

  it("každá vlnová úloha zná svůj strop a končí měkkým termínem před ním", () => {
    for (const [id, u] of VLNOVE) {
      const strop = krokVln(u)?.env?.STROP_ULOHY_MIN;
      expect(Number(strop), `${id}: STROP_ULOHY_MIN musí být timeout-minutes úlohy`).toBe(u["timeout-minutes"]);
      expect(volani(u), `${id}: bez měkkého termínu ji runner zabije uprostřed`).toMatch(/--mekky-termin "\$TERMIN"/);
      expect(volani(u), `${id}: termín se počítá ze stropu úlohy`).toMatch(/TERMIN=\$\(\( \$\(date \+%s\) \+ \(STROP_ULOHY_MIN - \d+\) \* 60 \)\)/);
    }
  });

  it("předává JEN vlna 7 a pokračování je právě jedno, na stejný rozsah, bez dalšího předání", () => {
    const predavaji = VLNOVE.filter(([, u]) => /--predat/.test(volani(u))).map(([id]) => id);
    expect(predavaji).toEqual(["deploy-stacky-vlna-7"]);
    expect(POKRACOVANI.map(([id]) => id)).toEqual(["deploy-stacky-vlna-7-pokracovani"]);
    const [, p] = POKRACOVANI[0];
    expect(rozsah(p)).toEqual(rozsah(J["deploy-stacky-vlna-7"]));
    expect(volani(p), "pokračování nesmí předávat dál — řetěz pokračování").not.toMatch(/--predat/);
    expect(volani(p)).toMatch(/--navazat-od "\$DEPLOY_ZACATEK"/);
    expect(krokVln(p)?.env?.DEPLOY_ZACATEK).toBe("${{ needs.deploy-zacatek.outputs.razitko }}");
    expect(J["deploy-stacky-vlna-7"].outputs?.predano, "vlna 7 musí vystavit predano").toBe("${{ steps.vlny.outputs.predano }}");
    const kdy = String(p.if ?? "");
    expect(kdy).toContain("needs.deploy-stacky-vlna-7.outputs.predano == 'true'");
    expect(kdy, "pojistka pro tvrdé zabití runnerem").toContain("needs.deploy-stacky-vlna-7.result == 'cancelled'");
    expect(kdy, "přeskočená vlna 7 (spadla vlna před ní) nesmí spustit pokračování").toContain("needs.deploy-stacky-vlna-7.result != 'skipped'");
  });

  it("deploy-verdikt čte celý řetěz a uzavírá stav, který deploy-razitko otevřel", () => {
    const v = J["deploy-verdikt"];
    // Od 2026-10-02 verdikt kryje CELÉ nasazení (i přímé úlohy a jejich pokračování —
    // brána nasazeni-pokracovani-uloh); řetěz stacků v něm musí být celý.
    for (const n of ["deploy-zacatek", ...VLNOVE.map(([id]) => id)]) expect(needs(v), `verdikt nečte ${n}`).toContain(n);
    const kdy = String(v.if ?? "");
    expect(kdy, "verdikt musí rozhodnout i po pádu vlny").toMatch(/^always\(\)/);
    expect(kdy, "verdikt rozhoduje, jakmile nasazení začalo (razítko)").toContain("needs.deploy-razitko.result == 'success'");
    expect(kdy, "verdikt jen na push do mainu").toContain("github.ref == 'refs/heads/main'");
    const telo = (v.steps ?? []).map((k) => k.run ?? "").join("\n");
    expect(telo, "verdikt musí padnout, když vlna nemá ověření").toMatch(/exit 1/);
    expect(JSON.stringify(J["deploy-razitko"]), "razítko běhu otevírá kontext deploy-verdikt jako pending").toContain('\\"state\\":\\"pending\\",\\"context\\":\\"deploy-verdikt\\"');
    expect(telo, "verdikt publikuje kontext deploy-verdikt").toContain('"context":"deploy-verdikt"');
  });

  it("⛔ výsledek vlnových úloh čte jen řetěz a deploy-verdikt — ve VŠECH workflow", () => {
    const spatne: string[] = [];
    const vlnove = VLNOVE.map(([id]) => id);
    for (const f of readdirSync(join(ROOT, ".forgejo/workflows")).filter((x) => /\.ya?ml$/.test(x))) {
      for (const [id, u] of Object.entries(ulohy(`.forgejo/workflows/${f}`))) {
        if (f === "ci.yml" && RETEZ.has(id)) continue;
        const text = JSON.stringify(u);
        for (const v of vlnove) {
          if (needs(u).includes(v) || text.includes(`needs.${v}.`)) spatne.push(`  ${f} › ${id} čte ${v}`);
        }
      }
    }
    expect(spatne, `Výsledek nasazení se čte z deploy-verdikt, ne z vlnové úlohy:\n${spatne.join("\n")}`).toEqual([]);
  });

  it("⛔ stav vlnové úlohy nečte žádný skript ani workflow podle jména (statuses API) — jen kontext deploy-verdikt", () => {
    const jmena = VLNOVE.map(([, u]) => String((u as { name?: string }).name ?? "")).filter(Boolean);
    expect(jmena.length).toBeGreaterThan(0);
    const soubory = [
      ...readdirSync(join(ROOT, ".forgejo/workflows")).map((f) => `.forgejo/workflows/${f}`),
      ...readdirSync(join(ROOT, "scripts/ci")).map((f) => `scripts/ci/${f}`),
      ...readdirSync(join(ROOT, "scripts/lib")).map((f) => `scripts/lib/${f}`),
    ].filter((f) => /\.(ya?ml|sh|mjs|js|ts)$/.test(f));
    const spatne: string[] = [];
    for (const f of soubory) {
      let text = readFileSync(join(ROOT, f), "utf8");
      // V ci.yml smí jméno stát jen jako `name:` vlastní úlohy řetězu — jinde je to čtenář.
      // Řádky se odstraňují CELÉ: jméno pokračování („… vlna 7, pokračování“) obsahuje
      // jméno vlny 7 jako předponu, odečet jednoho výskytu by ho hlásil jako čtenáře.
      if (f === CI) text = text.split("\n").filter((r) => !jmena.some((j) => r.trim() === `name: ${JSON.stringify(j)}`)).join("\n");
      for (const jmeno of jmena) {
        if (text.includes(jmeno)) spatne.push(`  ${f} zmiňuje „${jmeno}“`);
      }
    }
    expect(spatne, `Stav nasazení se čte z kontextu deploy-verdikt:\n${spatne.join("\n")}`).toEqual([]);
  });
});
