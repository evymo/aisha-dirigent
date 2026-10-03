import { afterAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
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
});
