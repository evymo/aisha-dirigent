/**
 * Brána: workspace, jehož `dist` Dockerfile KOPÍRUJE, musí být v témž souboru
 * i PŘELOŽEN.
 *
 * ⛔ NAMĚŘENO V PROD 2026-09-07: `Dockerfile.svc-source-broker` přidal
 * `npm ci --workspace=@aisha/plugin-<fork>-source` (nainstaluje) a
 * `COPY --from=build /app/plugins/<fork>-source/dist` (kopíruje), ale do řetězu
 * `npm run build --workspace=…` plugin nikdo nedal. `dist` tedy nikdy nevznikl
 * a COPY neexistujícího adresáře shodil build CELÉHO obrazu — ne jen pluginu.
 *
 * ⭐ VZOREC: INSTALACE NENÍ PŘEKLAD. `--workspace` v `npm ci` říká „stáhni jeho
 * závislosti", ne „přelož ho"; TypeScript workspace bez vlastního `npm run build`
 * zůstane bez `dist`. Půl kroku, který vypadá hotově, dokud si na jeho výsledek
 * někdo nesáhne.
 *
 * ⛔ A KOŘEN, který je cennější než sama vada: autor si `dist/` vyrobil RUČNĚ,
 * když plugin lokálně testoval (`npm install && npm run build` v jeho adresáři).
 * Adresář na disku existoval celou dobu, co psal Dockerfile — takže neměl jak
 * poznat, že v obrazu nevznikne. STAV DISKU NENÍ STAV BUILDU; co obraz potřebuje,
 * musí být v obrazu deklarované.
 *
 * Měří se staticky, bez jediného `docker build`: dvojice (co se kopíruje) ×
 * (co se překládá) v témž souboru, jméno workspace se bere z jeho package.json.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../../..");

/** Dockerfily podle gitu — ne podle procházení stromu (node_modules, artefakty). */
function dockerfiles(): string[] {
  return execFileSync("git", ["ls-files", "Dockerfile*", "**/Dockerfile*"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
}

/** Komentáře pryč PŘED měřením — jinak brána čte prózu jako kód. */
function bezKomentaru(text: string): string {
  return text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
}

/** Jméno balíku z package.json dané cesty; null, když tam žádný není. */
function jmenoWorkspace(cesta: string): string | null {
  const p = path.join(ROOT, cesta, "package.json");
  if (!fs.existsSync(p)) return null;
  try {
    return (JSON.parse(fs.readFileSync(p, "utf-8")) as { name?: string }).name ?? null;
  } catch {
    return null;
  }
}

describe("workspace, jehož dist se kopíruje, musí být i překládán", () => {
  it("každé `COPY --from=… /app/<cesta>/dist` má v témž Dockerfile svůj `npm run build --workspace=`", () => {
    const problemy: string[] = [];
    for (const df of dockerfiles()) {
      const abs = path.join(ROOT, df);
      if (!fs.existsSync(abs)) continue;
      const text = bezKomentaru(fs.readFileSync(abs, "utf-8"));

      // co se kopíruje: /app/<cesta>/dist
      const kopie = [...text.matchAll(/COPY\s+--from=\S+\s+\/app\/([A-Za-z0-9._\-/]+)\/dist\b/g)].map((m) => m[1]);
      if (kopie.length === 0) continue;
      // ⛔ CO SE PŘEKLÁDÁ — a npm to umí napsat PĚTI způsoby. Naměřeno při psaní
      // téhle brány: `Dockerfile.web-render` staví korektně přes
      // `npm run --workspace @aisha/svc-web-render build` (přepínač PŘED jménem
      // skriptu, mezera místo `=`), a užší detekce ho hlásila jako vadu. Falešný
      // poplach je horší než žádná brána — naučí lidi ji ignorovat.
      const preklad = new Set<string>();
      for (const re of [
        /npm\s+run\s+build\s+(?:--workspace[= ]|-w\s+)(\S+)/g,   // run build --workspace X | -w X
        /npm\s+run\s+(?:--workspace[= ]|-w\s+)(\S+)\s+build/g,    // run --workspace X build
      ]) {
        for (const m of text.matchAll(re)) preklad.add(m[1].replace(/["']/g, ""));
      }

      for (const cesta of new Set(kopie)) {
        const jmeno = jmenoWorkspace(cesta);
        if (!jmeno) continue;                       // není workspace → dist vzniká jinak
        if (preklad.has(jmeno) || preklad.has(cesta)) continue;
        problemy.push(
          `${df}: kopíruje /app/${cesta}/dist, ale nikde nemá ` +
            `\`npm run build --workspace=${jmeno}\` — dist v obrazu nevznikne a COPY shodí CELÝ build`,
        );
      }
    }
    expect(
      problemy,
      `INSTALACE NENÍ PŘEKLAD:\n${problemy.join("\n")}\n` +
        `Přidej překlad do build řetězu téhož Dockerfile. Pozor: adresář dist na tvém disku ` +
        `nic nedokazuje — mohl vzniknout ručním během, obraz ho staví od nuly.`,
    ).toEqual([]);
  });

  it("měřidlo má co měřit — aspoň jeden Dockerfile kopíruje dist z workspace", () => {
    const nalezeno = dockerfiles().some((df) => {
      const abs = path.join(ROOT, df);
      if (!fs.existsSync(abs)) return false;
      const kopie = [...bezKomentaru(fs.readFileSync(abs, "utf-8"))
        .matchAll(/COPY\s+--from=\S+\s+\/app\/([A-Za-z0-9._\-/]+)\/dist\b/g)].map((m) => m[1]);
      return kopie.some((c) => jmenoWorkspace(c) !== null);
    });
    expect(nalezeno, "žádný Dockerfile nekopíruje dist workspace — brána by mlčela i nad vadou").toBe(true);
  });
});
