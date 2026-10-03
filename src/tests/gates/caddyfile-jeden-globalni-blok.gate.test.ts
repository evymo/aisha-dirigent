import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ⛔ NAMĚŘENO 2026-09-02 — výpadek celé plochy (edge 502 na všechno).
 *
 * Caddy povoluje PRÁVĚ JEDEN globální blok a musí být první. Druhý `{` nemá
 * parser jak odlišit od bloku bez adresy, takže skončí hláškou
 * „server block without any key is global configuration, and if used, it must
 * be first" — ta pojmenovává PŘÍZNAK, ne příčinu, a vede hledání jinam.
 *
 * V `docker-compose.coolify-netbird.yml` se `trusted_proxies` emitoval
 * PODMÍNĚNĚ jako první blok a druhý blok se připojoval VŽDY. Konfigurace se
 * tedy rozbila PRÁVĚ TEHDY, KDYŽ BYL SEZNAM DORUČENÝ — a protože ho vyžadují
 * dveře, jejich zapnutí shodilo řídicí rovinu meshe: netbird-proxy
 * a netbird-internal-tls v restart smyčce, agenti se po restartu neměli kde
 * přihlásit, mesh jména zmizela a edge vracel 502.
 *
 * ⭐ Vlastnost, kterou brána hlídá, je STRUKTURÁLNÍ: heredoc, který se
 * PŘIPOJUJE (`>>`) do už rozepsaného Caddyfile, nesmí začínat holým `{`.
 * Takový začátek je vždy druhý globální blok, bez ohledu na to, co je uvnitř.
 */
const KOREN = process.cwd();

function composeSoubory(): string[] {
  return readdirSync(KOREN)
    .filter((f) => f.startsWith("docker-compose") && f.endsWith(".yml"))
    .map((f) => join(KOREN, f));
}

describe("Caddyfile se skládá do JEDNOHO globálního bloku", () => {
  it("žádný připojovaný heredoc nezačíná holým `{`", () => {
    const nalezy: string[] = [];

    for (const cesta of composeSoubory()) {
      const radky = readFileSync(cesta, "utf8").split("\n");
      for (let i = 0; i < radky.length; i++) {
        // Zajímá nás jen PŘIPOJENÍ (`>>`) do Caddyfile — první zápis (`>`)
        // globální blok obsahovat smí a musí.
        if (!/>>\s*\/etc\/caddy\/Caddyfile\s*<<-?'?\w+'?\s*$/.test(radky[i])) continue;

        // První neprázdný, nekomentářový řádek těla heredocu.
        for (let j = i + 1; j < radky.length; j++) {
          const t = radky[j].trim();
          if (t === "" || t.startsWith("#")) continue;
          if (t === "{") {
            nalezy.push(
              `${cesta.replace(KOREN + "/", "")}:${j + 1} — heredoc začíná holým '{' ` +
                `(druhý globální blok; Caddy skončí „server block without any key")`,
            );
          }
          break;
        }
      }
    }

    expect(nalezy, nalezy.join("\n")).toEqual([]);
  });
});
