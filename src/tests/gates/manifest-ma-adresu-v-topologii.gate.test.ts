/**
 * Brána: co manifest ZALOŽÍ, musí mít v topologii ADRESU
 *
 * ⛔ NAMĚŘENO 2026-09-04 na produkci forku. Manifest jmenoval 13 aplikací,
 * `derive-domains.mjs` znal 12 služeb — a ta dvě čísla neporovnával NIKDO.
 * `coolify-story-init.sh` aplikaci podle manifestu ZALOŽÍ, resolver jí ale
 * odmítne dát adresu, takže se nasadí s tím, co zbylo:
 *
 *     NETBIRD_DOMAIN=netbird.aisha.example.com
 *     NETBIRD_API_URL=https://
 *     PKI_DOMAIN=pki.backend.internal.example.com
 *
 * Všechno doplněné z `config/domains.env.example` (cold-start to i hlásí:
 * „domains: filled unset keys from domains.env.example (placeholder)"). Ten
 * fallback je navržená pohodlnost, která tiše vyrábí VĚROHODNĚ VYPADAJÍCÍ
 * špatné hodnoty — prázdno by spadlo hlasitě, příklad projde až do produkce.
 *
 * Vada měla dvě patra a ani jedno nekřičelo:
 *   1. `netbird` má v katalogu `tier: "optional"`, takže ho `tier_filter`
 *      (required+important) zahodil i po vyškrtnutí z `exclude`. Kladná
 *      deklarace v `include` je nutná — týž idiom jako `"include": ["openclaw"]`
 *      v `config/profiles/local-dev.json`.
 *   2. Vyloučení navíc MASKOVALO porušení závislosti: dokud netbird v topologii
 *      nebyl, neměl `checkTopology` co kontrolovat. Po zařazení ohlásil
 *      „'netbird' depends on 'pki' but 'pki' not in profile" okamžitě — a to byl
 *      skutečný důvod, proč `pki-init` končil exit 1 a vlna 5 padala.
 *
 * Kontrola při prvním ostrém spuštění našla další TŘI: `admin` a `ai-chat`
 * (tier=optional, v manifestu, mimo topologii — odtud jejich mesh-ingress
 * sidecary s `FailingStreak: 776` při zdravých službách pod nimi) a
 * stack forku (nasazovaný, ale v `config/services.json` vůbec nebyl).
 *
 * Brána hlídá OBĚ strany kontraktu:
 *   1. `checkManifestCoverage` skutečně měří — a umí zčervenat na obou
 *      diagnózách (mimo katalog × mimo profil), protože každá má jinou léčbu
 *   2. `aisha-cold-start.sh` manifest do `--check` PŘEDÁVÁ — bez toho by
 *      kontrola existovala a přesto nic neměřila, což je horší než kdyby nebyla
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  checkManifestCoverage,
  manifestCoverageOffenders,
} from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const COLD_START = join(ROOT, "scripts/aisha-cold-start.sh");
const DOCTOR = join(ROOT, "scripts/cold-start-doctor.sh");
const BASELINE = join(ROOT, "src/tests/gates/manifest-coverage.baseline.json");

/** Minimální topologie — brána měří pravidlo, ne konkrétní instanci. */
const topo = (ids: string[]) => ({
  profile: "test-profil",
  services: Object.fromEntries(ids.map((id) => [id, {}])),
});

const KATALOG = ["core", "edge", "netbird", "admin"];

describe("manifest má adresu v topologii", () => {
  test("zdroje se našly (jinak brána nic neměří)", () => {
    expect(existsSync(COLD_START), "scripts/aisha-cold-start.sh musí existovat").toBe(true);
    expect(typeof checkManifestCoverage, "checkManifestCoverage musí být exportovaná").toBe("function");
  });

  test("plné pokrytí projde", () => {
    const manifest = "story: t\napp: core:frontend:a.yml\napp: edge:frontend:b.yml\n";
    expect(checkManifestCoverage(topo(["core", "edge"]), manifest, KATALOG)).toEqual([]);
  });

  test("umí zčervenat: aplikace v manifestu mimo topologii se pozná", () => {
    // Přesně případ netbirdu z 2026-09-04: v manifestu, v katalogu, mimo profil.
    const manifest = "app: core:frontend:a.yml\napp: netbird:frontend:nb.yml\n";
    const nalezy = checkManifestCoverage(topo(["core"]), manifest, KATALOG);
    expect(nalezy).toHaveLength(1);
    expect(nalezy[0]).toContain("netbird");
    expect(nalezy[0], "diagnóza musí ukázat na 'include' — tam je léčba").toContain("include");
  });

  test("rozliší DVĚ diagnózy, protože mají různou léčbu", () => {
    // mimo katalog (→ doplnit services.json) × mimo profil (→ doplnit include).
    // Splynutí obou do jedné hlášky by operátora poslalo opravovat špatný soubor.
    const manifest = "app: netbird:frontend:nb.yml\napp: testfork:frontend:tf.yml\n";
    const nalezy = checkManifestCoverage(topo([]), manifest, KATALOG);
    expect(nalezy).toHaveLength(2);
    const mimoKatalog = nalezy.find((i: string) => i.includes("testfork"))!;
    const mimoProfil = nalezy.find((i: string) => i.includes("netbird"))!;
    expect(mimoKatalog).toContain("services.json");
    expect(mimoProfil).toContain("include");
    expect(mimoKatalog).not.toContain("include");
  });

  test("prázdný manifest NENÍ „vše v pořádku“, ale nezměřený stav", () => {
    // Tichý průchod na prázdném vstupu je přesně ta třída vady, kterou brána řeší.
    const nalezy = checkManifestCoverage(topo(["core"]), "# jen komentář\n", KATALOG);
    expect(nalezy).toHaveLength(1);
    expect(nalezy[0]).toContain("žádnou aplikaci");
  });

  test("DOKTOR manifest do --check taky předává", () => {
    // ⛔ Doktor je READ-ONLY preflight — místo, kde se to má chytit DŘÍV, než
    // cold-start vůbec začne. Do 2026-09-05 `derive-domains.mjs --check`
    // nevolal ŽÁDNÝ skript kromě cold-startu; doktor ho jen zmiňoval v chybové
    // hlášce, kterou vypisoval, když už bylo pozdě.
    // ⛔ MĚŘÍ SE SKUTEČNÉ VOLÁNÍ, NE VÝSKYT ŘETĚZCE. První verze tohohle testu
    // hledala `--check --manifest` kdekoli v souboru — a zůstala ZELENÁ i po
    // odebrání přepínače z volání, protože týž řetěz nese chybová HLÁŠKA
    // („ověř 'derive-domains.mjs --check --manifest=<cesta>'"). Test, který
    // matchne vlastní dokumentaci místo chování, je přesně ta vada, kvůli které
    // tahle brána vznikla — potřetí za jeden den.
    const src = readFileSync(DOCTOR, "utf8");
    const zacatekE = src.indexOf('phase E "');
    const dalsiFaze = src.indexOf('\n  phase ', zacatekE + 1);
    const fazeE = src.slice(zacatekE, dalsiFaze < 0 ? undefined : dalsiFaze);
    expect(zacatekE, "fáze E se v doktorovi nenašla — brána by tiše prošla").toBeGreaterThan(-1);
    // Hledá se JEN VE FÁZI E. Ta chybová hláška, která `--check --manifest`
    // zmiňuje v textu, žije ve fázi A — omezení na fázi E ji tedy vylučuje samo,
    // bez regulárních cvičení. (První verze hledala řetězec v CELÉM souboru a
    // zůstala zelená i po odebrání přepínače z volání: matchla dokumentaci
    // místo chování. Druhá se zas lámala na pokračovacím zpětném lomítku.)
    expect(
      fazeE.includes("derive-domains.mjs"),
      `Fáze E nespouští derive-domains.mjs. Měří jen EXISTENCI compose souborů\n` +
        `z manifestu, ne to, jestli jim topologie umí odvodit adresu — a právě ta\n` +
        `osa 2026-09-04 chyběla. Doktor je READ-ONLY preflight, tedy místo, kde se\n` +
        `to má chytit DŘÍV, než cold-start vůbec začne.`,
    ).toBe(true);
    expect(fazeE, "fáze E volá resolver bez --check").toContain("--check");
    expect(
      fazeE,
      `Fáze E volá derive-domains.mjs, ale BEZ --manifest — ověří tedy jen vnitřní\n` +
        `konzistenci topologie a rozpor „manifest zakládá N, topologie zná M" jí unikne.`,
    ).toContain("--manifest=");
  });

  test("ctí provision_when_env — tutéž bránu jako story-init a resolver", () => {
    // Opt-in stack s uzavřenou lane story-init NEZAKLÁDÁ (provision_gate_skips)
    // a resolver ho nevydá. Hlásit ho jako vadu znamená hlásit SHODU tří míst.
    // Naměřeno 2026-09-05: bez téhle brány byly 4 z 9 nálezů na cloud-multi plané.
    const manifest = "app: gated-svc:frontend:g.yml\n";
    const katalog = { "gated-svc": { provision_when_env: "NIKDY_NENASTAVENA_LANE" } };
    const r = manifestCoverageOffenders(topo([]), manifest, katalog);
    expect(
      [...r.bezKatalogu, ...r.mimoProfil],
      "aplikace s uzavřenou lane se NESMÍ hlásit — story-init ji taky přeskočí",
    ).toEqual([]);

    // A s otevřenou lane se hlásit MUSÍ, jinak brána nic neměří.
    process.env.OTEVRENA_LANE = "1";
    try {
      const r2 = manifestCoverageOffenders(
        topo([]),
        "app: open-svc:frontend:o.yml\n",
        { "open-svc": { provision_when_env: "OTEVRENA_LANE" } },
      );
      expect(r2.mimoProfil).toEqual(["open-svc"]);
    } finally {
      delete process.env.OTEVRENA_LANE;
    }
  });

  test("ráčna existuje a nesmí RŮST bez povšimnutí", () => {
    expect(existsSync(BASELINE), "manifest-coverage.baseline.json chybí").toBe(true);
    const bl = JSON.parse(readFileSync(BASELINE, "utf8"));
    expect(Array.isArray(bl.bez_katalogu)).toBe(true);
    expect(Array.isArray(bl.mimo_profil)).toBe(true);
    // `mimo_profil` je ta LEVNĚJI splatitelná polovina (stačí `include`), takže
    // tam nemá co ležet nikdo. Kdyby přibyl, je to regrese profilu, ne dluh.
    expect(
      bl.mimo_profil,
      "aplikace v manifestu mimo profil se opravuje jedním řádkem v 'include' — " +
        "do ráčny nepatří",
    ).toEqual([]);
  });

  test("cold-start manifest do --check PŘEDÁVÁ", () => {
    const src = readFileSync(COLD_START, "utf8");
    const volani = src.match(/node "\$DERIVE_SCRIPT" --check[^\n]*/);
    expect(volani, "volání `node \"$DERIVE_SCRIPT\" --check` v cold-startu nenalezeno").not.toBeNull();
    expect(
      volani![0],
      `Cold-start volá --check bez manifestu, takže ověří jen VNITŘNÍ konzistenci topologie.\n` +
        `Rozpor „manifest zakládá N aplikací, topologie zná M služeb" tím zůstane neměřený —\n` +
        `a přesně tak se 2026-09-04 dostalo do produkce netbird.aisha.example.com.`,
    ).toContain("--manifest");
  });
});
