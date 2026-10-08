// Generátor manifestu instance: umístění nedeklarovaného compose se ODVOZUJE
// z katalogu (config/services.json), ne natvrdo `frontend`. Firewall hostitele
// GPU uzlu by jinak na instanci, jejíž vlastní manifest je zdrojem mapování,
// přistál na veřejném frontendu.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { aplikaceManifestu } from "./gen-instance-manifest.mjs";

const SKRIPT = fileURLToPath(new URL("./gen-instance-manifest.mjs", import.meta.url));
const beh = (prefix, env = {}) =>
  spawnSync(process.execPath, [SKRIPT, "--print"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", APP_NAME_PREFIX: prefix, ...env },
  });
const tisk = (prefix, env = {}) => {
  const r = beh(prefix, env);
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.split("\n").filter((l) => l.startsWith("app: "));
};

describe("gen-instance-manifest: umístění z katalogu", () => {
  it("⛔ vlastní manifest vynechán (compose nedeklaruje žádný sourozenec) → accel-hostfw na slotu gpu, ne frontend", () => {
    const radky = tisk("aisha");
    expect(radky).toContain("app: accel-hostfw:gpu:docker-compose.coolify-accel-hostfw.yml");
    expect(radky.some((l) => /^app: accel-hostfw:frontend:/.test(l))).toBe(false);
  });

  it("služba po strojích (netinit: jedna služba katalogu na umístění) → řádek za každou", () => {
    const radky = tisk("aisha");
    for (const m of ["frontend", "backend", "experimental"]) {
      expect(radky).toContain(`app: netinit-${m}:${m}:docker-compose.coolify-netinit.yml`);
    }
    expect(radky.some((l) => /^app: netinit:/.test(l)), "jeden řádek pro tři stroje = dva bez warmupu").toBe(false);
  });

  it("jiná instance dědí deklarované mapování sourozeneckého manifestu (accel-hostfw → gpu)", () => {
    expect(tisk("zkouska")).toContain("app: accel-hostfw:gpu:docker-compose.coolify-accel-hostfw.yml");
  });
});

// Profil instance přesouvá službu (model forku na GPU slot): řádek manifestu nese EFEKTIVNÍ
// umístění i compose pro ten slot. Nasazení bere slot a compose z řádku; dřív fork po
// přesunu modelu zastavila kontrola umístění (umisteni-souhlasi.sh), 2026-10-06.
describe("gen-instance-manifest: přepis umístění z profilu instance", () => {
  const MODEL_NA_GPU = { service_overrides: { model: { placement: "gpu" } } };
  const model = (apps) => apps.filter((a) => a.name === "model");
  const overlay = mkdtempSync(join(tmpdir(), "manifest-profil-"));
  mkdirSync(join(overlay, "profiles"));
  writeFileSync(join(overlay, "profiles", "gpufork.json"), JSON.stringify({ id: "gpufork", ...MODEL_NA_GPU }));
  afterAll(() => rmSync(overlay, { recursive: true, force: true }));

  it("kotva: bez profilu má model umístění a compose z katalogu", () => {
    expect(model(aplikaceManifestu({ prefix: "zkouska" }).apps)).toEqual([
      { name: "model", placement: "experimental", compose: "docker-compose.coolify-model.yml" },
    ]);
  });

  it("model přesunutý profilem na slot has_gpu → řádek model:gpu s variantou compose_gpu (tenký stack)", () => {
    expect(model(aplikaceManifestu({ prefix: "zkouska", profil: MODEL_NA_GPU }).apps)).toEqual([
      { name: "model", placement: "gpu", compose: "docker-compose.coolify-model-gpu.yml" },
    ]);
  });

  it("CLI: profil z overlaye (AISHA_PROFILE) → týž řádek; ostatní řádky beze změny", () => {
    const env = { AISHA_PROFILE: "gpufork", AISHA_INSTANCE_CONFIG_DIR: overlay };
    const s = tisk("zkouska", env);
    expect(s).toContain("app: model:gpu:docker-compose.coolify-model-gpu.yml");
    expect(s.filter((l) => !l.startsWith("app: model:"))).toEqual(tisk("zkouska").filter((l) => !l.startsWith("app: model:")));
  });

  it("CLI: deklarovaný, ale nečitelný profil = chyba nahlas, ne manifest z katalogu", () => {
    const r = beh("zkouska", { AISHA_PROFILE: "neexistuje", AISHA_INSTANCE_CONFIG_DIR: overlay });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/Profile 'neexistuje' not found/);
  });
});
