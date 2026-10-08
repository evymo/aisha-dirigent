import { afterAll, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  composeZavrenychLanes,
  ctenarHodnot,
  jeLaneZapnuta,
  klicePodminky,
  neprovisionovaneSluzby,
  podminkaSplnena,
} from "./provision-gate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "scripts/lib/provision-gate.mjs");
const TMP = mkdtempSync(join(tmpdir(), "provision-gate-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("zapnuto? — vypínač se musí dát vypnout", () => {
  test("`false`, `0`, `no`, `off` (i velkými) jsou VYPNUTO — dřív je pět míst bralo za zapnutou lane", () => {
    for (const ne of ["false", "0", "no", "off", "FALSE", " Off ", ""]) {
      expect(jeLaneZapnuta(ne), `„${ne}"`).toBe(false);
    }
    expect(jeLaneZapnuta(undefined)).toBe(false);
  });

  test("deklarace lane je cokoli jiného: 1, true, URL, cesta", () => {
    for (const ano of ["1", "true", "https://source.example.test", "/srv/drop"]) {
      expect(jeLaneZapnuta(ano), `„${ano}"`).toBe(true);
    }
  });

  test("řetězec = jedna podmínka, pole = kterákoli; bez deklarace se nasazuje vždy", () => {
    expect(klicePodminky("A")).toEqual(["A"]);
    expect(klicePodminky(["A", "B"])).toEqual(["A", "B"]);
    const cti = (k) => ({ A: "false", B: "https://x.test" })[k];
    expect(podminkaSplnena(undefined, cti)).toBe(true);
    expect(podminkaSplnena("A", cti)).toBe(false);
    expect(podminkaSplnena(["A", "B"], cti)).toBe(true);
  });

  test("neprovisionované = jen služby s deklarovanou a nesplněnou podmínkou", () => {
    const sluzby = {
      core: {},
      extranet: { provision_when_env: "EXTRANET_ENABLED" },
      broker: { provision_when_env: ["SOURCE_API_URL", "DROP_DIR"] },
    };
    const cti = (k) => ({ EXTRANET_ENABLED: "false", DROP_DIR: "/srv/drop" })[k];
    expect(neprovisionovaneSluzby(sluzby, cti)).toEqual(["extranet"]);
  });

  test("prostředí má přednost před souborem, jen když je VÝSLOVNĚ nastavené", () => {
    const soubor = join(TMP, "lane.env");
    writeFileSync(soubor, "FIXTURE_LANE_SOUBOR=1\nFIXTURE_LANE_PREBITA=1\n");
    process.env.FIXTURE_LANE_PREBITA = "off";
    try {
      const cti = ctenarHodnot(soubor);
      expect(cti("FIXTURE_LANE_SOUBOR")).toBe("1");
      expect(cti("FIXTURE_LANE_PREBITA")).toBe("off");
    } finally {
      delete process.env.FIXTURE_LANE_PREBITA;
    }
  });
});

describe("CLI: kód odliší nasazuje / nenasazuje / neměřeno", () => {
  const spust = (args, env = {}) =>
    spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: ROOT, env: { ...process.env, ...env } });

  test("služba bez podmínky → 0", () => {
    expect(spust(["--zapnuto", "core"]).status).toBe(0);
  });

  test("extranet s EXTRANET_ENABLED=false → 1 a vypíše podmínku; s 1 → 0", () => {
    const vypnuto = spust(["--zapnuto", "extranet"], { EXTRANET_ENABLED: "false" });
    expect(vypnuto.status).toBe(1);
    expect(vypnuto.stdout.trim()).toBe("EXTRANET_ENABLED");
    expect(spust(["--zapnuto", "extranet"], { EXTRANET_ENABLED: "1" }).status).toBe(0);
  });

  test('bez přepínače → 2, nikdy tiché „nic“', () => {
    expect(spust([]).status).toBe(2);
  });

  // Nástroj umí zapisovat (--dopln-adresy-zavrenych). Překlep v přepínači nesmí spadnout do
  // jiné větve: `--zapnuto core` vedle neznámého přepínače dřív vrátilo 0, tedy „nasazuje“.
  test("neznámý přepínač → 2 a jmenuje ho, i když vedle něj stojí platný", () => {
    const r = spust(["--zapnuto", "core", "--env-fille", "/nikde"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--env-fille");
  });

  test("tvar --prepinac=hodnota nástroj nezná → 2 (hodnota se bere z dalšího argumentu)", () => {
    expect(spust(["--zapnuto=core"]).status).toBe(2);
  });

  test("překlep u zapisujícího přepínače soubor NEZMĚNÍ", () => {
    const soubor = join(TMP, "preklep.env");
    writeFileSync(soubor, "A=1\n");
    const r = spust(["--dopln-adresy-zavrenych", soubor, "--potvrzuji"]);
    expect(r.status).toBe(2);
    expect(readFileSync(soubor, "utf8")).toBe("A=1\n");
  });
});

describe("compose zavřených lanes — co preflight jen strukturou (suchý běh guru 2026-10-06)", () => {
  const KATALOG = {
    jadro: { compose: "jadro.yml" },
    firewall: { compose: "fw.yml", provision_when_env: ["UZEL_VLASTNIK", "UZEL_SSH"] },
    model: { compose: "model.yml", compose_gpu: "model-gpu.yml", provision_when_env: ["GGUF", "MESH"] },
    sdileny: { compose: "jadro.yml", provision_when_env: "SDILENY_ON" },
  };
  const cti = (hodnoty) => (k) => hodnoty[k];

  test("zavřená lane → její compose i varianta compose_gpu; otevřená lane → nic", () => {
    expect(composeZavrenychLanes(KATALOG, cti({}))).toEqual(["fw.yml", "model-gpu.yml", "model.yml"]);
    expect(composeZavrenychLanes(KATALOG, cti({ UZEL_SSH: "svet", MESH: "gpu" }))).toEqual([]);
  });

  test("compose, který nese i služba bez podmínky (sdílený stack), se nenasazení NEPŘIPÍŠE", () => {
    // `sdileny` je zavřená, ale jadro.yml nese i `jadro` — ten stack se nasadí, jeho env se měří.
    expect(composeZavrenychLanes(KATALOG, cti({}))).not.toContain("jadro.yml");
  });

  test("výslovné `false` lane nezapne — týž výklad jako --zapnuto", () => {
    expect(composeZavrenychLanes(KATALOG, cti({ UZEL_VLASTNIK: "false" }))).toContain("fw.yml");
  });

  test("CLI --compose-zavrenych čte TÝŽ env soubor; neznámý přepínač vedle něj → 2", () => {
    const soubor = join(TMP, "compose-zavrenych.env");
    writeFileSync(soubor, "ACCEL_FW_NODE_OWNER=vrstva-a\n");
    const s = spawnSync(process.execPath, [CLI, "--compose-zavrenych", "--env-file", soubor], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(s.status, s.stderr).toBe(0);
    const radky = s.stdout.trim().split("\n");
    expect(radky, "firewall s deklarací uzlu se nasadí").not.toContain("docker-compose.coolify-accel-hostfw.yml");
    const bez = spawnSync(process.execPath, [CLI, "--compose-zavrenych"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
    expect(bez.stdout.trim().split("\n"), "bez deklarace uzlu se firewall nenasadí").toContain("docker-compose.coolify-accel-hostfw.yml");
    const preklep = spawnSync(process.execPath, [CLI, "--compose-zavrenych", "--env-fil", soubor], { encoding: "utf8" });
    expect(preklep.status).toBe(2);
  });
});
