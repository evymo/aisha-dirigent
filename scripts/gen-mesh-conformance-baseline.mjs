#!/usr/bin/env node
/**
 * gen-mesh-conformance-baseline — snapshot which stacks are NOT yet on the mesh.
 *
 * The target shape (owner, 2026-07-30) is: inbound only through edge, internally
 * everything on the mesh. Converting ~17 stacks is a migration, so the gate
 * `mesh-inside-edge-outside` ratchets against this baseline instead of blocking:
 * the list may only shrink, a new offender fails, and a stack that became
 * conformant must leave the list.
 *
 * WHY A GENERATOR AND NOT A HAND-KEPT FILE: a baseline is a generated artefact,
 * and a generated artefact tempts an editor exactly when it conflicts — the next
 * regeneration then overwrites the edit without a word. Regenerate, never edit.
 *
 * The predicate has ONE owner — scripts/lib/mesh-conformance.mjs — imported by
 * both this generator and the gate. A baseline computed by a second
 * implementation would eventually disagree with the check it exists to serve,
 * and the disagreement would read as migration progress.
 *
 * Usage:
 *   node scripts/gen-mesh-conformance-baseline.mjs            # print the diff
 *   node scripts/gen-mesh-conformance-baseline.mjs --write    # update the file
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src/tests/gates/mesh-inside-edge-outside.baseline.json");
const WRITE = process.argv.includes("--write");

import { nonMeshStacks, ownPublicRouterOffenders } from "./lib/mesh-conformance.mjs";

const next = {
  $comment:
    "Stacks not yet converted to the target shape (inbound only through edge, " +
    "internally everything on the mesh). " +
    "Snapshot 2026-07-30. The gate fails on any NEW offender and on stale entries " +
    "(a stack that became conformant must be removed). Drain with dedicated PRs, " +
    "in the order the doc gives: core first (most edges point at it), then the " +
    "gateway, then one stack at a time; public routers come off LAST because until " +
    "then they are the only working way in. REGENERATE, never hand-edit.",
  $comment_univerzum:
    "2026-08-21: univerzum se ROZŠÍŘILO. Do té doby jím byly stacky s " +
    "`placement: backend` — jenže placement říká, na kterém STROJI služba běží, " +
    "ne jestli ji někdo zevnitř oslovuje jménem. Brána tak nikdy neviděla " +
    "extranet (frontend), ledger ani exec (experimental), a extranet přitom edge " +
    "volá vnitřním jménem, které bez mesh propadlo wildcardem na cizí stroj (502 " +
    "po každém přihlášení). Nové kritérium: služba s vnitřní adresou v katalogu " +
    "(`internal_url` / `internal_endpoints`). Položky, které se tím poprvé " +
    "ukázaly, NEJSOU nová vada — je to dluh, který měřidlo dosud nevidělo. " +
    "Přiznaný dluh se splácí, ne schovává; ráčna dál brání RŮSTU.",
  stacks_without_mesh: nonMeshStacks(),
  own_public_router: ownPublicRouterOffenders(),
};

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf-8")) : { stacks_without_mesh: [], own_public_router: [] };
const gone = (prev.stacks_without_mesh ?? []).filter((x) => !next.stacks_without_mesh.includes(x));
const added = next.stacks_without_mesh.filter((x) => !(prev.stacks_without_mesh ?? []).includes(x));

console.log(`mimo mesh: ${next.stacks_without_mesh.length}  ·  vlastní veřejný router: ${next.own_public_router.length}`);
if (gone.length) console.log(`  ✅ převedeno: ${gone.join(", ")}`);
if (added.length) console.log(`  ⚠️ nově mimo: ${added.join(", ")}`);

if (!WRITE) {
  console.log("\n(bez --write se nic nezapisuje)");
} else {
  writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n");
  console.log(`\nzapsáno → ${OUT}`);
}
