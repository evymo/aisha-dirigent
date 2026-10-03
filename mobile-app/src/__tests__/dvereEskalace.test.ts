/**
 * Žebříček ke dveřím — a hlavně: cesta ven z cihly.
 *
 * ⛔ Nejdůležitější tvrzení je to poslední: odvolané pověření zařízení nesmí
 * znamenat telefon, ze kterého se už nedá zaťukat ručně.
 */
import { dalsiKrokDveri, type StavDveri } from "@/lib/dvereEskalace";

const stav = (o: Partial<StavDveri> = {}): StavDveri => ({
  dosazitelne: false, maPovereniZarizeni: false, uzZatukano: false, ...o,
});

describe("když to jde", () => {
  it("nic se nedělá", () => {
    expect(dalsiKrokDveri(stav({ dosazitelne: true }))).toEqual({ krok: "pokracuj" });
  });

  it("⛔ NEŤUKÁ SE pro jistotu — ani s průkazem", () => {
    // Zvyk ťukat, když to jde, udělá z break-glass materiálu rutinu.
    expect(dalsiKrokDveri(stav({ dosazitelne: true, maPovereniZarizeni: true })))
      .toEqual({ krok: "pokracuj" });
  });
});

describe("zařízení s průkazem", () => {
  it("zaťuká samo", () => {
    expect(dalsiKrokDveri(stav({ maPovereniZarizeni: true })))
      .toEqual({ krok: "zatukej-sam" });
  });

  it("⛔ podruhé už NE — týž průkaz, tytéž dveře, jen blíž k cooldownu", () => {
    expect(dalsiKrokDveri(stav({ maPovereniZarizeni: true, uzZatukano: true })))
      .toEqual({ krok: "nabidni-rucni", duvod: "automatika-neprosla" });
  });
});

describe("cesta ven z cihly", () => {
  it("⛔ bez průkazu se rovnou nabídne ruční kód", () => {
    expect(dalsiKrokDveri(stav()))
      .toEqual({ krok: "nabidni-rucni", duvod: "bez-povereni" });
  });

  it("⛔ ODVOLANÉ pověření NESMÍ telefon zamknout", () => {
    // Odvolání = průkaz zmizí nebo přestane platit. Obojí musí skončit
    // u ruční cesty, ne u appky, která se nemá kam hnout.
    expect(dalsiKrokDveri(stav({ maPovereniZarizeni: false })).krok).toBe("nabidni-rucni");
    expect(dalsiKrokDveri(stav({ maPovereniZarizeni: true, uzZatukano: true })).krok)
      .toBe("nabidni-rucni");
  });

  it("⛔ ŽÁDNÝ vstup nevede do slepé uličky", () => {
    // Vyčerpávající: osm kombinací, žádná nesmí skončit jinak než krokem,
    // který někam vede.
    for (const dosazitelne of [true, false])
      for (const maPovereniZarizeni of [true, false])
        for (const uzZatukano of [true, false]) {
          const { krok } = dalsiKrokDveri({ dosazitelne, maPovereniZarizeni, uzZatukano });
          expect(["pokracuj", "zatukej-sam", "nabidni-rucni"]).toContain(krok);
        }
  });

  it("důvod se říká vždy, když se žádá člověk — jinak neví, co se stalo", () => {
    for (const maPovereniZarizeni of [true, false])
      for (const uzZatukano of [true, false]) {
        const r = dalsiKrokDveri({ dosazitelne: false, maPovereniZarizeni, uzZatukano });
        if (r.krok === "nabidni-rucni") expect(r.duvod).toBeTruthy();
      }
  });
});
