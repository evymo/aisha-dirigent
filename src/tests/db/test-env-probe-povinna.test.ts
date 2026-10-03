/**
 * Sonda DB v povinném režimu (AISHA_TESTDB_POVINNA=1, zapíná ji rohatka celé sady).
 *
 * ⛔ Rozbor #1113 (2026-09-28): sonda 3 s / 5 s pod zátěží sdíleného runneru
 * vypršela, soubor se celý přeskočil (skipIf) a rohatka ho brala jako změřený —
 * „dutá zelená". Povinně: víc pokusů, delší strop, neúspěch = výjimka se značkou
 * (rohatka → NEZMĚŘENO). Běžně (lokálně bez DB): beze změny — false a přeskočit.
 * Test DB nepotřebuje: spuštění sondy se podvrhne.
 */
import { describe, expect, test } from "vitest";
import { ZNACKA_DB_NEDOSTUPNA } from "../../../scripts/lib/rohatka-test-db.mjs";
import { sondaPg, type SpustSondu } from "./test-env-probe";

/** Podvržené spuštění: prvních `selze` volání vyhodí, pak projde; zaznamená stropy. */
function podvrh(selze: number) {
  const volani: { prikaz: string; strop: number }[] = [];
  const spust: SpustSondu = (prikaz, _argumenty, strop) => {
    volani.push({ prikaz, strop });
    if (volani.length <= selze) throw new Error(`${prikaz}: timeout`);
  };
  return { spust, volani };
}

describe("sonda DB — povinný režim nesmí tiše přeskočit", () => {
  test("běžný režim: nedostupná DB = false po JEDNOM pokusu se stropem 3 s (chování beze změny)", () => {
    const { spust, volani } = podvrh(Infinity);
    expect(sondaPg({ povinna: false, spust })).toBe(false);
    expect(volani).toEqual([{ prikaz: "pg_isready", strop: 3000 }]);
  });

  test("⛔ povinný režim: nedostupná DB = výjimka se značkou, ne false", () => {
    const { spust, volani } = podvrh(Infinity);
    expect(() => sondaPg({ povinna: true, spust, pauzaMs: 0 })).toThrow(ZNACKA_DB_NEDOSTUPNA);
    expect(volani.map((v) => v.prikaz)).toEqual(["pg_isready", "pg_isready", "pg_isready"]);
  });

  test("povinný režim: pomalá DB dostane další pokus a delší strop (zátěž není výpadek)", () => {
    const { spust, volani } = podvrh(1);
    expect(sondaPg({ povinna: true, spust, pauzaMs: 0 })).toBe(true);
    expect(volani).toEqual([
      { prikaz: "pg_isready", strop: 10_000 },
      { prikaz: "pg_isready", strop: 10_000 },
      { prikaz: "psql", strop: 15_000 },
    ]);
  });

  test("dostupná DB: true v obou režimech", () => {
    for (const povinna of [false, true]) expect(sondaPg({ povinna, spust: podvrh(0).spust })).toBe(true);
  });
});
