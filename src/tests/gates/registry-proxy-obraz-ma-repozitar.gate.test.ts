/**
 * Obraz přes registry proxy MUSÍ nést repozitář (CLASS gate)
 *
 * TŘÍDA VADY: krátké jméno oficiálního obrazu, které funguje proti Docker Hubu
 * a NEFUNGUJE proti pull-through cache. `docker:27-cli` si Hub domyslí jako
 * `library/docker:27-cli`, registry proxy ne — vrátí "not found".
 *
 * NAMĚŘENO 2026-08-11 na varra, obojí proti živé cache:
 *     docker pull cache.<tld>/docker:27-cli          → not found
 *     docker pull cache.<tld>/library/docker:27-cli  → OK
 * Deploy warmupu na tom spadl DŘÍV, než se cokoli spustilo, takže sítě instance
 * nikdo nezaložil a stacky by pak padaly na "declared as external, but could
 * not be found" — tedy na příznak úplně jinde než příčina.
 *
 * INVARIANT: každý `image:` sestavený z ${REGISTRY_PROXY} obsahuje `/`, tedy
 * plné jméno repozitáře. Bez proxy je krátké jméno v pořádku — vada vzniká až
 * kombinací "krátké jméno + proxy".
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** `image:` řádky, které jdou přes registry proxy → [soubor, obraz bez prefixu]. */
export function proxyImages(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*image:\s*\$\{REGISTRY_PROXY[^}]*\}(\S+)/gm)) out.push(m[1]);
  // Dockerfily uvnitř compose (`dockerfile_inline`) tahají obrazy přes FROM.
  for (const m of src.matchAll(/^\s*FROM\s+\$\{REGISTRY_PROXY[^}]*\}(\S+)/gm)) out.push(m[1]);
  return out;
}

describe("obraz přes registry proxy nese repozitář", () => {
  const soubory = readdirSync(ROOT).filter((f) => /^docker-compose.*\.ya?ml$/.test(f)).sort();

  test("compose soubory se našly (brána má co měřit)", () => {
    expect(soubory.length).toBeGreaterThan(10);
  });

  test("každý obraz z proxy má plné jméno repozitáře", () => {
    const nalezy: string[] = [];
    let celkem = 0;
    for (const f of soubory) {
      for (const img of proxyImages(readFileSync(join(ROOT, f), "utf-8"))) {
        celkem++;
        // `library/alpine:3.20` ✓ · `vendor/app:1` ✓ · `docker:27-cli` ✗
        if (!img.includes("/")) {
          nalezy.push(
            `${f}: image "${img}" jde přes REGISTRY_PROXY, ale nemá repozitář. ` +
              `Docker Hub si "library/" domyslí, pull-through cache NE — vrátí "not found" ` +
              `a deploy padne dřív, než se kontejner spustí. Použij "library/${img}".`,
          );
        }
      }
    }
    expect(celkem, "brána nenašla ŽÁDNÝ obraz přes proxy — buď zmizely, nebo přestala měřit")
      .toBeGreaterThan(5);
    expect(nalezy).toEqual([]);
  });

  // ── Negativní testy: brána musí nález POZNAT ────────────────────────────────
  test("krátké jméno přes proxy je nález", () => {
    expect(proxyImages("    image: ${REGISTRY_PROXY:-}docker:27-cli")).toEqual(["docker:27-cli"]);
  });

  test("plné jméno nálezem není", () => {
    const v = proxyImages("    image: ${REGISTRY_PROXY}library/alpine:3.20");
    expect(v).toEqual(["library/alpine:3.20"]);
    expect(v[0].includes("/")).toBe(true);
  });

  test("obraz BEZ proxy se neměří (krátké jméno je tam v pořádku)", () => {
    expect(proxyImages("    image: docker:27-cli")).toEqual([]);
  });

  test("FROM v dockerfile_inline se měří taky", () => {
    expect(proxyImages("        FROM ${REGISTRY_PROXY}library/alpine:3.20")).toEqual([
      "library/alpine:3.20",
    ]);
  });
});
