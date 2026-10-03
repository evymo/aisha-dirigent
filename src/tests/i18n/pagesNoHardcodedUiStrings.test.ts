import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

type Violation = {
  filePath: string;
  line: number;
  column: number;
  kind: string;
  context: string;
};

const PAGES_DIR = path.resolve(process.cwd(), "src/pages");
const ADMIN_PAGES_DIR = path.resolve(process.cwd(), "src/pages/admin");

function walkFiles(dirPath: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
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

function isTCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "t" &&
    node.arguments.length >= 1
  );
}

function hasTCallAncestor(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (isTCall(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function looksUserFacingText(text: string): boolean {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed) return false;

  // Ignore pure punctuation/symbol-only.
  if (!/[A-Za-zÀ-ž0-9]/.test(trimmed)) return false;

  // Ignore common non-user-facing tokens/abbreviations.
  if (trimmed === "OK") return false;

  return true;
}

function getJsxTextViolations(sourceFile: ts.SourceFile, filePath: string): Violation[] {
  const violations: Violation[] = [];

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      const raw = node.getText(sourceFile);
      if (looksUserFacingText(raw)) {
        const { line, column } = positionOf(sourceFile, node.getStart(sourceFile));
        violations.push({
          filePath,
          line,
          column,
          kind: "JSXText",
          context: "JSX text content",
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function getStringLiteralUiViolations(sourceFile: ts.SourceFile, filePath: string): Violation[] {
  const violations: Violation[] = [];

  const userFacingJsxAttributes = new Set(["aria-label", "ariaLabel", "title", "placeholder", "alt"]);

  function record(node: ts.Node, kind: string, context: string) {
    const { line, column } = positionOf(sourceFile, node.getStart(sourceFile));
    violations.push({ filePath, line, column, kind, context });
  }

  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const textValue = node.text;

      if (!looksUserFacingText(textValue)) {
        ts.forEachChild(node, visit);
        return;
      }

      // Allow literals inside t("...") calls.
      if (hasTCallAncestor(node)) {
        ts.forEachChild(node, visit);
        return;
      }

      // JSXAttribute initializer: <X placeholder="..." />
      if (ts.isJsxAttribute(node.parent) && ts.isIdentifier(node.parent.name)) {
        const attrName = node.parent.name.text;
        if (userFacingJsxAttributes.has(attrName)) {
          record(node, "JSXAttributeString", `String literal in JSX attribute: ${attrName}`);
          ts.forEachChild(node, visit);
          return;
        }
      }

      // Common UI payloads: toast({ title: "..." }), placeholder: "...", label: "..."
      if (ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) {
        const prop = node.parent.name.text;
        const uiProps = new Set([
          "title",
          "description",
          "label",
          "placeholder",
          "helperText",
          "emptyText",
          "text",
          "message",
          "ariaLabel",
        ]);

        if (uiProps.has(prop)) {
          record(node, "ObjectLiteralString", `String literal in UI prop: ${prop}`);
          ts.forEachChild(node, visit);
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

describe("non-admin pages should not contain hardcoded user-facing strings", () => {
  it("should use i18n t() for user-facing text", () => {
    if (!fs.existsSync(PAGES_DIR)) {
      expect(true).toBe(true);
      return;
    }

    const files = walkFiles(PAGES_DIR)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => !f.startsWith(ADMIN_PAGES_DIR))
      .filter((f) => !/ThemingTest/.test(path.basename(f)));

    const violations: Violation[] = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      violations.push(...getJsxTextViolations(sourceFile, filePath));
      violations.push(...getStringLiteralUiViolations(sourceFile, filePath));
    }

    if (violations.length > 0) {
      const formatted = violations
        .slice(0, 200)
        .map((v) => {
          const rel = path.relative(process.cwd(), v.filePath);
          return `${rel}:${v.line}:${v.column} ${v.kind} (${v.context})`;
        })
        .join("\n");

      expect.fail(
        `Found hardcoded user-facing strings in non-admin pages. Replace with i18n keys via t().\n` +
          `First ${Math.min(violations.length, 200)} violations:\n${formatted}\n` +
          (violations.length > 200 ? `\n...and ${violations.length - 200} more.` : "")
      );
    }

    expect(violations).toEqual([]);
  });
});
