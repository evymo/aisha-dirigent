import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKRIPT = join(dirname(fileURLToPath(import.meta.url)), "registry-proxy-guard.sh");

/** Spustí stráž s danou hodnotou REGISTRY_PROXY (undefined = proměnná vůbec není). */
function straz(hodnota) {
  const env = { PATH: process.env.PATH };
  if (hodnota !== undefined) env.REGISTRY_PROXY = hodnota;
  const r = spawnSync("bash", [SKRIPT], { env, encoding: "utf8" });
  return { kod: r.status, vystup: `${r.stdout}${r.stderr}` };
}

describe("registry-proxy-guard: cache Docker Hubu je volitelná, tvar ne", () => {
  it("bez cache (nenastavená i prázdná) → průchod a NAHLAS, že se stahuje přímo", () => {
    for (const hodnota of [undefined, ""]) {
      const { kod, vystup } = straz(hodnota);
      expect(kod).toBe(0);
      expect(vystup).toMatch(/stahují přímo/);
    }
  });

  it("cache s lomítkem na konci → průchod, ohlásí prefix", () => {
    const { kod, vystup } = straz("cache.example.test/");
    expect(kod).toBe(0);
    expect(vystup).toContain("přes cache.example.test/");
  });

  it("⛔ cache BEZ lomítka → pád: `<host>pgvector/…` není adresa obrazu", () => {
    const { kod, vystup } = straz("cache.example.test");
    expect(kod).toBe(1);
    expect(vystup).toMatch(/nekončí lomítkem/);
  });
});
