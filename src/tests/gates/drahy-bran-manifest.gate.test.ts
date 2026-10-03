/**
 * Brána: manifest drah bran odpovídá stromu — a nové žrouty se měří, ne tuší
 *
 * ⛔ NAMĚŘENO 2026-08-31 (poprvé per-soubor; dosud existoval jen agregát):
 * 630 souborů bran, 333 s CPU, MEDIÁN souboru 20 ms — a devět souborů spolklo
 * 114 s. Sada tedy není „pomalá", je NEROVNOMĚRNÁ. Rozdělení na dráhy dovolí
 * lehké dráze poctivý timeout (30 s místo 300 s), protože v ní žádný takový
 * soubor není.
 *
 * ⭐ PROČ TO NENÍ VIDĚT BEZ MĚŘENÍ: brána, která 60 s čeká na retry, PROCHÁZÍ.
 * Zelená sada nemá jak říct, že platí minutu za nic — náklad je viditelný
 * teprve per-soubor, což se do 2026-08-31 nedělalo.
 *
 * CO SE MĚŘÍ (vlastnost, ne vzorek):
 *   1. každá položka manifestu na disku existuje (mrtvý záznam = fikce)
 *   2. každá nese naměřený čas a důvod (číslo bez měření je odhad)
 *   3. bran s podprocesem mimo heavy nepřibývá (ratchet) — nová se má nejdřív
 *      ZMĚŘIT a vědomě zařadit, ne tiše zdražit lehkou dráhu
 *   4. pod gates/ neleží *.unit.test.ts — runner je NIKDY nespustí (include je
 *      jen *.gate.test.ts), takže by tiše nikdy neběžely
 *
 * HRANICE UNIVERZA: brána netvrdí, že seznam heavy je ÚPLNÝ — trvání není
 * vlastnost souboru, ale vlastnost běhu (týž soubor má v komentářích repa
 * zdokumentovaných 131 s z jednoho zatíženého běhu a 7,0 s z jiného). Tvrdí
 * jen, že seznam je pravdivý a že se nerozšiřuje bez měření.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GATES = path.join(ROOT, "src/tests/gates");
const LANES = JSON.parse(readFileSync(path.join(GATES, "lanes.json"), "utf-8")) as {
  heavy: { soubor: string; s: number; proc: string }[];
  ratchetPodprocesMimoHeavy: { pocet: number };
};

/** Všechny brány ve stromu, včetně podadresářů (remediation/, aitg/, …). */
function vsechnyBrany(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...vsechnyBrany(p));
    else if (e.name.endsWith(".gate.test.ts")) out.push(p);
  }
  return out;
}

describe("dráhy bran: manifest odpovídá stromu", () => {
  it("každá položka heavy na disku existuje", () => {
    const chybi = LANES.heavy
      .map((h) => h.soubor)
      .filter((s) => !vsechnyBrany(GATES).some((p) => path.basename(p) === s));
    expect(chybi, "mrtvý záznam v manifestu tvrdí něco o souboru, který není").toEqual([]);
  });

  it("každá položka heavy nese naměřený čas a důvod", () => {
    const bezMereni = LANES.heavy.filter((h) => !(h.s > 0) || !h.proc?.trim());
    expect(
      bezMereni.map((h) => h.soubor),
      "číslo bez měření je odhad; odhad v manifestu se za rok čte jako fakt",
    ).toEqual([]);
  });

  it("bran s podprocesem mimo heavy nepřibývá (ratchet)", () => {
    const heavy = new Set(LANES.heavy.map((h) => h.soubor));
    const podproces = vsechnyBrany(GATES).filter((p) => {
      if (heavy.has(path.basename(p))) return false;
      // ⛔ VOLÁNÍ, NE ZMÍNKA. Vzor bez závorky se trefí i do souboru, který ta
      // jména jen VYJMENOVÁVÁ — a první verze téhle brány se tak počítala SAMA
      // (naměřeno 2026-08-31: 122 místo 121, protože její vlastní regulární
      // výraz obsahuje `execSync|spawnSync|execFileSync`). Táž třída jako
      // komentář v compose čtený jako direktiva: text popisující kód se použil
      // jako kód. Otevřená závorka odliší volání od výčtu.
      return /\b(execSync|spawnSync|execFileSync)\s*\(/.test(readFileSync(p, "utf-8"));
    });
    expect(
      podproces.length,
      `Bran s podprocesem mimo heavy je ${podproces.length}, ratchet je ` +
        `${LANES.ratchetPodprocesMimoHeavy.pocet}. Nová brána, která spouští ` +
        `podproces, má být nejdřív ZMĚŘENA a vědomě zařazena — jinak tiše ` +
        `zdraží lehkou dráhu, jejíž smysl je být rychlá. Snížit je vždy ` +
        `v pořádku; zvýšit jen s měřením v lanes.json.`,
    ).toBeLessThanOrEqual(LANES.ratchetPodprocesMimoHeavy.pocet);
  });

  it("pod gates/ neleží *.unit.test.ts — runner je nikdy nespustí", () => {
    const osirele: string[] = [];
    const chodit = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) chodit(p);
        else if (e.name.endsWith(".unit.test.ts")) osirele.push(path.relative(ROOT, p));
      }
    };
    chodit(GATES);
    expect(
      osirele,
      "include konfigurace je jen **/*.gate.test.ts — takový soubor by nikdy " +
        "neběžel a nikdo by se to nedozvěděl. Přejmenuj na .gate.test.ts " +
        "(a napřed ho spusť: možná nikdy neběžel a je červený).",
    ).toEqual([]);
  });

  it("dráhy jsou ROZKLAD: light ∪ heavy = vše, light ∩ heavy = ∅", () => {
    // ⛔ BEZ TOHOTO TVRZENÍ MŮŽE SOUBOR TIŠE VYPADNOUT. Lehká dráha se dělá
    // vyloučením heavy; kdyby se jméno v manifestu rozešlo se jménem na disku
    // (překlep, přejmenování), vyloučí se NIC a soubor poběží dvakrát — nebo
    // hůř: kdyby se vzor rozšířil, vyloučí se víc a soubor nepoběží NIKDY,
    // přičemž obě dráhy zůstanou zelené. Zelená by pak znamenala NEMĚŘENO.
    //
    // Naměřeno 2026-08-31: 627 + 9 = 636, průnik ∅.
    const vse = vsechnyBrany(GATES).map((p) => path.basename(p));
    const heavy = LANES.heavy.map((h) => h.soubor);
    const light = vse.filter((f) => !heavy.includes(f));
    expect(light.length + heavy.length, "součet drah musí dát celý strom").toBe(vse.length);
    expect(
      light.filter((f) => heavy.includes(f)),
      "soubor v obou drahách by běžel dvakrát a měřil by se dvakrát",
    ).toEqual([]);
    const nezarazene = vse.filter((f) => !light.includes(f) && !heavy.includes(f));
    expect(nezarazene, "soubor mimo obě dráhy by neběžel NIKDY a nikdo by se to nedozvěděl").toEqual([]);
  });

  it("manifest existuje na očekávaném místě (čtou ho i skripty)", () => {
    expect(existsSync(path.join(GATES, "lanes.json"))).toBe(true);
  });
});
