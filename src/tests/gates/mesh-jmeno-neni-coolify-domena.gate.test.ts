/**
 * Brána: mesh jméno (`*.internal`) NENÍ Coolify doména — v žádné rovině.
 *
 * ⛔ NAMĚŘENO 2026-09-13 na forku, jehož `coolify-deploy-init.sh` mesh jména
 * už od 2026-08-27 vynechával: 16 mesh domén na 12 aplikacích bylo v Coolify
 * přesto, a Traefik jednoho uzlu zalogoval za 24 h 18 274 neúspěšných pokusů
 * o ACME certifikát, 60 % z nich pro `.internal`. Zapsal je zpátky
 * `coolify-domain-doctor.mjs` — obnovovací rovina, která pravidlo neznala.
 *
 * Proč na tom záleží víc než na šumu v logu: Coolify z každé domény staví
 * Traefik router s `certresolver=letsencrypt`, LE pro `.internal` nevydá
 * NIKDY, a opakované neúspěchy spálí rozpočet ACME účtu, až LE odmítne
 * i legitimní hostitele téhož účtu (429). Mesh provoz jde přes WireGuard do
 * vlastního mesh-ingressu stacku, ne přes veřejný Traefik.
 *
 * Dvě roviny zapisují domény; brána tvrdí, že obě mluví stejně.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMeshHost, withoutMeshHosts } from "../../../scripts/lib/mesh-host.mjs";

const ROOT = process.cwd();
const DOCTOR = readFileSync(join(ROOT, "scripts/coolify-domain-doctor.mjs"), "utf8");
const DEPLOY_INIT = readFileSync(join(ROOT, "scripts/coolify-deploy-init.sh"), "utf8");

describe("mesh jméno není Coolify doména (brána)", () => {
  test("mesh host se pozná — s portem, cestou i bez", () => {
    expect(isMeshHost("https://svc.mesh.inst.internal")).toBe(true);
    expect(isMeshHost("https://svc.mesh.inst.internal:3001")).toBe(true);
    expect(isMeshHost("http://svc.mesh.inst.internal:8080/cesta")).toBe(true);
    expect(isMeshHost(" https://svc.mesh.inst.internal ")).toBe(true);
    expect(isMeshHost("https://api.example.com")).toBe(false);
    expect(isMeshHost("https://internal.example.com")).toBe(false);
    expect(isMeshHost("https://mesh-router-disabled.invalid:80")).toBe(false);
  });

  test("ze seznamu hostů se odstraní jen mesh hosté, veřejní zůstanou", () => {
    expect(withoutMeshHosts("https://svc.mesh.inst.internal:4180")).toBe("");
    expect(withoutMeshHosts("https://a.example.com,https://b.mesh.inst.internal")).toBe("https://a.example.com");
    expect(withoutMeshHosts("https://b.mesh.inst.internal, https://a.example.com:8080")).toBe("https://a.example.com:8080");
    expect(withoutMeshHosts("https://a.example.com")).toBe("https://a.example.com");
  });

  test("doktor skládá odesílané domény PŘES ten filtr", () => {
    // Pomocník, který nikdo nevolá, není oprava.
    expect(DOCTOR).toMatch(/import \{ isMeshHost, withoutMeshHosts \} from "\.\/lib\/mesh-host\.mjs"/);
    const routable = /const routable = contract\.domains\.filter\([\s\S]*?\);\n/.exec(DOCTOR);
    expect(routable, "v doktorovi chybí `const routable = contract.domains.filter(…)`").not.toBeNull();
    expect(routable![0]).toMatch(/withoutMeshHosts\(entry\.domain\),?\s*\)\.map\(\(entry\) => \(\{ \.\.\.entry, domain: withoutMeshHosts\(entry\.domain\) \}\)\)/);
  });

  test("doktor hlásí mesh routy, které už v Coolify leží", () => {
    expect(DOCTOR).toMatch(/report\.storedMeshRoutes = storedMesh/);
  });

  test("nasazovací rovina mesh jména vynechává taky — obě roviny mluví stejně", () => {
    const fn = /set_coolify_domains\(\) \{[\s\S]*?\n\}/.exec(DEPLOY_INIT);
    expect(fn, "v coolify-deploy-init.sh chybí set_coolify_domains()").not.toBeNull();
    expect(fn![0]).toMatch(/\*\.internal\|\*\.internal:\*\|\*\.internal\/\*\)/);
    expect(fn![0]).toMatch(/continue/);
  });
});
