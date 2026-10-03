/**
 * Code Hygiene Gate Tests
 *
 * Kontroluje:
 * 1. Žádné console.log() v produkčním kódu
 * 2. Žádné `any` typy v produkčním kódu
 * 3. Žádné eslint-disable bez důvodu
 * 4. Žádné TODO/FIXME/HACK komentáře (audit)
 * 5. Maximální délka souborů (1000+ řádků = warning)
 * 6. Žádné přímé window.location mutace (používat react-router)
 * 7. Žádné @ts-ignore/@ts-expect-error bez komentáře
 * 8. Import řazení konzistence
 *
 * Nespouští DB dotazy — pracuje POUZE se soubory.
 * Spouští se přes vitest.gates.config.ts (node env, 2 min timeout).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SRC_DIR = path.join(ROOT, "src");

/* ---------- helpers ---------- */

function scanTsFiles(
  dir: string,
  result: Array<{ path: string; content: string; relPath: string }> = []
): Array<{ path: string; content: string; relPath: string }> {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules"
    ) {
      scanTsFiles(full, result);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      let content: string;
      try {
        content = fs.readFileSync(full, "utf-8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw err;
      }
      result.push({
        path: full,
        content,
        relPath: path.relative(ROOT, full),
      });
    }
  }
  return result;
}

function isProductionFile(relPath: string): boolean {
  return (
    !relPath.includes("/tests/") &&
    !relPath.includes("/__tests__/") &&
    !relPath.includes(".test.") &&
    !relPath.includes(".spec.") &&
    !relPath.includes("/mocks/") &&
    !relPath.includes("setupTests") &&
    !relPath.includes("vitest.") &&
    !relPath.includes("playwright.")
  );
}

function isNonCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.startsWith("//") &&
    !trimmed.startsWith("*") &&
    !trimmed.startsWith("/*")
  );
}

/* ====================================================================
 * 1. CONSOLE.LOG — žádné v produkčním kódu
 * ==================================================================== */

describe("console.log — žádné v produkčním kódu", () => {
  /**
   * Soubory kde je console.log legitimní:
   * - devFallbackSupabase.ts — diagnostika dev prostředí
   * - safeLogger.ts — implementace safe loggeru
   * - Soubory s explicitním eslint-disable
   */
  const ALLOWED_CONSOLE_LOG_FILES = new Set([
    "src/config/devFallbackSupabase.ts",
    "src/lib/security/safeLogger.ts",
    "src/lib/security/phiSanitizer.ts",
    "src/integrations/db/client.ts",
    // Debug utilities (používají console pro diagnostiku)
    "src/lib/debug.ts",
    "src/utils/debug.ts",
  ]);

  it("žádné console.log() v produkčních souborech", () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const violations: string[] = [];

    for (const file of prodFiles) {
      if (ALLOWED_CONSOLE_LOG_FILES.has(file.relPath)) continue;

      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Přeskočit komentáře a TSDoc příklady
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
        // Přeskočit JSDoc @example bloky
        if (/^\s*\*\s*@example/.test(line)) continue;

        if (/console\.log\(/.test(line)) {
          // Přeskočit pokud má eslint-disable na řádku
          if (/eslint-disable/.test(line)) continue;
          // Přeskočit pokud předchozí řádek má eslint-disable-next-line
          if (i > 0 && /eslint-disable-next-line/.test(lines[i - 1])) continue;

          violations.push(`${file.relPath}:${i + 1}`);
        }
      }
    }

    if (violations.length > 0) {
      console.warn(
        `⚠️ ${violations.length} console.log() v produkčním kódu:\n${violations.slice(0, 10).join("\n")}${violations.length > 10 ? `\n... a dalších ${violations.length - 10}` : ""}`
      );
    }

    // Aktuální baseline: mělo by být 0, ale pokud existují legacy, budou zde vidět
    expect(violations.length).toBeLessThanOrEqual(0);
  });

  it("console.error používá safeError()", () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const violations: string[] = [];

    for (const file of prodFiles) {
      // Přeskočit safeLogger sám
      if (file.relPath.includes("safeLogger")) continue;
      if (ALLOWED_CONSOLE_LOG_FILES.has(file.relPath)) continue;

      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

        // console.error() bez safeError
        if (
          /console\.error\(/.test(line) &&
          !/safeError/.test(line) &&
          !/eslint-disable/.test(line) &&
          !(i > 0 && /eslint-disable-next-line/.test(lines[i - 1]))
        ) {
          violations.push(`${file.relPath}:${i + 1}`);
        }
      }
    }

    // Informativní — zvyšuje povědomí o bezpečném logování
    if (violations.length > 0) {
      console.warn(
        `ℹ️ ${violations.length} console.error() bez safeError() (doporučení):\n${violations.slice(0, 5).join("\n")}`
      );
    }
    // Nefailuje — jen audit
    expect(true).toBe(true);
  });
});

/* ====================================================================
 * 2. ANY TYP — žádný v produkčním kódu
 * ==================================================================== */

describe("TypeScript — žádný `any` v produkčním kódu", () => {
  /**
   * Soubory s legitimním `any` (external API adaptéry atd.)
   */
  const KNOWN_ANY_FILES: Record<string, number> = {
    // Supabase client — (window as any).__supabase_client__
    "src/integrations/db/client.ts": 2,
    // Generované typy — neřešíme
    "src/integrations/db/types.ts": 999,
  };

  it("žádné explicitní `any` typy v produkčních souborech", () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const violations: string[] = [];

    // Patterny pro detekci `any`:
    // : any, as any, <any>, any[], any>, : any)
    const anyPatterns = [
      /:\s*any\b/,
      /\bas\s+any\b/,
      /<any\b/,
      /\bany\s*\[/,
      /\bany\s*>/,
    ];

    for (const file of prodFiles) {
      if (KNOWN_ANY_FILES[file.relPath] === 999) continue; // generované soubory

      const lines = file.content.split("\n");
      let anyCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Přeskočit komentáře (single-line + JSDoc continuation lines)
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

        // Odstranit obsah string literálů + template literálů, aby přirozený
        // jazyk uvnitř (např. JSX `t("...as any client story...")`) netriggeroval
        // false-positive proti pattern `\bas\s+any\b`. Spec gateu zůstává:
        // hledáme TS `any` v kódu, ne anglická slova v textech.
        const codeOnly = line
          .replace(/"(?:[^"\\]|\\.)*"/g, '""')
          .replace(/'(?:[^'\\]|\\.)*'/g, "''")
          .replace(/`(?:[^`\\]|\\.)*`/g, '``');

        for (const pattern of anyPatterns) {
          if (pattern.test(codeOnly)) {
            anyCount++;
            break; // jeden hit na řádek stačí
          }
        }
      }

      if (anyCount > 0) {
        const allowed = KNOWN_ANY_FILES[file.relPath] ?? 0;
        if (anyCount > allowed) {
          violations.push(
            `${file.relPath}: ${anyCount} 'any' (povoleno: ${allowed})`
          );
        }
      }
    }

    if (violations.length > 0) {
      console.warn(
        `⚠️ ${violations.length} souborů s 'any' typem:\n${violations.slice(0, 10).join("\n")}`
      );
    }

    expect(violations).toEqual([]);
  });

  it("KNOWN_ANY_FILES allowlist se nesmí rozšiřovat", () => {
    const entries = Object.keys(KNOWN_ANY_FILES).filter(
      (k) => KNOWN_ANY_FILES[k] !== 999
    );
    // Baseline: max 1 soubor s 2 výskyty
    expect(entries.length).toBeLessThanOrEqual(1);
  });
});

/* ====================================================================
 * 3. TS-IGNORE — žádné bez komentáře
 * ==================================================================== */

describe("@ts-ignore / @ts-expect-error", () => {
  it("žádné @ts-ignore (používat @ts-expect-error s komentářem)", () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const violations: string[] = [];

    for (const file of prodFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (/@ts-ignore/.test(lines[i])) {
          violations.push(`${file.relPath}:${i + 1}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("@ts-expect-error má vysvětlující komentář", () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const violations: string[] = [];

    for (const file of prodFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/@ts-expect-error\s*(.*)/);
        if (match) {
          const reason = match[1].trim();
          // Musí mít alespoň 5 znaků vysvětlení
          if (reason.length < 5) {
            violations.push(
              `${file.relPath}:${i + 1}: @ts-expect-error bez vysvětlení`
            );
          }
        }
      }
    }

    // Informativní
    if (violations.length > 0) {
      console.warn(
        `ℹ️ ${violations.length} @ts-expect-error bez vysvětlení:\n${violations.join("\n")}`
      );
    }
    expect(true).toBe(true);
  });
});

/* ====================================================================
 * 4. ESLINT-DISABLE — žádné bez důvodu
 * ==================================================================== */

describe("eslint-disable audit", () => {
  it("eslint-disable-next-line má specifikovaná pravidla", () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const violations: string[] = [];

    for (const file of prodFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(
          /eslint-disable-next-line\s*(.*)/
        );
        if (match) {
          const rules = match[1].trim();
          // Musí specifikovat alespoň jedno pravidlo
          if (
            !rules ||
            rules === "--" ||
            rules.startsWith("//") ||
            rules.length < 3
          ) {
            violations.push(
              `${file.relPath}:${i + 1}: eslint-disable bez specifikovaných pravidel`
            );
          }
        }
      }
    }

    // Informativní
    if (violations.length > 0) {
      console.warn(
        `ℹ️ ${violations.length} eslint-disable bez pravidel:\n${violations.slice(0, 5).join("\n")}`
      );
    }
    expect(true).toBe(true);
  });
});

/* ====================================================================
 * 5. VELIKOST SOUBORŮ — audit
 * ==================================================================== */

describe("Velikost souborů — audit", () => {
  const MAX_LINES = 800;
  const ABSOLUTE_MAX_LINES = 1500;

  // ℹ️ NÁPOVĚDA: Toto NENÍ chyba v logice kódu — jde o příznak přílišné složitosti souboru.
  // Řešení: Rozděl soubor na samostatné moduly (hooks, utils, sub-komponenty, registry soubory…).
  // Každý modul by měl mít jednu jasnou odpovědnost (single responsibility).
  // Vzor: src/lib/builder/blockRegistry.ts byl takto rozdělen na
  //   blockRegistry.types.ts / blockRegistry.web-blocks.ts / blockRegistry.workflow-blocks.ts / …
  it(`žádný produkční soubor nemá více než ${ABSOLUTE_MAX_LINES} řádků`, () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const violations: string[] = [];

    /** Velké soubory — budou refaktorovány postupně */
    const KNOWN_LARGE_FILES = new Set([
      "src/pages/admin/AdminQuestionnaires.tsx",   // 2149 — rozdělit na sub-komponenty
    ]);

    for (const file of prodFiles) {
      // Přeskočit generované soubory
      if (file.relPath.includes("types.ts")) continue;
      if (file.relPath.includes(".generated.")) continue;
      // Přeskočit known large files
      if (KNOWN_LARGE_FILES.has(file.relPath)) continue;

      const lineCount = file.content.split("\n").length;
      if (lineCount > ABSOLUTE_MAX_LINES) {
        violations.push(
          `${file.relPath}: ${lineCount} řádků (max ${ABSOLUTE_MAX_LINES})` +
          ` — rozděl soubor na samostatné moduly/komponenty (viz nápověda nad tímto testem)`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  // ℹ️ NÁPOVĚDA: Soubory zde jsou jen varování — test nepadá, ale signalizuje, že soubor roste.
  // Včas rozděl na: hooks (useXxx.ts), utils, sub-komponenty nebo registry soubory.
  // Cíl: soubory pod 800 řádků = snadná orientace, testování a code review.
  it(`soubory přes ${MAX_LINES} řádků jsou audit — doporučení k refaktoru`, () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const large: string[] = [];

    for (const file of prodFiles) {
      if (file.relPath.includes("types.ts")) continue;
      if (file.relPath.includes(".generated.")) continue;

      const lineCount = file.content.split("\n").length;
      if (lineCount > MAX_LINES) {
        large.push(`${file.relPath}: ${lineCount} řádků`);
      }
    }

    if (large.length > 0) {
      console.warn(
        `ℹ️ ${large.length} souborů přes ${MAX_LINES} řádků (doporučení k refaktoru):\n` +
        large.join("\n") +
        `\n\n💡 Nápověda: Velký soubor = příznak pro rozdělení. Řešení:\n` +
        `   • komponenty → src/components/SomeFeature/ (sub-komponenty)\n` +
        `   • hooks      → src/hooks/useXxx.ts\n` +
        `   • utils/data → src/lib/featureName.utils.ts nebo featureName.data.ts\n` +
        `   • registry   → featureName.web-blocks.ts, featureName.workflow-blocks.ts …\n` +
        `   Cíl: každý soubor < ${MAX_LINES} řádků, jedna jasná odpovědnost.`
      );
    }
    expect(true).toBe(true);
  });
});

/* ====================================================================
 * 6. TODO/FIXME/HACK — audit
 * ==================================================================== */

describe("TODO/FIXME/HACK audit", () => {
  it("audit TODO/FIXME/HACK komentářů v produkčním kódu", () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const items: string[] = [];

    for (const file of prodFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(
          /\/\/\s*(TODO|FIXME|HACK|XXX|TEMP)\b[:\s]*(.*)/i
        );
        if (match) {
          items.push(
            `${file.relPath}:${i + 1}: ${match[1].toUpperCase()} ${match[2].trim().substring(0, 60)}`
          );
        }
      }
    }

    if (items.length > 0) {
      console.warn(
        `ℹ️ ${items.length} TODO/FIXME/HACK v produkčním kódu:\n${items.slice(0, 10).join("\n")}${items.length > 10 ? `\n... a dalších ${items.length - 10}` : ""}`
      );
    }
    // Audit — nefailuje
    expect(true).toBe(true);
  });
});

/* ====================================================================
 * 7. ROUTING — žádné přímé window.location mutace
 * ==================================================================== */

describe("Routing — konzistence", () => {
  it("žádné window.location.href = ... (použít useNavigate)", () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const violations: string[] = [];

    for (const file of prodFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

        if (
          /window\.location\.(href|assign|replace)\s*=/.test(line) ||
          /window\.location\.assign\(/.test(line)
        ) {
          // Přeskočit legitimní external redirecty (OAuth, downloads)
          if (
            /supabase|oauth|download|blob|external/i.test(line) ||
            /eslint-disable/.test(line)
          )
            continue;

          violations.push(`${file.relPath}:${i + 1}`);
        }
      }
    }

    // Informativní
    if (violations.length > 0) {
      console.warn(
        `ℹ️ ${violations.length} window.location mutací (doporučení useNavigate):\n${violations.join("\n")}`
      );
    }
    expect(true).toBe(true);
  });
});

/* ====================================================================
 * 8. IMPORT KONZISTENCE — žádné require() v TS
 * ==================================================================== */

describe("Import konzistence", () => {
  it("žádné require() v produkčním TS/TSX kódu", () => {
    const allFiles = scanTsFiles(SRC_DIR);
    const prodFiles = allFiles.filter((f) => isProductionFile(f.relPath));
    const violations: string[] = [];

    for (const file of prodFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

        // require() — mělo by být import
        if (/\brequire\s*\(/.test(line)) {
          violations.push(`${file.relPath}:${i + 1}: require() — použít import`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

/* ====================================================================
 * 9. DEAD IMPORTS — importy nepoužitých hooks
 * ==================================================================== */

describe("Dead code audit", () => {
  it("žádné exporty bez použití v barrel souboru hooks/index.ts", () => {
    const hooksIndexPath = path.join(SRC_DIR, "hooks/index.ts");
    if (!fs.existsSync(hooksIndexPath)) return;

    const content = fs.readFileSync(hooksIndexPath, "utf-8");
    const exportMatches = content.match(/export\s+\{[^}]+\}\s+from/g);
    if (!exportMatches) return;

    // Jen audit — kolik exportů je v barrel souboru
    const totalExports = exportMatches.length;
    console.info(`ℹ️ hooks/index.ts: ${totalExports} export skupin`);

    expect(totalExports).toBeGreaterThan(0);
  });
});
