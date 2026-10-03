import { describe, expect, it } from "vitest";
import {
  jeLepsiPeer,
  klicMeshIp,
  meshIpKlice,
  mnozinaPeerIps,
  nejlepsiPeerPodleJmena,
} from "./mesh-peers.mjs";

/**
 * Výřez skutečného výčtu z 2026-09-15 (instance s meshem, 29 peerů) — jen
 * jména, adresy, stav. Pořadí je schválně to „nešťastné": starý záznam za
 * živým, takže naivní „poslední vyhrává" dá špatnou odpověď.
 */
const PEERY = [
  { hostname: "edge", ip: "100.112.37.118", connected: true, lastSeen: "2026-09-15T07:57:00Z" },
  { hostname: "edge", ip: "100.112.101.86", connected: false, lastSeen: "2026-08-30T23:32:00Z" },
  { hostname: "edge", ip: "100.112.202.217", connected: false, lastSeen: "2026-08-28T17:49:00Z" },
  { hostname: "backend-mesh-router", ip: "100.112.189.78", connected: true, lastSeen: "2026-09-15T06:24:00Z" },
  { hostname: "experimental-mesh-router", ip: "100.112.9.70", connected: true, lastSeen: "2026-09-15T06:24:00Z" },
  { hostname: "frontend-core", ip: "100.112.169.100", connected: true, lastSeen: "2026-09-15T06:24:00Z" },
  { hostname: "backend-realtime", ip: "100.112.14.89", connected: false, lastSeen: "2026-09-07T12:23:00Z" },
  { hostname: "backend-realtime", ip: "100.112.246.17", connected: false, lastSeen: "2026-08-28T03:01:00Z" },
];

/** Jak to skládal aisha-redeploy do 2026-09-15: řádky KEY=ip do Map, poslední vyhrává. */
function stareSkladani(peers) {
  const m = new Map();
  for (const p of peers) m.set(klicMeshIp(p.hostname), p.ip);
  return [...m.values()].sort();
}

describe("MESH_PEER_IPS — množina z výčtu, ne z klíčů", () => {
  it("kolize prefixů: oba mesh-routery jsou v důvěře (dříve jeden vypadl)", () => {
    const ips = mnozinaPeerIps(PEERY);
    expect(ips).toContain("100.112.189.78");
    expect(ips).toContain("100.112.9.70");
    // Sonda, že test měří skutečnou vadu: staré skládání jeden z nich ztratí.
    const stare = stareSkladani(PEERY);
    expect(stare.includes("100.112.189.78") && stare.includes("100.112.9.70")).toBe(false);
  });

  it("duplicitní jméno: v důvěře jsou všechny záznamy peera, i odpojené", () => {
    const ips = mnozinaPeerIps(PEERY);
    for (const ip of ["100.112.37.118", "100.112.101.86", "100.112.202.217", "100.112.14.89", "100.112.246.17"]) {
      expect(ips).toContain(ip);
    }
    expect(ips).toHaveLength(8);
  });

  it("nezávisí na pořadí z API", () => {
    const obracene = [...PEERY].reverse();
    expect(mnozinaPeerIps(obracene)).toEqual(mnozinaPeerIps(PEERY));
  });

  it("peer bez jména nebo adresy se ignoruje; prázdný výčet je prázdná množina", () => {
    expect(mnozinaPeerIps([{ ip: "100.1.1.1" }, { hostname: "x" }])).toEqual([]);
    expect(mnozinaPeerIps(undefined)).toEqual([]);
  });
});

describe("<ROLE>_MESH_IP — deterministický výběr, nejednoznačné klíče se nevydají", () => {
  it("duplicitní jméno: vyhraje připojený, ne poslední v pořadí", () => {
    const { klice } = meshIpKlice(PEERY);
    expect(klice.get("EDGE_MESH_IP")).toBe("100.112.37.118");
    expect(meshIpKlice([...PEERY].reverse()).klice.get("EDGE_MESH_IP")).toBe("100.112.37.118");
  });

  it("připojený vyhraje i nad odpojeným záznamem s NOVĚJŠÍM lastSeen", () => {
    // lastSeen připojeného peera je čas navázání spojení — klidně starší než
    // poslední zpráva záznamu, který mezitím spadl. Rozhoduje stav, ne čas.
    const pripojeny = { hostname: "backend-n8n", ip: "100.112.202.18", connected: true, lastSeen: "2026-09-10T08:00:00Z" };
    const odpojenyNovejsi = { hostname: "backend-n8n", ip: "100.112.99.1", connected: false, lastSeen: "2026-09-15T07:00:00Z" };
    expect(meshIpKlice([pripojeny, odpojenyNovejsi]).klice.get("N8N_MESH_IP")).toBe("100.112.202.18");
    expect(meshIpKlice([odpojenyNovejsi, pripojeny]).klice.get("N8N_MESH_IP")).toBe("100.112.202.18");
  });

  it("všichni odpojení: vyhraje nejnovější lastSeen", () => {
    expect(meshIpKlice(PEERY).klice.get("REALTIME_MESH_IP")).toBe("100.112.14.89");
  });

  it("shoda stavu i lastSeen: rozhodne nižší IP (číselně), ne pořadí", () => {
    const a = { hostname: "x", ip: "100.112.9.70", connected: true, lastSeen: "2026-09-15T06:00:00Z" };
    const b = { hostname: "x", ip: "100.112.10.1", connected: true, lastSeen: "2026-09-15T06:00:00Z" };
    expect(nejlepsiPeerPodleJmena([a, b]).get("x").ip).toBe("100.112.9.70");
    expect(nejlepsiPeerPodleJmena([b, a]).get("x").ip).toBe("100.112.9.70");
  });

  it("kolize prefixů: MESH_ROUTER_MESH_IP se NEvydá a hlásí se obě jména", () => {
    const { klice, nejednoznacne } = meshIpKlice(PEERY);
    expect(klice.has("MESH_ROUTER_MESH_IP")).toBe(false);
    expect(nejednoznacne.get("MESH_ROUTER_MESH_IP")).toEqual(["backend-mesh-router", "experimental-mesh-router"]);
  });

  it("historický prefix umístění nemění klíč služby", () => {
    expect(klicMeshIp("frontend-core")).toBe("CORE_MESH_IP");
    expect(klicMeshIp("backend-core")).toBe("CORE_MESH_IP");
    expect(klicMeshIp("core")).toBe("CORE_MESH_IP");
    expect(meshIpKlice(PEERY).klice.get("CORE_MESH_IP")).toBe("100.112.169.100");
  });

  it("jeLepsiPeer: prázdné místo vždy obsadí kandidát", () => {
    expect(jeLepsiPeer(undefined, { ip: "1.1.1.1" })).toBe(true);
  });
});
