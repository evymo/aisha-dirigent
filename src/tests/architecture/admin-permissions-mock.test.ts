import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const HOOK_TESTS_DIR = path.join(process.cwd(), "src/tests/hooks");

const INLINE_ADMIN_MOCK_PATTERN =
  /Mock usePermissions for admin guard[\s\S]*?permissions:\s*\[\s*['"]view_admin_dashboard['"]\s*\]/;

function listTestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.includes(".test.")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("Admin permissions mocks", () => {
  it("uses the shared mockAdminPermissions helper in hook tests", () => {
    const offenders: string[] = [];
    const testFiles = listTestFiles(HOOK_TESTS_DIR);

    for (const filePath of testFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (INLINE_ADMIN_MOCK_PATTERN.test(content)) {
        offenders.push(path.relative(process.cwd(), filePath));
      }
    }

    expect(
      offenders,
      `Inline admin permission mocks detected. Use mockAdminPermissions from src/tests/utils/permissions instead.\n${offenders.join(
        "\n"
      )}`
    ).toHaveLength(0);
  });
});
