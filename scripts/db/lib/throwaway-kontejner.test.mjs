import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jmenoKontejneru, mrtveKontejnery, procesZije } from "./throwaway-kontejner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("jméno kontejneru jednorázové DB", () => {
  it("za běh unikátní: prefix-pid-náhoda", () => {
    expect(jmenoKontejneru("aisha-typegen-throwaway", { pid: 4242, nahoda: () => "a1b2c3" })).toBe("aisha-typegen-throwaway-4242-a1b2c3");
    const a = jmenoKontejneru("x");
    const b = jmenoKontejneru("x");
    expect(a).not.toBe(b);
    expect(a).toMatch(new RegExp(`^x-${process.pid}-[0-9a-f]{6}$`));
  });

  it("výslovné jméno má přednost, prázdné se nebere", () => {
    expect(jmenoKontejneru("x", { override: "ladeni" })).toBe("ladeni");
    expect(jmenoKontejneru("x", { override: "  ", pid: 1, nahoda: () => "000000" })).toBe("x-1-000000");
  });
});

describe("úklid po přerušených bězích", () => {
  const zivy = new Set([100, 300]);
  const zije = (pid) => zivy.has(pid);

  it("⛔ živý běh jiné relace se NEMAŽE, mrtvý ano", () => {
    const jmena = ["aisha-typegen-throwaway-100-aaaaaa", "aisha-typegen-throwaway-200-bbbbbb", "aisha-typegen-throwaway-300-cccccc"];
    expect(mrtveKontejnery(jmena, "aisha-typegen-throwaway", zije)).toEqual(["aisha-typegen-throwaway-200-bbbbbb"]);
  });

  it("cizí jména ani starý pevný název bez pid se nevrací nikdy", () => {
    const jmena = ["aisha-typegen-throwaway", "aisha-testdb-throwaway-200-bbbbbb", "aisha-typegen-throwaway-200-bbbb", "jiny-200-bbbbbb"];
    expect(mrtveKontejnery(jmena, "aisha-typegen-throwaway", zije)).toEqual([]);
  });

  it("prefix se speciálními znaky se bere doslova", () => {
    expect(mrtveKontejnery(["a.b-200-bbbbbb", "axb-200-bbbbbb"], "a.b", zije)).toEqual(["a.b-200-bbbbbb"]);
  });

  it("procesZije: vlastní proces ano, nesmyslné pid ne", () => {
    expect(procesZije(process.pid)).toBe(true);
    expect(procesZije(2 ** 30)).toBe(false);
  });
});

describe("types-refresh-throwaway.mjs", () => {
  it("⛔ kontejner nemá pevné jméno a úklid jde přes mrtvé běhy", () => {
    const src = readFileSync(path.join(__dirname, "..", "types-refresh-throwaway.mjs"), "utf8");
    expect(src).not.toMatch(/const CONTAINER = "aisha-typegen-throwaway";/);
    expect(src).toMatch(/jmenoKontejneru\(/);
    expect(src).toMatch(/mrtveKontejnery\(/);
  });
});
