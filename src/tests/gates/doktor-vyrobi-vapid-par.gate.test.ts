/**
 * Env-doktor vyrobí VAPID PÁR — a rozbitý pár neopraví hádáním.
 *
 * ⛔ NAMĚŘENO 2026-09-23. Kontrakt doktora měl u obou klíčů web pushe druh
 * `secret` s délkou (65 a 32 bajtů). Chybějící klíč tak doktor doplnil NÁHODOU:
 * veřejný klíč nebyl bodem křivky P-256 a soukromý k němu nepatřil. Prohlížeč
 * se takovým klíčem k odběru nepřihlásí, svc-push při startu web push vypne
 * („web push VYPNUT — VAPID klíče nejsou platný pár") — a v trezoru přitom
 * leží dvě neprázdné hodnoty, které projdou každou kontrolou na prázdnotu.
 *
 * Co se tu drží (měří se ZAPSANÝ soubor, ne výpis):
 *   1. čistý start → pár, který k sobě patří, a plocha (`VITE_…`) odebírá týmž
 *      veřejným klíčem, kterým svc-push podepisuje;
 *   2. veřejný klíč, který není bodem (dřívější náhoda doktora) → odvodí se ze
 *      soukromého, soukromý zůstane a alias plochy jde za ním — bez rotace;
 *   3. chybí soukromý → NIC se nezapíše (obnovit nejde, nový pár = rotace =
 *      rozhodnutí člověka) a doktor to řekne;
 *   4. dva platné klíče, které k sobě nepatří → totéž;
 *   5. pár chybí celý a alias plochy je přítomný PRÁZDNÝ → plocha převezme nový
 *      veřejný klíč (prázdný alias nenese rozhodnutí, jen nevyplněnou kopii).
 * Posudek sám testuje `scripts/lib/vapid-par.test.mjs`; tady jde o to, že ho
 * doktor opravdu POUŽÍVÁ a že zápis a aliasy dělají, co posudek řekl.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { jeVerejnyVapid, verejnyZeSoukromeho, vyrobVapidPar } from "../../../scripts/lib/vapid-par.mjs";

const ROOT = process.cwd();
const DOKTOR = join(ROOT, "scripts/aisha-env-doctor.mjs");
const VER = "WEB_PUSH_VAPID_PUBLIC_KEY";
const SOUK = "WEB_PUSH_VAPID_PRIVATE_KEY";
const PLOCHA = "VITE_WEB_PUSH_VAPID_PUBLIC_KEY";

interface Beh {
  vystup: string;
  radky: Map<string, string[]>;
}

/** Doktor v APPLY nad dočasným souborem; `start` = obsah před během (null = soubor není). */
function behDoktora(start: string | null): Beh {
  const dir = mkdtempSync(join(tmpdir(), "aisha-doktor-vapid-"));
  const envFile = join(dir, "env.coolify");
  try {
    if (start !== null) writeFileSync(envFile, start, { mode: 0o600 });
    const beh = spawnSync("node", [DOKTOR, "--no-external"], {
      cwd: ROOT,
      env: {
        ...process.env,
        ENV_FILE: envFile,
        APP_NAME_PREFIX: "zkouska",
        AISHA_STORY: "zkouska",
        AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    if (beh.error) throw beh.error;
    if (beh.status !== 0 || !existsSync(envFile)) {
      throw new Error(`env-doktor skončil ${beh.status}: ${(beh.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}`);
    }
    // VŠECHNY výskyty klíče: dvojí řádek je sám vada (kterou hodnotu vezme parser?).
    const radky = new Map<string, string[]>();
    for (const radek of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(radek);
      if (m) radky.set(m[1], [...(radky.get(m[1]) ?? []), m[2].replace(/^["']|["']$/g, "")]);
    }
    return { vystup: `${beh.stdout ?? ""}\n${beh.stderr ?? ""}`, radky };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Jediná hodnota klíče; dvojí výskyt shodí test. */
function hodnota(b: Beh, klic: string): string {
  const v = b.radky.get(klic) ?? [];
  expect(v.length, `${klic} je v zapsaném souboru ${v.length}×`).toBeLessThanOrEqual(1);
  return v[0] ?? "";
}

const radkyStartu = (h: Record<string, string>) =>
  Object.entries(h)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";

describe("env-doktor vyrobí VAPID pár a rozbitý neopraví hádáním (brána)", () => {
  test("čistý start: pár k sobě patří a plocha odebírá týmž klíčem", () => {
    const b = behDoktora(null);
    const verejny = hodnota(b, VER);
    const soukromy = hodnota(b, SOUK);
    expect(jeVerejnyVapid(verejny), "veřejný klíč není bod křivky ve tvaru RFC 8292").toBe(true);
    expect(verejnyZeSoukromeho(soukromy), "soukromý klíč k veřejnému nepatří").toBe(verejny);
    expect(hodnota(b, PLOCHA)).toBe(verejny);
    expect(b.vystup, "hodnota soukromého klíče se objevila ve výstupu").not.toContain(soukromy.slice(0, 8));
  });

  // ⛔ NAMĚŘENO 2026-09-27 nad trezorem instance: pár chyběl celý, ale alias plochy
  // ležel v souboru PŘÍTOMNÝ a PRÁZDNÝ. Doktor pár vyrobil a prázdný alias „zachoval“
  // — preflight --strict v coolify-sync-envs pak padal na Empty required a blokoval
  // doručení čehokoli. `hodnota()` zároveň hlídá, že se prázdný řádek doplnil na
  // místě a klíč není v souboru dvakrát.
  test("⛔ pár chybí celý a alias plochy je přítomný PRÁZDNÝ: plocha převezme nový veřejný klíč", () => {
    const b = behDoktora(radkyStartu({ [PLOCHA]: "" }));
    const verejny = hodnota(b, VER);
    expect(jeVerejnyVapid(verejny), "pár se nevyrobil").toBe(true);
    expect(verejnyZeSoukromeho(hodnota(b, SOUK))).toBe(verejny);
    expect(hodnota(b, PLOCHA), "prázdný alias plochy zůstal prázdný — plocha by neodebírala").toBe(verejny);
  });

  test("veřejný klíč mimo křivku (dřívější náhoda doktora) se odvodí; soukromý zůstane, plocha jde za ním", () => {
    const { verejny, soukromy } = vyrobVapidPar();
    const nahoda = crypto.randomBytes(65).toString("base64url");
    const b = behDoktora(radkyStartu({ [VER]: nahoda, [SOUK]: soukromy, [PLOCHA]: nahoda }));
    expect(hodnota(b, SOUK), "soukromý klíč se změnil — to je rotace, ne oprava").toBe(soukromy);
    expect(hodnota(b, VER)).toBe(verejny);
    expect(hodnota(b, PLOCHA), "alias plochy zůstal na staré náhodě — plocha by odebírala jiným klíčem").toBe(verejny);
  });

  test("⛔ chybí soukromý: nic se nevymyslí, doktor to řekne", () => {
    const { verejny } = vyrobVapidPar();
    const b = behDoktora(radkyStartu({ [VER]: verejny, [SOUK]: "", [PLOCHA]: verejny }));
    expect(hodnota(b, SOUK), "doktor doplnil soukromý klíč, který k veřejnému nepatří").toBe("");
    expect(hodnota(b, VER)).toBe(verejny);
    expect(b.vystup).toContain("NEOPRAVUJU");
  });

  test("⛔ dva platné klíče, které k sobě nepatří: zůstanou, doktor to řekne", () => {
    const a = vyrobVapidPar();
    const c = vyrobVapidPar();
    const b = behDoktora(radkyStartu({ [VER]: a.verejny, [SOUK]: c.soukromy, [PLOCHA]: a.verejny }));
    expect(hodnota(b, VER)).toBe(a.verejny);
    expect(hodnota(b, SOUK)).toBe(c.soukromy);
    expect(b.vystup).toContain("NEPATŘÍ K SOBĚ");
  });
});
