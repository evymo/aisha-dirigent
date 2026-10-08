// Behaviorální test drift-watch: nezměřený server aplikace (serverUnmeasured z
// drift-checku) se započítá — drift-watch nesmí nad ním zapsat „no drift".
// Skript se spouští v kopii s falešným coolify-drift-check.mjs vedle sebe (čte ho
// relativně ke SCRIPT_DIR), takže nic nesahá na repo ani na Coolify.
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Každý test spouští skutečný bash skript (s node a jq) — pod zátěží sdíleného stroje
// to trvá víc než výchozích 5 s; strop proto výslovně.
const STROP_MS = 60_000;
const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const koreny = [];
afterEach(() => {
  for (const k of koreny.splice(0)) rmSync(k, { recursive: true, force: true });
});

function spust(drift) {
  const koren = mkdtempSync(join(tmpdir(), "drift-watch-"));
  koreny.push(koren);
  mkdirSync(join(koren, "scripts", "lib"), { recursive: true });
  copyFileSync(join(SCRIPTS, "drift-watch.sh"), join(koren, "scripts", "drift-watch.sh"));
  copyFileSync(join(SCRIPTS, "lib", "log.sh"), join(koren, "scripts", "lib", "log.sh"));
  writeFileSync(
    join(koren, "scripts", "coolify-drift-check.mjs"),
    `process.stdout.write(${JSON.stringify(JSON.stringify(drift))} + "\\n");\n`,
  );
  const env = { ...process.env };
  delete env.AISHA_DRIFT_WEBHOOK_URL;
  delete env.AISHA_DRIFT_IGNORE;
  const r = spawnSync("bash", [join(koren, "scripts", "drift-watch.sh")], { encoding: "utf8", env, timeout: 60_000 });
  return { kod: r.status, vystup: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const prazdny = { orphaned: [], missing: [], composeDrift: [], serverDrift: [] };

describe("drift-watch započítá nezměřený server", () => {
  it("bez driftu a bez nezměřeného → no drift, kód 0", () => {
    const r = spust({ ...prazdny, serverUnmeasured: [] });
    expect(r.kod, r.vystup).toBe(0);
    expect(r.vystup).toMatch(/no drift/);
  }, STROP_MS);

  it("⛔ jen nezměřený server → NENÍ no drift (drift detected, kód 1)", () => {
    const r = spust({ ...prazdny, serverUnmeasured: [{ name: "zkouska-alfa", host: "frontend", reason: "COOLIFY_SERVER_UUID_FRONTEND nenastaveno" }] });
    expect(r.vystup).not.toMatch(/no drift/);
    expect(r.vystup).toMatch(/drift detected/);
    expect(r.kod).toBe(1);
  }, STROP_MS);

  it("starší výstup bez pole serverUnmeasured se čte jako nula, ne jako chyba", () => {
    const r = spust(prazdny);
    expect(r.kod, r.vystup).toBe(0);
  }, STROP_MS);
});
