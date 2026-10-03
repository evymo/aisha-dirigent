/**
 * Člověk přihlášený na sdíleném tabletu platí do místní půlnoci.
 *
 * Vlastnost: přihlášení z dřívějšího dne se odhlásí, dnešní ani nový člověk ne.
 * Odhlášení se ODKLÁDÁ, dokud fronta neodeslala (rozvoz přes půlnoc): fronta
 * odesílá jen za přihlášeného, takže by předání čekala na návrat téhož řidiče.
 * Nečitelný záznam nikoho neodhlásí (jen se přepíše) — porucha úložiště nesmí
 * vyhodit řidiče uprostřed práce.
 */
import { rozhodniOsobu } from "@/lib/kioskOsoba";

const DNES = "2026-09-30";
const VCERA = "2026-09-29";
const zaznam = (uid: string, den: string) => JSON.stringify({ uid, den });

describe("rozhodniOsobu", () => {
  it("nikdo přihlášený a nic uloženého → nic", () => {
    expect(rozhodniOsobu(null, null, DNES, 0)).toEqual({ akce: "nic" });
  });

  it("nikdo přihlášený, záznam zbyl → smazat", () => {
    expect(rozhodniOsobu(zaznam("u1", DNES), null, DNES, 0)).toEqual({ akce: "smazat" });
  });

  it("nový člověk → zapsat s dneškem", () => {
    expect(rozhodniOsobu(null, "u1", DNES, 0)).toEqual({ akce: "zapsat", zaznam: { uid: "u1", den: DNES } });
  });

  it("jiný člověk než uložený → zapsat jeho, ne odhlásit", () => {
    expect(rozhodniOsobu(zaznam("u1", VCERA), "u2", DNES, 0)).toEqual({
      akce: "zapsat",
      zaznam: { uid: "u2", den: DNES },
    });
  });

  it("týž člověk týž den → nic, ať ve frontě čeká cokoli", () => {
    expect(rozhodniOsobu(zaznam("u1", DNES), "u1", DNES, 0)).toEqual({ akce: "nic" });
    expect(rozhodniOsobu(zaznam("u1", DNES), "u1", DNES, 5)).toEqual({ akce: "nic" });
  });

  it("⛔ týž člověk přihlášený včera, fronta prázdná → odhlásit", () => {
    expect(rozhodniOsobu(zaznam("u1", VCERA), "u1", DNES, 0)).toEqual({ akce: "odhlasit" });
  });

  it("⛔ rozvoz přes půlnoc: neodeslaná práce ve frontě → odložit, ne odhlásit", () => {
    expect(rozhodniOsobu(zaznam("u1", VCERA), "u1", DNES, 2)).toEqual({ akce: "odlozit" });
  });

  it("⛔ frontu nejde přečíst → odložit (nevím = neriskovat)", () => {
    expect(rozhodniOsobu(zaznam("u1", VCERA), "u1", DNES, null)).toEqual({ akce: "odlozit" });
  });

  it("nečitelný záznam přihlášeného nikoho neodhlásí — jen se přepíše", () => {
    expect(rozhodniOsobu("{nesmysl", "u1", DNES, 0)).toEqual({ akce: "zapsat", zaznam: { uid: "u1", den: DNES } });
    expect(rozhodniOsobu(JSON.stringify({ uid: "u1" }), "u1", DNES, 0)).toEqual({
      akce: "zapsat",
      zaznam: { uid: "u1", den: DNES },
    });
  });

  it("nečitelný záznam bez člověka se smaže", () => {
    expect(rozhodniOsobu("{nesmysl", null, DNES, 0)).toEqual({ akce: "smazat" });
  });
});
