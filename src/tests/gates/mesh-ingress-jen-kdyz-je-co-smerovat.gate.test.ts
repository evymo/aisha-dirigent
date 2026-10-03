/**
 * Brána: mesh-ingress smí stát jen tam, kde má co směrovat.
 *
 * ── PROČ ──────────────────────────────────────────────────────────────────────
 * `*-mesh-ingress` je Caddy, který směruje podle `Host`. Tabulku mu vydává
 * derivace z katalogu — a vydá ji jen pro službu, která má `internal_url`
 * (tedy HTTP tvář na meshi). Když ji služba nemá, derivace `*_MESH_INGRESS_ROUTES`
 * NEVYDÁ VŮBEC, compose dosadí prázdno (`:-`) a Caddy spadne do záložní větve.
 *
 * ⛔ NAMĚŘENO 2026-08-25: záložní větev poslouchá na :8000, kdežto zdravotní
 * sonda ťuká na :8080. Kontejner je tedy TRVALE nezdravý — a protože zdraví
 * aplikace v Coolify je KONJUNKCE všech kontejnerů, celá appka nemohla být
 * zdravá nikdy. Postihlo to `<prefix>-clamav` a `<prefix>-playwright`:
 *
 *   · clamd mluví vlastním TCP protokolem, ne HTTP — Caddy směrující podle
 *     `Host` ho nemá jak rozvést. Katalog to říká správně: `clamav` má
 *     `internal_tcp_endpoints`, nikoli `internal_url`, a mesh tvář mu drží
 *     `clamav-mesh-tcp`. HTTP ingress byl jeho neuklizený předchůdce.
 *   · playwright runner nemá HTTP rozhraní vůbec (spouští specy, polluje frontu).
 *
 * Obě appky přitom byly „měkké", takže vlny neblokovaly — jen tiše kazily
 * každé měření „je stack zdravý".
 *
 * ── PROČ SE MĚŘÍ PRÁVĚ KATALOG ────────────────────────────────────────────────
 * Nabízelo se ptát se derivace („vydala pro tenhle peer tabulku?"). Jenže ta
 * závisí na PROFILU a na opt-in proměnných: `source-broker`, `extranet`,
 * `potok` i `local-ingest` jsou volitelné a bez své proměnné z derivace
 * vypadnou — měřidlo by je označilo za vadné, ač vadné nejsou (změřeno).
 * Katalog je vstup derivace a na opt-in nezávisí: buď služba HTTP tvář MÁ,
 * nebo nemá.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Jen ta část katalogu, o kterou tahle brána opírá svůj verdikt. */
type KatalogovaSluzba = {
  compose?: string;
  internal_url?: unknown;
  internal_endpoints?: unknown;
  internal_tcp_endpoints?: unknown;
};

const { services } = JSON.parse(
  readFileSync(join(ROOT, "config/services.json"), "utf-8"),
) as { services: Record<string, KatalogovaSluzba> };

/** Univerzum se HLEDÁ: každý compose, který mesh-ingress skutečně deklaruje. */
function composeSMeshIngressem(): string[] {
  return readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify-.*\.yml$/.test(f))
    .filter((f) => /^ {2}[a-z0-9-]*mesh-ingress:/m.test(readFileSync(join(ROOT, f), "utf-8")));
}

const sluzbyProCompose = (soubor: string) =>
  Object.entries(services).filter(([, s]) => s?.compose === soubor);

/**
 * HTTP tvář na meshi se v katalogu deklaruje DVĚMA jmény: `internal_url`
 * (jeden endpoint, 15 služeb) a `internal_endpoints` (víc endpointů, 6 služeb).
 * ⛔ Měřidlo, které zná jen jedno, označí ta druhá za vadná — na `pki`,
 * `messaging`, `realtime` a `domain-services` se to stalo (2026-08-25).
 * `internal_tcp_endpoints` je NĚCO JINÉHO: mesh tvář, kterou HTTP ingress
 * neumí rozvést (clamd).
 */
const maHttpTvar = (s: KatalogovaSluzba) => Boolean(s?.internal_url || s?.internal_endpoints);

describe("mesh-ingress jen tam, kde je co směrovat", () => {
  test("univerzum není prázdné — jinak by brána mlčela místo měření", () => {
    expect(composeSMeshIngressem().length).toBeGreaterThan(5);
  });

  test("každý compose s mesh-ingressem má v katalogu službu s HTTP tváří", () => {
    const vadne: string[] = [];
    for (const soubor of composeSMeshIngressem()) {
      const sluzby = sluzbyProCompose(soubor);
      if (sluzby.length === 0) {
        vadne.push(`${soubor} — žádná katalogová služba se na tenhle compose neváže`);
        continue;
      }
      if (!sluzby.some(([, s]) => maHttpTvar(s))) {
        const jmena = sluzby.map(([id]) => id).join(", ");
        vadne.push(
          `${soubor} (${jmena}) — žádná z jeho služeb nemá HTTP tvář ` +
            `(internal_url ani internal_endpoints), ` +
            `derivace tabulku NEVYDÁ a Caddy zůstane trvale nezdravý`,
        );
      }
    }
    expect(vadne, `mesh-ingress bez čeho směrovat:\n  ${vadne.join("\n  ")}`).toEqual([]);
  });

  test("služba jen s TCP tváří mesh-ingress NEVEZE (clamd není HTTP)", () => {
    for (const [id, s] of Object.entries(services)) {
      if (!s?.internal_tcp_endpoints || maHttpTvar(s)) continue;
      const compose = s.compose;
      if (!compose) continue;
      const text = readFileSync(join(ROOT, compose), "utf-8");
      expect(
        /^ {2}[a-z0-9-]*mesh-ingress:/m.test(text),
        `${id} má na meshi jen TCP tvář (internal_tcp_endpoints), ale ${compose} veze ` +
          `HTTP mesh-ingress — ten nemá co směrovat a udrží appku trvale nezdravou`,
      ).toBe(false);
    }
  });

  test("clamav si mesh tvář drží TCP sidecarem, ne HTTP ingressem", () => {
    const text = readFileSync(join(ROOT, "docker-compose.coolify-clamav.yml"), "utf-8");
    expect(text).toMatch(/^ {2}clamav-mesh-tcp:/m);
    expect(text).not.toMatch(/^ {2}clamav-mesh-ingress:/m);
  });
});
