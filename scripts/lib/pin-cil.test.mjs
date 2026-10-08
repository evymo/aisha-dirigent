// Jednouzlový pin AISHA_TARGET_SERVER nesmí přišpendlit hlavní stack na GPU uzel
// (revize accel-1, 10-05, bod 2). Spouští se SKUTEČNÝ blok z aisha-cold-start.sh,
// vyříznutý mezi značkami — ne opis; err/info/warn jsou jen zástupci výpisu.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COLD = readFileSync(join(KOREN, "scripts/aisha-cold-start.sh"), "utf8");
const ZACATEK = '  if [ -n "${AISHA_TARGET_SERVER:-}" ]; then\n    _target_upper=';
const KONEC = "    unset _target_upper _target_key _target_uuid\n  fi\n";
const i = COLD.indexOf(ZACATEK);
const j = COLD.indexOf(KONEC, i);
const BLOK = i >= 0 && j > i ? COLD.slice(i, j + KONEC.length) : "";

function spust(env) {
  const skript = [
    'err(){ echo "ERR $*" >&2; }; info(){ echo "INFO $*"; }; warn(){ echo "WARN $*"; }',
    `REPO_ROOT='${KOREN}'`,
    BLOK,
    'echo "F=${COOLIFY_SERVER_UUID_FRONTEND:-} B=${COOLIFY_SERVER_UUID_BACKEND:-} G=${COOLIFY_SERVER_UUID_GPU:-}"',
  ].join("\n");
  const ciste = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(COOLIFY_SERVER_UUID_|AISHA_TARGET_SERVER)/.test(k)));
  return spawnSync("bash", ["-c", skript], { encoding: "utf8", env: { ...ciste, ...env } });
}

describe("pin AISHA_TARGET_SERVER × slot s výslovnou vazbou (GPU)", () => {
  it("blok pinu v cold-startu existuje (jinak test neměří nic)", () => {
    expect(BLOK.length, "blok pinu nenalezen mezi značkami").toBeGreaterThan(200);
  });

  it("AISHA_TARGET_SERVER=gpu = STOP, nic se nepřišpendlí", () => {
    const r = spust({ AISHA_TARGET_SERVER: "gpu", COOLIFY_SERVER_UUID_GPU: "server-gpu", COOLIFY_SERVER_UUID_FRONTEND: "server-f" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/slot s výslovnou vazbou \(GPU uzel\) nejde použít jako cíl/);
  }, 30_000);

  it("cíl pod jiným jménem, ale s UUID GPU serveru = STOP", () => {
    const r = spust({ AISHA_TARGET_SERVER: "frontend", COOLIFY_SERVER_UUID_FRONTEND: "server-gpu", COOLIFY_SERVER_UUID_GPU: "server-gpu" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/míří na server slotu 'gpu'/);
  }, 30_000);

  it("kotva: pin na frontend přišpendlí připnutelné sloty, GPU slot zůstane svůj", () => {
    const r = spust({ AISHA_TARGET_SERVER: "frontend", COOLIFY_SERVER_UUID_FRONTEND: "server-f", COOLIFY_SERVER_UUID_GPU: "server-gpu" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/F=server-f B=server-f G=server-gpu/);
  }, 30_000);

  it("jméno serveru, které není slot (single-host podle jména), projde jako dřív", () => {
    const r = spust({ AISHA_TARGET_SERVER: "Hlavni" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/WARN AISHA_TARGET_SERVER=Hlavni but COOLIFY_SERVER_UUID_HLAVNI is empty/);
  }, 30_000);
});
