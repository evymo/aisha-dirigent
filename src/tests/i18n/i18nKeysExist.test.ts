import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

type KeyUse = {
  key: string;
  filePath: string;
  line: number;
  column: number;
  kind: "t" | "Trans";
};

type MissingKey = {
  key: string;
  filePath: string;
  line: number;
  column: number;
  missingIn: Array<"cs" | "en" | "de" | "fr" | "ru" | "th">;
  kind: "t" | "Trans";
};

const SRC_DIR = path.resolve(process.cwd(), "src");
const CS_PATH = path.resolve(process.cwd(), "src/i18n/locales/cs.json");
const EN_PATH = path.resolve(process.cwd(), "src/i18n/locales/en.json");
const DE_PATH = path.resolve(process.cwd(), "src/i18n/locales/de.json");
const FR_PATH = path.resolve(process.cwd(), "src/i18n/locales/fr.json");
const RU_PATH = path.resolve(process.cwd(), "src/i18n/locales/ru.json");
const TH_PATH = path.resolve(process.cwd(), "src/i18n/locales/th.json");

const EXCLUDED_DIRS = [
  path.resolve(process.cwd(), "src/tests"),
  path.resolve(process.cwd(), "src/i18n/locales"),
];

function walkFiles(dirPath: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.some((d) => fullPath.startsWith(d))) continue;
      walkFiles(fullPath, out);
      continue;
    }

    if (entry.isFile() && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
      out.push(fullPath);
    }
  }

  return out;
}

function positionOf(sourceFile: ts.SourceFile, pos: number): { line: number; column: number } {
  const lc = sourceFile.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, column: lc.character + 1 };
}

function isLiteralString(node: ts.Expression | undefined): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
}

function isTCallExpression(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;

  // t("key")
  if (ts.isIdentifier(node.expression) && node.expression.text === "t") return true;

  // i18n.t("key") / i18next.t("key")
  if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "t") {
    const expr = node.expression.expression;
    return ts.isIdentifier(expr) && (expr.text === "i18n" || expr.text === "i18next");
  }

  return false;
}

function collectKeysFromTrans(node: ts.Node, sourceFile: ts.SourceFile, filePath: string, out: KeyUse[]) {
  const visit = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const tag = n.tagName;
      const isTransTag = ts.isIdentifier(tag) && tag.text === "Trans";
      if (isTransTag) {
        const attrs = n.attributes.properties;
        for (const attr of attrs) {
          if (ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name) && attr.name.text === "i18nKey") {
            const init = attr.initializer;
            if (init && ts.isStringLiteral(init)) {
              const { line, column } = positionOf(sourceFile, attr.getStart(sourceFile));
              out.push({ key: init.text, filePath, line, column, kind: "Trans" });
            }
          }
        }
      }
    }

    ts.forEachChild(n, visit);
  };

  visit(node);
}

function collectI18nKeys(filePath: string): KeyUse[] {
  const content = fs.readFileSync(filePath, "utf8");

  const isTsx = filePath.endsWith(".tsx");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const keys: KeyUse[] = [];

  function visit(node: ts.Node) {
    if (isTCallExpression(node)) {
      const firstArg = node.arguments[0];
      if (isLiteralString(firstArg)) {
        const { line, column } = positionOf(sourceFile, node.getStart(sourceFile));
        keys.push({ key: firstArg.text, filePath, line, column, kind: "t" });
      }
    }

    collectKeysFromTrans(node, sourceFile, filePath, keys);

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return keys;
}

function getJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function hasKeyPath(obj: unknown, keyPath: string): boolean {
  const parts = keyPath.split(".");
  let cur: unknown = obj;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (cur == null || typeof cur !== "object") return false;
    const record = cur as Record<string, unknown>;
    if (part in record) {
      cur = record[part];
    } else if (i === parts.length - 1) {
      // i18next plural suffixes — key "dayCount" resolves to "dayCount_one", "dayCount_other", etc.
      const pluralSuffixes = ["_one", "_other", "_few", "_many", "_zero", "_two"];
      return pluralSuffixes.some((suffix) => `${part}${suffix}` in record);
    } else {
      return false;
    }
  }
  return true;
}

describe("i18n keys used in code should exist in all locale dictionaries", () => {
  it(
    "should have every static key present in both locales",
    async () => {
    expect(fs.existsSync(CS_PATH)).toBe(true);
    expect(fs.existsSync(EN_PATH)).toBe(true);
    expect(fs.existsSync(DE_PATH)).toBe(true);
    expect(fs.existsSync(FR_PATH)).toBe(true);
    expect(fs.existsSync(RU_PATH)).toBe(true);
    expect(fs.existsSync(TH_PATH)).toBe(true);

    const cs = getJson(CS_PATH);
    const en = getJson(EN_PATH);
    const de = getJson(DE_PATH);
    const fr = getJson(FR_PATH);
    const ru = getJson(RU_PATH);
    const th = getJson(TH_PATH);

    const files = walkFiles(SRC_DIR);

    const uses: KeyUse[] = [];
    for (const [index, f] of files.entries()) {
      // Skip generated/utility edge cases if any end up under src.
      if (f.endsWith(".d.ts")) continue;
      uses.push(...collectI18nKeys(f));

      // Keep the worker responsive during the largest static audit in the suite.
      if ((index + 1) % 25 === 0) {
        await yieldToEventLoop();
      }
    }

    const missing: MissingKey[] = [];

    for (const u of uses) {
      const missingIn: Array<"cs" | "en" | "de" | "fr" | "ru" | "th"> = [];
      if (!hasKeyPath(cs, u.key)) missingIn.push("cs");
      if (!hasKeyPath(en, u.key)) missingIn.push("en");
      if (!hasKeyPath(de, u.key)) missingIn.push("de");
      if (!hasKeyPath(fr, u.key)) missingIn.push("fr");
      if (!hasKeyPath(ru, u.key)) missingIn.push("ru");
      if (!hasKeyPath(th, u.key)) missingIn.push("th");

      if (missingIn.length > 0) {
        missing.push({ ...u, missingIn });
      }
    }

    if (missing.length > 0) {
      const formatted = missing
        .slice(0, 200)
        .map((m) => {
          const rel = path.relative(process.cwd(), m.filePath);
          return `${rel}:${m.line}:${m.column} Missing key in [${m.missingIn.join(",")}]: ${m.key} (${m.kind})`;
        })
        .join("\n");

      expect.fail(
        `Found i18n keys used in code that are missing from locale dictionaries.\n` +
          `First ${Math.min(missing.length, 200)} missing keys:\n${formatted}\n` +
          (missing.length > 200 ? `\n...and ${missing.length - 200} more.` : "")
      );
    }

    expect(missing).toEqual([]);
  },
    300000
  );
});
