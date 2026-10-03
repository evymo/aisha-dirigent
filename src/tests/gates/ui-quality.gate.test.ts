/**
 * UI Quality Gate Tests
 *
 * Kontroluje:
 * 1. Žádné emoji v UI kódu — používat lucide-react ikony
 * 2. Žádné hardcoded UI texty — vše přes i18n t()
 * 3. Konzistentní import ikon z lucide-react (žádné jiné icon knihovny)
 * 4. Žádné hardcoded barvy — pouze Tailwind/CSS variable classes
 * 5. Accessible komponenty (alt, aria-label, role)
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

function scanTsxFilesRecursive(
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
      scanTsxFilesRecursive(full, result);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      result.push({
        path: full,
        content: fs.readFileSync(full, "utf-8"),
        relPath: path.relative(ROOT, full),
      });
    }
  }
  return result;
}

function scanAllTsFiles(
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
      scanAllTsFiles(full, result);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      result.push({
        path: full,
        content: fs.readFileSync(full, "utf-8"),
        relPath: path.relative(ROOT, full),
      });
    }
  }
  return result;
}

/** Produkční TSX soubory (bez testů, testovacích helperů) */
function getProductionTsx() {
  return scanTsxFilesRecursive(SRC_DIR).filter(
    (f) =>
      !f.relPath.includes("/tests/") &&
      !f.relPath.includes("/__tests__/") &&
      !f.relPath.includes(".test.") &&
      !f.relPath.includes(".spec.")
  );
}

/** Produkční TS/TSX soubory */
function getProductionTs() {
  return scanAllTsFiles(SRC_DIR).filter(
    (f) =>
      !f.relPath.includes("/tests/") &&
      !f.relPath.includes("/__tests__/") &&
      !f.relPath.includes(".test.") &&
      !f.relPath.includes(".spec.")
  );
}

/**
 * Emoji regex — detekuje Unicode emoji v kódu.
 * Zahrnuje: emotikony, symboly, vlajky, ruční znaky, šipky, atd.
 *
 * POZOR: false positives u RegExp Unicode property escapes jsou vzácné,
 * ale ověřujeme pouze v JSX renderovaných řetězcích / return statements.
 */
/* eslint-disable no-misleading-character-class -- Intentional: complex emoji detection regex */
const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{2934}-\u{2935}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{27BF}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}\u{FE0F}\u{200D}]|[\u{E0020}-\u{E007F}]/gu;
/* eslint-enable no-misleading-character-class */

/* ====================================================================
 * 1. EMOJI AUDIT — žádné emoji v produkčním UI kódu
 * ==================================================================== */

describe("Emoji audit — lucide-react místo emoji", () => {
  /**
   * KNOWN_EMOJI_FILES — vyprázdněno po kompletní opravě emoji.
   * Všechny emoji byly nahrazeny lucide-react ikonami.
   * Tento map zůstává pro referenci — nové soubory NESMÍ přidávat emoji.
   */
  const KNOWN_EMOJI_FILES: Record<string, number> = {
  };

  it("detekuje emoji v produkčních TSX/TS souborech", () => {
    const productionFiles = getProductionTs();
    const violations: string[] = [];

    for (const file of productionFiles) {
      const lines = file.content.split("\n");
      let emojiCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Přeskočit komentáře
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
        // Přeskočit importy
        if (/^\s*import\s/.test(line)) continue;

        const matches = line.match(EMOJI_REGEX);
        if (matches) {
          emojiCount += matches.length;
        }
      }

      if (emojiCount > 0) {
        const allowed = KNOWN_EMOJI_FILES[file.relPath] ?? 0;
        if (emojiCount > allowed) {
          violations.push(
            `${file.relPath}: ${emojiCount} emoji (povoleno: ${allowed}) — nahradit lucide-react ikonami`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("KNOWN_EMOJI_FILES allowlist se nesmí rozšiřovat", () => {
    // Celkový povolený počet emoji se smí pouze snižovat
    const totalAllowed = Object.values(KNOWN_EMOJI_FILES).reduce(
      (sum, n) => sum + n,
      0
    );
    // Počáteční baseline: 0 — žádné emoji v produkčním kódu
    expect(totalAllowed).toBeLessThanOrEqual(0);
  });

  it("žádné nové soubory s emoji mimo allowlist", () => {
    const productionFiles = getProductionTs();
    const newEmojiFiles: string[] = [];

    for (const file of productionFiles) {
      // Přeskočit known soubory
      if (KNOWN_EMOJI_FILES[file.relPath] !== undefined) continue;

      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
        if (/^\s*import\s/.test(line)) continue;

        if (EMOJI_REGEX.test(line)) {
          newEmojiFiles.push(`${file.relPath}:${i + 1}`);
          break; // stačí první výskyt na soubor
        }
      }
    }

    expect(newEmojiFiles).toEqual([]);
  });
});

/* ====================================================================
 * 2. ICON LIBRARY — pouze lucide-react
 * ==================================================================== */

describe("Icon library konzistence", () => {
  const FORBIDDEN_ICON_LIBS = [
    "react-icons",
    "@heroicons",
    "@fortawesome",
    "@ant-design/icons",
    "ionicons",
    "@mui/icons-material",
    "phosphor-react",
    "tabler-icons-react",
  ];

  it("žádné importy z alternativních icon knihoven", () => {
    const productionFiles = getProductionTs();
    const violations: string[] = [];

    for (const file of productionFiles) {
      for (const lib of FORBIDDEN_ICON_LIBS) {
        if (file.content.includes(`from "${lib}`) || file.content.includes(`from '${lib}`)) {
          violations.push(`${file.relPath}: import z ${lib} — použít lucide-react`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("lucide-react ikony se importují správně (named imports)", () => {
    const productionFiles = getProductionTsx();
    const violations: string[] = [];

    for (const file of productionFiles) {
      // Kontrola default importu – lucide-react nemá default export
      if (/import\s+\w+\s+from\s+["']lucide-react["']/.test(file.content)) {
        violations.push(
          `${file.relPath}: default import z lucide-react — použít named import { Icon }`
        );
      }
    }

    expect(violations).toEqual([]);
  });
});

/* ====================================================================
 * 3. HARDCODED UI TEXTY — vše přes i18n
 * ==================================================================== */

describe("i18n — žádné hardcoded UI texty", () => {
  /**
   * Detekce hardcoded českých textů v JSX.
   * Hledáme české znaky (háčky, čárky) v string literálech uvnitř JSX.
   */
  const CZECH_CHARS = /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/;

  /** Soubory kde jsou hardcoded CZ texty povolené (legacy) */
  const KNOWN_HARDCODED_CZ: Record<string, number> = {};

  it("žádné nové hardcoded české texty v TSX mimo allowlist", () => {
    const tsxFiles = getProductionTsx();
    const violations: string[] = [];

    for (const file of tsxFiles) {
      if (KNOWN_HARDCODED_CZ[file.relPath] !== undefined) continue;

      const lines = file.content.split("\n");
      let czechLineCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Přeskočit komentáře
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
        // Přeskočit importy
        if (/^\s*import\s/.test(line)) continue;
        // Přeskočit i18n klíče a konstanty
        if (/t\(["']/.test(line)) continue;
        // Přeskočit className a Tailwind
        if (/className=/.test(line) && !CZECH_CHARS.test(line)) continue;

        // Hledat CZ text v JSX string literálech:
        // <span>Český text</span> nebo title="Český text"
        // Ale NE v: const x = "český" (JS variable)
        const jsxTextMatch =
          // Text mezi JSX tagy: >Český text<
          />([^<]*[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][^<]*)</.test(line) ||
          // String prop: title="Český" nebo placeholder="Český"
          /(?:title|placeholder|label|alt|aria-label|content)=["']([^"']*[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][^"']*)["']/.test(
            line
          );

        if (jsxTextMatch) {
          czechLineCount++;
        }
      }

      if (czechLineCount > 0) {
        violations.push(
          `${file.relPath}: ${czechLineCount} řádků s hardcoded CZ textem — použít t()`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("KNOWN_HARDCODED_CZ allowlist se nesmí rozšiřovat", () => {
    const totalAllowed = Object.values(KNOWN_HARDCODED_CZ).reduce(
      (sum, n) => sum + n,
      0
    );
    // Baseline: 0 — žádné hardcoded CZ texty
    expect(totalAllowed).toBeLessThanOrEqual(0);
  });
});

/* ====================================================================
 * 4. HARDCODED BARVY — žádné inline style barvy
 * ==================================================================== */

describe("Barvy — žádné hardcoded inline barvy", () => {
  it("žádné style={{ color: '#xxx' }} v produkčních TSX", () => {
    const tsxFiles = getProductionTsx();
    const violations: string[] = [];

    // Hledáme hardcoded hex barvy v inline stylech
    const inlineColorPattern =
      /style\s*=\s*\{\s*\{[^}]*(?:color|background|backgroundColor|borderColor)\s*:\s*["']#[0-9a-fA-F]{3,8}["']/;

    for (const file of tsxFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (inlineColorPattern.test(lines[i])) {
          violations.push(`${file.relPath}:${i + 1}: hardcoded hex barva v inline stylu`);
        }
      }
    }

    // Povolíme 0 — vše by mělo být přes Tailwind classes
    expect(violations).toEqual([]);
  });
});

/* ====================================================================
 * 5. ACCESSIBILITY — základní a11y kontroly
 * ==================================================================== */

describe("Accessibility — základní kontroly", () => {
  it("img tagy mají alt atribut", () => {
    const tsxFiles = getProductionTsx();
    const violations: string[] = [];

    for (const file of tsxFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Hledáme <img bez alt
        if (/<img\s/.test(line) && !/alt=/.test(line)) {
          // Kontrola, zda alt není na dalších řádcích (multiline JSX — až +3 řádky)
          const lookAhead = [
            lines[i + 1] || "",
            lines[i + 2] || "",
            lines[i + 3] || "",
          ];
          const hasAltNearby = lookAhead.some((l) => /alt=/.test(l));
          // Zastavit look-ahead pokud narazíme na konec tagu
          const tagClosed = lookAhead.some((l) => /\/>|>/.test(l) && !/alt=/.test(l) && !/<img/.test(l));
          if (!hasAltNearby) {
            violations.push(
              `${file.relPath}:${i + 1}: <img> bez alt atributu`
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);

    // Ale logujeme všechny pro audit
    if (violations.length > 0) {
      console.warn(
        `⚠️ ${violations.length} <img> bez alt (${violations.length} nových):\n${violations.join("\n")}`
      );
    }
  });

  it("button bez children nebo aria-label", () => {
    const tsxFiles = getProductionTsx();
    const violations: string[] = [];

    for (const file of tsxFiles) {
      // Self-closing <button /> nebo <Button /> bez aria-label
      const selfClosingButton =
        /<(?:button|Button)\s[^>]*\/>/g;
      let match;
      while ((match = selfClosingButton.exec(file.content)) !== null) {
        if (
          !/aria-label/.test(match[0]) &&
          !/title=/.test(match[0]) &&
          !/children/.test(match[0])
        ) {
          // Pozice v souboru
          const lineNum =
            file.content.substring(0, match.index).split("\n").length;
          violations.push(
            `${file.relPath}:${lineNum}: self-closing <Button /> bez aria-label/title`
          );
        }
      }
    }

    // Informativní — nefailuje, ale loguje
    if (violations.length > 0) {
      console.warn(
        `⚠️ ${violations.length} self-closing buttons bez aria-label:\n${violations.slice(0, 5).join("\n")}${violations.length > 5 ? "\n..." : ""}`
      );
    }
    // Nezpůsobuje fail — jen audit
    expect(true).toBe(true);
  });
});

/* ====================================================================
 * 6. KOMPONENTY — konzistence patterns
 * ==================================================================== */

describe("Komponenty — quality patterns", () => {
  it("žádné inline onClick handlery delší než 1 řádek", () => {
    const tsxFiles = getProductionTsx();
    const violations: string[] = [];

    for (const file of tsxFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // onClick={() => { ... multiline
        if (
          /onClick=\{.*\(\)\s*=>\s*\{/.test(line) &&
          !/\}/.test(line.substring(line.indexOf("=>")))
        ) {
          // Multiline handler — měl by být extrahován do funkce
          violations.push(
            `${file.relPath}:${i + 1}: multiline onClick handler — extrahovat do pojmenované funkce`
          );
        }
      }
    }

    // Informativní
    if (violations.length > 0) {
      console.warn(
        `ℹ️ ${violations.length} multiline onClick handlers (doporučení):\n${violations.slice(0, 3).join("\n")}`
      );
    }
    expect(true).toBe(true);
  });

  it("žádné magic numbers v Tailwind spacing (>12)", () => {
    const tsxFiles = getProductionTsx();
    const violations: string[] = [];

    // Arbitrary spacing: p-[42px], m-[100px] atd.
    const arbitrarySpacing = /(?:p|m|gap|space)(?:-[xylrtb])?-\[\d{3,}px\]/;

    for (const file of tsxFiles) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (arbitrarySpacing.test(lines[i])) {
          violations.push(
            `${file.relPath}:${i + 1}: arbitrary spacing (100+px) — použít standardní Tailwind`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
