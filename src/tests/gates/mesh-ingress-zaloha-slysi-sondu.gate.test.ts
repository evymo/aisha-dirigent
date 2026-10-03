/**
 * Brána: záložní Caddyfile mesh-ingressu poslouchá na TÉMŽE portu, na který
 * ťuká zdravotní sonda.
 *
 * ── PROČ ──────────────────────────────────────────────────────────────────────
 * `*-mesh-ingress` dostává směrovací tabulku z derivace. Když ji nedostane,
 * compose dosadí prázdno a Caddy spadne do ZÁLOŽNÍ větve, která je navržená
 * tak, aby stav „nemám tabulku" byl VIDĚT: na `/__mesh_health` odpovídá 503
 * s textem „mesh-ingress bez směrovací tabulky".
 *
 * ⛔ NAMĚŘENO 2026-09-03: ten navržený stav sonda nikdy neuviděla. Záložní blok
 * poslouchal natvrdo na `:8000`, kdežto healthcheck ťuká na port SLUŽBY —
 * `:8090` u source-brokeru, `:3002` u realtime, `:80` u admina a pki, …
 * Sonda tedy dostala „connection refused" místo 503, a diagnóza vedla
 * k „zavřenému portu" místo k „chybí tabulka". U source-brokeru to stálo
 * několik hodin hledání: appka byla `running:unhealthy` s FailingStreak 9467,
 * a skutečnou příčinou byla NEDORUČENÁ hodnota `*_MESH_INGRESS_ROUTES`.
 *
 * Neshoda byla v 15 z 16 stacků. Jediný, kde porty seděly, byl kanonický
 * `model` — jeho vlastní port JE 8000, takže se vzor trefil sám sebou a vada
 * byla ze zdroje neviditelná. Přesně proto to měří brána a ne oko: jediný
 * náhodně správný vzorek dokáže vypadat jako pravidlo.
 *
 * ── CO SE MĚŘÍ ────────────────────────────────────────────────────────────────
 * VLASTNOST, ne tvar: „port, na kterém záloha naslouchá" == „port, na který
 * míří sonda". Kdo blok přepíše jinak (jiný Caddyfile, jiný příkaz), projde —
 * pokud ty dva porty pořád sedí. Generátor `mesh-conformance-apply.mjs` to
 * u stacků, které přepisuje, dělá sám (`printf ':${healthPort} {`); tahle
 * brána drží i ty, které už považuje za konformní, takže je nepřepisuje.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Port, na kterém naslouchá záložní (bez-tabulkový) Caddyfile. */
const ZALOHA = /printf ':(\d+) \{/;
/** Port, na který ťuká healthcheck mesh-ingressu. */
const SONDA = /http:\/\/127\.0\.0\.1:(\d+)\/__mesh_health/;

interface Stack {
  soubor: string;
  zaloha: string;
  sonda: string;
}

function stackySMeshIngressem(): Stack[] {
  return readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify-.*\.yml$/.test(f))
    .map((soubor) => {
      const text = readFileSync(join(ROOT, soubor), "utf-8");
      const z = ZALOHA.exec(text);
      const s = SONDA.exec(text);
      return z && s ? { soubor, zaloha: z[1], sonda: s[1] } : null;
    })
    .filter((x): x is Stack => x !== null);
}

describe("mesh-ingress: záloha slyší sondu", () => {
  // ⛔ Prázdné univerzum by znamenalo, že brána mlčí místo aby měřila — táž
  // třída jako „běh, který nic nezměřil, se vydával za nález".
  test("univerzum není prázdné — jinak by brána mlčela místo měření", () => {
    expect(stackySMeshIngressem().length).toBeGreaterThanOrEqual(10);
  });

  test("záložní Caddyfile naslouchá na portu, na který míří healthcheck", () => {
    const neshody = stackySMeshIngressem()
      .filter((s) => s.zaloha !== s.sonda)
      .map((s) => `${s.soubor}: záloha :${s.zaloha} ≠ sonda :${s.sonda}`);

    expect(
      neshody,
      `Záložní Caddyfile poslouchá jinde, než ťuká sonda (${neshody.length}):\n  ${neshody.join("\n  ")}\n\n` +
        "CO S TÍM: v záložní větvi změň `printf ':<port> {` na port, na který míří\n" +
        "healthcheck té služby. Stav „nemám směrovací tabulku\" musí sonda VIDĚT jako\n" +
        "503, jinak dostane „connection refused\" a diagnóza ukáže na zavřený port\n" +
        "místo na chybějící tabulku.",
    ).toEqual([]);
  });
});
