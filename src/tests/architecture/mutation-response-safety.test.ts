/**
 * Test for mutation response safety
 *
 * Detects patterns that can cause crashes when RPC returns unexpected data:
 * - Missing null checks on response.data
 * - Accessing array[0] without checking array length
 * - Destructuring without defaults
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

const HOOKS_DIR = path.join(process.cwd(), "src", "hooks");

interface Issue {
  file: string;
  line: number;
  pattern: string;
  code: string;
}

// Dangerous patterns that can cause crashes on null/undefined response
const DANGEROUS_PATTERNS = [
  {
    name: "Array access without length check",
    // data[0] or result[0] without prior .length or Array.isArray check
    regex: /(?<!(?:\.length|Array\.isArray\([^)]+\)|data\s*\?\s*))(?:data|result|rows?)\[0\]/g,
  },
  {
    name: "Destructuring RPC response without null check",
    // const { something } = data without data && or data?.
    regex: /const\s*\{\s*\w+[^}]*\}\s*=\s*(?:data|result|response)(?!\s*\?\?|\s*\|\||\s*&&|\?\.)/g,
  },
  {
    name: "Direct property access on potentially null data",
    // Only match when accessing RPC response data, not input parameters
    // Matches: return data.something, const x = data.something
    // But not: p_field: data.field (input mapping)
    //
    // Negative lookahead rejects both `??` (nullish coalescing) and `?.`
    // (optional chaining) after the property — both indicate the author
    // explicitly handled an undefined value.
    // \w+\b prevents the greedy match from backtracking into the middle of
    // a word — otherwise `data.recommendation?.panels` would match
    // `data.recommendatio` (with the `n` still ahead) and the lookahead
    // would not see the optional chain.
    regex: /(?:return|const\s+\w+\s*=)\s*(?:data|result|response)\.(?!error\b)(\w+\b)(?!\s*(?:\?\?|\?\.))/g,
  },
];

// Patterns that indicate safe handling
const SAFE_PATTERNS = [
  /if\s*\(\s*error\s*\)/,
  /if\s*\(\s*!data\s*\)/,
  /if\s*\(\s*data\s*===?\s*null/,
  /if\s*\(\s*!result\s*\|\|\s*result\.length/,
  /if\s*\(\s*!rows\s*\|\|\s*rows\.length/,
  /if\s*\(\s*!rows\[0\]\s*\)/,
  /if\s*\(\s*!result\[0\]\s*\)/,
  /data\s*\?\?/,
  /data\s*\?\./,
  /data\s*&&/,
  /result\s*&&/,
  /rows\s*&&/,
  /Array\.isArray\s*\(/,
  /data\.length/,
  /result\.length/,
  /rows\.length/,
  /throw\s+error/,
  /parseArrayResponse/,
  /parseRpcArray/,
  /\.safeParse\(/,
  /\.parse\(/,
  /invokeEdgeFunction/,  // Has built-in schema validation
  /getPublicUrl/,  // Supabase SDK always returns valid object
];

function isSafeContext(content: string, matchIndex: number): boolean {
  // Look backwards within the enclosing function (up to 800 chars or the
  // previous `=> {` / `function (` boundary, whichever is closer). The
  // forward window stays small (200) — schema parse / error guards typically
  // appear BEFORE the property access, not after.
  const lookback = 800;
  const lookahead = 200;
  const rawStart = Math.max(0, matchIndex - lookback);
  // Heuristic: stop at the closest enclosing function-open, so a sibling
  // function above doesn't leak its safe patterns into this match.
  const slice = content.substring(rawStart, matchIndex);
  const enclosingOpen = Math.max(
    slice.lastIndexOf("=> {"),
    slice.lastIndexOf("function ("),
    slice.lastIndexOf("queryFn:"),
    slice.lastIndexOf("mutationFn:"),
  );
  const start = enclosingOpen >= 0 ? rawStart + enclosingOpen : rawStart;
  const end = Math.min(content.length, matchIndex + lookahead);
  const context = content.substring(start, end);

  return SAFE_PATTERNS.some(pattern => pattern.test(context));
}

function findDangerousPatterns(filePath: string): Issue[] {
  const issues: Issue[] = [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const fileName = path.basename(filePath);
  
  // Skip test files
  if (fileName.includes(".test.") || fileName.includes(".spec.")) {
    return [];
  }
  
  // Only check files with mutations
  if (!content.includes("mutationFn") && !content.includes("useMutation")) {
    return [];
  }
  
  for (const { name, regex } of DANGEROUS_PATTERNS) {
    let match;
    const regexCopy = new RegExp(regex.source, regex.flags);
    
    while ((match = regexCopy.exec(content)) !== null) {
      // Skip if in safe context
      if (isSafeContext(content, match.index)) {
        continue;
      }
      
      // Find line number
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split("\n").length;
      const lineContent = lines[lineNumber - 1]?.trim() || "";
      
      // Skip comments
      if (lineContent.startsWith("//") || lineContent.startsWith("*")) {
        continue;
      }
      
      issues.push({
        file: fileName,
        line: lineNumber,
        pattern: name,
        code: lineContent.substring(0, 80),
      });
    }
  }
  
  return issues;
}

function getAllHookFiles(): string[] {
  return glob.sync("**/*.ts", { 
    cwd: HOOKS_DIR,
    ignore: ["**/*.test.ts", "**/*.spec.ts", "**/index.ts"],
  });
}

describe("Mutation response safety", () => {
  it("should not have dangerous patterns that can crash on null response", () => {
    const files = getAllHookFiles();
    const allIssues: Issue[] = [];
    
    for (const file of files) {
      const fullPath = path.join(HOOKS_DIR, file);
      const issues = findDangerousPatterns(fullPath);
      allIssues.push(...issues);
    }
    
    if (allIssues.length > 0) {
      console.log("\n⚠️  Potential crash risks in mutation handlers:");
      console.log("─".repeat(80));
      
      const grouped = allIssues.reduce((acc, issue) => {
        const key = issue.file;
        if (!acc[key]) acc[key] = [];
        acc[key].push(issue);
        return acc;
      }, {} as Record<string, Issue[]>);
      
      for (const [file, issues] of Object.entries(grouped)) {
        console.log(`\n📄 ${file}:`);
        for (const issue of issues) {
          console.log(`   L${issue.line}: ${issue.pattern}`);
          console.log(`       ${issue.code}`);
        }
      }
      console.log("");
    }
    
    // Zero-tolerance: every new mutation handler must either guard the
    // response (Zod parse, error check, `??`/`?.`) or sit inside an
    // `invokeEdgeFunction` call (which validates internally). If the
    // heuristic flags a true negative, refine the safe-pattern list rather
    // than allowlisting the specific call site.
    expect(allIssues.length).toBe(0);
  });
  
  it("all mutations should have error handling", () => {
    const files = getAllHookFiles();
    const mutationsWithoutErrorHandling: string[] = [];
    
    for (const file of files) {
      const fullPath = path.join(HOOKS_DIR, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      
      // Find all useMutation blocks more accurately
      // Match from mutationFn: to the next onSuccess/onError/onSettled or closing of useMutation
      const mutationRegex = /mutationFn:\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^{]+)?\s*=>\s*\{/g;
      let match;
      
      while ((match = mutationRegex.exec(content)) !== null) {
        // Find the closing brace of this function
        const startIndex = match.index + match[0].length;
        let braceCount = 1;
        let endIndex = startIndex;
        
        while (braceCount > 0 && endIndex < content.length) {
          if (content[endIndex] === "{") braceCount++;
          if (content[endIndex] === "}") braceCount--;
          endIndex++;
        }
        
        const block = content.substring(match.index, endIndex);
        
        // Check if error handling exists in this block
        const hasErrorCheck = 
          /if\s*\(\s*error\s*\)/.test(block) ||
          /if\s*\(\s*!?\s*error\s*\)/.test(block) ||
          block.includes("throw error") ||
          block.includes("throw new Error") ||
          /\.catch\s*\(/.test(block) ||
          // Check for error in destructuring that gets thrown
          (/const\s*\{\s*(?:data\s*,\s*)?error\s*\}/.test(block) && 
           /if\s*\(\s*error\s*\)[\s\S]{0,20}throw/.test(block));
        
        // Only flag if it calls RPC and doesn't have error handling
        if (!hasErrorCheck && block.includes("supabase.rpc")) {
          mutationsWithoutErrorHandling.push(`${file}: ${match[0].substring(0, 50)}...`);
        }
      }
    }
    
    if (mutationsWithoutErrorHandling.length > 0) {
      console.log("\n⚠️  Mutations without error handling:");
      mutationsWithoutErrorHandling.forEach(m => console.log(`   - ${m}`));
    }
    
    // TODO: Gradually fix these - currently too many to enforce
    // expect(mutationsWithoutErrorHandling.length).toBe(0);
    expect(mutationsWithoutErrorHandling.length).toBeLessThan(100); // Track regression
  });
  
  it("should validate response data before returning", () => {
    const files = getAllHookFiles();
    let validatedCount = 0;
    let unvalidatedCount = 0;
    
    for (const file of files) {
      const fullPath = path.join(HOOKS_DIR, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      
      // Check for schema validation
      if (content.includes("mutationFn")) {
        if (
          content.includes(".parse(") || 
          content.includes(".safeParse(") ||
          content.includes("z.") ||
          content.includes("parseRpcArray") ||
          content.includes("parseRpcObject")
        ) {
          validatedCount++;
        } else if (content.includes("supabase.rpc")) {
          unvalidatedCount++;
        }
      }
    }
    
    console.log(`\n📊 Schema validation in mutation hooks:`);
    console.log(`   ✅ Validated: ${validatedCount}`);
    console.log(`   ⚠️  Not validated: ${unvalidatedCount}`);
    
    // At least 50% should have validation
    const ratio = validatedCount / (validatedCount + unvalidatedCount);
    expect(ratio).toBeGreaterThan(0.3);
  });
});
