/**
 * Env-doktor odvodí PKI_BUNDLE_REQUIRED i z VÝSLOVNÉHO inventáře (`MANIFEST_FILE`).
 *
 * ⛔ NAMĚŘENO 2026-09-27 nad trezorem <fork>: manifest instance leží v jejích
 * datech mimo overlay `manifests/` a stack ho má jen gitignorovaný, takže ho
 * výchozí dveře (overlay → repo) nenajdou. Redeploy i cold-start ho proto berou
 * VÝSLOVNĚ z `MANIFEST_FILE` — doktor, jejich dítě na cestě redeploye, ho
 * nečetl: `PKI_BUNDLE_REQUIRED se neodvodil (manifest instance nenalezen)`
 * a v chybě radil `--manifest`, přepínač, který doktor odmítne.
 *
 * Co se drží (měří se ZAPSANÝ soubor a stderr, ne text kódu):
 *   1. `MANIFEST_FILE` s `app: pki:` → `true`, bez něj → `false` — obě odpovědi,
 *      aby brána nešla „projít“ doktoru, který píše konstantu;
 *   2. bez výslovného manifestu (a bez nalezitelného) zůstane klíč PRÁZDNÝ
 *      a rada v hlášce jde provést: `MANIFEST_FILE=<path>`, ne `--manifest`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { envDoktorDokoncil } from "./_env-doktor-dokoncil";

const ROOT = process.cwd();
const DOKTOR = join(ROOT, "scripts/aisha-env-doctor.mjs");
// Identita, pro kterou v repu ani overlayi manifest NENÍ — výchozí dveře musí selhat.
const IDENTITA = "zkouskapki";

function behDoktora(manifest: string | null): { stderr: string; hodnota: string | undefined } {
  const dir = mkdtempSync(join(tmpdir(), "aisha-doktor-pki-"));
  const envFile = join(dir, "env.coolify");
  try {
    const {
      MANIFEST_FILE: _m,
      AISHA_INSTANCE_CONFIG_DIR: _o,
      AISHA_INSTANCE_DATA_GIT_URL: _d,
      AISHA_OVERLAY_REQUIRED: _r,
      ...prostredi
    } = process.env;
    let manifestPath: string | undefined;
    if (manifest !== null) {
      manifestPath = join(dir, "vyslovny.manifest");
      writeFileSync(manifestPath, manifest);
    }
    const beh = spawnSync("node", [DOKTOR, "--no-external"], {
      cwd: ROOT,
      env: {
        ...prostredi,
        ENV_FILE: envFile,
        AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi",
        APP_NAME_PREFIX: IDENTITA,
        AISHA_STORY: IDENTITA,
        ...(manifestPath ? { MANIFEST_FILE: manifestPath } : {}),
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    if (beh.error) throw beh.error;
    if (!envDoktorDokoncil(beh.status) || !existsSync(envFile)) {
      throw new Error(`env-doktor skončil ${beh.status}: ${(beh.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}`);
    }
    const radek = readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("PKI_BUNDLE_REQUIRED="));
    return {
      stderr: beh.stderr ?? "",
      hodnota: radek?.slice("PKI_BUNDLE_REQUIRED=".length).replace(/^["']|["']$/g, ""),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hlavicka = `story: ${IDENTITA}\nrepo: aisha/${IDENTITA}\nbranch: main\n`;

describe("env-doktor: PKI_BUNDLE_REQUIRED z výslovného MANIFEST_FILE", () => {
  test("manifest s `app: pki:` → true; bez PKI → false (obě odpovědi, ne konstanta)", () => {
    const s = behDoktora(`${hlavicka}app: pki:backend:docker-compose.coolify-pki.yml\n`);
    const bez = behDoktora(`${hlavicka}app: web:frontend:docker-compose.coolify-edge.yml\n`);
    expect({ sPki: s.hodnota, bezPki: bez.hodnota }).toEqual({ sPki: "true", bezPki: "false" });
    expect(s.stderr).not.toMatch(/PKI_BUNDLE_REQUIRED se neodvodil/);
  });

  test("bez výslovného manifestu: klíč PRÁZDNÝ a rada jde provést (MANIFEST_FILE, ne --manifest)", () => {
    const { stderr, hodnota } = behDoktora(null);
    expect(hodnota ?? "").toBe("");
    const hlaska = stderr.split("\n").find((l) => l.includes("PKI_BUNDLE_REQUIRED se neodvodil")) ?? "";
    expect(hlaska, "doktor musí prázdno sám ohlásit").not.toBe("");
    expect(hlaska).toContain("MANIFEST_FILE=<path>");
    expect(hlaska).not.toContain("--manifest");
  });
});
