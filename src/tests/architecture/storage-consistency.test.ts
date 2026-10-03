/**
 * Storage Bucket Consistency Test
 *
 * Ensures all storage buckets used in application code are defined in
 * the source of truth (aisha/db/sql/storage/*.sql)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT_DIR = path.resolve(__dirname, "../../..");
const SRC_DIR = path.join(ROOT_DIR, "src");
const STORAGE_SQL_DIR = path.join(ROOT_DIR, "aisha/db/sql/storage");

// Known storage buckets that should exist
// Note: All archive documents go to archive-scans bucket
// Access control is via DB columns (is_public, is_download_public)
const EXPECTED_BUCKETS = [
  "archive-scans",     // Archive documents (public read, app-controlled access)
  "email-assets",      // Email template assets (logos, badges - public)
  "health-documents",  // sensitive data documents (private, authenticated only)
  "hero-images",       // Marketing images (public)
  "product-images",    // Product catalog images (public)
];

describe("Storage Bucket Consistency", () => {
  it("should have SQL definition for all expected buckets", () => {
    const sqlFiles = fs.readdirSync(STORAGE_SQL_DIR).filter((f) => f.endsWith(".sql"));

    for (const bucket of EXPECTED_BUCKETS) {
      const sqlFile = `${bucket}.sql`;
      expect(
        sqlFiles.includes(sqlFile),
        `Missing SQL file for bucket: ${bucket}`
      ).toBe(true);
    }
  });

  it("should define bucket creation in each SQL file", () => {
    for (const bucket of EXPECTED_BUCKETS) {
      const sqlPath = path.join(STORAGE_SQL_DIR, `${bucket}.sql`);
      const content = fs.readFileSync(sqlPath, "utf-8");

      expect(
        content.includes(`INSERT INTO storage.buckets`),
        `${bucket}.sql should contain INSERT INTO storage.buckets`
      ).toBe(true);

      expect(
        content.includes(`'${bucket}'`),
        `${bucket}.sql should reference bucket name '${bucket}'`
      ).toBe(true);
    }
  });

  it("should have RLS policies for each bucket", () => {
    for (const bucket of EXPECTED_BUCKETS) {
      const sqlPath = path.join(STORAGE_SQL_DIR, `${bucket}.sql`);
      const content = fs.readFileSync(sqlPath, "utf-8");

      expect(
        content.includes("CREATE POLICY"),
        `${bucket}.sql should define at least one RLS policy`
      ).toBe(true);

      expect(
        content.includes(`bucket_id = '${bucket}'`),
        `${bucket}.sql policies should reference bucket_id = '${bucket}'`
      ).toBe(true);
    }
  });

  it("should not use buckets in code that are not in source of truth", () => {
    // Recursively find all TypeScript files
    function getAllTsFiles(dir: string): string[] {
      const files: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.includes("node_modules") && entry.name !== "tests") {
          files.push(...getAllTsFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          files.push(fullPath);
        }
      }

      return files;
    }

    const tsFiles = getAllTsFiles(SRC_DIR);
    const sqlFiles = fs.readdirSync(STORAGE_SQL_DIR).filter((f) => f.endsWith(".sql"));
    const definedBuckets = sqlFiles.map((f) => f.replace(".sql", ""));

    // Regex to find storage.from('bucket-name') or storage.from("bucket-name")
    const bucketUsageRegex = /\.storage\.from\(['"]([a-z0-9-]+)['"]\)/g;

    const usedBuckets = new Set<string>();

    for (const file of tsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      let match;
      while ((match = bucketUsageRegex.exec(content)) !== null) {
        usedBuckets.add(match[1]);
      }
    }

    for (const bucket of usedBuckets) {
      expect(
        definedBuckets.includes(bucket),
        `Bucket '${bucket}' is used in code but not defined in aisha/db/sql/storage/`
      ).toBe(true);
    }
  });

  it("should include all storage buckets in generated baseline migration", () => {
    const migrationsDir = path.join(ROOT_DIR, "aisha/db/migrations");
    // Note: Supabase skips migrations named '_init', so we use 'baseline' instead
    const migrations = fs.readdirSync(migrationsDir).filter((f) => f.includes("baseline.sql"));

    expect(migrations.length).toBeGreaterThan(0);

    const baselineMigration = fs.readFileSync(path.join(migrationsDir, migrations[0]), "utf-8");

    for (const bucket of EXPECTED_BUCKETS) {
      expect(
        baselineMigration.includes(`'${bucket}'`),
        `Baseline migration should include bucket '${bucket}'`
      ).toBe(true);
    }
  });

  it("should have seed-storage script with correct folder mappings", () => {
    const seedStoragePath = path.join(ROOT_DIR, "scripts/db/seed-storage.mjs");
    expect(fs.existsSync(seedStoragePath), "seed-storage.mjs should exist").toBe(true);

    const content = fs.readFileSync(seedStoragePath, "utf-8");

    // Should have folder mappings
    expect(
      content.includes("FOLDER_MAPPING"),
      "seed-storage.mjs should define FOLDER_MAPPING"
    ).toBe(true);

    // Should reference archive-scans bucket (main bucket for documents)
    expect(
      content.includes("archive-scans"),
      "seed-storage.mjs should reference archive-scans bucket"
    ).toBe(true);
  });
});

describe("Email Template Consistency", () => {
  const EMAIL_SCRIPT_PATH = path.join(ROOT_DIR, "scripts/email/update-email-i18n.mjs");
  const SEGMENTS_DIR = path.join(ROOT_DIR, "src/i18n/segments");
  const LANGS = ["en", "cs", "de", "fr", "ru", "th"];

  it("should have email template update script", () => {
    expect(
      fs.existsSync(EMAIL_SCRIPT_PATH),
      "update-email-i18n.mjs should exist"
    ).toBe(true);
  });

  it("should have email template translations for all languages", () => {
    for (const lang of LANGS) {
      const authSegmentPath = path.join(SEGMENTS_DIR, lang, "auth.json");
      expect(
        fs.existsSync(authSegmentPath),
        `${lang}/auth.json should exist`
      ).toBe(true);

      const content = JSON.parse(fs.readFileSync(authSegmentPath, "utf-8"));
      expect(
        content.auth?.emailTemplates,
        `${lang}/auth.json should have emailTemplates section`
      ).toBeDefined();
    }
  });

  it("should have consistent email template keys across languages", () => {
    const enPath = path.join(SEGMENTS_DIR, "en", "auth.json");
    const enContent = JSON.parse(fs.readFileSync(enPath, "utf-8"));
    const enKeys = Object.keys(enContent.auth?.emailTemplates?.common || {});

    for (const lang of LANGS.filter((l) => l !== "en")) {
      const langPath = path.join(SEGMENTS_DIR, lang, "auth.json");
      if (!fs.existsSync(langPath)) continue;

      const langContent = JSON.parse(fs.readFileSync(langPath, "utf-8"));
      const langKeys = Object.keys(langContent.auth?.emailTemplates?.common || {});

      // All EN keys should exist in other languages
      for (const key of enKeys) {
        expect(
          langKeys.includes(key),
          `${lang}/auth.json emailTemplates.common should have key '${key}'`
        ).toBe(true);
      }
    }
  });

  it("should have email-assets bucket for email logos", () => {
    const emailAssetsSql = path.join(ROOT_DIR, "aisha/db/sql/storage/email-assets.sql");
    expect(
      fs.existsSync(emailAssetsSql),
      "email-assets.sql should exist for email branding"
    ).toBe(true);

    const content = fs.readFileSync(emailAssetsSql, "utf-8");
    expect(
      content.includes("email-assets"),
      "email-assets.sql should define email-assets bucket"
    ).toBe(true);
  });
});
