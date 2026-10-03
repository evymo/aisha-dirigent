/**
 * Každý pruh brokeru má VOLAJÍCÍHO (CLASS gate)
 *
 * TŘÍDA VADY: kód, který je napsaný, otestovaný a zmergovaný, ale v produkci
 * ho nikdo nesestrojí. Zvenčí to vypadá jako mrtvý zdroj dat, ne jako chybějící
 * volání — a proto se to hledá dny.
 *
 * NAMĚŘENO 2026-08-31: `feedDocumentsToIngest` („poslední chybějící článek",
 * s vlastními testy) měl JEDINÝ import — svůj vlastní test. `IngestClient`
 * nebyl nikdy sestrojen, protože `config.ts` neznal ani adresu ingestu.
 * Důsledek: vstupní cesta ingestu neměla ŽÁDNÉHO zapisovatele (`documents: 0`),
 * engine běžel nad statickým korpusem a od 30. 8. nepřibyl jediný doklad.
 * Táž třída jako [[meridla-jsou-napsana-ale-nikdo-je-nespousti]] (59 z 245
 * skriptů bez volajícího).
 *
 * INVARIANT: každý exportovaný `create*Lane` / `create*Driver` v `clients/`
 * je někde MIMO testy importován. Univerzum se HLEDÁ (grep exportů), nepíše
 * rukou — seznam psaný rukou by zdědil právě tu díru, kterou brána hlídá.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CLIENTS = join(ROOT, "services/svc-source-broker/src/clients");
const SRC = join(ROOT, "services/svc-source-broker/src");

/** Továrny pruhů — co má běžet, ne co jen existuje. */
function tovarny(): Array<{ soubor: string; jmeno: string }> {
  const out: Array<{ soubor: string; jmeno: string }> = [];
  for (const f of readdirSync(CLIENTS)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const text = readFileSync(join(CLIENTS, f), "utf-8");
    for (const m of text.matchAll(/export function (create[A-Za-z0-9_]*(?:Lane|Driver))\s*\(/g)) {
      out.push({ soubor: f, jmeno: m[1] });
    }
  }
  return out;
}

/** Všechny .ts pod src/ mimo testy — kde se hledá volající. */
function zdrojoveSoubory(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      out.push(...zdrojoveSoubory(p));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

describe("každý pruh brokeru má volajícího", () => {
  const t = tovarny();
  const soubory = zdrojoveSoubory(SRC);

  test("univerzum není prázdné — jinak brána nic neměří", () => {
    expect(t.length).toBeGreaterThan(0);
  });

  test("žádná továrna pruhu není volaná JEN z testu", () => {
    const sirotci: string[] = [];
    for (const { soubor, jmeno } of t) {
      const volajici = soubory.filter((p) => {
        if (p.endsWith(join("clients", soubor))) return false; // vlastní definice
        return new RegExp(`\\b${jmeno}\\s*\\(`).test(readFileSync(p, "utf-8"));
      });
      if (volajici.length === 0) sirotci.push(`${soubor}:${jmeno}`);
    }
    expect(sirotci, "pruh bez volajícího vypadá jako mrtvý zdroj dat").toEqual([]);
  });

  test("money-lane sestrojí klienta ingestu — jinak nemá čím psát", () => {
    const lane = readFileSync(join(CLIENTS, "money-lane.ts"), "utf-8");
    expect(lane).toMatch(/new IngestClient\(/);
  });

  test("vstup ingestu je ZAPISOVATELNÝ — bez toho upload vrací 403", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.coolify-local-ingest.yml"), "utf-8");
    expect(compose).toMatch(/^\s+- ingest-input:\/data\/input\s*$/m);
    expect(compose).not.toMatch(/ingest-input:\/data\/input:ro/);
  });
});
