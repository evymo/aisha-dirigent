#!/usr/bin/env node
// =============================================================================
// Register n8n-nodes-aisha in n8n's PostgreSQL database
// =============================================================================
//
// PURPOSE:
//   n8n's community packages loader reads from the installed_packages table,
//   NOT from the filesystem. Packages installed via entrypoint (npm install)
//   exist on disk but are invisible to n8n without DB registration.
//
//   This script runs in the ENTRYPOINT, BEFORE n8n starts:
//     1. Finds pg module from n8n's own installation
//     2. Connects to the n8n PostgreSQL database
//     3. Upserts into installed_packages table
//     4. n8n at startup finds the package in DB → loads from disk → nodes available
//
//   On the VERY FIRST startup (before n8n creates its tables), this script
//   gracefully skips. N8N_CUSTOM_EXTENSIONS serves as fallback for that case.
//
// ENVIRONMENT VARIABLES (from docker-compose):
//   DB_POSTGRESDB_HOST     — PostgreSQL host (default: postgresql)
//   DB_POSTGRESDB_PORT     — PostgreSQL port (default: 5432)
//   DB_POSTGRESDB_DATABASE — Database name (default: n8n)
//   DB_POSTGRESDB_USER     — Username
//   DB_POSTGRESDB_PASSWORD — Password
// =============================================================================

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = (msg) => console.log(`[REGISTER] ${msg}`);

// ── Find pg module from n8n's installation ──────────────────────────────────

let Client;
const searchPaths = [
  // n8n's own pg dependency (most reliable)
  "/usr/local/lib/node_modules/n8n",
  // Global node_modules (hoisted)
  "/usr/local/lib/node_modules",
  // Fallback: direct require
  null,
];

for (const basePath of searchPaths) {
  try {
    if (basePath) {
      const req = createRequire(join(basePath, "package.json"));
      Client = req("pg").Client;
    } else {
      // Direct import as last resort
      const pg = await import("pg");
      Client = pg.default?.Client || pg.Client;
    }
    if (Client) break;
  } catch {
    // Try next path
  }
}

if (!Client) {
  log("⚠️ pg module not found — skipping DB registration");
  log("Nodes will be loaded via N8N_CUSTOM_EXTENSIONS fallback");
  process.exit(0);
}

// ── Read package metadata ───────────────────────────────────────────────────

const pkgJsonPath = join(__dirname, "..", "package.json");
let pkgJson;
try {
  pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
} catch (err) {
  log(`⚠️ Cannot read package.json: ${err.message}`);
  process.exit(0);
}

const packageName = pkgJson.name;
const version = pkgJson.version;
const authorName = pkgJson.author?.name || "AISHA Platform";
const authorEmail = pkgJson.author?.email || "dev@evymo.com";

// ── Connect to n8n's PostgreSQL and register ────────────────────────────────

async function main() {
  const client = new Client({
    host: process.env.DB_POSTGRESDB_HOST || "postgresql",
    port: parseInt(process.env.DB_POSTGRESDB_PORT || "5432", 10),
    database: process.env.DB_POSTGRESDB_DATABASE || "n8n",
    user: process.env.DB_POSTGRESDB_USER,
    password: process.env.DB_POSTGRESDB_PASSWORD,
    // Short timeouts — don't block entrypoint if DB has issues
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });

  try {
    await client.connect();

    // Check if installed_packages table exists
    // On the VERY FIRST n8n startup, this table won't exist yet (n8n creates it via migrations).
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'installed_packages'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      log("Table installed_packages not found — first run, skipping");
      log("Nodes will be loaded via N8N_CUSTOM_EXTENSIONS on first startup");
      return;
    }

    // Upsert the package record
    // n8n at startup reads this table → finds package → loads from disk → registers nodes
    await client.query(
      `INSERT INTO installed_packages ("packageName", "installedVersion", "authorName", "authorEmail", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT ("packageName")
       DO UPDATE SET "installedVersion" = $2, "updatedAt" = NOW()`,
      [packageName, version, authorName, authorEmail]
    );

    log(`✅ ${packageName} v${version} registered in n8n DB`);

    // Also register other community packages if they're installed on disk
    const otherPackages = [
      { name: "n8n-nodes-globals", dir: join(__dirname, "..", "..", "n8n-nodes-globals") },
      { name: "n8n-nodes-document-generator", dir: join(__dirname, "..", "..", "n8n-nodes-document-generator") },
      { name: "n8n-nodes-langfuse", dir: join(__dirname, "..", "..", "n8n-nodes-langfuse") },
    ];

    for (const pkg of otherPackages) {
      try {
        const otherPkgJson = JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf-8"));
        await client.query(
          `INSERT INTO installed_packages ("packageName", "installedVersion", "authorName", "authorEmail", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT ("packageName")
           DO UPDATE SET "installedVersion" = $2, "updatedAt" = NOW()`,
          [
            pkg.name,
            otherPkgJson.version,
            otherPkgJson.author?.name || null,
            otherPkgJson.author?.email || null,
          ]
        );
        log(`✅ ${pkg.name} v${otherPkgJson.version} registered`);
      } catch {
        // Package not installed on disk yet — skip silently
      }
    }
  } catch (err) {
    log(`⚠️ DB registration failed: ${err.message}`);
    log("Nodes will be loaded via N8N_CUSTOM_EXTENSIONS fallback");
  } finally {
    try {
      await client.end();
    } catch {
      // intentional: best-effort pg client cleanup
    }
  }
}

main();
