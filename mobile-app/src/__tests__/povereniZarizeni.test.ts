/**
 * Pověření zařízení — vlastnosti, na kterých stojí důvěra.
 *
 * Testuje se ČISTÉ JÁDRO: úložiště i krypto jsou parametry, takže tenhle běh
 * nelinkuje nic nativního a měří logiku, ne platformu.
 */
import { describe, expect, it } from "@jest/globals";
import {
  KLIC_POVERENI,
  kidZKlice,
  povereniZarizeni,
  zapomenZarizeni,
  type KryptoZarizeni,
  type UlozisteKlicu,
} from "../lib/poverovani-zarizeni";

function pametovéUloziste(pocatek: Record<string, string> = {}) {
  const data = { ...pocatek };
  const u: UlozisteKlicu = {
    precti: async (k) => (k in data ? data[k] : null),
    zapis: async (k, v) => void (data[k] = v),
    smaz: async (k) => void delete data[k],
  };
  return { u, data };
}

let poradi = 0;
const kryptoNaoko: KryptoZarizeni = {
  novyPar: () => {
    poradi += 1;
    return {
      privateKeyPem: `-----PEM-${poradi}-----`,
      publicKeyHex: `04${String(poradi).repeat(2).padEnd(128, "a")}`,
    };
  },
  podepis: () => new Uint8Array([1, 2, 3]),
};

describe("pověření zařízení", () => {
  it("při prvním volání vyrobí pár a uloží ho", async () => {
    const { u, data } = pametovéUloziste();
    const p = await povereniZarizeni(u, kryptoNaoko, "ops");
    expect(p.privateKeyPem).toContain("PEM");
    expect(p.publicKeyHex.startsWith("04")).toBe(true);
    expect(data[KLIC_POVERENI]).toBeDefined();
  });

  it("⛔ podruhé vrátí TOTÉŽ — nový pár by znamenal ztrátu schválení", async () => {
    const { u } = pametovéUloziste();
    const a = await povereniZarizeni(u, kryptoNaoko, "ops");
    const b = await povereniZarizeni(u, kryptoNaoko, "ops");
    expect(b.publicKeyHex).toBe(a.publicKeyHex);
    expect(b.kid).toBe(a.kid);
  });

  it("⛔ kid se ODVOZUJE z klíče, takže jedno zařízení má jednu identitu", () => {
    const k = `04${"7".repeat(128)}`;
    expect(kidZKlice(k)).toBe(kidZKlice(k));
    expect(kidZKlice(k)).not.toBe(kidZKlice(`04${"8".repeat(128)}`));
  });

  it("⛔ nečitelné pověření SELŽE, nevyrobí tiše nové", async () => {
    const { u } = pametovéUloziste({ [KLIC_POVERENI]: "{tohle není json" });
    await expect(povereniZarizeni(u, kryptoNaoko, "ops")).rejects.toThrow(/nejde přečíst/);
  });

  it("⛔ neúplné pověření SELŽE — tichá výměna klíče vypadá jako útok", async () => {
    const { u } = pametovéUloziste({ [KLIC_POVERENI]: JSON.stringify({ kid: "dev-x" }) });
    await expect(povereniZarizeni(u, kryptoNaoko, "ops")).rejects.toThrow(/neúplné/);
  });

  it("soukromá část se do veřejného otisku NEDOSTANE", async () => {
    const { u } = pametovéUloziste();
    const p = await povereniZarizeni(u, kryptoNaoko, "ops");
    expect(p.publicKeyHex).not.toContain("PEM");
  });

  it("zapomenutí zařízení vrátí člověka k ručnímu ťukání", async () => {
    const { u, data } = pametovéUloziste();
    await povereniZarizeni(u, kryptoNaoko, "ops");
    await zapomenZarizeni(u);
    expect(data[KLIC_POVERENI]).toBeUndefined();
  });
});
