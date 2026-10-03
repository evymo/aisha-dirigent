/**
 * Helper for test heuristics: build an index of `table.column` strings whose
 * column is typed as a known enum (or matches a USER-DEFINED type name we
 * treat as enum-equivalent).
 *
 * Used by cast heuristics so naming alone does NOT trigger false-positive
 * `::TEXT` warnings on plain varchar/text columns named `status`/`role`/etc.
 */

import * as fs from "fs";
import * as path from "path";

export interface EnumInfo {
  name: string;
  values: string[];
}

export function buildEnumColumnIndex(
  tablesDir: string,
  enums: Map<string, EnumInfo>,
): Set<string> {
  const index = new Set<string>();
  if (!fs.existsSync(tablesDir)) return index;

  const enumNames = new Set<string>();
  for (const name of enums.keys()) {
    enumNames.add(name);
    enumNames.add(name.toLowerCase());
  }

  const tableFiles = fs.readdirSync(tablesDir).filter((f) => f.endsWith(".sql"));
  const colRe = /^\s*"?(\w+)"?\s+([A-Za-z_][\w]*)/gm;
  const skip = new Set(["PRIMARY", "FOREIGN", "UNIQUE", "CONSTRAINT", "CHECK"]);

  for (const file of tableFiles) {
    const tableName = file.replace(/\.sql$/, "");
    const content = fs.readFileSync(path.join(tablesDir, file), "utf-8");
    const createMatch = content.match(/CREATE\s+TABLE[^(]+\(([\s\S]*?)\);/i);
    if (!createMatch) continue;
    const body = createMatch[1];
    colRe.lastIndex = 0;
    let m;
    while ((m = colRe.exec(body)) !== null) {
      const colName = m[1].toLowerCase();
      const typeName = m[2];
      if (skip.has(colName.toUpperCase())) continue;
      if (enumNames.has(typeName) || enumNames.has(typeName.toLowerCase())) {
        index.add(`${tableName}.${colName}`);
      }
    }
  }
  return index;
}
