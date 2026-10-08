import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Modelový mesh forku (varianta C, aisha.decision 2026-10-05 03:17:54Z): lane MODEL_MESH
// a adresy řídicí roviny vydává derivace z UMÍSTĚNÍ modelu — ne z prostředí.
// Derivace běží v samostatném procesu: čte prostředí a overlay při každém volání,
// takže sdílený proces testů by si hodnoty mezi případy přenášel.
const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DERIVACE = join(KOREN, "scripts/lib/derive-domains.mjs");
const ZAKLAD = JSON.parse(readFileSync(join(KOREN, "config/profiles/cloud-multi.json"), "utf8"));

let overlay;
beforeAll(() => {
  overlay = mkdtempSync(join(tmpdir(), "modelovy-mesh-"));
  mkdirSync(join(overlay, "profiles"));
  const profil = (id, doplnek) =>
    writeFileSync(join(overlay, "profiles", `${id}.json`), JSON.stringify({ ...ZAKLAD, id, ...doplnek }));
  const LANE = { lane_gpu: { vlastnik: "testuzel", vstup_url: "http://10.251.9.2:8000" } };
  profil("model-na-gpu", { service_overrides: { model: { placement: "gpu" } }, ...LANE });
  profil("bez-lane", { service_overrides: { model: { placement: "gpu" } } });
  profil("lane-verejna", { service_overrides: { model: { placement: "gpu" } }, lane_gpu: { vlastnik: "testuzel", vstup_url: "http://203.0.113.10:8000" } });
  profil("lane-bez-vlastnika", { service_overrides: { model: { placement: "gpu" } }, lane_gpu: { vstup_url: "http://10.251.9.2:8000" } });
  profil("model-v-katalogu", {});
  profil("bez-ridici-roviny", { service_overrides: { model: { placement: "gpu" } }, exclude: ["netbird-model"], ...LANE });
  profil("bez-mostu", { service_overrides: { model: { placement: "gpu" } }, exclude: ["model-most"], ...LANE });
});
afterAll(() => rmSync(overlay, { recursive: true, force: true }));

function derivuj(profil, env = {}) {
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `const d = await import(${JSON.stringify(DERIVACE)}); process.stdout.write(d.formatShellExports(d.buildTopology({ profileId: ${JSON.stringify(profil)} })));`],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        AISHA_INSTANCE_CONFIG_DIR: overlay,
        AISHA_PROFILE: profil,
        APP_NAME_PREFIX: "testfork",
        PUBLIC_TLD: "testfork.example",
        INTERNAL_TLD: "int.testfork.example",
        MESH_TLD: "mesh.testfork.internal",
        CHAT_GGUF_URL: "https://m.example/x.gguf",
        ...env,
      },
    },
  );
  const klice = new Map();
  for (const m of (r.stdout ?? "").matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) klice.set(m[1], m[2]);
  return { rc: r.status, stderr: r.stderr ?? "", klice };
}

describe("derivace modelového meshe", () => {
  it("model na gpu s otevřenou lane → lane, veřejný vstup, vnitřní DNS doména, adresa pro uzel", () => {
    const { rc, stderr, klice } = derivuj("model-na-gpu");
    expect(rc, stderr).toBe(0);
    expect(klice.get("MODEL_MESH")).toBe("gpu");
    expect(klice.get("NETBIRD_MODEL_DOMAIN")).toBe("mesh-model.testfork.example");
    expect(klice.get("NETBIRD_MODEL_DNS_DOMAIN")).toBe("model.mesh.testfork.internal");
    expect(klice.get("MODEL_MESH_MANAGEMENT_URL")).toBe("https://mesh-model.testfork.example:443");
    expect(klice.get("NETBIRD_MODEL_PLACEMENT")).toBe("backend");
    // jména peerů (deklarovaná identita pro bootstrap i NB_HOSTNAME) a port jediné politiky
    expect(klice.get("MODEL_MESH_GPU_PEER")).toBe("testfork-model");
    expect(klice.get("MODEL_MESH_MOST_PEER")).toBe("testfork-model-most");
    expect(klice.get("MODEL_MESH_PORT")).toBe("8000");
    // přímá tvář řídicí roviny (edge-proxy a doktor domén na ni míří) — jiné jméno než veřejné
    expect(klice.get("NETBIRD_MODEL_DOMAIN_DIRECT")).toMatch(/mesh-model/);
    expect(klice.get("NETBIRD_MODEL_DOMAIN_DIRECT")).not.toBe(klice.get("NETBIRD_MODEL_DOMAIN"));
    // MOST (C4): konzumenti volají jméno modelu beze změny, v hlavním meshi ho drží most —
    // trasa jde na síťový koncový bod mostu, ne do compose modelu (ten v hlavním meshi není).
    expect(klice.get("SVC_MODEL_URL")).toBe("http://testfork-model.gpu.int.testfork.example:8000/v1");
    const trasyMostu = klice.get("MODEL_MOST_MESH_INGRESS_ROUTES") ?? "";
    expect(trasyMostu).toContain("testfork-model.gpu.int.testfork.example");
    expect(trasyMostu).toMatch(/\|testfork-model-most--model-mesh:8000'?$/);
    expect(klice.has("MODEL_MESH_INGRESS_ROUTES"), "tenký stack na GPU slotu hlavní mesh nemá — tabulka by mířila na CPU model").toBe(false);
    // vstup lane z deklarace instance (tenký stack: LANE_KLIENT_UPSTREAM)
    expect(klice.get("LANE_VSTUP_URL")).toBe("http://10.251.9.2:8000");
    // síť nájemce je v prostoru vlastníka uzlu: <vlastník>-lane-<prefix> (compose tenkého stacku)
    expect(klice.get("LANE_VLASTNIK")).toBe("testuzel");
  });

  it("profil bez vlastníka GPU uzlu (lane_gpu.vlastnik) → derivace selže (tenký stack by neznal jméno své sítě)", () => {
    const { rc, stderr } = derivuj("lane-bez-vlastnika");
    expect(rc).not.toBe(0);
    expect(stderr).toMatch(/lane_gpu\.vlastnik/);
  });

  it("vstup lane mimo privátní rozsah (veřejná IP) → derivace selže (lane jen na síti nájemce)", () => {
    const { rc, stderr } = derivuj("lane-verejna");
    expect(rc).not.toBe(0);
    expect(stderr).toMatch(/nedeklaruje vstup lane/);
  });

  it("model na gpu bez deklarace vstupu lane → derivace selže nahlas (tenký stack by neměl kam)", () => {
    const { rc, stderr } = derivuj("bez-lane");
    expect(rc).not.toBe(0);
    expect(stderr).toMatch(/nedeklaruje vstup lane/);
  });

  it("topologie: model na slotu has_gpu nese TENKÝ compose (compose_gpu), mimo něj původní", () => {
    const compose = (profilId) => {
      const r = spawnSync(process.execPath, ["--input-type=module", "-e",
        `const d = await import(${JSON.stringify(DERIVACE)}); process.stdout.write(String(d.buildTopology({ profileId: ${JSON.stringify(profilId)} }).services.model?.compose));`],
        { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, AISHA_INSTANCE_CONFIG_DIR: overlay, AISHA_PROFILE: profilId,
          APP_NAME_PREFIX: "testfork", PUBLIC_TLD: "testfork.example", INTERNAL_TLD: "int.testfork.example", MESH_TLD: "mesh.testfork.internal",
          CHAT_GGUF_URL: "https://m.example/x.gguf" } });
      return r.stdout;
    };
    expect(compose("model-na-gpu")).toBe("docker-compose.coolify-model-gpu.yml");
    expect(compose("model-v-katalogu")).toBe("docker-compose.coolify-model.yml");
  });

  it("kotva: model podle katalogu (mimo GPU slot) → lane prázdná, žádné adresy modelového meshe", () => {
    const { rc, stderr, klice } = derivuj("model-v-katalogu");
    expect(rc, stderr).toBe(0);
    expect(klice.get("MODEL_MESH")).toBe("");
    expect(klice.has("NETBIRD_MODEL_DNS_DOMAIN")).toBe(false);
    expect(klice.has("MODEL_MESH_MANAGEMENT_URL")).toBe(false);
    expect(klice.has("NETBIRD_MODEL_PLACEMENT")).toBe(false);
    expect(klice.has("MODEL_MESH_GPU_PEER")).toBe(false);
    expect(klice.has("NETBIRD_MODEL_DOMAIN_DIRECT")).toBe(false);
    // bez modelového meshe jméno modelu drží jeho vlastní stack, most v topologii není
    expect(klice.get("MODEL_MESH_INGRESS_ROUTES")).toMatch(/testfork-svc-model:8000/);
    expect(klice.has("MODEL_MOST_MESH_INGRESS_ROUTES")).toBe(false);
  });

  it("lane nastavená v prostředí derivaci NEPŘEBIJE (operátor přepíná umístění, ne lane)", () => {
    const { rc, stderr, klice } = derivuj("model-v-katalogu", { MODEL_MESH: "gpu" });
    expect(rc, stderr).toBe(0);
    expect(klice.get("MODEL_MESH")).toBe("");
    expect(klice.has("NETBIRD_MODEL_PLACEMENT")).toBe(false);
  });

  it("CPU váhy pryč (CHAT_GGUF_URL prázdná), model na gpu → mesh i model vzniknou z umístění (krok 7)", () => {
    const { rc, stderr, klice } = derivuj("model-na-gpu", { CHAT_GGUF_URL: "" });
    expect(rc, stderr).toBe(0);
    expect(klice.get("MODEL_MESH")).toBe("gpu");
    expect(klice.get("SVC_MODEL_URL")).toBe("http://testfork-model.gpu.int.testfork.example:8000/v1");
    expect(klice.get("MODEL_MOST_MESH_INGRESS_ROUTES") ?? "").toContain("testfork-model.gpu.int.testfork.example");
  });

  it("kotva: bez umístění na gpu a bez CPU vah model není (ani jeho adresa)", () => {
    const { rc, stderr, klice } = derivuj("model-v-katalogu", { CHAT_GGUF_URL: "" });
    expect(rc, stderr).toBe(0);
    expect(klice.get("MODEL_MESH")).toBe("");
    expect(klice.has("SVC_MODEL_URL")).toBe(false);
  });

  it("model na gpu, ale řídicí rovina vyřazená profilem → derivace selže nahlas", () => {
    const { rc, stderr } = derivuj("bez-ridici-roviny");
    expect(rc).not.toBe(0);
    expect(stderr).toMatch(/netbird-model.*nemá veřejné jméno/);
  });

  it("model na gpu, ale most vyřazený profilem → derivace selže nahlas (žádný návrat na CPU)", () => {
    const { rc, stderr } = derivuj("bez-mostu");
    expect(rc).not.toBe(0);
    expect(stderr).toMatch(/nedrží žádný most/);
  });
});
