import { afterAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hlaskyPovinnychKlicu } from "./lib/hlasky-z-compose.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "gen-hlaska-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// Hláška se bere z compose (ne opsaná): přesně ten text, který trezor guru nesl.
const hlasky = hlaskyPovinnychKlicu(ROOT);
const nejdelsi = (k) => [...(hlasky.get(k) ?? [])].sort((a, b) => b.length - a.length)[0];

function spust(zaloha) {
  const backup = join(TMP, `backup-${Math.random().toString(36).slice(2)}`);
  const coolify = join(TMP, `coolify-${Math.random().toString(36).slice(2)}`);
  writeFileSync(backup, zaloha.join("\n") + "\n");
  writeFileSync(coolify, "\n");
  return spawnSync(process.execPath, [join(ROOT, "scripts/generate-secrets.mjs"), "--preserve=1", `--env-backup=${backup}`, `--env-coolify=${coolify}`], {
    cwd: ROOT,
    env: { ...process.env, APP_NAME_PREFIX: "aisha", KC_ADMIN_CLIENT_SECRET: "", EXTRANET_OIDC_SECRET: "", KC_ADMIN_CLIENT_ID: "" },
    encoding: "utf8",
  });
}
const hodnota = (out, k) => new RegExp(`^${k}='?([^'\\n]*)'?$`, "m").exec(out)?.[1];

describe("generate-secrets: hláška z compose v trezoru není hodnota (naměřeno 2026-09-16 na guru)", () => {
  test("předpoklad: compose hlášky pro tyto klíče skutečně nese", () => {
    expect(nejdelsi("KC_ADMIN_CLIENT_SECRET")?.length).toBeGreaterThan(20);
    expect(nejdelsi("EXTRANET_OIDC_SECRET")?.length).toBeGreaterThan(20);
  });

  test("⛔ tajemství s hláškou se zahodí a dosadí čerstvé; ID klienta dostane výchozí; běh to řekne jménem", () => {
    const r = spust([
      `KC_ADMIN_CLIENT_SECRET=${nejdelsi("KC_ADMIN_CLIENT_SECRET")}`,
      `EXTRANET_OIDC_SECRET=${nejdelsi("EXTRANET_OIDC_SECRET")}`,
    ]);
    expect(r.status, r.stderr).toBe(0);
    const kc = hodnota(r.stdout, "KC_ADMIN_CLIENT_SECRET");
    const ex = hodnota(r.stdout, "EXTRANET_OIDC_SECRET");
    expect(kc).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(ex).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(r.stdout).not.toContain(nejdelsi("KC_ADMIN_CLIENT_SECRET").slice(0, 30));
    expect(r.stderr).toMatch(/KC_ADMIN_CLIENT_SECRET: hodnotou je HLÁŠKA/);
    expect(r.stderr).toMatch(/neslo v trezoru hlášku místo hodnoty: EXTRANET_OIDC_SECRET, KC_ADMIN_CLIENT_SECRET/);
  });

  test("negativní sonda: skutečná hodnota se zachová a nic se nehlásí", () => {
    const skutecna = "Zc3v0Q-real-secret-0123456789abcdefghijklmno";
    const r = spust([`KC_ADMIN_CLIENT_SECRET=${skutecna}`]);
    expect(r.status, r.stderr).toBe(0);
    expect(hodnota(r.stdout, "KC_ADMIN_CLIENT_SECRET")).toBe(skutecna);
    expect(r.stderr).not.toMatch(/HLÁŠKA/);
  });
});
