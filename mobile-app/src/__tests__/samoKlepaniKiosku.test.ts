/**
 * Samo-klepání tabletu v kiosku — hlídka dveří bez člověka.
 *
 * Testuje se ČISTÉ JÁDRO: dosažitelnost, klepání i čas jsou parametry.
 */
import { describe, expect, it } from "@jest/globals";
import {
  DAVKA,
  HLIDKA_MS,
  PREVENCE_MS,
  dalsiKoloZa,
  koloHlidky,
  novaPametKiosku,
  type SamoKlepaniDeps,
} from "../lib/samoKlepaniKiosku";
import type { PovereniZarizeni } from "../lib/poverovani-zarizeni";

const PRUKAZ: PovereniZarizeni = {
  kid: "dev-abababababababab",
  privateKeyPem: "SOUKROMY",
  publicKeyHex: `04${"ab".repeat(64)}`,
  scope: "ops",
};

function deps(o: { dosazitelne: boolean[]; prukaz?: PovereniZarizeni | null; odeslano?: boolean; ted?: number }) {
  const dosah = [...o.dosazitelne];
  const tukano: string[] = [];
  let nonce = 0;
  const d: SamoKlepaniDeps = {
    dosazitelne: async () => (dosah.length > 1 ? dosah.shift()! : dosah[0]),
    nactiPovereni: async () => (o.prukaz === undefined ? PRUKAZ : o.prukaz),
    pockej: async () => undefined,
    ted: () => o.ted ?? 1_000_000,
    zatukej: async (p) => {
      nonce += 1;
      tukano.push(`${p.kid}#${nonce}`);
      return o.odeslano === false ? { error: "EHOSTUNREACH", kid: p.kid, sent: false } : { kid: p.kid, nonceHex: String(nonce), sent: true };
    },
  };
  return { d, tukano };
}

describe("hlídka dveří tabletu", () => {
  it("zavřeno → pošle DÁVKU rámců (UDP se ztrácí) a ověří, že je otevřeno", async () => {
    const { d, tukano } = deps({ dosazitelne: [false, true] });
    const pamet = novaPametKiosku();
    expect(await koloHlidky(pamet, d)).toEqual({ kid: PRUKAZ.kid, vysledek: "zatukano" });
    expect(tukano).toHaveLength(DAVKA);
    // Každý rámec je jiný pokus — stejný nonce by dveře zahodily jako replay.
    expect(new Set(tukano).size).toBe(DAVKA);
    expect(pamet.posledniDavka).toBe(1_000_000);
  });

  it("otevřeno a čerstvě zaťukáno → nic neposílá", async () => {
    const { d, tukano } = deps({ dosazitelne: [true], ted: 2_000_000 });
    const pamet = { neuspechuVRade: 0, posledniDavka: 2_000_000 - 60_000 };
    expect(await koloHlidky(pamet, d)).toEqual({ vysledek: "otevreno" });
    expect(tukano).toHaveLength(0);
  });

  it("⭐ otevřeno, ale nájem stárne → zaťuká PREVENTIVNĚ, ať se nezavře pod rukama", async () => {
    const { d, tukano } = deps({ dosazitelne: [true], ted: 10_000_000 });
    const pamet = { neuspechuVRade: 0, posledniDavka: 10_000_000 - PREVENCE_MS - 1 };
    expect((await koloHlidky(pamet, d)).vysledek).toBe("zatukano");
    expect(tukano).toHaveLength(DAVKA);
  });

  it("⛔ bez průkazu neklepe a nic nezakládá", async () => {
    const { d, tukano } = deps({ dosazitelne: [false], prukaz: null });
    expect(await koloHlidky(novaPametKiosku(), d)).toEqual({ vysledek: "bez-prukazu" });
    expect(tukano).toHaveLength(0);
  });

  it("pořád zavřeno → další pokus s rostoucím odstupem, NE předání člověku", async () => {
    const { d } = deps({ dosazitelne: [false] });
    const pamet = novaPametKiosku();
    const odstupy: number[] = [];
    for (let i = 0; i < 6; i++) {
      const v = await koloHlidky(pamet, d);
      expect(v.vysledek).toBe("zavreno");
      odstupy.push(dalsiKoloZa(v, pamet));
    }
    expect(odstupy).toEqual([30_000, 60_000, 120_000, 240_000, HLIDKA_MS, HLIDKA_MS]);
  });

  it("rámec, který neodešel, se hlásí důvodem", async () => {
    const { d } = deps({ dosazitelne: [false], odeslano: false });
    expect(await koloHlidky(novaPametKiosku(), d)).toEqual({
      chyba: "EHOSTUNREACH",
      kid: PRUKAZ.kid,
      vysledek: "zavreno",
    });
  });

  it("výjimka z úložiště se stane stavem, ne pádem hlídky", async () => {
    const { d } = deps({ dosazitelne: [false] });
    d.nactiPovereni = async () => {
      throw new Error("uložené pověření je neúplné");
    };
    expect(await koloHlidky(novaPametKiosku(), d)).toEqual({ duvod: "uložené pověření je neúplné", vysledek: "chyba" });
  });

  it("po úspěchu se odstup vynuluje", async () => {
    const pamet = { neuspechuVRade: 4, posledniDavka: null };
    const { d } = deps({ dosazitelne: [false, true] });
    const v = await koloHlidky(pamet, d);
    expect(pamet.neuspechuVRade).toBe(0);
    expect(dalsiKoloZa(v, pamet)).toBe(HLIDKA_MS);
  });
});
