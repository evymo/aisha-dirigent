/**
 * ŠABLONA: Gate Test
 *
 * Gate testy jsou statické analyzátory codebase.
 * Spouštějí se přes: npm run test:gates
 *
 * Tento soubor patří do: src/tests/gates/
 * Runner: vitest.gates.config.ts (Node environment, ne jsdom)
 *
 * POSTUP PRO NOVÝ GATE TEST:
 * 1. Zkopíruj tuto šablonu do src/tests/gates/[nazev].gate.test.ts
 * 2. Definuj co kontroluješ (regex, AST, nebo soubor existence)
 * 3. Přidej výjimky do KNOWN_EXCEPTIONS pokud nutné
 * 4. Spusť: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SRC_DIR = path.join(ROOT, "src");

// ============================================================
// VÝJIMKY — soubory nebo vzory které jsou explicitně povoleny
// ============================================================
const KNOWN_EXCEPTIONS = new Set<string>([
  // "src/lib/legacy/oldCode.ts", // TODO: refactorovat
]);

// ============================================================
// HELPER: Skenuj TypeScript soubory
// ============================================================
type ScannedFile = { absPath: string; content: string; rel: string };

function scanTsFiles(
  dir: string,
  filter?: (rel: string) => boolean
): ScannedFile[] {
  const results: ScannedFile[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git", ".next"].includes(entry.name)) continue;
      results.push(...scanTsFiles(full, filter));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      const rel = path.relative(ROOT, full);
      if (filter && !filter(rel)) continue;
      results.push({ absPath: full, content: fs.readFileSync(full, "utf-8"), rel });
    }
  }
  return results;
}

// Produkční soubory (ne testy, ne mocks)
function isProductionFile(rel: string): boolean {
  return (
    !rel.includes("/tests/") &&
    !rel.includes("/__tests__/") &&
    !rel.endsWith(".test.ts") &&
    !rel.endsWith(".test.tsx") &&
    !rel.endsWith(".spec.ts") &&
    !rel.endsWith(".spec.tsx") &&
    !rel.includes("/mocks/") &&
    !rel.includes("vitest") &&
    !rel.includes("playwright")
  );
}

// Pouze komponenty a pages (pro UI pravidla)
function isComponentOrPage(rel: string): boolean {
  return (
    isProductionFile(rel) &&
    (rel.includes("/components/") || rel.includes("/pages/"))
  );
}

// ============================================================
// GATE 1: Vlastní pravidlo — přizpůsob
// ============================================================
describe("[Název] Gate", () => {
  it("[Co kontroluje]", () => {
    const violations: string[] = [];
    const files = scanTsFiles(SRC_DIR, isProductionFile);

    for (const { rel, content } of files) {
      // Skoč výjimky
      if (KNOWN_EXCEPTIONS.has(rel)) continue;

      // Zkontroluj každý řádek
      content.split("\n").forEach((line, lineIndex) => {
        const lineNumber = lineIndex + 1;

        // ← TADY definuj co hledáš
        const violationPattern = /VZOR_KTERÝ_ZAKAZUJEŠ/;
        const isExcludedLine = line.trim().startsWith("//"); // komentáře přeskočíme

        if (violationPattern.test(line) && !isExcludedLine) {
          violations.push(`${rel}:${lineNumber} — [popis porušení]`);
        }
      });
    }

    if (violations.length > 0) {
      console.error(
        `\n❌ [Název] gate violations (${violations.length}):\n${violations.join("\n")}\n` +
        `\nŘešení: [Co udělat pro opravu]`
      );
    }

    expect(violations, `[Název] violations found`).toHaveLength(0);
  });
});

// ============================================================
// GATE 2: Soubor existence check
// ============================================================
describe("File Existence Gate", () => {
  it("every hook file has a corresponding test file", () => {
    const hooksDir = path.join(SRC_DIR, "hooks");
    const testsDir = path.join(SRC_DIR, "tests", "hooks");
    const missing: string[] = [];

    if (!fs.existsSync(hooksDir)) return; // skip if no hooks dir

    for (const file of fs.readdirSync(hooksDir)) {
      if (!file.startsWith("use") || !(file.endsWith(".ts") || file.endsWith(".tsx"))) {
        continue;
      }
      if (file === "index.ts") continue; // barrel export

      const testFileTs = file.replace(/\.tsx?$/, ".test.ts");
      const testFileTsx = file.replace(/\.tsx?$/, ".test.tsx");

      if (
        !fs.existsSync(path.join(testsDir, testFileTs)) &&
        !fs.existsSync(path.join(testsDir, testFileTsx))
      ) {
        missing.push(file);
      }
    }

    if (missing.length > 0) {
      console.error(`\n❌ Hooky bez testů:\n${missing.map(f => `  src/hooks/${f}`).join("\n")}`);
    }

    expect(missing, `Hooky bez testů:\n${missing.join("\n")}`).toHaveLength(0);
  });
});
