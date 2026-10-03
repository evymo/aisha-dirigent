/**
 * Statické `t()` nesmí číst klíč, který se dodává PRÁZDNÝ.
 *
 * ⛔ EXISTENCE NENÍ OBSAH (naměřeno 2026-09-01 na živém webu instance).
 *
 * Stránka 404 ukazovala na produkci doslova tři znaky — „404" — a pod tím
 * prázdný odstavec a tlačítko BEZ POPISKU. Přitom `i18nKeysExist` byl zelený:
 * klíče `web.notfound.text` i `web.notfound.back` EXISTUJÍ ve všech šesti
 * slovnících. Jsou jen prázdné.
 *
 * Není to nedopatření. `web.*` (80 % prázdných) a `research.*` (99 %) jsou
 * jmenné prostory INSTANČNÍHO obsahu — text do nich dodává instance z databáze
 * přes `useDynamicTranslationsMap`. Všechny ostatní jmenné prostory se dodávají
 * vyplněné (0 % prázdných). Komponenta, která si takový klíč přečte statickým
 * `t()`, tedy nedostane nic NIKDY, na žádné instanci.
 *
 * Kontrola je RÁČNA, ne přepis: 442 takových volání ve 28 souborech je stav,
 * který tahle změna needituje. Většina jsou platformní stránky, které si
 * instance stejně nahrazuje stránkou z plátna, takže „oprava" by znamenala
 * hádat cizí obsah. Zakazuje se RŮST — a u stránek, které návštěvník uvidí bez
 * ohledu na obsah instance (chybové), se drží tvrdá nula.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const KOREN = process.cwd();
const SEGMENTY = path.join(KOREN, "src/i18n/segments/en");
const PROHLEDAT = ["src/pages", "src/components"];

/**
 * Stránky, které se vykreslí na KAŽDÉ instanci bez ohledu na to, co má
 * v databázi — a nemá je čím nahradit stránka z plátna. Tady prázdný klíč
 * znamená prázdnou stránku, takže se netoleruje ani jeden.
 */
const CHROME_S_TVRDOU_NULOU = ["src/pages/NotFound.tsx", "src/pages/Forbidden.tsx"];

/** Naměřeno 2026-09-01 během tohoto testu. Kdo číslo zvyšuje, ať doloží proč. */
const RACNA_VOLANI = 442;

function plochy(o: unknown, p = "", out: Record<string, unknown> = {}) {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      plochy(v, p ? `${p}.${k}` : k, out);
    }
  } else {
    out[p] = o;
  }
  return out;
}

function slovnik(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fs.readdirSync(SEGMENTY)) {
    if (!f.endsWith(".json")) continue;
    Object.assign(out, plochy(JSON.parse(fs.readFileSync(path.join(SEGMENTY, f), "utf-8"))));
  }
  return out;
}

function zdrojove(dir: string, out: string[] = []): string[] {
  const abs = path.join(KOREN, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "tests" || e.name === "__tests__") continue;
      zdrojove(rel, out);
    } else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) {
      if (!e.name.includes(".test.")) out.push(rel);
    }
  }
  return out;
}

// Jen doslovné `t("…")`. Klíč složený z proměnné se staticky nedá rozhodnout
// a hádat se nebude — radši méně nálezů než nález vymyšlený.
const VOLANI = /\bt\(\s*"([a-zA-Z0-9_.]+)"/g;

function nalezy() {
  const dict = slovnik();
  const prazdne = new Set(
    Object.entries(dict)
      .filter(([, v]) => typeof v === "string" && !(v as string).trim())
      .map(([k]) => k),
  );

  const out: { soubor: string; radek: number; klic: string }[] = [];
  for (const dir of PROHLEDAT) {
    for (const rel of zdrojove(dir)) {
      const radky = fs.readFileSync(path.join(KOREN, rel), "utf-8").split("\n");
      radky.forEach((radek, i) => {
        for (const m of radek.matchAll(VOLANI)) {
          if (prazdne.has(m[1])) out.push({ soubor: rel, radek: i + 1, klic: m[1] });
        }
      });
    }
  }
  return out;
}

describe("i18n — statické t() na prázdný klíč", () => {
  it("chybové stránky nemají ANI JEDEN prázdný klíč", () => {
    const spatne = nalezy().filter((n) => CHROME_S_TVRDOU_NULOU.includes(n.soubor));
    expect(
      spatne,
      spatne.length
        ? `Chybová stránka čte klíč, který se dodává prázdný — návštěvník uvidí prázdno:\n` +
            spatne.map((n) => `  ${n.soubor}:${n.radek}  ${n.klic}`).join("\n") +
            `\nPoužij klíč z vyplněného jmenného prostoru (např. core: notFound.*).`
        : "",
    ).toEqual([]);
  });

  it("počet takových volání NEROSTE (ráčna)", () => {
    const vse = nalezy();
    const podleSouboru = new Map<string, number>();
    for (const n of vse) podleSouboru.set(n.soubor, (podleSouboru.get(n.soubor) ?? 0) + 1);

    expect(
      vse.length,
      vse.length > RACNA_VOLANI
        ? `Přibylo ${vse.length - RACNA_VOLANI} volání t() na klíč, který se dodává prázdný.\n` +
            [...podleSouboru.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([f, n]) => `  ${n.toString().padStart(4)}  ${f}`)
              .join("\n") +
            `\nBuď klíč vyplň v src/i18n/segments/*/, nebo ho čti přes useDynamicTranslationsMap.`
        : "",
    ).toBeLessThanOrEqual(RACNA_VOLANI);
  });

  it("ráčna sedí na skutečnost (jinak měří něco jiného)", () => {
    // Kanárek proti shnilé kontrole: kdyby regex přestal chytat, spadlo by to
    // na nulu a oba testy výš by mlčky procházely. Dolní mez to odhalí.
    expect(nalezy().length).toBeGreaterThan(RACNA_VOLANI / 2);
  });
});
