import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Node globál v kódu, který běží v Hermesu, je vada — a testy ji NEUVIDÍ.
 *
 * ⛔ PROČ EXISTUJE
 * Klepání v release buildu 2026-09-01 spadlo na `Property 'Buffer' doesn't
 * exist`. `Buffer` je globál Nodu: v jestu i ve vitestu EXISTUJE, v release
 * bundlu Hermesu NE. Vada proto prošla VŠEMI branami i všemi testy a projevila
 * se až na telefonu člověka — u dveří, tedy na jediné cestě dovnitř.
 *
 * ⭐ MĚŘÍ SE DOSTUPNOST, NE JMÉNO. Použít `Buffer` je v pořádku, když si ho
 * soubor NAIMPORTUJE (`@craftzdog/react-native-buffer`). Zakázané je spolehnout
 * se na to, že „nějaký prostě bude" — to je domněnka, ne závislost.
 *
 * ⚠️ Brána NEŘÍKÁ, který Buffer je správný. U čistého jádra (`lib/trezor.ts`)
 * je správná odpověď ŽÁDNÝ — nativní modul se tam importovat nesmí a base64 se
 * napíše ručně. U adaptéru (`lib/knock-native.ts`) je správná odpověď import.
 */
const ROOT = join(__dirname, "../../..");
const SRC = join(ROOT, "mobile-app/src");

/** Globály Nodu, které Hermes NEMÁ. `process` má Expo shim, proto tu není. */
const ZAKAZANE = ["Buffer"] as const;

function souboryKodu(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "__tests__" || e === "node_modules") continue;
      souboryKodu(p, out);
    } else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) {
      out.push(p);
    }
  }
  return out;
}

/** Komentáře pryč — zmínka v komentáři není použití. */
function bezKomentaru(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("mobilní kód nesmí spoléhat na globály Nodu", () => {
  it("každé použití Bufferu má v témže souboru import", () => {
    const hrisnici: string[] = [];

    for (const soubor of souboryKodu(SRC)) {
      const kod = bezKomentaru(readFileSync(soubor, "utf8"));
      for (const jmeno of ZAKAZANE) {
        // Použití = `Buffer` NEpředcházené písmenem (tedy ne `RNBuffer`).
        const pouzito = new RegExp(`(^|[^A-Za-z0-9_$])${jmeno}\\s*[.(\\[]`).test(kod);
        if (!pouzito) continue;
        const naimportovano = new RegExp(
          `import[^;]*\\b${jmeno}\\b[^;]*from`,
        ).test(kod);
        if (!naimportovano) {
          hrisnici.push(`${soubor.slice(ROOT.length + 1)} — ${jmeno} bez importu`);
        }
      }
    }

    expect(
      hrisnici,
      `Tyhle soubory spoléhají na globál, který Hermes nemá — v testech projdou,\n` +
        `na telefonu spadnou:\n  ${hrisnici.join("\n  ")}\n\n` +
        `Buď si ho naimportuj (adaptér), nebo se bez něj obejdi (čisté jádro).`,
    ).toEqual([]);
  });
});
