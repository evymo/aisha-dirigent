/**
 * env-hodnota — uvozování hodnot tak, aby je `source` přečetl doslova.
 *
 * ⛔ NAMĚŘENO 2026-09-21 (na forku při fast-forwardu z upstreamu): `odUvozovkuj` uměl '…' i "…", ale
 *    `jeUvozena` jen "…". Jednoduše uvozená hodnota proto vyšla jako „potřebuje
 *    uvozovky", `uvozovkuj` ji obalil dvojitými — a APOSTROFY SE STALY SOUČÁSTÍ
 *    HODNOTY. Doktor to hlásil s návodem „apply je srovná"; apply by tím na
 *    produkční instanci poškodil 25 hodnot v trezoru (mesh trasy, adresy).
 *    Hlášení o léku bylo součástí vady.
 *
 * Brána proto měří KULATOST: hodnota přečtená po srovnání musí být TÁŽ jako
 * hodnota přečtená před ním. To je vlastnost, ne seznam případů — chytí i
 * budoucí uvozovací styl, na který dnes nikdo nemyslí.
 */
import { describe, expect, it } from "vitest";
import { jeUvozena, odUvozovkuj, potrebujeUvozovky, srovnejUvozovani, uvozovkuj } from "./env-hodnota.mjs";

const VZORKY = [
  "'3310|fork-clamav:3310'",                       // jednoduše uvozené — regrese
  "'5672|fork-integration--rabbitmq:5672'",
  '"uz \\$dvojite"',                               // správně dvojitě uvozené (\$ je escapovaný)
  // ⛔ `"uz $dvojite"` (NEescapovaný $) sem NEPATŘÍ: bash by $dvojite roztáhl,
  //    takže to bezpečně uvozená hodnota NENÍ a kulatost u ní platit nemá.
  "hola-hodnota",                                  // nic nepotřebuje
  "ma$dolar",                                      // potřebuje
  'ma"uvozovku',
  "ma`backtick",
  "{\"json\":true}",
  "",                                              // prázdno je hodnota
];

describe("uvozování přežije source a nezmění hodnotu", () => {
  it.each(VZORKY)("kulatost: %j", (v) => {
    expect(odUvozovkuj(uvozovkuj(v))).toBe(odUvozovkuj(v));
  });

  it("jednoduše uvozená hodnota se NEuvozuje podruhé", () => {
    const v = "'3310|fork-clamav:3310'";
    expect(jeUvozena(v), "jeUvozena nezná apostrofy — apply by hodnotu poškodil").toBe(true);
    expect(potrebujeUvozovky(v)).toBe(false);
    expect(uvozovkuj(v)).toBe(v);
  });

  it("apostrof UVNITŘ nedělá z hodnoty uvozenou (bash to neumí)", () => {
    expect(jeUvozena("'a'b'")).toBe(false);
  });

  it("srovnání celého souboru nezmění ani jednu hodnotu", () => {
    const text = VZORKY.map((v, i) => `K${i}=${v}`).join("\n");
    const { text: po } = srovnejUvozovani(text);
    const cti = (t) =>
      Object.fromEntries(
        t.split("\n").flatMap((r) => {
          const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(r);
          return m ? [[m[1], odUvozovkuj(m[2])]] : [];
        }),
      );
    expect(cti(po)).toEqual(cti(text));
  });

  it("NEGATIVNÍ KONTROLA: měřidlo umí říct ne", () => {
    // Zmutovaná jeUvozena (bez větve pro apostrof) musí kulatost porušit.
    const jeUvozenaBezApostrofu = (h) => String(h).startsWith('"') && String(h).endsWith('"');
    const uvozovkujZle = (h) => (jeUvozenaBezApostrofu(h) ? h : `"${String(h).replace(/([\\"$`])/g, "\\$1")}"`);
    const v = "'3310|fork-clamav:3310'";
    expect(odUvozovkuj(uvozovkujZle(v))).not.toBe(odUvozovkuj(v));
  });
});
