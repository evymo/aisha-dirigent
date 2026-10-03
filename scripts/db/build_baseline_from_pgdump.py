#!/usr/bin/env python3
"""Build a clean baseline migration from pg_dump output + SoT storage files."""

import os
import datetime

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PGDUMP_PATH = "/tmp/pg_dump_public_schema.sql"
SOT_STORAGE_DIR = os.path.join(REPO_ROOT, "supabase", "sql", "storage")
OUTPUT_PATH = os.path.join(REPO_ROOT, "supabase", "migrations", "00000000000000_baseline.sql")


def main():
    # Read pg_dump
    with open(PGDUMP_PATH, "r") as f:
        pg_lines = f.readlines()

    # Filter out problematic lines
    filtered = []
    for line in pg_lines:
        stripped = line.strip()
        # Skip \restrict and \unrestrict lines (psql-specific, PG17)
        if stripped.startswith("\\restrict") or stripped.startswith("\\unrestrict"):
            continue
        # Skip CREATE SCHEMA public (already exists in Supabase)
        if stripped == "CREATE SCHEMA public;":
            continue
        # Skip ALTER DEFAULT PRIVILEGES (permission denied in Supabase migration runner)
        if stripped.startswith("ALTER DEFAULT PRIVILEGES"):
            continue
        filtered.append(line)

    # Read storage SoT files
    storage_files = []
    if os.path.isdir(SOT_STORAGE_DIR):
        storage_files = sorted(
            f for f in os.listdir(SOT_STORAGE_DIR) if f.endswith(".sql")
        )
    storage_sql = []
    for sf in storage_files:
        with open(os.path.join(SOT_STORAGE_DIR, sf), "r") as f:
            content = f.read().strip()
            storage_sql.append(f"\n-- Storage: {sf}\n{content}\n")

    # Build final baseline
    now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    header = (
        "-- Evymo Platform - Baseline Migration\n"
        f"-- Generated from pg_dump + SoT storage at: {now}\n"
        "-- Source: pg_dump --schema-only -n public (PG 17.6)\n"
        "-- Contains: enums, tables, constraints, functions, triggers, indexes, "
        "RLS, policies, views, grants\n"
        "\n"
        "-- Safety guard: prevent re-applying onto existing schema\n"
        "DO $$\n"
        "BEGIN\n"
        "  IF EXISTS (\n"
        "    SELECT 1 FROM pg_tables\n"
        "    WHERE schemaname = 'public' AND tablename = 'profiles'\n"
        "  ) THEN\n"
        "    RAISE NOTICE 'Baseline already applied (profiles table exists), skipping.';\n"
        "    RETURN;\n"
        "  END IF;\n"
        "END $$;\n"
        "\n"
        "-- Required extensions (installed into 'extensions' schema by Supabase)\n"
        "CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;\n"
        "CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;\n"
        "CREATE EXTENSION IF NOT EXISTS btree_gist;\n"
        "\n"
    )

    # Write output
    with open(OUTPUT_PATH, "w") as f:
        f.write(header)
        f.writelines(filtered)

        if storage_sql:
            f.write(
                "\n\n-- ========================================"
                "==================================\n"
            )
            f.write("-- STORAGE BUCKETS\n")
            f.write(
                "-- ========================================"
                "==================================\n"
            )
            for s in storage_sql:
                f.write(s)

    # Stats
    with open(OUTPUT_PATH, "r") as f:
        line_count = sum(1 for _ in f)
    file_size = os.path.getsize(OUTPUT_PATH)
    print(f"Baseline generated: {line_count} lines, {file_size / 1024 / 1024:.1f} MB")
    print(f"Storage files included: {len(storage_files)}")
    print(f"Output: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
