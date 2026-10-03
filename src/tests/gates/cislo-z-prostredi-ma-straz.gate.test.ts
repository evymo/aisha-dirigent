/**
 * Číslo z prostředí má stráž na prázdnou hodnotu.
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA (2026-09-10). `?? default` hlídá jen `undefined`,
 * ne PRÁZDNÝ ŘETĚZEC — a klíč deklarovaný s prázdnou hodnotou je v `.env` běžný
 * stav (Coolify je tak zapisuje). Výchozí hodnota se pak nikdy nepoužije.
 * Naměřeno na `SPA_OTP_SKEW` (okno OTP = jediný krok, vrátný mlčí), pak
 * `WS_MAX_TOPICS` (nula témat) a `SOURCE_SYNC_INTERVAL_MS` (nulový interval).
 * Oprava dorazila do `svc-money`, do `svc-knock` ne — a nic to nehlídalo.
 *
 * ⭐ UNIVERZUM SE ODVOZUJE: každý `services/<x>/src/config.ts` sledovaný gitem.
 * Konvence domu je, že čtení `process.env` žije v `config.ts` (viz hlavička
 * `services/ws-gateway/src/config.ts`); tam se měří. `|| default` je bezpečný
 * (prázdno je falsy) a brána ho nechává být.
 *
 * ── 2026-09-22: BRÁNA MĚŘÍ CELOU TŘÍDU, NE JEDEN ZÁPIS ───────────────────────
 * Do dneška hlídala jen `Number(process.env.X ?? …)`. Táž vada napsaná jako
 * `parseInt(…)` procházela — a NAMĚŘENO ve `storage-auth`: `Number(…)` byl
 * odmítnut, přitom o šest řádků výš stálo `parseInt(process.env.X ?? '50', 10)`
 * se stejnou vadou. Brána, která z jedné třídy vidí jeden tvar, dává falešné
 * bezpečí: autor si opraví, co mu ukázala, a zbytek nechá být.
 *
 * ⚠️ TY TVARY NEJSOU STEJNĚ HLASITÉ a brána to nesmí zastírat:
 *   `Number('')`     → 0    — TICHÉ vždycky
 *   `parseInt('')`   → NaN  — hlasité u portu (spojení se nenaváže), ale
 *                             `setTimeout(fn, NaN)` je tichých 0 ms a
 *                             `NaN` jako strop znamená „limit vypnutý"
 * Proto se `Number/parseFloat/+` zakazují TVRDĚ (dnes 0 výskytů), zatímco
 * `parseInt` má ROHATKU: 55 míst ve 21 službách je dluh, který se přiznává
 * jmenovitě a smí jen ubývat. Plošný zákaz by bránu nechal na mainu červenou a
 * shodil první cizí PR — a rohatku předepisuje už poznámka z 2026-09-10.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const KOREN = join(__dirname, "..", "..", "..");

/** Tvary, u kterých je prázdná hodnota TICHÁ nula — žádný dluh se netoleruje. */
const TVRDE: Array<{ jmeno: string; vzor: RegExp }> = [
  { jmeno: "Number(process.env.X ?? …)", vzor: /\bNumber\(\s*process\.env\.([A-Z0-9_]+)\s*\?\?/g },
  { jmeno: "parseFloat(process.env.X ?? …)", vzor: /\bparseFloat\(\s*process\.env\.([A-Z0-9_]+)\s*\?\?/g },
  // Unární `+` před `process.env` — `+('')` je 0, stejně tiché jako Number().
  { jmeno: "+process.env.X ?? …", vzor: /(?<![\w.$)\]])\+\s*\(?\s*process\.env\.([A-Z0-9_]+)\s*\?\?/g },
];
/** Tvar s přiznaným dluhem (rohatka). */
const ROHATKA = /\bparseInt\(\s*process\.env\.([A-Z0-9_]+)\s*\?\?/g;

interface Baseline {
  soubory: Record<string, string[]>;
}
const baseline = JSON.parse(
  readFileSync(join(__dirname, "cislo-z-prostredi-ma-straz.baseline.json"), "utf8"),
) as Baseline;

function konfigy(): string[] {
  return execFileSync("git", ["ls-files", "services/*/src/config.ts"], { cwd: KOREN, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** Řádky souboru bez těch, které jsou celé komentářem. */
function kodoveRadky(f: string): Array<{ cislo: number; text: string }> {
  return readFileSync(join(KOREN, f), "utf8")
    .split("\n")
    .map((text, i) => ({ cislo: i + 1, text }))
    .filter(({ text }) => {
      const o = text.trim();
      return !(o.startsWith("//") || o.startsWith("*") || o.startsWith("/*"));
    });
}

function klice(f: string, vzor: RegExp): Set<string> {
  const out = new Set<string>();
  for (const { text } of kodoveRadky(f)) {
    for (const m of text.matchAll(new RegExp(vzor.source, "g"))) out.add(m[1]!);
  }
  return out;
}

const RADA = "čti hodnotu přes stráž, která prázdno vrátí jako výchozí — `num(v, d)`, vzor services/svc-knock/src/config.ts";

describe("číslo z prostředí má stráž na prázdnou hodnotu", () => {
  const soubory = konfigy();

  it("měřidlo má co měřit", () => {
    expect(soubory.length, "žádný services/*/src/config.ts — verdikt by nic neznamenal").toBeGreaterThan(0);
  });

  it("kontrolní vzorek: rohatka popisuje soubory, které v repu OPRAVDU jsou", () => {
    // Baseline ukazující na neexistující soubory by tiše povolovala cokoli.
    const chybi = Object.keys(baseline.soubory).filter((f) => !soubory.includes(f));
    expect(chybi, "rohatka jmenuje soubory, které už v repu nejsou — smaž je z baseline").toEqual([]);
  });

  it.each(TVRDE)("⛔ žádné `$jmeno` — prázdná hodnota je TICHÁ nula", ({ vzor }) => {
    const nalezy: string[] = [];
    for (const f of soubory) {
      for (const { cislo, text } of kodoveRadky(f)) {
        for (const m of text.matchAll(new RegExp(vzor.source, "g"))) {
          nalezy.push(`${f}:${cislo}: ${m[0]}`);
        }
      }
    }
    expect(nalezy, RADA).toEqual([]);
  });

  it("⛔ `parseInt(process.env.X ?? …)` nesmí PŘIBÝT — rohatka jen ubývá", () => {
    const pribylo: string[] = [];
    for (const f of soubory) {
      const dovolene = new Set(baseline.soubory[f] ?? []);
      for (const k of klice(f, ROHATKA)) {
        if (!dovolene.has(k)) pribylo.push(`${f}: ${k}`);
      }
    }
    expect(
      pribylo,
      `nový parseInt nad process.env — ${RADA}. Rohatka je seznam DLUHU, ne povolenka.`,
    ).toEqual([]);
  });

  it("⛔ ROHATKA JE OBOUSTRANNÁ: co zmizelo ze zdrojáku, musí zmizet i z baseline", () => {
    // Bez tohohle by brána povolila návrat: klíč opravím, v baseline ho nechám,
    // a za měsíc ho tam někdo vrátí — zeleně.
    const utahni: string[] = [];
    for (const [f, ocekavane] of Object.entries(baseline.soubory)) {
      if (!soubory.includes(f)) continue;
      const skutecne = klice(f, ROHATKA);
      for (const k of ocekavane) if (!skutecne.has(k)) utahni.push(`${f}: ${k}`);
    }
    expect(
      utahni,
      "tyhle klíče už stráž mají (nebo zmizely) — smaž je z cislo-z-prostredi-ma-straz.baseline.json, jinak se smí vrátit",
    ).toEqual([]);
  });
});
