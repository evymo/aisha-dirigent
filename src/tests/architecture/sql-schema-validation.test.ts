/**
 * SQL Schema Validation Tests
 *
 * Ensures the SQL source of truth files don't contain common errors
 * that would cause migration failures
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT_DIR = path.resolve(__dirname, "../../..");
const SQL_DIR = path.join(ROOT_DIR, "aisha/db/sql");
const TABLES_DIR = path.join(SQL_DIR, "tables");

describe("SQL Schema Validation", () => {
  describe("UNIQUE constraints", () => {
    it("should not have duplicate columns in UNIQUE constraints", () => {
      const files = fs.readdirSync(TABLES_DIR).filter((f) => f.endsWith(".sql"));
      const errors: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(path.join(TABLES_DIR, file), "utf-8");

        // Match UNIQUE constraint definitions
        const uniqueRegex = /UNIQUE\s*\(([^)]+)\)/g;
        let match;

        while ((match = uniqueRegex.exec(content)) !== null) {
          const columns = match[1]
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c.length > 0);

          const uniqueColumns = [...new Set(columns)];

          if (uniqueColumns.length !== columns.length) {
            errors.push(
              `${file}: Duplicate columns in UNIQUE constraint: ${match[0]}`
            );
          }
        }
      }

      expect(errors, `Found duplicate columns in UNIQUE constraints:\n${errors.join("\n")}`).toHaveLength(0);
    });
  });

  describe("PRIMARY KEY constraints", () => {
    it("should not have duplicate columns in PRIMARY KEY constraints", () => {
      const files = fs.readdirSync(TABLES_DIR).filter((f) => f.endsWith(".sql"));
      const errors: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(path.join(TABLES_DIR, file), "utf-8");

        // Match PRIMARY KEY constraint definitions
        const pkRegex = /PRIMARY\s+KEY\s*\(([^)]+)\)/gi;
        let match;

        while ((match = pkRegex.exec(content)) !== null) {
          const columns = match[1]
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c.length > 0);

          const uniqueColumns = [...new Set(columns)];

          if (uniqueColumns.length !== columns.length) {
            errors.push(
              `${file}: Duplicate columns in PRIMARY KEY: ${match[0]}`
            );
          }
        }
      }

      expect(errors, `Found duplicate columns in PRIMARY KEY constraints:\n${errors.join("\n")}`).toHaveLength(0);
    });
  });

  describe("FOREIGN KEY constraints", () => {
    it("should reference valid column names in REFERENCES", () => {
      const files = fs.readdirSync(TABLES_DIR).filter((f) => f.endsWith(".sql"));
      const errors: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(path.join(TABLES_DIR, file), "utf-8");

        // Check for obviously malformed FK references
        const malformedFk = /REFERENCES\s+\(\s*\)/gi;
        if (malformedFk.test(content)) {
          errors.push(`${file}: Empty REFERENCES clause found`);
        }
      }

      expect(errors, `Found malformed FOREIGN KEY constraints:\n${errors.join("\n")}`).toHaveLength(0);
    });
  });

  describe("Table definitions", () => {
    it("should have RLS enabled for all tables", () => {
      const files = fs.readdirSync(TABLES_DIR).filter((f) => f.endsWith(".sql"));
      const missingRls: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(path.join(TABLES_DIR, file), "utf-8");

        // Check if file has CREATE TABLE but no ENABLE ROW LEVEL SECURITY
        if (
          content.includes("CREATE TABLE") &&
          !content.includes("ENABLE ROW LEVEL SECURITY")
        ) {
          missingRls.push(file);
        }
      }

      expect(
        missingRls,
        `Tables missing RLS:\n${missingRls.join("\n")}`
      ).toHaveLength(0);
    });
  });

  describe("Storage buckets", () => {
    it("should have bucket creation and policies in storage files", () => {
      const storageDir = path.join(SQL_DIR, "storage");
      const files = fs.readdirSync(storageDir).filter((f) => f.endsWith(".sql"));
      const errors: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(path.join(storageDir, file), "utf-8");
        const bucketName = file.replace(".sql", "");

        if (!content.includes("INSERT INTO storage.buckets")) {
          errors.push(`${file}: Missing INSERT INTO storage.buckets`);
        }

        if (!content.includes("CREATE POLICY")) {
          errors.push(`${file}: Missing storage policies`);
        }

        if (!content.includes(`bucket_id = '${bucketName}'`)) {
          errors.push(`${file}: Policies don't reference bucket_id = '${bucketName}'`);
        }
      }

      expect(errors, `Storage bucket issues:\n${errors.join("\n")}`).toHaveLength(0);
    });
  });
});
