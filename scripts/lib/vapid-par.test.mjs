/**
 * VAPID pár: výroba a posudek uloženého stavu. Čistě hodnoty — žádné I/O.
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { jeVerejnyVapid, posudVapidPar, verejnyZeSoukromeho, vyrobVapidPar } from "./vapid-par.mjs";

const b64 = (buf) => Buffer.from(buf).toString("base64url");

describe("vyrobVapidPar", () => {
  it("vyrobí pár ve tvaru RFC 8292, který k sobě patří", () => {
    const { verejny, soukromy } = vyrobVapidPar();
    expect(Buffer.from(verejny, "base64url")).toHaveLength(65);
    expect(Buffer.from(verejny, "base64url")[0]).toBe(0x04);
    expect(Buffer.from(soukromy, "base64url")).toHaveLength(32);
    expect(verejnyZeSoukromeho(soukromy)).toBe(verejny);
  });
});

describe("tvar veřejného klíče", () => {
  it("náhoda o 65 bajtech — to, co vyráběl doktor druhem `secret` — NENÍ bod", () => {
    expect(jeVerejnyVapid(b64(crypto.randomBytes(65)))).toBe(false);
    expect(jeVerejnyVapid(b64(Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)])))).toBe(false);
  });
  it("komprimovaný bod je bod, ale Web Push ho nebere", () => {
    const { verejny } = vyrobVapidPar();
    const komprimovany = crypto.ECDH.convertKey(Buffer.from(verejny, "base64url"), "prime256v1", undefined, undefined, "compressed");
    expect(jeVerejnyVapid(b64(komprimovany))).toBe(false);
  });
});

describe("soukromý klíč", () => {
  it("odmítne špatnou délku, nulu i skalár ≥ n", () => {
    expect(verejnyZeSoukromeho(b64(crypto.randomBytes(31)))).toBeNull();
    expect(verejnyZeSoukromeho(b64(Buffer.alloc(32)))).toBeNull();
    expect(verejnyZeSoukromeho(b64(Buffer.alloc(32, 0xff)))).toBeNull();
  });
});

describe("posudVapidPar", () => {
  const par = vyrobVapidPar();
  const jiny = vyrobVapidPar();

  it("úplný platný pár se ponechá", () => {
    expect(posudVapidPar(par).akce).toBe("ponechat");
  });
  it("nic uloženo → nový pár, který k sobě patří", () => {
    const r = posudVapidPar({});
    expect(r.akce).toBe("vyrobit");
    expect(verejnyZeSoukromeho(r.soukromy)).toBe(r.verejny);
  });
  it("chybí veřejný → odvodí se ze soukromého, soukromý zůstane (žádná rotace)", () => {
    const r = posudVapidPar({ soukromy: par.soukromy });
    expect(r).toMatchObject({ akce: "doplnit-verejny", verejny: par.verejny, soukromy: par.soukromy });
  });
  it("veřejný je náhoda z doktora → nahradí se odvozeným, soukromý zůstane", () => {
    const r = posudVapidPar({ verejny: b64(crypto.randomBytes(65)), soukromy: par.soukromy });
    expect(r).toMatchObject({ akce: "nahradit-verejny", verejny: par.verejny, soukromy: par.soukromy });
  });
  it("⛔ chybí soukromý → STOP (obnovit ho nejde; nový pár = rotace = rozhodnutí)", () => {
    const r = posudVapidPar({ verejny: par.verejny });
    expect(r.akce).toBe("stop");
    expect(r.verejny).toBeUndefined();
    expect(r.soukromy).toBeUndefined();
  });
  it("⛔ soukromý není platný skalár → STOP", () => {
    expect(posudVapidPar({ verejny: par.verejny, soukromy: b64(Buffer.alloc(32)) }).akce).toBe("stop");
  });
  it("⛔ dva platné klíče, které k sobě nepatří → STOP (nevím, který je pravý)", () => {
    const r = posudVapidPar({ verejny: jiny.verejny, soukromy: par.soukromy });
    expect(r.akce).toBe("stop");
    expect(r.duvod).toMatch(/NEPATŘÍ K SOBĚ/);
  });
  it("důvod STOPu nikdy nenese hodnotu klíče", () => {
    for (const vstup of [{ verejny: par.verejny }, { verejny: jiny.verejny, soukromy: par.soukromy }]) {
      const { duvod } = posudVapidPar(vstup);
      expect(duvod).not.toContain(par.soukromy.slice(0, 8));
      expect(duvod).not.toContain(par.verejny.slice(0, 8));
      expect(duvod).not.toContain(jiny.verejny.slice(0, 8));
    }
  });
});
