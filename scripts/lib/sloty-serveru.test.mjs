import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nactiSloty } from "./sloty-serveru.mjs";

// CLI je to, co čtou bash konzumenti (cold-start, obal cold-startu, doktor):
// měří se tak, jak ho volají — s `--env-soubor` i bez, a s návratovým kódem.
const CLI = fileURLToPath(new URL("./sloty-serveru.mjs", import.meta.url));

// Lane služeb slotu `gpu` (provision_when_env katalogu): vstup lane, enginy, firewall.
const LANE_GPU = ["ACCEL_DEKLARACE_B64", "ACCEL_EMBED_1_REPO", "ACCEL_EMBED_2_REPO", "ACCEL_FW_NODE_OWNER", "ACCEL_FW_SSH", "MODEL_MESH"];

function spust(args, env = {}) {
  const ciste = { ...process.env, ...env };
  // Příznak z prostředí volajícího by přebil soubor — test musí měřit soubor.
  for (const k of LANE_GPU) if (!(k in env)) delete ciste[k];
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: ciste, timeout: 60_000 });
  return { kod: r.status, radky: (r.stdout ?? "").split("\n").filter(Boolean), chyba: r.stderr ?? "" };
}

function sEnvSouborem(obsah, fn) {
  const dir = mkdtempSync(join(tmpdir(), "sloty-serveru-"));
  try {
    const soubor = join(dir, "zaloha.env");
    writeFileSync(soubor, obsah);
    return fn(soubor);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("sloty-serveru CLI", () => {
  it("--vsechny vypíše klíče registru včetně build serveru a gpu", () => {
    const r = spust(["--vsechny"]);
    expect(r.kod).toBe(0);
    expect(r.radky).toEqual(expect.arrayContaining(["build", "gpu"]));
  });

  it("--umisteni vynechá build server", () => {
    const r = spust(["--umisteni"]);
    expect(r.kod).toBe(0);
    expect(r.radky).toContain("gpu");
    expect(r.radky).not.toContain("build");
  });

  it("--pripnutelne vynechá slot s výslovnou vazbou (has_gpu) — jednouzlový pin ho nesmí vzít", () => {
    const r = spust(["--pripnutelne"]);
    expect(r.kod).toBe(0);
    expect(r.radky).toEqual(expect.arrayContaining(["frontend", "build"]));
    expect(r.radky).not.toContain("gpu");
  });

  it("--v-provozu: gpu jen s otevřenou lane některé služby slotu ze zálohy (vstup lane, engine, firewall)", () => {
    sEnvSouborem("ACCEL_DEKLARACE_B64=\nACCEL_EMBED_1_REPO=\nACCEL_FW_NODE_OWNER=\n", (f) => {
      const r = spust(["--v-provozu", "--env-soubor", f]);
      expect(r.kod).toBe(0);
      expect(r.radky.length).toBeGreaterThan(0);
      expect(r.radky).not.toContain("gpu");
    });
    for (const otevre of ["ACCEL_DEKLARACE_B64=x\n", "ACCEL_EMBED_1_REPO=org/model\n", "ACCEL_FW_NODE_OWNER=instance-a\n"]) {
      sEnvSouborem(otevre, (f) => {
        expect(spust(["--v-provozu", "--env-soubor", f]).radky, otevre).toContain("gpu");
      });
    }
    sEnvSouborem("ACCEL_DEKLARACE_B64=false\n", (f) => {
      expect(spust(["--v-provozu", "--env-soubor", f]).radky, "výslovné false je vypínač").not.toContain("gpu");
    });
    // Zrušený přepínač vrstvy už slot neotevírá.
    sEnvSouborem("ACCEL_ENABLED=1\n", (f) => {
      expect(spust(["--v-provozu", "--env-soubor", f]).radky, "ACCEL_ENABLED už nikdo nečte").not.toContain("gpu");
    });
  });

  it("výslovné prostředí má přednost před souborem (operátor přepne lane pro jeden běh)", () => {
    sEnvSouborem("ACCEL_DEKLARACE_B64=\n", (f) => {
      expect(spust(["--v-provozu", "--env-soubor", f], { ACCEL_DEKLARACE_B64: "x" }).radky).toContain("gpu");
    });
  });

  it("⛔ neznámý přepínač a nečitelný soubor jsou NEMĚŘENO (kód 2), ne prázdný seznam", () => {
    expect(spust(["--neco"]).kod).toBe(2);
    const r = spust(["--v-provozu", "--env-soubor", join(tmpdir(), "neexistuje-sloty-serveru.env")]);
    expect(r.kod).toBe(2);
    expect(r.radky).toEqual([]);
  });

  it("⛔ adresář místo souboru je NEMĚŘENO — existsSync by ho pustil a lane by vyšla zavřená s kódem 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "sloty-serveru-adr-"));
    try {
      const r = spust(["--v-provozu", "--env-soubor", dir]);
      expect(r.kod).toBe(2);
      expect(r.chyba).toMatch(/není soubor/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("⛔ chybějící nebo prázdný registr je chyba, ne výchozí kopie slotů", () => {
    const dir = mkdtempSync(join(tmpdir(), "sloty-serveru-reg-"));
    try {
      expect(() => nactiSloty(dir)).toThrow();
      mkdirSync(join(dir, "coolify"));
      writeFileSync(join(dir, "coolify", "servers.json"), JSON.stringify({ servers: {} }));
      expect(() => nactiSloty(dir)).toThrow(/prázdný/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("nasazujeRaw — na slotu s GPU nasazuje Coolify compose raw", () => {
  it("raw je PŘESNĚ sloty s has_gpu (vlastnost slotu, žádný druhý přepínač) a story-init ho nastavuje i ověřuje", async () => {
    const { nasazujeRaw, nactiSloty } = await import("./sloty-serveru.mjs");
    const sloty = nactiSloty();
    const raw = Object.keys(sloty).filter((s) => nasazujeRaw(sloty[s]));
    expect(raw.length, "registr nemá slot s GPU — měřidlo by tvrdilo prázdno").toBeGreaterThan(0);
    expect(raw.sort()).toEqual(Object.keys(sloty).filter((s) => sloty[s]?.has_gpu === true).sort());
    const init = (await import("node:fs")).readFileSync(new URL("../coolify-story-init.sh", import.meta.url), "utf8");
    expect(init).toMatch(/sloty-serveru\.mjs" --raw "\$slot"/);
    expect(init).toMatch(/is_raw_compose_deployment_enabled":true/);
    expect(init, "zpětné čtení: false i nezměřeno = FAILURE").toMatch(/raw-compose-vypnuty[\s\S]*raw-compose-nezmereno/);
  });
  it("CLI --raw: 0 = raw, 1 = běžně, neznámý slot = 2 (NEMĚŘENO, ne „běžně“)", async () => {
    const { spawnSync } = await import("node:child_process");
    const cli = new URL("./sloty-serveru.mjs", import.meta.url).pathname;
    const { nactiSloty } = await import("./sloty-serveru.mjs");
    const sloty = nactiSloty();
    const gpu = Object.keys(sloty).find((s) => sloty[s]?.has_gpu === true);
    const bez = Object.keys(sloty).find((s) => sloty[s]?.has_gpu !== true);
    expect(spawnSync("node", [cli, "--raw", gpu]).status).toBe(0);
    expect(spawnSync("node", [cli, "--raw", bez]).status).toBe(1);
    expect(spawnSync("node", [cli, "--raw", "neni-takovy-slot"]).status).toBe(2);
  });
});
