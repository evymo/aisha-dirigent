import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nactiKatalog } from "./provision-gate.mjs";
import { ctiSModelovymMeshem, efektivniUmisteni, nactiSloty, slotModelovehoMeshe, slotyVProvozu, umisteniBezWarmupu } from "./sloty-serveru.mjs";

// Přepis umístění z profilu instance (model forku na GPU slotu) a warmup jen tam,
// kde instance SKUTEČNĚ nasazuje. Kontrakt d8 U1/U6, doktor fáze N.
const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKRIPT = join(KOREN, "scripts/lib/sloty-serveru.mjs");
const servers = nactiSloty(KOREN);
const sluzby = nactiKatalog(join(KOREN, "config/services.json"));
const lane = (hodnoty) => (k) => hodnoty[k];
const BEZ_LANE = lane({});
const MODEL_NA_GPU = { service_overrides: { model: { placement: "gpu" } } };

describe("slotyVProvozu s profilem instance", () => {
  it("kotva: bez profilu a bez lane není gpu v provozu (dnešní stav, U1)", () => {
    expect(slotyVProvozu({ servers, sluzby, cti: BEZ_LANE })).not.toContain("gpu");
  });

  it("model přesunutý profilem na gpu s otevřenou lane = gpu v provozu", () => {
    const cti = lane({ CHAT_GGUF_URL: "https://m.example/x.gguf" });
    expect(slotyVProvozu({ servers, sluzby, cti, profil: MODEL_NA_GPU })).toContain("gpu");
  });

  it("přepis na gpu je SÁM deklarací: gpu v provozu i bez CPU vah (CHAT_GGUF_URL prázdná, krok 7)", () => {
    expect(slotyVProvozu({ servers, sluzby, cti: BEZ_LANE, profil: MODEL_NA_GPU })).toContain("gpu");
  });

  it("MODEL_MESH z prostředí bez umístění na gpu nic neotevře (lane odvozuje umístění)", () => {
    expect(slotyVProvozu({ servers, sluzby, cti: lane({ MODEL_MESH: "gpu" }) })).not.toContain("gpu");
  });

  it("MODEL_MESH z prostředí bez umístění model NEZALOŽÍ (bez CPU vah); s umístěním na gpu ano", () => {
    const zProstredi = ctiSModelovymMeshem({ servers, sluzby, cti: lane({ MODEL_MESH: "gpu" }) });
    expect(efektivniUmisteni({ sluzby, cti: zProstredi }).has("model")).toBe(false);
    const sUmistenim = ctiSModelovymMeshem({ servers, sluzby, profil: MODEL_NA_GPU, cti: BEZ_LANE });
    expect(efektivniUmisteni({ sluzby, cti: sUmistenim, profil: MODEL_NA_GPU }).get("model")).toBe("gpu");
  });

  it("přepis slot přidá, neubere: povinné sloty z katalogu zůstávají v provozu", () => {
    const vse = Object.fromEntries(Object.keys(sluzby).map((id) => [id, { placement: "backend" }]));
    const bez = slotyVProvozu({ servers, sluzby, cti: BEZ_LANE });
    const s = slotyVProvozu({ servers, sluzby, cti: BEZ_LANE, profil: { service_overrides: vse } });
    expect(s).toEqual(bez);
  });

  it("exclude profilu službu z efektivního umístění vyřadí; kotva: bez exclude tam je", () => {
    const cti = lane({ CHAT_GGUF_URL: "x" });
    expect(efektivniUmisteni({ sluzby, cti, profil: MODEL_NA_GPU }).get("model")).toBe("gpu");
    expect(efektivniUmisteni({ sluzby, cti, profil: { ...MODEL_NA_GPU, exclude: ["model"] } }).has("model")).toBe(false);
  });
});

describe("slotModelovehoMeshe — deklarací modelového meshe je umístění modelu (varianta C)", () => {
  const LANE = lane({ CHAT_GGUF_URL: "x" });

  it("kotva: bez profilu model stojí mimo GPU slot → modelový mesh žádný", () => {
    expect(slotModelovehoMeshe({ servers, sluzby, cti: LANE })).toBe("");
  });

  it("model přesunutý profilem na gpu s otevřenou lane → mesh na slotu gpu", () => {
    expect(slotModelovehoMeshe({ servers, sluzby, cti: LANE, profil: MODEL_NA_GPU })).toBe("gpu");
  });

  it("týž přepis BEZ CPU vah (CHAT_GGUF_URL prázdná) → mesh na gpu: umístění je deklarace (krok 7)", () => {
    expect(slotModelovehoMeshe({ servers, sluzby, cti: BEZ_LANE, profil: MODEL_NA_GPU })).toBe("gpu");
  });

  it("model vyřazený profilem → žádný mesh, i s přepisem na gpu", () => {
    expect(slotModelovehoMeshe({ servers, sluzby, cti: LANE, profil: { ...MODEL_NA_GPU, exclude: ["model"] } })).toBe("");
  });

  it("bez registru slotů = výjimka, ne tiché „bez meshe“", () => {
    expect(() => slotModelovehoMeshe({ sluzby, cti: LANE, profil: MODEL_NA_GPU })).toThrow(/registr slotů/);
  });

  it("rozhoduje vlastnost slotu (has_gpu), ne jeho jméno: slot bez has_gpu mesh nedá", () => {
    const bezGpu = { ...servers, gpu: { ...servers.gpu, has_gpu: false } };
    expect(slotModelovehoMeshe({ servers: bezGpu, sluzby, cti: LANE, profil: MODEL_NA_GPU })).toBe("");
  });
});

describe("umisteniBezWarmupu — doktor fáze N", () => {
  it("katalog bez lane: žádné umístění bez warmupu (vrstva accel za zavřenou lane sítě nepotřebuje)", () => {
    expect(umisteniBezWarmupu({ sluzby, cti: BEZ_LANE })).toEqual([]);
  });

  // Kotva vlastnosti slotu: týž registr, jen slot gpu bez has_gpu (warmup rozhoduje slot, ne služba).
  const bezGpu = { ...servers, gpu: { ...servers.gpu, has_gpu: false } };
  const LANE_VRSTVY = lane({ ACCEL_DEKLARACE_B64: "x", ACCEL_EMBED_1_REPO: "org/model", ACCEL_EMBED_2_REPO: "org/model", ACCEL_FW_NODE_OWNER: "instance-a", ACCEL_FW_SSH: "svet" });

  it("otevřené lane vrstvy na gpu (vstup, enginy, firewall) bez netinit-gpu: warmup NECHYBÍ — sítě jádra a slotů zakládá compose accel-vstup, firewall běží v síti hostitele; KOTVA: slot bez has_gpu ho chce", () => {
    const efektivni = efektivniUmisteni({ sluzby, cti: LANE_VRSTVY });
    for (const id of ["accel-vstup", "accel-embed-1", "accel-embed-2", "accel-hostfw"]) expect(efektivni.get(id), `měřidlo: lane ${id} otevřená`).toBe("gpu");
    expect(umisteniBezWarmupu({ servers, sluzby, cti: LANE_VRSTVY })).toEqual([]);
    expect(umisteniBezWarmupu({ servers: bezGpu, sluzby, cti: LANE_VRSTVY })).toEqual(["gpu"]);
  });

  it("model přesunutý profilem na gpu = tenký stack na uzlu operátora: warmup forku tam nechybí", () => {
    // Jedinou externí síť tenkého stacku (`<prefix>-lane`) zakládá operátor; dřív fáze N
    // hlásila „gpu bez warmupu“ a předlet cold-startu forku s modelem na GPU skončil FATAL.
    expect(umisteniBezWarmupu({ sluzby, cti: lane({ CHAT_GGUF_URL: "x" }), profil: MODEL_NA_GPU })).toEqual([]);
    expect(umisteniBezWarmupu({ sluzby, cti: BEZ_LANE, profil: MODEL_NA_GPU })).toEqual([]);
  });

  it("služba přesunutá na gpu i BEZ varianty compose_gpu warmup na slotu s GPU nepotřebuje (rozhoduje slot); KOTVA: na slotu bez has_gpu ano", () => {
    const bezVarianty = { ...sluzby, model: { ...sluzby.model, compose_gpu: undefined } };
    expect(umisteniBezWarmupu({ sluzby: bezVarianty, cti: lane({ CHAT_GGUF_URL: "x" }), profil: MODEL_NA_GPU })).toEqual([]);
    expect(umisteniBezWarmupu({ servers: bezGpu, sluzby: bezVarianty, cti: lane({ CHAT_GGUF_URL: "x" }), profil: MODEL_NA_GPU })).toEqual(["gpu"]);
  });

  it("warmup se počítá i přepisem: netinit přesunutý profilem pokryje nové umístění (slot bez has_gpu, kde warmup chybí — viz kotva výš)", () => {
    const profil = { service_overrides: { ...MODEL_NA_GPU.service_overrides, "netinit-experimental": { placement: "gpu" } } };
    expect(umisteniBezWarmupu({ servers: bezGpu, sluzby, cti: lane({ CHAT_GGUF_URL: "x" }), profil })).not.toContain("gpu");
  });
});

// CLI případy pouští node s derivací profilu — pod zátěží sdíleného stroje víc než 5 s.
const STROP_MS = 60_000;
/** Lane služeb slotu gpu z prostředí stanoviště by přebila měření — zavřou se výslovně. */
const ZAVRENE_LANE_GPU = { ACCEL_DEKLARACE_B64: "", ACCEL_EMBED_1_REPO: "", ACCEL_EMBED_2_REPO: "", ACCEL_FW_NODE_OWNER: "", ACCEL_FW_SSH: "", MODEL_MESH: "" };
describe("CLI --profil a --bez-warmupu", () => {
  let d;
  const spust = (argv, env = {}) =>
    spawnSync(process.execPath, [SKRIPT, ...argv], {
      encoding: "utf8",
      env: { ...process.env, CHAT_GGUF_URL: "", ...ZAVRENE_LANE_GPU, AISHA_INSTANCE_CONFIG_DIR: d, ...env },
    });
  beforeAll(() => {
    d = mkdtempSync(join(tmpdir(), "sloty-profil-"));
    mkdirSync(join(d, "profiles"));
    writeFileSync(join(d, "profiles", "gpufork.json"), JSON.stringify({ id: "gpufork", ...MODEL_NA_GPU }));
  });
  afterAll(() => d && rmSync(d, { recursive: true, force: true }));

  it("--v-provozu --profil z overlaye: gpu v provozu z umístění (s CPU vahami i bez nich); bez profilu ne", () => {
    expect(spust(["--v-provozu", "--profil", "gpufork"], { CHAT_GGUF_URL: "https://m.example/x.gguf" }).stdout.split("\n")).toContain("gpu");
    expect(spust(["--v-provozu", "--profil", "gpufork"]).stdout.split("\n")).toContain("gpu");
    expect(spust(["--v-provozu", "--profil", ""], { MODEL_MESH: "gpu" }).stdout.split("\n")).not.toContain("gpu");
  }, STROP_MS);

  it("deklarovaný, ale nečitelný profil = NEMĚŘENO (2), ne „bez přepisů“", () => {
    const r = spust(["--v-provozu", "--profil", "neexistuje"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/NEMĚŘENO/);
  }, STROP_MS);

  it("prázdný --profil = katalog (tak volá cold-start bez AISHA_PROFILE)", () => {
    const r = spust(["--v-provozu", "--profil", ""]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split("\n")).not.toContain("gpu");
  }, STROP_MS);

  it("--bez-warmupu: prázdný výstup a kód 0 = pokryto; tenký stack na gpu pokrytý; otevřené lane vrstvy na gpu (slot s GPU) taky", () => {
    const ok = spust(["--bez-warmupu", "--profil", ""]);
    expect([ok.status, ok.stdout]).toEqual([0, ""]);
    const tenky = spust(["--bez-warmupu", "--profil", "gpufork"], { CHAT_GGUF_URL: "x" });
    expect([tenky.status, tenky.stdout]).toEqual([0, ""]);
    const vrstva = { ACCEL_DEKLARACE_B64: "x", ACCEL_EMBED_1_REPO: "org/model" };
    // Měřidlo: tytéž lane slot gpu SKUTEČNĚ otevřou (jinak by prázdný výstup nic neříkal).
    expect(spust(["--v-provozu", "--profil", ""], vrstva).stdout.split("\n")).toContain("gpu");
    const sVrstvou = spust(["--bez-warmupu", "--profil", ""], vrstva);
    expect([sVrstvou.status, sVrstvou.stdout], sVrstvou.stderr).toEqual([0, ""]);
  }, STROP_MS);
});
