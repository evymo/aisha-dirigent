// Kontrakt d8 U1/UT1: instance, která slot `gpu` nepoužívá, dostane TÝŽ výstup jako dřív.
// Samotná deklarace UUID GPU serveru nic nemění; změnu vyvolá jen přepis umístění v profilu
// (kotva ve stejném běhu — bez ní by „beze změny“ prošlo i nad derivací, která nic nevidí).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const STROP_MS = 60_000;
const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DERIVACE = join(KOREN, "scripts/lib/derive-domains.mjs");
const SLOTY = join(KOREN, "scripts/lib/sloty-serveru.mjs");

let d;
const profil = (id, prepis) => {
  const p = JSON.parse(readFileSync(join(KOREN, "config/profiles/cloud-multi.json"), "utf8"));
  p.id = id;
  p.domain = { ...p.domain, public_tld: "aisha.example", internal_tld: "int.example", mesh_tld: "mesh.example" };
  if (prepis) {
    p.servers = [...p.servers, "gpu"];
    p.service_overrides = { ...p.service_overrides, ...prepis };
    // Model na GPU slotu chce deklaraci vstupu lane nájemce (LANE_VSTUP_URL) — testovací hodnota.
    p.lane_gpu = { vlastnik: "testuzel", vstup_url: "http://10.251.9.2:8000" };
  }
  writeFileSync(join(d, "profiles", `${id}.json`), JSON.stringify(p, null, 2));
};
const spust = (skript, argv, env) =>
  spawnSync(process.execPath, [skript, ...argv], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, AISHA_INSTANCE_CONFIG_DIR: d, APP_NAME_PREFIX: "zkouska", CHAT_GGUF_URL: "https://modely.example/m.gguf", COOLIFY_SERVER_UUID_GPU: "", ...env },
  });

beforeAll(() => {
  d = mkdtempSync(join(tmpdir(), "gpu-beze-zmeny-"));
  mkdirSync(join(d, "profiles"));
  profil("bezgpu", null);
  profil("sgpu", { model: { placement: "gpu" } });
});
afterAll(() => d && rmSync(d, { recursive: true, force: true }));

describe("slot gpu nepoužitý = beze změny (U1)", () => {
  it("derivace domén: deklarované UUID GPU serveru výstup NEZMĚNÍ; kotva: přepis modelu na gpu ano", () => {
    const bez = spust(DERIVACE, ["--shell"], { AISHA_PROFILE: "bezgpu" });
    const sUuid = spust(DERIVACE, ["--shell"], { AISHA_PROFILE: "bezgpu", COOLIFY_SERVER_UUID_GPU: "server-gpu-0001" });
    expect(bez.status, bez.stderr).toBe(0);
    expect(bez.stdout.length, "derivace nevydala nic").toBeGreaterThan(1000);
    expect(sUuid.stdout).toBe(bez.stdout);
    expect(bez.stdout).toMatch(/^MODEL_PLACEMENT=experimental$/m);
    expect(bez.stdout, "bez přepisu nesmí nic bydlet na gpu").not.toMatch(/_PLACEMENT=gpu$/m);

    const prepis = spust(DERIVACE, ["--shell"], { AISHA_PROFILE: "sgpu" });
    expect(prepis.status, prepis.stderr).toBe(0);
    expect(prepis.stdout).toMatch(/^MODEL_PLACEMENT=gpu$/m);
    expect(prepis.stdout).not.toBe(bez.stdout);
  }, STROP_MS);

  it("sloty v provozu: bez přepisu gpu chybí i s deklarovaným UUID; kotva: s přepisem je tam", () => {
    const bez = spust(SLOTY, ["--v-provozu", "--profil", "bezgpu"], { COOLIFY_SERVER_UUID_GPU: "server-gpu-0001" });
    expect(bez.status, bez.stderr).toBe(0);
    expect(bez.stdout.split("\n")).not.toContain("gpu");
    const s = spust(SLOTY, ["--v-provozu", "--profil", "sgpu"], {});
    expect(s.stdout.split("\n")).toContain("gpu");
  }, STROP_MS);
});
