/**
 * Čekání měří JEN to, co odsud vidí, a jen to, co je jeho (CLASS gate)
 *
 * TŘÍDA VADY: univerzum měřidla se nekryje s univerzem jeho verdiktu. Měřidlo
 * pak čeká na podmínku, kterou nemá jak splnit, a vypadá to jako práce.
 *
 * Naměřeno 2026-08-26 na ostrém wipe deployi riqi — TŘI vady v jednom nástroji,
 * dohromady 90 minut tichého stání:
 *
 *   A) `--wait-healthy` čekal na `health_failed == 0`, ale 11 z 16 sond mířilo
 *      na `*.mesh.riq.internal` — jména existující jen UVNITŘ meshe. Operátorský
 *      stroj ani CI runner v ní nejsou, takže podmínka nemohla nastat.
 *      `deploy-and-verify.sh` si tuhle vadu zapsal 2026-08-08 a vyřešil ji tím,
 *      že sondy odtud nespouští; druhý volající ten poznatek nikdy nedostal.
 *   B) Pojistka `--stall-s` se resetovala na JAKOUKOLI změnu. Jedna kmitající
 *      sonda (4↔5 ok) ji resetovala donekonečna. Byla navržená na TICHO, ne
 *      na ŠUM.
 *   C) `active_deployments` se počítalo z CELÉ fronty Coolify. Watch tak čekal
 *      na nasazení cizích nájemníků — mimo jiné na druhý cold-start, který
 *      běžel vedle. Dva běhy čekaly jeden na druhý.
 *
 * INVARIANT:
 *   1. sonda, na kterou odsud není vidět, není `fail` ani `pass` — je to třetí
 *      stav a do `health_failed` se nepočítá;
 *   2. do `active_deployments` patří jen nasazení VLASTNÍCH appek;
 *   3. pokrok je monotónní — kmit tam a zpět pojistku neresetuje.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import {
  spoctiSouhrn,
  summarizeHealth,
  vyhodnotPokrok,
} from "../../../scripts/coolify-deploy-watch.mjs";

const appka = (name: string, uuid: string, status_class = "healthy") => ({
  name,
  uuid,
  status_class,
  latest_deployment: null,
  active_deployment: null,
});

describe("čekání měří jen vlastní a jen dosažitelný svět", () => {
  test("sonda mimo dosah není porucha — do health_failed se nepočítá", () => {
    const healthResults = [
      { app: "a", pass: true, merit: true },
      { app: "a", pass: false, merit: true }, // skutečná vada
      { app: "b", pass: false, merit: false }, // mesh jméno, odsud nevidět
      { app: "b", pass: false, merit: false },
    ];
    const s = spoctiSouhrn({ rows: [], globalDeployments: [], healthResults });
    expect(s.health_failed, "počítá se JEN měřitelná vada").toBe(1);
    expect(s.health_passed).toBe(1);
    expect(s.health_total, "nedosažitelné sondy nejsou součástí jmenovatele").toBe(2);
    expect(s.health_unmeasurable, "…ale nesmí zmizet: musí být vidět, že se neměřily").toBe(2);
  });

  test("sloupec HEALTH u appky nehlásí vadu, když na ni odsud není vidět", () => {
    const h = summarizeHealth([{ pass: false, merit: false }, { pass: false, merit: false }]);
    expect(h.failed, "appka, na kterou není vidět, není rozbitá").toBe(0);
    expect(h.mimoDosah).toBe(2);
  });

  test("čeká se jen na VLASTNÍ frontu, cizí nájemníci ji nedrží", () => {
    const rows = [appka("stack-core", "u1"), appka("stack-edge", "u2")];
    const globalDeployments = [
      { id: "d1", active: true, app_uuid: "u1", app_name: "stack-core" },
      { id: "d2", active: true, app_uuid: "zz", app_name: "testfork-mechanic" },
      { id: "d3", active: true, app_uuid: "yy", app_name: "testfork-keycloak" },
    ];
    const s = spoctiSouhrn({ rows, globalDeployments, healthResults: [] });
    expect(s.active_deployments, "jen nasazení našich appek").toBe(1);
    expect(s.cizi_aktivni_nasazeni, "cizí se ukážou, ale nečeká se na ně").toBe(2);
  });

  test("kmitání není pokrok — pojistka se resetovat nesmí", () => {
    const snim = (health_failed: number) => ({
      rows: [],
      summary: {
        active_deployments: 0,
        pending_apps: 0,
        bad_apps: 4,
        health_failed,
        failed_latest_deployments: 0,
      },
    });
    // kolo 1: první měření je vždy nové minimum
    let stav = vyhodnotPokrok(snim(11), { nejmensiZbyva: Infinity, otisk: "" });
    expect(stav.pokrok).toBe(true);
    // kolo 2: sonda kmitne NAHORU
    stav = vyhodnotPokrok(snim(12), stav);
    expect(stav.pokrok, "zhoršení není pokrok").toBe(false);
    // kolo 3: kmitne ZPÁTKY na původní hodnotu — přesně tenhle tvar držel watch 90 minut
    stav = vyhodnotPokrok(snim(11), stav);
    expect(
      stav.pokrok,
      "návrat na už dosažené minimum NENÍ pokrok; jinak kmitající sonda resetuje pojistku donekonečna",
    ).toBe(false);
    // kolo 4: skutečné zlepšení
    stav = vyhodnotPokrok(snim(9), stav);
    expect(stav.pokrok, "nové minimum JE pokrok").toBe(true);
  });

  test("pohyb fronty je pokrok i bez zlepšení počtů", () => {
    const rows = (id: string | null) => [{ active_deployment: id ? { id } : null }];
    const summary = {
      active_deployments: 1,
      pending_apps: 0,
      bad_apps: 0,
      health_failed: 0,
      failed_latest_deployments: 0,
    };
    let stav = vyhodnotPokrok({ rows: rows("d1"), summary }, { nejmensiZbyva: 1, otisk: "" });
    expect(stav.pokrok, "změna množiny běžících nasazení je skutečný pohyb").toBe(true);
    stav = vyhodnotPokrok({ rows: rows("d1"), summary }, stav);
    expect(stav.pokrok, "tatáž fronta podruhé už pohyb není").toBe(false);
  });
});
