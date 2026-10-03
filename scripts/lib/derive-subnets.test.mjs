import { describe, expect, it } from "vitest";
import { TRUSTED_PROXY_CIDRS, gatewayTrustedProxies, srovnaniTrustedProxies } from "./derive-subnets.mjs";

/**
 * Doktor nesmí snížit důvěru v mesh peery jen proto, že nevidí svůj vstup.
 *
 * ⛔ NAMĚŘENO 2026-09-13: bez `MESH_PEER_IPS` doktor přepsal seznam s 23 peery
 * seznamem bez nich a nazval to „drift opraven". Na core a edge by tím klientská
 * adresa za mesh skokem přestala jít spočítat — tou cestou dveře a gateway
 * rozhodují o přístupu.
 */
const PEERY = Array.from({ length: 23 }, (_, i) => `100.90.${i + 1}.7`).join(",");
const SPRAVNE = gatewayTrustedProxies(PEERY);
const BEZ_PEERU = gatewayTrustedProxies("");

describe("srovnání GATEWAY_TRUSTED_PROXIES", () => {
  it("s peery se odvozuje a zapisuje jako dosud", () => {
    const r = srovnaniTrustedProxies({ existujici: BEZ_PEERU, meshPeerIps: PEERY });
    expect(r.akce).toBe("zapsat");
    expect(r.hodnota).toBe(SPRAVNE);
  });

  it("⛔ bez peerů NEPŘEPÍŠE platný seznam s peery", () => {
    const r = srovnaniTrustedProxies({ existujici: SPRAVNE, meshPeerIps: "" });
    expect(r.akce).toBe("ponechat");
    expect(r.hodnota).toBe(SPRAVNE);
    // Štítek nesmí tvrdit opravu — přesně ta lež zakryla vadu.
    expect(r.duvod).not.toMatch(/opraven/);
  });

  it("⛔ bez peerů ODSTRANÍ zakázaný rozsah — CGNAT se nesmí zakonzervovat", () => {
    const sCgnat = `${BEZ_PEERU},100.64.0.0/10`;
    const r = srovnaniTrustedProxies({ existujici: sCgnat, meshPeerIps: "" });
    expect(r.akce).toBe("zapsat");
    expect(r.hodnota).toBe(BEZ_PEERU);
    expect(r.hodnota).not.toContain("100.64.0.0/10");
    expect(r.duvod).toContain("100.64.0.0/10");
  });

  it("bez peerů a bez uložené hodnoty zapíše stav před meshem", () => {
    for (const existujici of [undefined, ""]) {
      const r = srovnaniTrustedProxies({ existujici, meshPeerIps: "" });
      expect(r.akce).toBe("zapsat");
      expect(r.hodnota).toBe(BEZ_PEERU);
    }
  });

  it("povolené CIDR v uloženém seznamu za zakázaný rozsah nepovažuje", () => {
    // Kdyby se za „zakázaný" bral každý řádek s lomítkem, doktor by přepisoval
    // i správné seznamy — dockerové CIDR v nich jsou vždycky.
    expect(TRUSTED_PROXY_CIDRS.some((c) => c.includes("/"))).toBe(true);
    const r = srovnaniTrustedProxies({ existujici: SPRAVNE, meshPeerIps: "  " });
    expect(r.akce).toBe("ponechat");
  });
});
