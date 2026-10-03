/**
 * AI-Powered Static Validation Suite
 * 
 * Comprehensive static analysis of the entire codebase using Apple Silicon Neural Engine.
 * Runs independently without database connection.
 * 
 * Usage:
 *   npm run test:static
 *   
 * Prerequisites (for AI features):
 *   - macOS with Apple Silicon (M1/M2/M3/M4)
 *   - Run: ./scripts/ai/setup-mlx.sh
 * 
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { vypnuteTriggeryBezZapnuti } from "./validation-utils";

// =============================================================================
// Configuration
// =============================================================================

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

const STATIC_PATHS = {
  seed: "aisha/db/seed.compiled.sql",
  seedModules: "supabase/seed",
  migrations: "aisha/db/migrations",
  types: "src/integrations/db/types.ts",
  hooks: "src/hooks",
  components: "src/components",
  pages: "src/pages",
  security: "src/lib/security",
  i18n: "src/i18n/locales",
  backup: "docs/db-backup-check",
  securityDocs: "docs/security",
} as const;

// Critical patterns to check
const SECURITY_PATTERNS = {
  securePatterns: [
    /console\.(log|error|warn|info)\([^)]*email/gi,
    /console\.(log|error|warn|info)\([^)]*password/gi,
    /console\.(log|error|warn|info)\([^)]*phone/gi,
    /console\.(log|error|warn|info)\([^)]*ssn/gi,
    /console\.(log|error|warn|info)\([^)]*address/gi,
    /console\.(log|error|warn|info)\([^)]*birth/gi,
  ],
  directTableAccess: [
    /\.from\s*\(\s*["']health_check_ins["']\s*\)/g,
    /\.from\s*\(\s*["']lab_results["']\s*\)/g,
    /\.from\s*\(\s*["']dosing_logs["']\s*\)/g,
    /\.from\s*\(\s*["']profiles["']\s*\)\.select\s*\(\s*["']\*["']\s*\)/g,
  ],
  unsafePatterns: [
    /eval\s*\(/g,
    /new\s+Function\s*\(/g,
  ],
};

// =============================================================================
// AI Utilities (Apple MLX)
// =============================================================================

interface AIAvailability {
  available: boolean;
  reason: string;
  model: string | null;
  modelId: string | null;
  isAppleSilicon: boolean;
}

const MLX_MODEL_ID = "mlx-community/Qwen2.5-Coder-1.5B-Instruct-4bit";

function getHuggingFaceHubCacheDirs(): string[] {
  const dirs = new Set<string>();

  if (process.env.HUGGINGFACE_HUB_CACHE) {
    dirs.add(process.env.HUGGINGFACE_HUB_CACHE);
  }

  if (process.env.HF_HOME) {
    dirs.add(path.join(process.env.HF_HOME, "hub"));
  }

  if (process.env.XDG_CACHE_HOME) {
    dirs.add(path.join(process.env.XDG_CACHE_HOME, "huggingface", "hub"));
  }

  const home = os.homedir();
  dirs.add(path.join(home, ".cache", "huggingface", "hub"));
  dirs.add(path.join(home, "Library", "Caches", "huggingface", "hub"));

  return [...dirs];
}

function isMlxModelCached(modelId: string): { cached: boolean; cacheDir: string | null } {
  const parts = modelId.split("/");
  if (parts.length !== 2) return { cached: false, cacheDir: null };

  const [org, repo] = parts;
  const modelFolder = `models--${org}--${repo}`;

  for (const hubDir of getHuggingFaceHubCacheDirs()) {
    const modelDir = path.join(hubDir, modelFolder);
    const snapshotsDir = path.join(modelDir, "snapshots");

    if (!fs.existsSync(snapshotsDir)) continue;

    try {
      const entries = fs.readdirSync(snapshotsDir, { withFileTypes: true });
      const hasAnySnapshot = entries.some((e) => e.isDirectory());
      if (hasAnySnapshot) {
        return { cached: true, cacheDir: modelDir };
      }
    } catch {
      // Ignore unreadable cache locations
    }
  }

  return { cached: false, cacheDir: null };
}

function checkAIAvailability(): AIAvailability {
  let isAppleSilicon = false;
  try {
    const arch = execSync("uname -m", { encoding: "utf-8" }).trim();
    isAppleSilicon = arch === "arm64";
  } catch {
    return { available: false, reason: "Cannot detect architecture", model: null, modelId: null, isAppleSilicon: false };
  }

  if (!isAppleSilicon) {
    return { available: false, reason: "Not Apple Silicon (M1/M2/M3/M4)", model: null, modelId: null, isAppleSilicon };
  }

  const venvPath = path.join(WORKSPACE_ROOT, "scripts/ai/.venv/bin/python3");
  if (!fs.existsSync(venvPath)) {
    return { available: false, reason: "MLX not setup (run: ./scripts/ai/setup-mlx.sh)", model: null, modelId: null, isAppleSilicon };
  }

  try {
    execSync(`${venvPath} -c "import mlx; mlx.__version__"`, { stdio: "pipe", timeout: 5000 });
  } catch {
    return { available: false, reason: "MLX not installed in venv (run: pip install mlx mlx-lm)", model: null, modelId: null, isAppleSilicon };
  }

  // Guard against environments where `import mlx` works but Metal device init crashes
  // (observed as NSException from libmlx on some headless/non-GPU contexts).
  try {
    execSync(`${venvPath} -c "import mlx.core as mx; _ = mx.array([1], dtype=mx.int32)"`, {
      stdio: "pipe",
      timeout: 5000,
    });
  } catch {
    return {
      available: false,
      reason: "MLX runtime unavailable (Metal device init failed)",
      model: null,
      modelId: null,
      isAppleSilicon,
    };
  }

  return { available: true, reason: "Ready (Apple MLX)", model: "Qwen2.5-Coder-1.5B", modelId: MLX_MODEL_ID, isAppleSilicon };
}

async function queryMLX(category: string = "all"): Promise<string> {
  const venvPython = path.join(WORKSPACE_ROOT, "scripts/ai/.venv/bin/python3");
  const scriptPath = path.join(WORKSPACE_ROOT, "scripts/ai/validate.py");
  
  // AI_MAX_TOKENS env allows override (default 200 for speed, 2000 for thorough analysis)
  const maxTokens = process.env.AI_MAX_TOKENS || "200";

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      venvPython,
      [scriptPath, "--json", "--max-tokens", maxTokens, ...(category !== "all" ? ["--prompt", category] : [])],
      {
        cwd: WORKSPACE_ROOT,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          HF_HUB_DISABLE_TELEMETRY: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`MLX validation timed out for category: ${category}`));
    }, 300000);

    child.stdout.on("data", (d: Buffer) => {
      chunks.push(d);
      process.stdout.write(d);
    });

    child.stderr.on("data", (d: Buffer) => {
      errChunks.push(d);
      process.stderr.write(d);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(chunks).toString("utf-8");
      const stderr = Buffer.concat(errChunks).toString("utf-8");

      if (code === 0) {
        resolve(stdout || stderr);
        return;
      }

      reject(new Error(`MLX validation failed (code ${code}) for ${category}: ${stderr.slice(-1000)}`));
    });
  });
}

// =============================================================================
// Static Analysis Utilities
// =============================================================================

function getAbsolutePath(relativePath: string): string {
  return path.join(WORKSPACE_ROOT, relativePath);
}

function getAllFiles(dir: string, extensions: string[]): string[] {
  const files: string[] = [];
  
  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") {
        continue;
      }
      
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

function searchPattern(content: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  let match;
  const regex = new RegExp(pattern.source, pattern.flags);
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[0]);
    if (!pattern.global) break;
  }
  return matches;
}

// =============================================================================
// Tests - Static Analysis
// =============================================================================

describe("Static Analysis - File Structure", () => {
  it("critical files exist", () => {
    const criticalFiles: [string, string][] = [
      ["seed.sql", STATIC_PATHS.seed],
      ["types.ts", STATIC_PATHS.types],
      ["package.json", "package.json"],
      ["tsconfig.json", "tsconfig.json"],
    ];
    
    for (const [name, relativePath] of criticalFiles) {
      const fullPath = getAbsolutePath(relativePath);
      expect(fs.existsSync(fullPath), `Missing: ${name}`).toBe(true);
    }
  });

  it("seed.sql is substantial", () => {
    const seedPath = getAbsolutePath(STATIC_PATHS.seed);
    const content = fs.readFileSync(seedPath, "utf-8");
    expect(content.length).toBeGreaterThan(10000);
  });

  it("migrations directory has SQL files", () => {
    const migrationsPath = getAbsolutePath(STATIC_PATHS.migrations);
    const files = fs.readdirSync(migrationsPath);
    const sqlFiles = files.filter(f => f.endsWith(".sql"));
    expect(sqlFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("types.ts exports Database type", () => {
    const typesPath = getAbsolutePath(STATIC_PATHS.types);
    const content = fs.readFileSync(typesPath, "utf-8");
    expect(content).toContain("export type Database");
  });
});

describe("Static Analysis - Security Patterns", () => {
  let srcFiles: string[];

  beforeAll(() => {
    srcFiles = getAllFiles(getAbsolutePath("src"), [".ts", ".tsx"]);
  });

  it("no sensitive data logging patterns", () => {
    const violations: { file: string; pattern: string; matches: string[] }[] = [];
    
    for (const file of srcFiles) {
      if (file.includes("/tests/") || file.includes(".test.")) continue;
      
      const content = fs.readFileSync(file, "utf-8");
      
      for (const pattern of SECURITY_PATTERNS.securePatterns) {
        const matches = searchPattern(content, pattern);
        if (matches.length > 0) {
          violations.push({
            file: path.relative(WORKSPACE_ROOT, file),
            pattern: pattern.source,
            matches,
          });
        }
      }
    }
    
    if (violations.length > 0) {
      console.warn("sensitive data logging violations:", violations);
    }
    
    expect(violations.length, `Found ${violations.length} sensitive data logging violations`).toBe(0);
  });

  it("no direct sensitive data table access (warning)", () => {
    const violations: { file: string; pattern: string }[] = [];
    
    for (const file of srcFiles) {
      if (file.includes("/tests/") || file.includes(".test.")) continue;
      
      const content = fs.readFileSync(file, "utf-8");
      
      for (const pattern of SECURITY_PATTERNS.directTableAccess) {
        const matches = searchPattern(content, pattern);
        if (matches.length > 0) {
          violations.push({
            file: path.relative(WORKSPACE_ROOT, file),
            pattern: pattern.source,
          });
        }
      }
    }
    
    if (violations.length > 0) {
      console.warn("Direct sensitive data table access:", violations);
    }
    
    expect(true).toBe(true); // Warning only
  });

  it("no unsafe patterns (eval, new Function)", () => {
    const violations: { file: string; pattern: string; matches: string[] }[] = [];

    // PR #93 (RAG evaluation foundation) tripped this gate with the literal
    // text "RAG ev" + "al (Step 0..." inside a JSDoc comment — the unsafe
    // pattern regex matched the comment word, not an actual code call.
    // Strip line + block comments before scanning so the gate only flags
    // real code paths (string-literals containing the pattern still match,
    // which is intentional — code-as-string is exactly what we want to
    // catch).
    function stripCommentsAndJsdoc(src: string): string {
      // /* ... */ block comments (including JSDoc), non-greedy.
      let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
      // // ... line comments (rest of line). Avoid matching `://` in URLs.
      out = out.replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
      return out;
    }

    for (const file of srcFiles) {
      if (file.includes("/tests/") || file.includes(".test.")) continue;

      const raw = fs.readFileSync(file, "utf-8");
      const content = stripCommentsAndJsdoc(raw);

      for (const pattern of SECURITY_PATTERNS.unsafePatterns) {
        const matches = searchPattern(content, pattern);
        if (matches.length > 0) {
          violations.push({
            file: path.relative(WORKSPACE_ROOT, file),
            pattern: pattern.source,
            matches,
          });
        }
      }
    }

    if (violations.length > 0) {
      console.warn("Unsafe patterns:", JSON.stringify(violations, null, 2));
    }

    expect(violations.length, `Found ${violations.length} unsafe patterns`).toBe(0);
  });
});

describe("Static Analysis - Seed SQL", () => {
  let seedContent: string;

  // By default we allow seed.sql to contain backup/restore data.
  // If you want to enforce a "clean seed" (no sensitive data/user data, only @platform.local emails),
  // run tests with: PLATFORM_VALIDATE_CLEAN_SEED=true
  const validateCleanSeed = (() => {
    const raw = process.env.PLATFORM_VALIDATE_CLEAN_SEED;
    if (!raw) return false;
    return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
  })();

  beforeAll(() => {
    const seedRelPath = process.env.PLATFORM_SEED_PATH || STATIC_PATHS.seed;
    const seedPath = path.isAbsolute(seedRelPath) ? seedRelPath : getAbsolutePath(seedRelPath);
    seedContent = fs.readFileSync(seedPath, "utf-8");
  });

  it("has INSERT statements for critical tables", () => {
    // Platforma sama; projektové tabulky se neseedují (PROJEKTOVE_TABULKY).
    const criticalTables = [
      "auth.users",
      "public.profiles",
      "public.user_roles",
      "public.roles",
      "public.system_config",
    ];
    
    for (const table of criticalTables) {
      expect(seedContent, `Missing INSERT for ${table}`).toContain(table);
    }
  });

  it.skipIf(!validateCleanSeed)("clean seed: does not include user-generated sensitive data data", () => {
    const disallowedTables = [
      "public.health_check_ins",
      "public.lab_results",
      "public.dosing_logs",
      "public.questionnaire_responses",
    ];

    for (const table of disallowedTables) {
      expect(seedContent, `seed.sql must not insert into ${table}`).not.toContain(`INSERT INTO ${table}`);
      expect(seedContent, `seed.sql must not insert into ${table}`).not.toContain(`INSERT INTO\n${table}`);
    }
  });

  it.skipIf(!validateCleanSeed)("clean seed: does not contain non-local email addresses", () => {
    // Prevent committing production-like PII into seed.
    // Allow only @platform.local (used for system seed users).
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const emails = seedContent.match(emailRegex) || [];
    const nonLocal = emails.filter((e) => !e.toLowerCase().endsWith("@platform.local"));
    expect(nonLocal, `Non-local emails found in seed.sql: ${nonLocal.join(", ")}`).toHaveLength(0);
  });

  it("never leaves a trigger disabled", () => {
    // Vlastnost, ne přítomnost slov: vypnutý trigger musí být v témže textu zase
    // zapnutý (viz vypnuteTriggeryBezZapnuti — naměřený výpadek na produkci).
    expect(vypnuteTriggeryBezZapnuti(seedContent)).toEqual([]);
  });

  it("uses ON CONFLICT for idempotency", () => {
    const onConflictCount = (seedContent.match(/ON CONFLICT/gi) || []).length;
    expect(onConflictCount).toBeGreaterThan(5);
  });

  it("has no hardcoded production secrets", () => {
    const sensitivePatterns = [
      /sk_live_[a-zA-Z0-9]+/g,
      /pk_live_[a-zA-Z0-9]+/g,
      /AISHA_POSTGREST_SERVICE_KEY/g,
    ];
    
    for (const pattern of sensitivePatterns) {
      expect(searchPattern(seedContent, pattern).length).toBe(0);
    }
  });
});

describe("Static Analysis - i18n", () => {
  it("locale files exist", () => {
    const i18nPath = getAbsolutePath(STATIC_PATHS.i18n);
    expect(fs.existsSync(path.join(i18nPath, "en.json"))).toBe(true);
    expect(fs.existsSync(path.join(i18nPath, "cs.json"))).toBe(true);
  });

  it("locale files are valid JSON", () => {
    const i18nPath = getAbsolutePath(STATIC_PATHS.i18n);
    const files = fs.readdirSync(i18nPath).filter(f => f.endsWith(".json"));
    
    for (const file of files) {
      const content = fs.readFileSync(path.join(i18nPath, file), "utf-8");
      expect(() => JSON.parse(content), `Invalid JSON: ${file}`).not.toThrow();
    }
  });

  it("EN locale has substantial content", () => {
    const enPath = path.join(getAbsolutePath(STATIC_PATHS.i18n), "en.json");
    const content = JSON.parse(fs.readFileSync(enPath, "utf-8"));
    const keyCount = JSON.stringify(content).split('":').length;
    expect(keyCount).toBeGreaterThan(1000);
  });
});

// Backup directory is a local development artifact, not committed to repo
const backupDirectoryExists = fs.existsSync(getAbsolutePath(STATIC_PATHS.backup));

describe("Static Analysis - Backup Data", () => {
  it.skipIf(!backupDirectoryExists)("backup directory has CSV files", () => {
    const backupPath = getAbsolutePath(STATIC_PATHS.backup);
    const files = fs.readdirSync(backupPath).filter(f => f.endsWith(".csv"));
    expect(files.length).toBeGreaterThan(50);
  });

  it.skipIf(!backupDirectoryExists)("backup files are readable", () => {
    const backupPath = getAbsolutePath(STATIC_PATHS.backup);
    const files = fs.readdirSync(backupPath).filter(f => f.endsWith(".csv"));
    
    const samplesToCheck = files.slice(0, 5);
    for (const file of samplesToCheck) {
      const content = fs.readFileSync(path.join(backupPath, file), "utf-8");
      expect(content.length, `Empty file: ${file}`).toBeGreaterThan(0);
    }
  });

  it.skipIf(!backupDirectoryExists)("critical backup files exist", () => {
    const backupPath = getAbsolutePath(STATIC_PATHS.backup);
    const files = fs.readdirSync(backupPath);
    
    const criticalTables = ["profiles", "studies", "user_roles"];
    
    for (const table of criticalTables) {
      const hasBackup = files.some(f => f.includes(table) && f.endsWith(".csv"));
      expect(hasBackup, `Missing backup for: ${table}`).toBe(true);
    }
  });
});

// =============================================================================
// Tests - AI-Powered Analysis (Apple MLX)
// =============================================================================

describe("AI-Powered Static Analysis", () => {
  const ai = checkAIAvailability();
  const modelCache = ai.modelId ? isMlxModelCached(ai.modelId) : { cached: false, cacheDir: null };
  const aiEnabled = ai.available && modelCache.cached;
  const maxTokens = process.env.AI_MAX_TOKENS || "200";

  it("reports AI availability", () => {
    console.log("\n🤖 AI Static Analysis Status:");
    console.log(`   Apple Silicon: ${ai.isAppleSilicon ? "✅ Yes" : "❌ No"}`);
    console.log(`   Available: ${ai.available ? "✅ Yes" : "❌ No"}`);
    console.log(`   Reason: ${ai.reason}`);
    console.log(`   Model cached: ${modelCache.cached ? "✅ Yes" : "❌ No"}`);
    if (modelCache.cacheDir) {
      console.log(`   Cache dir: ${modelCache.cacheDir}`);
    }
    console.log(`   AI checks enabled: ${aiEnabled ? "✅ Yes" : "❌ No (model not cached)"}`);
    console.log(`   Max tokens: ${maxTokens}`);
    if (ai.model) {
      console.log(`   Model: ${ai.model}`);
    }
    
    if (!ai.available && ai.isAppleSilicon) {
      console.log("\n   To enable AI validation:");
      console.log("   ./scripts/ai/setup-mlx.sh");
    }

    if (ai.available && !modelCache.cached) {
      console.log("\n   To enable AI checks (download model once):");
      console.log("   ./scripts/ai/setup-mlx.sh");
      console.log("   ./scripts/ai/.venv/bin/python3 scripts/ai/validate.py --check seed --json");
    }
    
    expect(true).toBe(true);
  });

  it.skipIf(!aiEnabled)(
    "AI: runs full validation (all categories)",
    async () => {
      console.log("\n🚀 Running full AI validation (single model load)...");
      console.log(`   Categories: seed, security, hooks, i18n, migrations, rpc, rls`);
      console.log(`   Max tokens: ${maxTokens}`);
      console.log("");
      
      const output = await queryMLX("all");
      
      console.log("\n" + "=".repeat(60));
      console.log("📊 AI Validation Results (MLX):");
      console.log("=".repeat(60));
      
      try {
        const results = JSON.parse(output);
        
        // Display each category result
        for (const [category, result] of Object.entries(results)) {
          console.log(`\n📁 ${category.toUpperCase()}:`);
          console.log(JSON.stringify(result, null, 2));
        }
        
        // Collect issues across all categories
        const issues: string[] = [];
        
        if (results.migrations?.rule_issues?.length > 0) {
          issues.push(...results.migrations.rule_issues.map(
            (i: { file: string; message: string }) => `migrations: ${i.file} - ${i.message}`
          ));
        }
        
        if (results.rpc?.audited_issues?.length > 0) {
          issues.push(...results.rpc.audited_issues.map(
            (i: { function: string; message: string }) => `rpc: ${i.function} - ${i.message}`
          ));
        }
        
        if (results.rls?.secure_tables_missing_rls?.length > 0) {
          issues.push(...results.rls.secure_tables_missing_rls.map(
            (t: string) => `rls: sensitive data table "${t}" missing RLS`
          ));
        }
        
        if (issues.length > 0) {
          console.log("\n⚠️  Potential Issues Found:");
          issues.forEach(i => console.log(`   - ${i}`));
        } else {
          console.log("\n✅ No critical issues detected");
        }
        
      } catch {
        console.log("Raw output (last 2000 chars):");
        console.log(output.slice(-2000));
      }
      
      expect(true).toBe(true);
    },
    600000 // 10 min timeout for full analysis
  );
});

// =============================================================================
// Summary
// =============================================================================

describe("Summary", () => {
  it("prints summary", () => {
    console.log("\n" + "=".repeat(60));
    console.log("📋 AI Static Validation Summary");
    console.log("=".repeat(60));
    console.log(`
This test suite performs comprehensive static analysis:

Static Tests (always run):
  ✅ File structure validation
  ✅ Security pattern detection (sensitive data logging, unsafe code)
  ✅ Seed SQL validation
  ✅ i18n locale validation
  ✅ Backup data validation

AI Tests (Apple Silicon + MLX required):
  🤖 seed       - Seed SQL logic validation
  🤖 security   - Security code review
  🤖 hooks      - React hooks patterns
  🤖 i18n       - i18n completeness
  🤖 migrations - SQL migration security review
  🤖 rpc        - RPC function patterns (_audited suffix)
  🤖 rls        - RLS policy completeness

Setup AI: ./scripts/ai/setup-mlx.sh
Run: npm run test:static

Configure:
  AI_MAX_TOKENS=200   # Fast (default)
  AI_MAX_TOKENS=2000  # Thorough analysis
`);
    expect(true).toBe(true);
  });
});
