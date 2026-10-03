/**
 * Shared topology SoT reader for the domain gates.
 *
 * The INTERNAL domain zone is server-specific: `<svc>.<server>.<INTERNAL_TLD>`
 * (e.g. api.backend.id3a.cz) — each server hosts a distinct slice of the stack.
 * The set of server roles is NOT hardcoded in any gate; it is read DYNAMICALLY
 * from the topology source of truth `coolify/servers.json` (its `servers` keys:
 * frontend/backend/experimental/build for the AISHA reference; a fork edits that
 * file to add/rename cluster nodes). So the whole zoning design stays dynamic
 * per deployment — gates account for the topology instead of circumventing it.
 *
 * Used by: legacy-domains.gate.test.ts, domain-zoning.gate.test.ts.
 */
import fs from "node:fs";
import path from "node:path";

// src/tests/gates/lib/ → repo root is four levels up.
const ROOT = path.resolve(__dirname, "../../../..");

/**
 * Server roles from `coolify/servers.json` (`servers` object keys), lowercased.
 * Falls back to the AISHA reference roles only when the topology SoT is absent
 * or unreadable (partial checkout), so the gates still function.
 */
export function getServerRoles(): Set<string> {
  const roles = new Set<string>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "coolify/servers.json"), "utf8"));
    if (raw && typeof raw.servers === "object" && raw.servers) {
      for (const id of Object.keys(raw.servers as Record<string, unknown>)) {
        roles.add(String(id).toLowerCase());
      }
    }
  } catch {
    /* topology SoT absent/unreadable — fall back below */
  }
  if (roles.size === 0) {
    for (const r of ["frontend", "backend", "experimental", "build"]) roles.add(r);
  }
  return roles;
}
