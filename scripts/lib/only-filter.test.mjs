import { describe, expect, test } from "vitest";
import { rozdelOnlyCile, dosazitelneVeVlnach } from "./only-filter.mjs";

// ⛔ Prefix fixtur je SCHVÁLNĚ smyšlený. Knihovna nezná jméno žádné instance
// (prefix je parametr) a testy to nesmějí popírat tím, že si nějaké dosadí —
// brána `stack-nesmi-znat-jmeno-instance` takový tvar správně odmítá.
const PREFIX = "fixture-";

describe("--only musí umět říct „na tohle nedosáhnu\"", () => {
  test("dosažitelné = vlastní je vlna A existují v Coolify", () => {
    const waves = [{ apps: ["fixture-edge", "fixture-core"] }, { apps: ["fixture-monitoring"] }];
    const vCoolify = new Set(["fixture-edge", "fixture-core", "fixture-model"]);
    // `fixture-monitoring` vlna vlastní, ale v Coolify není → nedosažitelné.
    // `fixture-model` v Coolify je, ale nevlastní ho vlna → taky nedosažitelné.
    expect([...dosazitelneVeVlnach(waves, vCoolify)].sort()).toEqual(["fixture-core", "fixture-edge"]);
  });

  test("rozdělí cíle na dosažitelné / mimo vlny / neexistující", () => {
    const vCoolify = new Set(["fixture-edge", "fixture-model"]);
    const dosazitelne = new Set(["fixture-edge"]);
    const r = rozdelOnlyCile(["edge", "model", "vymysl"], PREFIX, vCoolify, dosazitelne);
    expect(r.cile).toEqual(["fixture-edge"]);
    // PŘESNĚ tenhle případ 2026-08-20 mlčel: appka v Coolify JE, vlna ji nemá,
    // `--only` ji minulo a souhrn hlásil samé nuly.
    expect(r.mimoVlny).toEqual(["fixture-model"]);
    expect(r.neexistuji).toEqual(["fixture-vymysl"]);
  });

  test("umí říct i „všechno v pořádku\" — sonda musí jít zezelenat", () => {
    const vse = new Set(["fixture-edge", "fixture-core"]);
    const r = rozdelOnlyCile(["edge", "core"], PREFIX, vse, vse);
    expect(r.mimoVlny).toEqual([]);
    expect(r.neexistuji).toEqual([]);
    expect(r.cile).toEqual(["fixture-edge", "fixture-core"]);
  });

  test("operátor smí napsat jméno i s prefixem — prefix se nesmí zdvojit", () => {
    const jen = new Set(["fixture-edge"]);
    const r = rozdelOnlyCile(["fixture-edge"], PREFIX, jen, jen);
    expect(r.cile).toEqual(["fixture-edge"]);
    expect(r.neexistuji).toEqual([]);
  });

  test("prázdné a mezerami obalené položky se zahazují, ne mění v prefix", () => {
    const jen = new Set(["fixture-edge"]);
    const r = rozdelOnlyCile([" edge ", "", "  "], PREFIX, jen, jen);
    expect(r.cile).toEqual(["fixture-edge"]);
    expect(r.neexistuji).toEqual([]);
  });

  test("prefix je parametr — jiný prefix dá jiná jména", () => {
    const jen = new Set(["jinaqq-edge"]);
    const r = rozdelOnlyCile(["edge"], "jinaqq-", jen, jen);
    expect(r.cile).toEqual(["jinaqq-edge"]);
  });

  // Seznam z manifestu (netbird-bootstrap) nese i appky s vypnutou lane; ty
  // v Coolify chybí PRÁVEM. Kdyby padaly do `neexistuji`, bootstrap by na každé
  // instance s vypnutou lane skončil kódem 2 (naměřeno 2026-09-25: 13 stacků
  // s NETBIRD_ v manifestu, 12 v Coolify — `source-broker` má lane vypnutou).
  test("vypnutá lane je deklarovaný stav, ne neexistující appka", () => {
    const vCoolify = new Set(["fixture-core"]);
    const vypnute = new Map([["fixture-source-broker", "SOURCE_BROKER_ENABLED"]]);
    const r = rozdelOnlyCile(["core", "source-broker", "vymysl"], PREFIX, vCoolify, vCoolify, vypnute);
    expect(r.cile).toEqual(["fixture-core"]);
    expect(r.vypnuteLane).toEqual(["fixture-source-broker"]);
    // Překlep zůstává překlepem — vypnutá lane nesmí ředit přísnost.
    expect(r.neexistuji).toEqual(["fixture-vymysl"]);
  });

  test("appka, která v Coolify JE, se jako vypnutá nevykáže, i kdyby ji tak manifest vedl", () => {
    const vCoolify = new Set(["fixture-core"]);
    const r = rozdelOnlyCile(["core"], PREFIX, vCoolify, vCoolify, new Set(["fixture-core"]));
    expect(r.cile).toEqual(["fixture-core"]);
    expect(r.vypnuteLane).toEqual([]);
  });
});
