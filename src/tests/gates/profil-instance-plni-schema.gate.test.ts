/**
 * Profil INSTANCE plní schéma profilu — týmž měřidlem jako šablony v repu.
 *
 * ⛔ NAMĚŘENO 2026-09-15. `derive-domains.mjs` čte `service_overrides.<id>.public`
 * (`override.public ?? svc.public`) a profil jedné instance jím zavírá čtyři
 * veřejné tváře, každou s `_comment_public`. Schéma přitom v přepisu služby
 * znalo jen `placement`, `legacy_env_var`, `subdomain`, `external_domain`
 * a `additionalProperties: false` — tentýž profil byl podle schématu NEPLATNÝ.
 * Neplatný byl i jinde: `server_bindings`, `surfaces`, `edge_profiles` a `knock`
 * resolver čte, schéma je nedeklarovalo.
 *
 * Nikdo to nepoznal, protože `schema-deklarace-se-plni` prochází jen JSON
 * v TOMHLE repu (`git ls-files`) a profil instance leží v privátním overlayi.
 * Šablony v repu přepisy `public` nepoužívají, takže brána šablon měřila tvar,
 * který nikdo nenasazuje, a tvar, který se nasazuje, neměřil nikdo.
 *
 * Proto:
 *   1. Profily overlaye (`$AISHA_INSTANCE_CONFIG_DIR/profiles/*.json`) se validují
 *      proti `config/profiles.schema.json` — resolver je načítá MÍSTO šablony
 *      (`profileCandidates`), takže jejich kontrakt je schéma šablony, ne
 *      relativní `$schema` uvnitř overlaye (ten na nic neukazuje).
 *   2. Pravidlo „přepis `public` nese důvod" stojí VE SCHÉMATU (`dependencies`
 *      + `minLength` u `_comment_*`), ne v téhle bráně — jedno místo pravdy,
 *      které uplatní každý validátor schématu, ne jen tenhle test.
 *   3. Kontrolní vzorky dokazují, že pravidlo umí zčervenat. Šablony `public`
 *      nepoužívají a overlay v lokálním běhu chybí — bez vzorků by zelená
 *      nedokazovala nic.
 *
 * Bez overlaye řekne nahlas, co neprohlédla; v CI ho `AISHA_OVERLAY_REQUIRED=1`
 * povyšuje na povinný (job „Instance: brány nad overlayem").
 */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { overit, type Uzel } from "./lib/json-schema-podmnozina";
import { overlayDir, overlayRequired } from "../../../scripts/lib/instance-overlay.mjs";

const ROOT = process.cwd();
const SCHEMA = JSON.parse(readFileSync(join(ROOT, "config/profiles.schema.json"), "utf8")) as Uzel;

/** Nejmenší profil, který schéma přijme — základ kontrolních vzorků. */
function profil(serviceOverrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "vzorek",
    description: "kontrolní vzorek brány",
    domain: { internal_pattern: "{subdomain}.{server}.{internal_tld}", public_pattern: "{subdomain}.{public_tld}", mesh_pattern: "{subdomain}.{mesh_tld}" },
    servers: ["backend"],
    tier_filter: ["required"],
    mesh_default: true,
    service_overrides: serviceOverrides,
  };
}

describe("profil instance plní schéma profilu (brána)", () => {
  test("kontrolní vzorek: přepis `public` s důvodem schéma přijme", () => {
    const chyby = overit(
      profil({ "local-ingest": { placement: "experimental", public: false, _comment_public: "vnitřní nástroj, chodí se meshem" } }),
      SCHEMA,
      SCHEMA,
    );
    expect(chyby).toEqual([]);
  });

  test("kontrolní vzorek: přepis `public` BEZ důvodu je nález", () => {
    const chyby = overit(profil({ "local-ingest": { public: true } }), SCHEMA, SCHEMA);
    expect(chyby.join("\n")).toMatch(/'public' vyžaduje i '_comment_public'/);
  });

  test("kontrolní vzorek: prázdný důvod není důvod", () => {
    const chyby = overit(profil({ "local-ingest": { public: true, _comment_public: "" } }), SCHEMA, SCHEMA);
    expect(chyby.join("\n")).toMatch(/_comment_public: délka 0 < minLength 1/);
  });

  test("kontrolní vzorek: neznámý klíč přepisu i konfigurace pod podtržítkem jsou nález", () => {
    const neznamy = overit(profil({ "local-ingest": { verejna: true } }), SCHEMA, SCHEMA);
    expect(neznamy.join("\n")).toMatch(/'verejna' není ve schématu deklarovaná/);
    const schovana = overit({ ...profil({}), _notes: { mesh_default: false } }, SCHEMA, SCHEMA);
    expect(schovana.join("\n")).toMatch(/\$\._notes: očekáván typ string\|array/);
  });

  test("profily instančního overlaye vyhovují config/profiles.schema.json", () => {
    const dir = overlayDir();
    const profilyDir = dir ? join(dir, "profiles") : "";
    if (!dir || !existsSync(profilyDir)) {
      const zprava =
        "profil-instance-plni-schema: " +
        (dir ? `overlay ${dir} nemá adresář profiles/` : "AISHA_INSTANCE_CONFIG_DIR není nastaven") +
        " — NEPROHLÉDNUT žádný profil instance. Prázdná množina není platný profil.";
      if (overlayRequired()) throw new Error(zprava);
      console.warn(zprava);
      return;
    }

    const soubory = readdirSync(profilyDir).filter((f) => f.endsWith(".json"));
    if (overlayRequired()) {
      expect(soubory.length, `overlay ${profilyDir} neobsahuje žádný profil — brána by měřila prázdno`).toBeGreaterThan(0);
    }
    const nalezy: string[] = [];
    for (const f of soubory) {
      const data = JSON.parse(readFileSync(join(profilyDir, f), "utf8"));
      for (const chyba of overit(data, SCHEMA, SCHEMA)) nalezy.push(`profiles/${f} ${chyba}`);
    }
    expect(
      nalezy,
      "Profil instance neodpovídá config/profiles.schema.json:\n  " +
        nalezy.join("\n  ") +
        "\n\nResolver ho načítá MÍSTO šablony, takže platí týž kontrakt. Klíč, který resolver čte,\n" +
        "patří do schématu (a brána profilova-deklarace-ma-konzumenta ověří, že ho někdo čte);\n" +
        "klíč, který nečte nikdo, patří z profilu pryč. Přepis `public` nese `_comment_public`.",
    ).toEqual([]);
  });
});
