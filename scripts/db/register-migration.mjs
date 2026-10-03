#!/usr/bin/env node
/**
 * Migration Registry Manager
 *
 * Scans aisha/db/migrations/ for .sql files and registers any unregistered
 * migrations into migration-registry.json.
 *
 * Usage:
 *   node scripts/db/register-migration.mjs
 *   npm run db:migration:register
 *
 * @module
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
// Phase 1 rebrand: use aisha/db/ as SOT (no more supabase/ except trash/)
const MIGRATIONS_DIR = path.join(ROOT, "aisha", "db", "migrations");
const REGISTRY_PATH = path.join(ROOT, "aisha", "db", "migration-registry.json");
const SCHEMA_PATH = path.join(ROOT, "aisha", "db", "migration-registry.schema.json");

function normalizeRegistry(existing, allFiles) {
  return {
    ...(existing ?? {}),
    ...(existsSync(SCHEMA_PATH) ? { $schema: "./migration-registry.schema.json" } : {}),
    version: existing?.version ?? "1.0.0",
    description:
      "Registry of approved non-baseline migrations. Managed by: npm run db:migration:register",
    note:
      allFiles.length === 0
        ? "Baseline-only state: no non-baseline migrations are currently present in aisha/db/migrations/."
        : `Tracks ${allFiles.length} non-baseline migration(s) currently present on disk.`,
    migrations: [...allFiles],
  };
}

// Ensure registry exists
if (!existsSync(REGISTRY_PATH)) {
  const initial = normalizeRegistry({}, []);
  writeFileSync(REGISTRY_PATH, JSON.stringify(initial, null, 2) + "\n");
  console.log("📝 Created migration-registry.json");
}

const existingRegistry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

// Get all migration files except baseline
const allFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql") && f !== "00000000000000_baseline.sql")
  .sort();

const normalizedRegistry = normalizeRegistry(existingRegistry, allFiles);
const existing = new Set(Array.isArray(existingRegistry.migrations) ? existingRegistry.migrations : []);
const next = new Set(normalizedRegistry.migrations);
const newMigrations = normalizedRegistry.migrations.filter((f) => !existing.has(f));
const removedMigrations = [...existing].filter((f) => !next.has(f));
const metadataChanged = JSON.stringify(existingRegistry) !== JSON.stringify(normalizedRegistry);

if (!metadataChanged && newMigrations.length === 0 && removedMigrations.length === 0) {
  console.log(`✅ All ${allFiles.length} migrations are already registered`);
  process.exit(0);
}

writeFileSync(REGISTRY_PATH, JSON.stringify(normalizedRegistry, null, 2) + "\n");

if (newMigrations.length > 0) {
  console.log(`✅ Registered ${newMigrations.length} new migration(s):`);
  newMigrations.forEach((m) => console.log(`   + ${m}`));
}

if (removedMigrations.length > 0) {
  console.log(`🧹 Removed ${removedMigrations.length} stale registry entr${removedMigrations.length === 1 ? "y" : "ies"}:`);
  removedMigrations.forEach((m) => console.log(`   - ${m}`));
}

if (newMigrations.length === 0 && removedMigrations.length === 0) {
  console.log("✅ Normalized migration-registry.json metadata");
}

console.log(`\n   Total: ${normalizedRegistry.migrations.length} migrations registered`);
