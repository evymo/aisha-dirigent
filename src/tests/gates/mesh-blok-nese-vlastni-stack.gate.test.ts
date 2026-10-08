/**
 * Brána: blok meshe vyrobený z kanonického vzoru nese VLASTNÍ stack, ne vzor.
 *
 * ⛔ NAMĚŘENO 2026-10-02 (web-render, varianta d-ii): `mesh-conformance-apply`
 * přejmenovával kanonický vzor (`docker-compose.coolify-model.yml`) podle tvaru
 * jmen `experimental--model--netbird`. Vzor se ale od 2026-09-15 jmenuje
 * s identitou (`${APP_NAME_PREFIX:?…}-model--netbird`) a agent nese mapu sítí
 * s aliasem `<prefix>-svc-model`. Náhrady se míjely a nový stack zdědil:
 *   · kontejnery `<prefix>-model--netbird` / `<prefix>-model--mesh-ingress`,
 *   · na sdílené síti instance alias `<prefix>-svc-model` — tedy cíl CIZÍ trasy
 *     v netns hostitele ingressu (Docker DNS by mezi držiteli round-robinoval).
 * Chytily to až brány nad hotovým compose; nástroj sám tvrdil úspěch.
 *
 * CO SE MĚŘÍ (vlastnost): pro libovolný stack, který vzorem není, vyrenderované
 * bloky (agent, ingress, TCP rozvaděč, pki-init) neodkazují na jméno vzoru a
 * agent nenese žádný alias. Kontrolní vzorek dokazuje, že měřidlo umí říct
 * „ne“: na samotném vzoru cizí jména najde.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CANON_STACK,
  renderAgent,
  renderIngress,
  renderPkiInit,
  renderTcp,
} from "../../../scripts/mesh-conformance-apply.mjs";

const ROOT = process.cwd();
const ROLE = "(netbird|mesh-ingress|mesh-tcp|pki-init)";

/** Odkazy na JINÝ stack než `stack` — jména kontejnerů, svazků, proměnných tras a aliasy. */
function ciziJmena(text: string, stack: string): string[] {
  const nalezy: string[] = [];
  for (const m of text.matchAll(new RegExp(`\\}-([a-z0-9-]+)--${ROLE}\\b`, "g"))) {
    if (m[1] !== stack) nalezy.push(m[0]);
  }
  for (const m of text.matchAll(/netbird-([a-z0-9-]+)-data-v3/g)) {
    if (m[1] !== stack) nalezy.push(m[0]);
  }
  const vlastniId = stack.toUpperCase().replace(/-/g, "_");
  for (const m of text.matchAll(/\b([A-Z0-9_]+)_MESH_(INGRESS|TCP)_ROUTES\b/g)) {
    if (m[1] !== vlastniId) nalezy.push(m[0]);
  }
  for (const m of text.matchAll(/\}-svc-([a-z0-9-]+)/g)) {
    if (m[1] !== stack) nalezy.push(m[0]);
  }
  return [...new Set(nalezy)];
}

describe("brána: blok meshe ze vzoru nese vlastní stack", () => {
  const stack = "zkouska-stack";
  const placement = "backend";
  const idUpper = "ZKOUSKA_STACK";

  it("agent: jména, svazek a NB_HOSTNAME patří stacku; sítě jsou holý seznam bez aliasů", () => {
    const blok = renderAgent({ stack, placement, ports: [3040], networks: ["internal", "mesh-dns"] });
    expect(ciziJmena(blok, stack)).toEqual([]);
    expect(blok).toContain(`}-${stack}--netbird`);
    expect(blok).toContain(`netbird-${stack}-data-v3`);
    expect(blok).toMatch(new RegExp(`NB_HOSTNAME: ${placement}-${stack}\\b`));
    const site = blok.slice(blok.indexOf("\n    networks:"));
    expect(site).toBe("\n    networks:\n      - internal\n      - mesh-dns");
    expect(blok, "hostitel netns ingressu nesmí nést alias — ingress by cíl přeložil sám na sebe").not.toMatch(
      /\baliases:/,
    );
  });

  it("ingress, TCP rozvaděč a pki-init: jméno kontejneru i proměnná tras patří stacku", () => {
    const bloky = {
      ingress: renderIngress({ stack, placement, idUpper, healthPort: 3040 }),
      tcp: renderTcp({ stack, placement, idUpper }),
      pkiInit: renderPkiInit({ stack, placement, network: "internal" }),
    };
    for (const [co, blok] of Object.entries(bloky)) {
      expect(ciziJmena(blok, stack), co).toEqual([]);
    }
    expect(bloky.ingress).toContain(`}-${stack}--mesh-ingress`);
    expect(bloky.ingress).toContain(`${idUpper}_MESH_INGRESS_ROUTES`);
    expect(bloky.tcp).toContain(`}-${stack}--mesh-tcp`);
    expect(bloky.tcp).toContain(`${idUpper}_MESH_TCP_ROUTES`);
    expect(bloky.pkiInit).toContain(`}-${stack}--pki-init`);
  });

  it("KONTROLNÍ VZOREK: na samotném vzoru měřidlo cizí jména najde (umí říct ne)", () => {
    const vzor = readFileSync(path.join(ROOT, `docker-compose.coolify-${CANON_STACK}.yml`), "utf8");
    const nalezy = ciziJmena(vzor, stack);
    expect(nalezy).toContain(`}-${CANON_STACK}--netbird`);
    expect(nalezy).toContain(`}-${CANON_STACK}--mesh-ingress`);
    expect(nalezy.some((n) => n.startsWith(`}-svc-${CANON_STACK}`))).toBe(true);
  });
});
