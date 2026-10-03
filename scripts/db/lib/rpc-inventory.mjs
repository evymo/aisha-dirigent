import fs from "node:fs";
import path from "node:path";
import { porovnej } from "../../lib/razeni.mjs";

function splitTopLevel(input) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const char of input) {
    if (char === "(") depth++;
    if (char === ")") depth--;

    if (char === "," && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseParamName(signaturePart) {
  const match = signaturePart.match(/\b(p_\w+)\b/i);
  return match ? match[1] : null;
}

export function parseRpcFunction(content, file) {
  const functionMatch = content.match(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*RETURNS/is,
  );

  if (!functionMatch) {
    return null;
  }

  const [, name, rawParams] = functionMatch;
  const params = splitTopLevel(rawParams)
    .map(parseParamName)
    .filter(Boolean);

  return {
    file,
    name,
    params,
  };
}

export function buildRpcInventory(rootDir = process.cwd()) {
  const preferredDir = path.join(rootDir, "aisha", "db", "sql", "functions");
  const legacyDir = path.join(rootDir, "supabase", "sql", "functions");
  const functionsDir = fs.existsSync(preferredDir) ? preferredDir : legacyDir;
  if (!fs.existsSync(functionsDir)) {
    throw new Error(
      `SQL functions directory not found. Checked ${preferredDir} and ${legacyDir}`,
    );
  }
  const files = fs
    .readdirSync(functionsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => porovnej(a, b));

  return files
    .map((file) => {
      const fullPath = path.join(functionsDir, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      return parseRpcFunction(content, file);
    })
    .filter(Boolean);
}
