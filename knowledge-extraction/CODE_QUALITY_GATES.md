# Code Quality Gates — Co Musí Projít

> Gate testy jsou **automatické strážce kódu**. Spouštějí se při každém PR a blokují merge pokud selhají.  
> Nejsou to unit testy — jsou to architektonické a bezpečnostní kontroly celé codebase.

---

## Jak Gate Testy Fungují

```bash
# Dvě konfigurace Vitest:
npm run test:run    # Unit testy (jsdom environment)
npm run test:gates  # Gate testy (node environment, statická analýza)

# Před PR musí projít OBA:
npm run test:run && npm run test:gates && npm run build
```

Gate testy v `src/tests/gates/` a `src/tests/architecture/` **analyzují soubory staticky** — čtou AST/regex a kontrolují pravidla bez spouštění kódu.

---

## Povinné Gate Testy (šablony pro nový projekt)

### 1. Code Hygiene Gate

**Soubor:** `src/tests/gates/code-hygiene.gate.test.ts`

Co kontroluje:
- Žádné `console.log()` v produkčních souborech
- Žádné `any` typy (warn na explicitní, block na implicitní)
- Žádné `@ts-ignore` bez komentáře
- Žádné soubory >1000 řádků (warning)
- Žádné `window.location =` přímé mutace

```typescript
// Základní šablona gate testu
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SRC_DIR = path.join(ROOT, "src");

function scanProductionTsFiles() {
  const results: Array<{ path: string; content: string; rel: string }> = [];
  function scan(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !["node_modules", "dist"].includes(entry.name)) {
        scan(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const rel = path.relative(ROOT, full);
        // Přeskoč testovací soubory
        if (!rel.includes("/tests/") && !rel.endsWith(".test.ts") && !rel.endsWith(".test.tsx")) {
          results.push({ path: full, content: fs.readFileSync(full, "utf-8"), rel });
        }
      }
    }
  }
  scan(SRC_DIR);
  return results;
}

describe("Code Hygiene", () => {
  it("no console.log in production code", () => {
    const violations: string[] = [];
    for (const { rel, content } of scanProductionTsFiles()) {
      content.split("\n").forEach((line, i) => {
        if (/console\.log\s*\(/.test(line) && !line.trim().startsWith("//")) {
          violations.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(violations, `console.log v produkčním kódu:\n${violations.join("\n")}`).toHaveLength(0);
  });

  it("no @ts-ignore without explanation comment", () => {
    const violations: string[] = [];
    for (const { rel, content } of scanProductionTsFiles()) {
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (/@ts-ignore/.test(line) && !/@ts-ignore.*:/.test(line)) {
          violations.push(`${rel}:${i + 1} — @ts-ignore bez důvodu`);
        }
      });
    }
    expect(violations, violations.join("\n")).toHaveLength(0);
  });
});
```

---

### 2. API Access Gate (Hook-Only)

**Soubor:** `src/tests/gates/api-access.gate.test.ts`

Co kontroluje: žádné přímé `fetch()` nebo `apiClient.*` volání v komponentech/pages.

```typescript
describe("API Access Gate", () => {
  it("no direct fetch() in components or pages", () => {
    const SCANNED_DIRS = ["src/components", "src/pages"];
    const violations: string[] = [];

    for (const dir of SCANNED_DIRS) {
      const fullDir = path.join(ROOT, dir);
      if (!fs.existsSync(fullDir)) continue;
      // ... scanFiles, check for /\bfetch\s*\(/
    }

    expect(violations, violations.join("\n")).toHaveLength(0);
  });

  it("no direct apiClient.get/post in components or pages", () => {
    // Stejný pattern, ale hledá /\bapiClient\.(get|post|put|delete|patch)\s*\(/
  });
});
```

---

### 3. UI Quality Gate

**Soubor:** `src/tests/gates/ui-quality.gate.test.ts`

Co kontroluje:
- Žádné Unicode emoji v JSX (vyžadujeme icon library)
- Žádné hardcoded CZ/EN texty delší než 3 slova v JSX

```typescript
const EMOJI_PATTERN = /[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{27FF}]/u;

describe("UI Quality Gate", () => {
  it("no emoji characters in component files", () => {
    const violations: string[] = [];
    for (const { rel, content } of scanComponentFiles()) {
      if (EMOJI_PATTERN.test(content)) {
        violations.push(`${rel} — obsahuje emoji`);
      }
    }
    expect(violations, violations.join("\n")).toHaveLength(0);
  });
});
```

---

### 4. Architecture Gate — Hook Coverage

**Soubor:** `src/tests/architecture/hook-coverage.test.ts`

Co kontroluje: každý soubor v `src/hooks/` má odpovídající test v `src/tests/hooks/`.

```typescript
describe("Hook Coverage", () => {
  it("every hook file has a test file", () => {
    const hooksDir = path.join(ROOT, "src/hooks");
    const testsDir = path.join(ROOT, "src/tests/hooks");
    const missing: string[] = [];

    for (const file of fs.readdirSync(hooksDir)) {
      if (!file.startsWith("use") || !file.endsWith(".ts")) continue;
      const testFile = file.replace(".ts", ".test.ts");
      const testFileAlt = file.replace(".ts", ".test.tsx");
      if (
        !fs.existsSync(path.join(testsDir, testFile)) &&
        !fs.existsSync(path.join(testsDir, testFileAlt))
      ) {
        missing.push(file);
      }
    }

    expect(missing, `Hooky bez testů:\n${missing.join("\n")}`).toHaveLength(0);
  });
});
```

---

### 5. i18n Gate

**Soubor:** `src/tests/gates/i18n-completeness.gate.test.ts`

Co kontroluje:
- Všechny klíče v EN existují i v ostatních lokalizacích
- Žádné `[English text]` placeholdery v překladech
- Žádné hardcoded texty delší než 3 slova v JSX

```typescript
describe("i18n Gate", () => {
  it("all EN keys exist in CS", () => {
    const en = JSON.parse(fs.readFileSync("src/i18n/locales/en.json", "utf-8"));
    const cs = JSON.parse(fs.readFileSync("src/i18n/locales/cs.json", "utf-8"));
    const missing = findMissingKeys(en, cs);
    expect(missing, `Chybějící CS překlady:\n${missing.join("\n")}`).toHaveLength(0);
  });

  it("no bracket placeholders in translations", () => {
    const locales = ["cs", "de", "fr"];
    const violations: string[] = [];
    for (const lang of locales) {
      const content = fs.readFileSync(`src/i18n/locales/${lang}.json`, "utf-8");
      const matches = content.match(/\[[^\]]{3,}\]/g) ?? [];
      if (matches.length > 0) violations.push(`${lang}: ${matches.join(", ")}`);
    }
    expect(violations, violations.join("\n")).toHaveLength(0);
  });
});
```

---

## PR Checklist — Co Musí Projít

### Automaticky (CI / pre-commit):

```bash
✅  npm run test:run          # Unit + integration testy
✅  npm run test:gates        # Gate testy (architektura, hygiene)
✅  npx tsc --noEmit          # TypeScript bez chyb
✅  npm run lint              # ESLint (max-warnings 0)
✅  npm run build             # Produkční build
✅  npm run i18n:check        # Překlady kompletní
```

### Manuálně (code review):

```bash
✅  Žádné .select("*") nebo přímé DB query z komponent
✅  Každý nový hook má test
✅  Zod schéma pro každý API response
✅  Error messages neobsahují citlivá data
✅  Parametry hooků a funkcí řazeny abecedně
✅  Nové komponenty < 500 řádků
```

---

## Threshold Coverage (Vitest)

Minimální pokrytí pro produkční kód (nastavení v `vitest.config.ts`):

```typescript
coverage: {
  thresholds: {
    lines: 40,       // Minimální % řádků
    functions: 40,   // Minimální % funkcí
    branches: 30,    // Minimální % větví (if/else)
    statements: 40,  // Minimální % příkazů
  },
  // Vyjmi z měření:
  exclude: [
    "src/pages/**",         // Page-level UI (testujeme cíleně)
    "src/components/ui/**", // Shadcn/UI primitiva
    "src/integrations/**",  // Generovaný kód
    "src/tests/**",         // Testy samotné
  ],
}
```

> **Pozor:** 40% threshold je MINIMUM. Cíl je 80%+ pro hooky a business logic.

---

## ESLint Konfigurace (klíčová pravidla)

```javascript
// eslint.config.js — klíčová pravidla
export default [
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",        // Žádné any
      "@typescript-eslint/no-unused-vars": "error",         // Žádné unused vars
      "no-console": ["error", { allow: ["error", "warn"] }], // Jen console.error/warn
      "react-hooks/rules-of-hooks": "error",                // Hook pravidla
      "react-hooks/exhaustive-deps": "warn",                // Dependencies
    },
  },
];
```

---

## Vitest Dual Config Pattern

Tento projekt používá **dvě Vitest konfigurace** — klíčový pattern:

```
vitest.config.ts        → Unit testy (jsdom, React Testing Library)
vitest.gates.config.ts  → Gate testy (node, statická analýza souborů)
```

```json
// package.json scripts
{
  "test:run": "vitest run --config vitest.config.ts",
  "test:gates": "vitest run --config vitest.gates.config.ts",
  "test:all": "npm run test:run && npm run test:gates"
}
```

Gate testy **nesmí** být v jsdom konfiguraci (nepoužívají DOM) a unit testy **nesmí** být v node konfiguraci (React komponenty potřebují jsdom).
