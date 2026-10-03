#!/usr/bin/env python3
"""Mass-rebrand legacy stack subdomains onto the public TLD.

Single-pass directory walk. Idempotent.

Domain tokens are env-driven (no hardcoded hostnames in source), mirroring
config/domains.env (PUBLIC_TLD / INTERNAL_TLD). The operator supplies the
legacy source TLD and the target public TLD at run time; the only thing that
lives in code is the semantic, TLD-independent subdomain rename table.

Required env:
  REBRAND_FROM_TLD   legacy/source TLD to replace (the retired internal TLD)
  REBRAND_TO_TLD     target public TLD
Optional env (Keycloak/n8n realm identifier rename; overridable defaults):
  REBRAND_FROM_REALM (default: evymo)
  REBRAND_TO_REALM   (default: aisha)

Skips trash/, archive/, node_modules, dist, .git, lock files and tenant data
(see ALLOWLIST). Only the mapped subdomains are rewritten; unmapped legacy
hosts (external services, infra aliases) are left untouched.

Usage:
  REBRAND_FROM_TLD=<legacy.tld> REBRAND_TO_TLD=<public.tld> \\
    python3 scripts/rebrand-id3a-to-aisha-guru.py
"""
from __future__ import annotations
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def _require_env(name: str) -> str:
    """Fail-fast env read — no hardcoded hostnames allowed in source."""
    val = os.environ.get(name, "").strip()
    if not val:
        sys.stderr.write(
            f"ERROR: {name} not set. Rebrand domains are env-driven — "
            f"export {name}=... (see this module's docstring).\n"
        )
        sys.exit(1)
    return val


# Deployment-specific domain tokens come from the environment (fail-fast),
# exactly like the rest of the toolchain (config/domains.env: PUBLIC_TLD /
# INTERNAL_TLD). Nothing infra-specific is hardcoded here.
FROM_TLD = _require_env("REBRAND_FROM_TLD")
TO_TLD = _require_env("REBRAND_TO_TLD")
# Keycloak/n8n realm identifier rename (company -> product). Overridable; the
# defaults are identifiers (not hostnames) following the documented rename.
FROM_REALM = os.environ.get("REBRAND_FROM_REALM", "evymo").strip()
TO_REALM = os.environ.get("REBRAND_TO_REALM", "aisha").strip()

# Subdomain rename table — semantic and TLD-independent. Each legacy
# `<sub>.${FROM_TLD}` maps to its `<sub>.${TO_TLD}` on the public zone; a few
# subdomains are also renamed (kc->auth, dirigent*->api/db/web, aisha->n8n).
MAPPING: dict[str, str] = {
    f"kc.{FROM_TLD}": f"auth.{TO_TLD}",
    f"dirigent-api.{FROM_TLD}": f"api.{TO_TLD}",
    f"dirigent-studio.{FROM_TLD}": f"db.{TO_TLD}",
    f"dirigent.{FROM_TLD}": f"web.{TO_TLD}",
    f"rpc.aisha.{FROM_TLD}": f"rpc.{TO_TLD}",
    f"aisha.{FROM_TLD}": f"n8n.{TO_TLD}",
    f"n8n.{FROM_TLD}": f"n8n.{TO_TLD}",
    f"langfuse.{FROM_TLD}": f"langfuse.{TO_TLD}",
    f"matrix.{FROM_TLD}": f"matrix.{TO_TLD}",
    f"element.{FROM_TLD}": f"element.{TO_TLD}",
    f"call.{FROM_TLD}": f"call.{TO_TLD}",
    f"livekit.{FROM_TLD}": f"livekit.{TO_TLD}",
    f"turn.{FROM_TLD}": f"turn.{TO_TLD}",
    f"appsmith.{FROM_TLD}": f"appsmith.{TO_TLD}",
    f"nocodb.{FROM_TLD}": f"nocodb.{TO_TLD}",
    f"pki.{FROM_TLD}": f"pki.{TO_TLD}",
    f"realms/{FROM_REALM}": f"realms/{TO_REALM}",
}

# Sort longest-first so dirigent-api is replaced before dirigent.
SORTED_KEYS = sorted(MAPPING.keys(), key=len, reverse=True)

IGNORE_DIRS = {
    "node_modules", "dist", ".git", "trash", "archive",
    "playwright-report", "test-results", "coverage",
    ".next", ".turbo", ".cache",
}

IGNORE_FILES = {"package-lock.json", "bun.lockb"}

# Workspace-relative paths NEVER touched.
ALLOWLIST = {
    "supabase/seed.instance.sql",
    "scripts/rebrand-id3a-to-aisha-guru.py",
    "scripts/rebrand-id3a-to-aisha-guru.sh",
    "src/tests/gates/legacy-domains.gate.test.ts",
}

TEXT_EXT = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".json", ".yml", ".yaml", ".toml",
    ".md", ".sh", ".env",
    ".sql", ".conf", ".properties",
}


def is_scannable(path: Path) -> bool:
    name = path.name
    if name in IGNORE_FILES or name.endswith(".lock"):
        return False
    if path.suffix in TEXT_EXT:
        return True
    if name == "Dockerfile" or name.startswith("Dockerfile."):
        return True
    if name.startswith(".env"):
        return True
    return False


def main() -> int:
    changed_files = 0
    total_replacements = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for filename in filenames:
            abs_path = Path(dirpath) / filename
            if not is_scannable(abs_path):
                continue
            rel = abs_path.relative_to(ROOT).as_posix()
            if rel in ALLOWLIST:
                continue
            try:
                content = abs_path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            new_content = content
            file_changes = 0
            for key in SORTED_KEYS:
                if key in new_content:
                    occurrences = new_content.count(key)
                    new_content = new_content.replace(key, MAPPING[key])
                    file_changes += occurrences
            if file_changes > 0:
                abs_path.write_text(new_content, encoding="utf-8")
                changed_files += 1
                total_replacements += file_changes
                print(f"  {rel}: {file_changes} replacement(s)")
    print()
    print(f"Replaced {total_replacements} occurrence(s) across {changed_files} file(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
