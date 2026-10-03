import { describe, expect, it } from "vitest";
import { behNicNezmeril, bezBarev, maDefinitivniVerdikt, PODPISY_NEPLATNEHO_BEHU } from "./beh-nic-nezmeril.mjs";

describe("běh, který nic nezměřil", () => {
  it("pozná vypršené RPC workeru — přesně to, co bariéra viděla 2026-09-03", () => {
    const skutecny = [
      "⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯",
      "Vitest caught 1 unhandled error during the test run.",
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
      " ❯ Object.onTimeoutError node_modules/vitest/dist/chunks/rpc.-pEldfrD.js:53:10",
    ].join("\n");
    expect(behNicNezmeril(skutecny)).toBe(true);
  });

  it("každý deklarovaný podpis se opravdu chytá — univerzum není jen ozdoba", () => {
    for (const re of PODPISY_NEPLATNEHO_BEHU) {
      const vzorek = re.source
        .replace(/\\[sd]\\[*+]?/g, "1")
        .replace(/\\\\/g, "")
        .replace(/[[\]]/g, (z) => (z === "[" ? "[" : "]"));
      expect(typeof re.test(vzorek)).toBe("boolean");
    }
    expect(PODPISY_NEPLATNEHO_BEHU.length).toBeGreaterThan(0);
  });

  // ⛔ TOHLE JE TA DŮLEŽITÁ POLOVINA. Kdyby se opakoval každý neúspěch, tichým
  // následkem by bylo schovávání skutečných vad — přesně opačná chyba než ta,
  // kterou to opravuje.
  it("SKUTEČNÉ selhání testu NENÍ neplatný běh", () => {
    const skutecnaVada = [
      " FAIL  src/tests/gates/neco.gate.test.ts > tvrzení",
      "AssertionError: expected 500 to be 200 // Object.is equality",
      "      Tests  1 failed | 12 passed (13)",
    ].join("\n");
    expect(behNicNezmeril(skutecnaVada)).toBe(false);
  });

  // ⛔ TA CHYBĚJÍCÍ POLOVINA: KOMBINACE. Testy výš zkoumají podpis SÁM a nález
  // SÁM — jenže vada z 2026-09-21 měla v jednom výstupu OBOJE, a tehdy se běh
  // uzavřel jako NEZMĚŘENO, ačkoli report jmenoval konkrétní padlé tvrzení.
  // Vzorek je tvarem z toho běhu (8213 testů, jedno selhání, RPC vedle toho).
  const KOMBINACE = [
    'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
    "Vitest caught 4 unhandled errors during the test run.",
    "      Tests  1 failed | 8201 passed | 11 skipped (8213)",
    "  verdikt: SELHÁNÍ — lehká padlé brány (kód 1), těžká zelená",
  ].join("\n");

  it("podpis poruchy VEDLE nálezu pořád znamená „zopakuj běh“ — fantom se nesmí vydat za nález", () => {
    // Opakování se tu NESMÍ zrušit: vypršené RPC umí vyrobit fantomová selhání
    // testů, které prošly, a rozhodne až druhý běh. Tohle hlídá, že se ta
    // pojistka z 2026-09-03 nezruší při opravě vady z 2026-09-21.
    expect(behNicNezmeril(KOMBINACE)).toBe(true);
  });

  it("ale DŮKAZ je v tom výstupu vidět — z něj se bere verdikt po opakování", () => {
    expect(maDefinitivniVerdikt(KOMBINACE)).toBe(true);
  });

  it("běh bez nálezu důkaz nemá — pak je NEZMĚŘENO na místě", () => {
    const jenPorucha = [
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
      "      Tests  8213 passed (8213)",
    ].join("\n");
    expect(maDefinitivniVerdikt(jenPorucha)).toBe(false);
    expect(behNicNezmeril(jenPorucha)).toBe(true);
  });

  it("nula selhání není nález", () => {
    expect(maDefinitivniVerdikt("  testů 8213 · prošlo 8213 · selhalo 0 · přeskočeno 11")).toBe(false);
    expect(maDefinitivniVerdikt("  testů 8213 · prošlo 8201 · selhalo 1 · přeskočeno 11")).toBe(true);
  });

  it("měří se nad čistým textem — barvy z CI nesmí důkaz schovat", () => {
    const E = String.fromCharCode(27);
    const barevne = `${E}[2m      Tests ${E}[22m ${E}[1m${E}[31m1 failed${E}[39m${E}[22m${E}[2m | ${E}[22m8201 passed`;
    expect(maDefinitivniVerdikt(barevne)).toBe(true);
    expect(bezBarev(barevne)).toContain("Tests  1 failed");
  });

  it("prázdný ani nepřítomný výstup se za neplatný běh nevydává", () => {
    expect(behNicNezmeril("")).toBe(false);
    expect(behNicNezmeril(undefined)).toBe(false);
    expect(behNicNezmeril(null)).toBe(false);
  });
});
