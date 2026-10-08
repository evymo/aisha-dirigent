import { describe, expect, it } from "vitest";
import { posudekModelovehoMeshe } from "./modelovy-mesh-posudek.mjs";

// Doktor C5 modelového meshe (varianta C): posudek JEN z odpovědí API a deklarací instance.
const SKUPINY = [{ id: "g-gpu", name: "model-gpu" }, { id: "g-most", name: "model-most" }];
const ENV = {
  MODEL_MESH_GPU_PEER: "fork-model", MODEL_MESH_GPU_PEER_ID: "p-gpu",
  MODEL_MESH_MOST_PEER: "fork-model-most", MODEL_MESH_MOST_PEER_ID: "p-most",
  MODEL_MESH_GPU_PEER_IP: "100.70.1.2", MODEL_MESH_PORT: "8000",
};
const uzel = (o = {}) => ({ id: "p-gpu", name: "fork-model", connected: true, ip: "100.70.1.2", groups: [{ id: "g-gpu" }], ...o });
const most = (o = {}) => ({ id: "p-most", name: "fork-model-most", connected: true, ip: "100.70.9.9", groups: [{ id: "g-most" }], ...o });
const POLITIKA = [{ enabled: true, rules: [{ enabled: true, action: "accept", bidirectional: false, protocol: "tcp", ports: ["8000"], sources: [{ id: "g-most" }], destinations: [{ id: "g-gpu" }] }] }];
const posud = (o = {}) => posudekModelovehoMeshe({ peery: [uzel(), most()], politiky: POLITIKA, skupiny: SKUPINY, env: ENV, ...o });
const vady = (r) => r.verdikty.filter((v) => v.stav === "vada").map((v) => `${v.co}: ${v.detail}`).join("\n");

describe("posudek modelového meshe (doktor C5)", () => {
  it("vše v pořádku → rc 0, každá kontrola ok", () => {
    const r = posud();
    expect(r.rc, vady(r)).toBe(0);
    expect(r.verdikty.map((v) => v.co)).toEqual(["uzel na GPU slotu", "most", "cíl mostu", "politika"]);
  });

  it("uzel nepřipojený → vada: modelové funkce stojí", () => {
    const r = posud({ peery: [uzel({ connected: false, last_seen: "2026-10-05T10:00:00Z" }), most()] });
    expect(r.rc).toBe(1);
    expect(vady(r)).toMatch(/NEPŘIPOJENÝ.*modelové funkce stojí/);
  });

  it.each([
    ["cizí jméno ve skupině uzlu", [uzel(), uzel({ id: "x9", name: "vetrelec" }), most()]],
    ["jiné id se jménem uzlu", [uzel({ id: "p-jiny" }), most()]],
    ["cizí peer ve skupině mostu", [uzel(), most(), most({ id: "x8", name: "vetrelec" })]],
  ])("%s → vada (incident)", (_p, peery) => {
    const r = posud({ peery });
    expect(r.rc).toBe(1);
    expect(vady(r)).toMatch(/CIZÍ peer/);
  });

  it("uzel chybí / není připnutý → vada", () => {
    expect(vady(posud({ peery: [most()] }))).toMatch(/v modelovém meshi NENÍ/);
    expect(vady(posud({ env: { ...ENV, MODEL_MESH_GPU_PEER_ID: "" } }))).toMatch(/není připnutý/);
  });

  it("most míří na jinou IP, nebo ji nemá → vada", () => {
    expect(vady(posud({ env: { ...ENV, MODEL_MESH_GPU_PEER_IP: "100.70.6.6" } }))).toMatch(/most míří na 100\.70\.6\.6, uzel má 100\.70\.1\.2/);
    expect(vady(posud({ env: { ...ENV, MODEL_MESH_GPU_PEER_IP: "" } }))).toMatch(/nedoručena/);
  });

  it.each([
    ["druhá politika", [...POLITIKA, POLITIKA[0]]],
    ["obousměrná", [{ ...POLITIKA[0], rules: [{ ...POLITIKA[0].rules[0], bidirectional: true }] }]],
    ["jiný port", [{ ...POLITIKA[0], rules: [{ ...POLITIKA[0].rules[0], ports: ["22"] }] }]],
    ["opačný směr", [{ ...POLITIKA[0], rules: [{ ...POLITIKA[0].rules[0], sources: [{ id: "g-gpu" }], destinations: [{ id: "g-most" }] }] }]],
    ["zdroj není most (cíl správně)", [{ ...POLITIKA[0], rules: [{ ...POLITIKA[0].rules[0], sources: [{ id: "g-cizi" }] }] }]],
    ["cíl není uzel (zdroj správně)", [{ ...POLITIKA[0], rules: [{ ...POLITIKA[0].rules[0], destinations: [{ id: "g-cizi" }] }] }]],
    ["žádná", []],
  ])("politika: %s → vada", (_p, politiky) => {
    const r = posud({ politiky });
    expect(r.rc).toBe(1);
    expect(vady(r)).toMatch(/politika/);
  });

  it("odpověď API, která není pole (401 objekt) → NEZMĚŘENO, ne „nic tam není“", () => {
    const r = posud({ peery: { message: "token invalid", code: 401 } });
    expect(r.rc).toBe(2);
    expect(r.verdikty[0].stav).toBe("nezmereno");
  });
});
