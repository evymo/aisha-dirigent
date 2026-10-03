/**
 * Brána: alias-kolize-je-po-kontejnerech
 *
 * INVARIANT, dvě tvrzení:
 *
 *   1. Kolize aliasu je VÍC RŮZNÝCH KONTEJNERŮ na jednom jméně — ne víc řádků
 *      výpisu. Měří se spuštěním `scripts/lib/alias-collisions.awk`, tedy
 *      téhož pravidla, které používá doktor.
 *   2. Doktor rozlišuje, ČÍ ten alias je: kolize na aliasu tohohle nasazení je
 *      `fail`, kolize mezi cizími nájemníky `info`.
 *
 * PROČ (1): Docker vypíše týž kontejner pro jeden alias OPAKOVANĚ — alias se
 * rovná jeho jménu i hostname. Naměřeno 2026-08-15 na talosu: počítání řádků
 * hlásilo jako kolizi kontejner sám se sebou (`ok404sgo4kswk…` třikrát), takže
 * mezi 20 „nálezy" byly čtyři skutečné a zbytek šum.
 *
 * PROČ (2): na sdíleném hostiteli se běžně potkají dva CIZÍ nájemníci —
 * generická jména jako `db`, `gateway` nebo `web` kolidují napříč všemi, 16 na
 * samotném talosu. Tvrdý fail bez rozlišení zastaví cold-start kvůli cizí
 * kolizi; mlčení naopak přejde tu vlastní. A ta vlastní je vážná: `aisha-db`,
 * `aisha-gateway`, `aisha-postgrest` a `aisha-redis` na talosu drží
 * jádra DVOU CIZÍCH forků (`<fork>-core`), zatímco `aisha-core` běží na Giah —
 * takže `aisha-edge` si `aisha-gateway` přeloží na CIZÍ kontejner.
 *
 * Jedno pravidlo, jeden domov: kdyby si brána awk opsala, potvrzovala by svou
 * vlastní kopii, ne to, co doktor opravdu dělá.
 *
 * ⚠️ MEZ TOHOHLE MĚŘENÍ: brána pouští `awk`, který má PRÁVĚ TENHLE stroj.
 * Implementace se ale liší — naměřeno 2026-08-15: na macOS awk vyšlo `X→a,b`,
 * na mawk i busybox awk (tedy na Linuxu, kde skript opravdu běží) `X→,a,b`
 * s prázdným prvním držitelem. Lokálně tedy bylo zeleno a spadlo to až v CI.
 * Druhou implementací je proto CI samo; kdo tohle pravidlo mění, musí projít
 * OBOJÍ — zelená na jednom awk není důkaz o druhém.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const PRAVIDLO = path.join(ROOT, "scripts/lib/alias-collisions.awk");
const DOKTOR = path.join(ROOT, "scripts/cold-start-doctor.sh");

/** Pustí pravidlo na `<kontejner>\t<alias>` řádcích a vrátí `alias → držitelé`. */
function kolize(radky: Array<[string, string]>): Map<string, string[]> {
  const vstup = radky.map(([c, a]) => `${c}\t${a}`).join("\n") + "\n";
  const r = spawnSync("awk", ["-f", PRAVIDLO], { input: vstup, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) {
    throw new Error(`awk selhal (status=${r.status}): ${r.stderr}` );
  }
  const out = new Map<string, string[]>();
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    const [alias, drzitele] = line.split("\t");
    out.set(alias, drzitele.split(","));
  }
  return out;
}

describe("brána: kolize aliasu se počítá po kontejnerech", () => {
  it("týž kontejner vypsaný vícekrát NENÍ kolize", () => {
    const v = kolize([["c1", "aisha-db"], ["c1", "aisha-db"], ["c1", "aisha-db"]]);
    expect([...v.keys()], "kontejner nemůže kolidovat sám se sebou").toEqual([]);
  });

  it("dva různé kontejnery na jednom aliasu kolize JSOU — i s vypsanými držiteli", () => {
    const v = kolize([["a", "aisha-gateway"], ["a", "aisha-gateway"], ["b", "aisha-gateway"]]);
    expect([...v.keys()]).toEqual(["aisha-gateway"]);
    expect(v.get("aisha-gateway")).toEqual(["a", "b"]);
  });

  it("aliasy bez kolize se nevypisují (nález je jen to, co kolidovalo)", () => {
    const v = kolize([["a", "sam"], ["b", "taky-sam"], ["c", "spolu"], ["d", "spolu"]]);
    expect([...v.keys()]).toEqual(["spolu"]);
  });

  it("prázdné řádky se nepočítají (mlčení není měření)", () => {
    const r = spawnSync("awk", ["-f", PRAVIDLO], { input: "\n\n\t\n", encoding: "utf8", timeout: 30_000 });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("");
  });

  it("doktor to pravidlo opravdu volá (neopisuje si vlastní kopii)", () => {
    const zdroj = readFileSync(DOKTOR, "utf8");
    expect(
      zdroj,
      "doktor musí číst scripts/lib/alias-collisions.awk — dvě kopie téhož pravidla se rozejdou",
    ).toContain("scripts/lib/alias-collisions.awk");
  });

  it("kontrola nepředpokládá ORCHESTRÁTOR ani víc hostitelů", () => {
    const zdroj = readFileSync(DOKTOR, "utf8");
    const blok = zdroj.slice(zdroj.indexOf("_SDILENA_SIT="), zdroj.indexOf("Kanárek na wildcard resolver"));
    expect(blok.length, "blok volby hostitelů se nenašel — brána by měřila prázdno").toBeGreaterThan(400);

    // Platforma je ŠABLONA pro libovolný fork. Že my provozujeme víc instancí
    // na sdíleném Coolify, je NÁŠ tvar — jiná instalace o něm nemusí vědět
    // a nesmí ho potřebovat. Proto:

    // 1. Jméno sdílené sítě je proměnná s doloženým výchozím jménem, ne
    //    předpoklad. Lokální generátor téhle platformy používá jinou síť,
    //    cizí fork může mít docela jinou.
    expect(blok, "sdílená síť nesmí být natvrdo").toContain("AISHA_SHARED_NETWORK");

    // 2. Nejběžnější tvar ze všech — jeden Docker server, žádný orchestrátor —
    //    se pozná podle SÍTĚ, o kterou v téhle kontrole jde. Dřív tu stála
    //    podmínka „běží kontejner coolify-proxy", což z Coolify dělalo
    //    předpoklad; takový fork by se nezměřil a mlčky prošel.
    const iLok = blok.indexOf('_kandidati="__local__"');
    expect(iLok, "větev lokálního démona se nenašla — brána by měřila prázdno").toBeGreaterThan(0);
    expect(
      blok.slice(Math.max(0, iLok - 700), iLok + 40),
      "lokální démon se musí poznat podle sdílené sítě, ne podle Coolify",
    ).toContain("docker network inspect");
    expect(blok, "přítomnost coolify-proxy nesmí být podmínkou měření").not.toContain("grep -qx 'coolify-proxy'");

    // 3. Živé umístění z orchestrátoru je DOPLNĚK — smí přijít až po
    //    deklarovaném umístění a jen když je orchestrátor vůbec deklarovaný.
    const iSloty = blok.indexOf("FRONTEND_HOSTNAME");
    const iZive = blok.indexOf("destination?.server?.name");
    expect(iSloty, "deklarované umístění se nečte").toBeGreaterThan(0);
    expect(iZive, "živé umístění se nečte").toBeGreaterThan(0);
    expect(iZive, "orchestrátor musí být doplněk ZA deklarací, ne před ní").toBeGreaterThan(iSloty);
    // Dotaz na orchestrátor se smí poslat jen tehdy, když je vůbec deklarovaný —
    // a když deklarovaný není, musí se to ozvat (ne mlčky přeskočit).
    expect(blok, "živé umístění se smí ptát jen s deklarovaným orchestrátorem").toContain("_orch_url");
    expect(blok, "chybějící orchestrátor se nesmí přejít mlčky").toContain("NEDOTAZOVÁNO");

    // 4. Jeden název i žádný jsou legitimní tvary.
    expect(blok, "víc hostitelů nesmí být podmínkou — dedup, ne požadavek").toContain("sort -u");

    // 5. Override zůstává, dosažitelnost se ověřuje, nedosažitelné se hlásí.
    expect(blok).toContain("AISHA_DOCTOR_DOCKER_HOSTS");
    expect(blok, "jméno hostitele není SSH cíl — ověřit, ne hádat").toContain("_ssh_docker_target");
    expect(blok, "nedosažitelný cíl je díra v měření, ne čisto").toContain("NEZMĚŘENO na:");
  });

  it("cíle se SJEDNOCUJÍ — lokální démon nesmí zastínit ostatní stroje", () => {
    const zdroj = readFileSync(DOKTOR, "utf8");
    const blok = zdroj.slice(zdroj.indexOf("_SDILENA_SIT="), zdroj.indexOf("Kanárek na wildcard resolver"));

    // ⛔ MOJE VADA 2026-08-15: tohle bylo `elif`, tedy PRVNÍ-KDO-ODPOVÍ.
    // Vývojový notebook má síť `coolify` se dvěma kontejnery → „čisto" →
    // a na produkční stroje se doktor nepodíval. Zelená z jiného stanoviště.
    // Lokální démon smí být JEDNÍM z cílů, nikdy náhradou za ostatní.
    expect(blok, "kandidáti se musí skládat, ne vybírat").toContain("_kandidati");
    expect(blok, "výsledek musí být sjednocení bez duplicit").toMatch(/_kandidati.*sort -u/s);
    const iLokal = blok.indexOf('_kandidati="__local__"');
    const iSloty = blok.indexOf("_deklarovany_slot FRONTEND_HOSTNAME");
    expect(iLokal, "větev lokálního démona se nenašla").toBeGreaterThan(0);
    expect(iSloty, "čtení deklarovaných slotů se nenašlo").toBeGreaterThan(0);
    expect(
      blok.slice(iLokal, iSloty),
      "mezi lokálním démonem a sloty nesmí být `elif` — tím by lokál ostatní zastínil",
    ).not.toMatch(/^\s*elif /m);

    // ⛔ DRUHÁ MOJE VADA: sloty se braly z prostředí, takže `FRONTEND_HOSTNAME`
    // (žije v .env.local) doktor neviděl a Talos — stroj s tou kolizí — beze
    // slova vynechal. Hodnoty musí pocházet z DEKLARACE.
    expect(blok, "sloty se čtou z deklarace, ne z náhodného prostředí").toContain("_deklarovany_slot");
    expect(blok).toMatch(/\.env\.local/);

    // A přeskočená větev se musí ozvat: „nebylo co přidat" a „nezeptal jsem se"
    // nesmí vypadat stejně.
    expect(blok, "přeskočený dotaz na orchestrátor musí být slyšet").toContain("NEDOTAZOVÁNO");
  });

  it("cizí kolize je info, vlastní je fail — rozlišuje se podle identity nasazení", () => {
    const zdroj = readFileSync(DOKTOR, "utf8");
    const blok = zdroj.slice(zdroj.indexOf("_moje_identita="), zdroj.indexOf("Kanárek na wildcard resolver"));
    expect(blok.length, "blok klasifikace se nenašel — brána by měřila prázdno").toBeGreaterThan(400);
    // Vlastní alias → fail, a rozhoduje o tom identita, ne pořadí ve výpisu.
    expect(blok).toMatch(/\$_alias.*==.*\$\{_moje_identita\}-/);
    expect(blok).toMatch(/fail "\[\$_label\] \$_n alias\(ů\) tohohle nasazení/);
    // Cizí alias → info. `fail` v téhle větvi by zastavil cold-start kvůli
    // kolizi, které se tohle nasazení netýká.
    expect(blok).toMatch(/info "\[\$_label\] \$_n kolidující\(ch\) alias\(ů\) patří JINÝM/);
  });
});
