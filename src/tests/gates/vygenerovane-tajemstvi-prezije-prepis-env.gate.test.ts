/**
 * Vygenerované tajemství přežije přepis `.env.coolify` cold-startem.
 *
 * ⛔ NAMĚŘENO 2026-09-16 na instanci (tři běhy `--skip-create`, hash hodnot):
 * 11 tajemství (AISHA_AS/HS_TOKEN, AISHA_PKI_BOOTSTRAP_*, GRAFANA_ADMIN_PASSWORD,
 * INGEST_DROP_*, INTRANET_API_KEY, POSTGRES_EXPORTER_PASSWORD) mělo po KAŽDÉM
 * běhu jinou hodnotu. Heredoc je nezapisuje, záloha je nenese nebo je REGEN_KEYS
 * vyřadí — nový soubor je ztratil a env-doktor je vyrobil znovu. Rozbité tím:
 * Appsmith datasource (provision existující přeskočí → starý klíč → 401), admin
 * Grafany (heslo se nastaví jen při založení DB), a každý běh přidal do MinIO
 * dalšího rw uživatele bucketu.
 *
 * Brána `kontrakt-nema-dva-domovy` měří „nejvýš jeden zápis na klíč" — klíč s NULA
 * zápisy projde a doktor ho pak „doplní" novou hodnotou. Tahle brána měří opačnou
 * půlku: SPOUŠTÍ skutečný blok průchodu z aisha-cold-start.sh (vyříznutý mezi
 * `_klice_zapsane="$(mktemp)"` a jeho `unset`, s reálným REGEN_KEY_PATTERNS
 * a reálným kontraktem doktora) nad fixturou a čte, co zapsal.
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const COLD_START = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");

function vyrizni(od: string, po: string): string {
  const i = COLD_START.indexOf(od);
  const j = i < 0 ? -1 : COLD_START.indexOf(po, i);
  if (i < 0 || j < 0) throw new Error(`blok ${od} … ${po} v aisha-cold-start.sh nenalezen — měřidlo přestalo sedět`);
  return COLD_START.slice(i, j + po.length);
}

const REGEN = vyrizni("  REGEN_KEY_PATTERNS=(", 'REGEN_KEYS="^($(IFS="|"; printf "%s" "${REGEN_KEY_PATTERNS[*]}"))="');
const PRUCHOD = vyrizni('  _klice_zapsane="$(mktemp)"', "  unset _klice_zapsane _tajne_z_minula");

type Vysledek = { status: number | null; stderr: string; zapsano: Map<string, string[]> };

function prepis(opts: { heredoc: string; minuly?: string; zaloha: string; preserve?: string }): Vysledek {
  const dir = mkdtempSync(join(tmpdir(), "aisha-prepis-env-"));
  try {
    const tmpEnv = join(dir, "tmp.env");
    const envCoolify = join(dir, "env.coolify");
    const zaloha = join(dir, "env-prod-backup");
    writeFileSync(tmpEnv, opts.heredoc);
    if (opts.minuly !== undefined) writeFileSync(envCoolify, opts.minuly);
    writeFileSync(zaloha, opts.zaloha);
    const skript = [
      "set -uo pipefail",
      'err() { echo "ERR: $*" >&2; }',
      REGEN,
      PRUCHOD,
    ].join("\n");
    const beh = spawnSync("bash", ["-c", skript], {
      cwd: ROOT,
      env: {
        ...process.env,
        REPO_ROOT: ROOT,
        TMP_ENV: tmpEnv,
        ENV_COOLIFY: envCoolify,
        ENV_PROD_BACKUP: zaloha,
        PRESERVE_STATEFUL_SECRETS: opts.preserve ?? "1",
        AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi",
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    const zapsano = new Map<string, string[]>();
    for (const radek of readFileSync(tmpEnv, "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(radek);
      if (m) zapsano.set(m[1], [...(zapsano.get(m[1]) ?? []), m[2]]);
    }
    return { status: beh.status, stderr: beh.stderr ?? "", zapsano };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Klíče z naměřeného incidentu — všechny jsou v kontraktu doktora druhu `secret`
// (ověřuje první test, jinak by fixtura měřila něco jiného než nasazení).
const NESENY_JEN_MINULE = "AISHA_AS_TOKEN";
const VYRAZENY_REGEN = "INTRANET_API_KEY";
const V_ZALOZE_I_MINULE = "GRAFANA_ADMIN_PASSWORD";
const ZAPSANY_HEREDOCEM = "JWT_SECRET";

describe("vygenerované tajemství přežije přepis .env.coolify (brána)", () => {
  const kontrakt = spawnSync("node", ["scripts/aisha-env-doctor.mjs", "--print-contract-keys"], {
    cwd: ROOT,
    env: { ...process.env, AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi" },
    encoding: "utf8",
    timeout: 60_000,
  }).stdout;
  const druh = (k: string) => new RegExp(`^${k}\\t(\\S+)$`, "m").exec(kontrakt)?.[1];
  const odvozeny = /^([A-Z0-9_]+)\tderived$/m.exec(kontrakt)?.[1] ?? "";

  test("fixtura měří skutečné druhy: incidentní klíče jsou tajemství, odvozený existuje, INTRANET je v REGEN", () => {
    for (const k of [NESENY_JEN_MINULE, VYRAZENY_REGEN, V_ZALOZE_I_MINULE, ZAPSANY_HEREDOCEM]) expect(druh(k), k).toBe("secret");
    expect(odvozeny, "kontrakt nemá žádný derived klíč").not.toBe("");
    expect(REGEN).toContain(`'${VYRAZENY_REGEN}'`);
  });

  const zakladniFixtura = {
    heredoc: `${ZAPSANY_HEREDOCEM}=z-heredocu\n`,
    minuly: [
      `${NESENY_JEN_MINULE}=minula-hodnota-as`,
      `${VYRAZENY_REGEN}=minula-hodnota-intranet`,
      `${V_ZALOZE_I_MINULE}=minula-hodnota-grafana`,
      `${ZAPSANY_HEREDOCEM}=minuly-jwt`,
      `${odvozeny}=stara-odvozena-hodnota`,
      "",
    ].join("\n"),
    zaloha: [`${V_ZALOZE_I_MINULE}=hodnota-z-trezoru`, `${VYRAZENY_REGEN}=trezor-intranet`, ""].join("\n"),
  };

  test("⛔ tajemství, které nese jen minulý .env.coolify, se NEZTRATÍ (doktor by vyrobil nové)", () => {
    const r = prepis(zakladniFixtura);
    expect(r.status, r.stderr).toBe(0);
    expect(r.zapsano.get(NESENY_JEN_MINULE)).toEqual(["minula-hodnota-as"]);
  });

  test("⛔ tajemství vyřazené REGEN_KEYS ze zálohy se převezme z minulého .env.coolify", () => {
    const r = prepis(zakladniFixtura);
    expect(r.zapsano.get(VYRAZENY_REGEN)).toEqual(["minula-hodnota-intranet"]);
  });

  test("hodnota z trezoru vyhraje nad minulým .env.coolify (pořadí jako pg(): backup → .env.coolify)", () => {
    const r = prepis(zakladniFixtura);
    expect(r.zapsano.get(V_ZALOZE_I_MINULE)).toEqual(["hodnota-z-trezoru"]);
  });

  test("co zapsal heredoc, vyhraje a klíč je v souboru jednou", () => {
    const r = prepis(zakladniFixtura);
    expect(r.zapsano.get(ZAPSANY_HEREDOCEM)).toEqual(["z-heredocu"]);
  });

  test("⛔ odvozená hodnota se z minulého .env.coolify NEPŘEVEZME (ozvěna starého výstupu)", () => {
    const r = prepis(zakladniFixtura);
    expect(r.zapsano.has(odvozeny)).toBe(false);
  });

  test("rotace na přání (PRESERVE_STATEFUL_SECRETS=0): z minulého .env.coolify se nepřevezme nic", () => {
    const r = prepis({ ...zakladniFixtura, preserve: "0" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.zapsano.has(NESENY_JEN_MINULE)).toBe(false);
  });

  test("čistý start (žádný .env.coolify) projde a nese jen heredoc + zálohu", () => {
    const r = prepis({ heredoc: zakladniFixtura.heredoc, zaloha: zakladniFixtura.zaloha });
    expect(r.status, r.stderr).toBe(0);
    expect(r.zapsano.has(NESENY_JEN_MINULE)).toBe(false);
    expect(r.zapsano.get(V_ZALOZE_I_MINULE)).toEqual(["hodnota-z-trezoru"]);
  });
});
