#!/usr/bin/env node
/**
 * DB Manager — CLI Entry Point
 *
 * Unified CLI for database source-of-truth management.
 *
 * Sub-commands:
 *   source   — Source-of-truth analyzer (SQL ↔ Frontend parity)
 *   access   — Access-flow security analyzer (SECURITY DEFINER, RLS, consent)
 *   flow     — Flow consistency analyzer (hook → RPC → DB)
 *   lint     — SQL source file linter
 *   status   — Show current state summary
 *
 * Usage:
 *   node scripts/db/db-manager/index.mjs [command] [options]
 *   npm run db-mgr [-- command] [-- options]
 *
 * @module
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { hashContent, loadState, getChangedItems } from "./lib/state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const SQL_DIR = path.join(ROOT, "aisha", "db", "sql");

const command = process.argv[2] || "status";
const args = process.argv.slice(3);

function runSubCommand(script) {
  const scriptPath = path.join(__dirname, script);
  try {
    execSync(`node "${scriptPath}" ${args.join(" ")}`, {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

function showStatus() {
  console.log("🗃️  DB Manager — Status\n");

  const categories = ["functions", "tables", "policies", "triggers", "indexes", "enums", "views"];

  for (const cat of categories) {
    const dir = path.join(SQL_DIR, cat);
    const stateFile = path.join(SQL_DIR, `.${cat.replace(/s$/, "")}-state.json`);
    // Also try plural form
    const stateFile2 = path.join(SQL_DIR, `.${cat}-state.json`);

    if (!existsSync(dir)) {
      console.log(`  ${cat}: ⚠️  directory missing`);
      continue;
    }

    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

    // Try to load state and show changes
    const state = loadState(existsSync(stateFile) ? stateFile : stateFile2);
    const currentItems = {};
    for (const file of files) {
      const name = file.replace(".sql", "");
      currentItems[name] = readFileSync(path.join(dir, file), "utf-8");
    }

    const changes = getChangedItems(currentItems, state);
    const parts = [];
    if (changes.added.length > 0) parts.push(`+${changes.added.length} new`);
    if (changes.modified.length > 0) parts.push(`~${changes.modified.length} modified`);
    if (changes.removed.length > 0) parts.push(`-${changes.removed.length} removed`);

    const changeStr = parts.length > 0 ? ` (${parts.join(", ")})` : " (up to date)";
    console.log(`  ${cat}: ${files.length} files${changeStr}`);
  }

  // Migration info
  const migrationsDir = path.join(ROOT, "aisha", "db", "migrations");
  if (existsSync(migrationsDir)) {
    const migrations = readdirSync(migrationsDir).filter(
      (f) => f.endsWith(".sql") || (existsSync(path.join(migrationsDir, f)) && !f.startsWith("."))
    );
    console.log(`\n  migrations: ${migrations.length} files`);
  }

  console.log("\n💡 Commands: source | access | flow | lint | status");
}

switch (command) {
  case "source":
    runSubCommand("source.mjs");
    break;
  case "access":
    runSubCommand("access.mjs");
    break;
  case "flow":
    runSubCommand("flow.mjs");
    break;
  case "lint":
    runSubCommand("lint.mjs");
    break;
  case "status":
    showStatus();
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(`
🗃️  DB Manager — Database Source of Truth Management

Commands:
  status   Show current state summary (default)
  source   Source-of-truth analyzer (SQL ↔ Frontend parity)
  access   Access-flow security analyzer
  flow     Flow consistency analyzer (hook → RPC → DB)
  lint     SQL source file linter

Usage:
  npm run db-mgr                    # status
  npm run db-mgr -- source          # source-of-truth analysis
  npm run db-mgr:source             # shorthand
  npm run db-mgr:access             # access-flow analysis
  npm run db-mgr:access -- --static # file-based only (no DB)
  npm run db-mgr:flow               # flow consistency
  npm run db-mgr:lint               # SQL linting
`);
    break;
  default:
    console.error(`❌ Unknown command: "${command}"\n`);
    console.error("Available: status | source | access | flow | lint | help");
    process.exit(1);
}
