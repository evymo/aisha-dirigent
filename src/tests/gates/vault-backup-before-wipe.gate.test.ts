/**
 * vault-backup-before-wipe.gate.test.ts — refuse-wipe-unless-backed-up.
 *
 * A --wipe DELETEs apps WITH their Coolify env + volumes (delete_configurations /
 * delete_volumes) — that is the ONLY server-side copy of the stack secrets. This
 * gate enforces that cold-start ALWAYS backs the vault up before the destroy, and
 * REFUSES to wipe if the backup fails (mirroring the validate-before-destroy +
 * placeholder guards). Loss of the vault = unrecoverable encryption keys / validator
 * identity on the next generate-secrets run.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CS = join(ROOT, "scripts/aisha-cold-start.sh");

describe("pre-wipe vault backup — refuse-wipe-unless-backed-up", () => {
  const sh = readFileSync(CS, "utf-8");

  test("backup runs (guarded by WIPE_PENDING) and REFUSES the wipe on failure — before the destroy", () => {
    expect(sh).toMatch(/backup_vault_before_wipe\(\)\s*\{/); // defined
    const guardIdx = sh.search(/if \[ "\$WIPE_PENDING" = "1" \]; then\s*\n\s*info "Pre-wipe vault backup/);
    expect(guardIdx, "a WIPE_PENDING-guarded backup block must exist").toBeGreaterThan(-1);
    // The backup guard must appear BEFORE the destroy block.
    // Komentář mezi rozhodnutím a voláním není vada — měří se POŘADÍ, ne bílé znaky.
    const destroyIdx = sh.search(
      /if \[ "\$WIPE_PENDING" = "1" \]; then(?:\s*\n\s*#[^\n]*)*\s*\n\s*wipe_orphan_apps/,
    );
    expect(destroyIdx, "the WIPE_PENDING→wipe_orphan_apps destroy block must exist").toBeGreaterThan(-1);
    expect(guardIdx, "backup must run BEFORE the destroy").toBeLessThan(destroyIdx);
    // On failure it must EXIT non-zero (platform left intact), not warn-and-continue.
    const block = sh.slice(guardIdx, destroyIdx);
    expect(block).toMatch(/if ! backup_vault_before_wipe; then[\s\S]*?REFUSING TO WIPE[\s\S]*?exit 1/);
  });

  test("backup_vault_before_wipe reverse-syncs, snapshots locally, and does off-machine age only when configured", () => {
    const start = sh.indexOf("backup_vault_before_wipe() {");
    const body = sh.slice(start, sh.indexOf("\n}", start));
    // Reverse-sync via the shared tool (recover secrets that live only in Coolify).
    expect(body).toMatch(/coolify-pull-envs\.mjs/);
    // Local snapshot floor (no key) — mode 600.
    expect(body).toMatch(/tar -czf/);
    expect(body).toMatch(/chmod 600/);
    // Off-machine layer gated on an operator-configured age recipient.
    expect(body).toMatch(/AISHA_VAULT_BACKUP_AGE_RECIPIENT/);
    // Escape hatch for operators holding their own backup.
    expect(body).toMatch(/AISHA_WIPE_SKIP_VAULT_BACKUP/);
  });

  test("the age off-machine layer publishes CIPHERTEXT only (never plaintext) to instance-data", () => {
    const start = sh.indexOf("backup_vault_age_to_instance_data() {");
    expect(start, "age helper must be defined").toBeGreaterThan(-1);
    const body = sh.slice(start, sh.indexOf("\n}", start));
    expect(body).toMatch(/age -r "\$AISHA_VAULT_BACKUP_AGE_RECIPIENT"/); // encrypt to recipient
    expect(body).toMatch(/\.age/); // only .age artifacts leave the machine
    expect(body).toMatch(/AISHA_INSTANCE_DATA_GIT_URL/); // published to the private instance-data repo
  });
});
