const TAB = String.fromCharCode(9);
import { describe, expect, it } from "vitest";
import { odvozeneKlice, otiskOdvozenych } from "./otisk-odvozenych.mjs";

const KONTRAKT = [
  "POSTGREST_URL@derived",
  "MESH_PEER_IPS@placeholder",
  "GATEWAY_TRUSTED_PROXIES@derived",
  "SOME_SECRET@secret",
  "__CONTRACT_END__@4",
].join("\n").split("@").join(TAB);

describe("otisk odvozených klíčů", () => {
  it("bere JEN druh derived a řadí je", () => {
    expect(odvozeneKlice(KONTRAKT)).toEqual(["GATEWAY_TRUSTED_PROXIES", "POSTGREST_URL"]);
  });

  // ⛔ Useknutý výstup by vypadal jako kratší kontrakt — a otisk z části světa
  // je přesně to měřidlo, které mlčky mine, co má hlídat.
  it("bez patičky NEVYDÁ závěr, ale chybu", () => {
    const useknuty = ["POSTGREST_URL@derived", "GATEWAY_TRUSTED_PROXIES@deri"].join("\n").split("@").join(TAB);
    expect(() => odvozeneKlice(useknuty)).toThrow(/USEKNUTY/);
  });

  it("změna hodnoty odvozeného klíče otisk ZMĚNÍ", () => {
    const k = ["GATEWAY_TRUSTED_PROXIES"];
    const pred = otiskOdvozenych("GATEWAY_TRUSTED_PROXIES=10.0.0.0/8,127.0.0.1\n", k);
    const po = otiskOdvozenych("GATEWAY_TRUSTED_PROXIES=10.0.0.0/8,127.0.0.1,100.126.196.201\n", k);
    expect(pred.otisk).not.toBe(po.otisk);
  });

  it("změna NEodvozeného klíče otisk NEZMĚNÍ — jinak by se přenasazovalo pořád", () => {
    const k = ["GATEWAY_TRUSTED_PROXIES"];
    const a = otiskOdvozenych("GATEWAY_TRUSTED_PROXIES=x\nJINY=1\n", k);
    const b = otiskOdvozenych("GATEWAY_TRUSTED_PROXIES=x\nJINY=2\n", k);
    expect(a.otisk).toBe(b.otisk);
  });

  // ⛔ „Klíč zmizel" a „klíč je prázdný" jsou DVA RŮZNÉ stavy.
  it("chybějící klíč se odliší od prázdné hodnoty", () => {
    const k = ["A"];
    const chybi = otiskOdvozenych("JINY=1\n", k);
    const prazdny = otiskOdvozenych("A=\n", k);
    expect(chybi.otisk).not.toBe(prazdny.otisk);
    expect(chybi.chybejici).toEqual(["A"]);
    expect(prazdny.chybejici).toEqual([]);
  });
});
