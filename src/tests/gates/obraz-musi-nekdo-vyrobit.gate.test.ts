/**
 * Brána: obraz, který stack při `up` potřebuje, musí někdo VYROBIT nebo VYDAT.
 *
 * ⛔ NAMĚŘENO 2026-08-17 (a předtím 2026-08-09 — týž pád, jiná oprava):
 *
 * Nasazení `<fork>-core` skončilo takhle:
 *
 *     Image aisha-db-pg17:local Pulling
 *     Image aisha-db-pg17:local pull access denied — repository does not exist
 *     Image aisha-db-pg17:local Building
 *     unable to prepare context: path ".../infra/pg17" not found
 *
 * Tři cesty stavějí týž Dockerfile a KAŽDÁ ho tavuje jinak:
 *
 *     CI (.github/workflows/ci.yml)   → aisha-pg17-coldstart
 *     Coolify build fáze               → <app-uuid>_<služba>:<commit>
 *     compose při `up` OČEKÁVÁ         → aisha-db-pg17:local
 *
 * Ten třetí tag nevyrábí NIKDO. Stack proto nešel nastartovat od nuly — držel
 * se jen dokud na stroji ležel obraz postavený kdysi ručně. `force_docker_cleanup`
 * (na všech pěti serverech, každou noc, BEZ ohledu na práh zaplnění) zaručuje,
 * že takový obraz dřív nebo později zmizí.
 *
 * PROČ TA PŘEDCHOZÍ OPRAVA NESTAČILA
 * 2026-08-09 padlo totéž a náprava zněla „zajistit, aby `AISHA_DB_IMAGE` byla
 * doručená". Ta proměnná DORUČENÁ JE — jenže existence proměnné nevyrábí obraz.
 * Opravila se DEKLARACE, artefakt dál nevznikal. Tahle brána proto neměří, jestli
 * je hodnota vyplněná, ale jestli ten obraz může vůbec vzniknout.
 *
 * PRAVIDLO
 * Deklaruje-li služba `build:`, nasazovací cesta si obraz otaguje SAMA. Připnutý
 * `image:` na lokální tag (bez registru) se s tím tagem nikdy nepotká: `up` ho
 * zkusí stáhnout (není odkud) a pak postavit (v adresáři, kde repo není).
 * Připínat se smí jen odkaz, který jde STÁHNOUT.
 *
 * Univerzum si brána HLEDÁ sama — projde všechny `docker-compose.coolify*.yml`,
 * takže nový compose se pod ni dostane bez zásahu.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(__dirname, "../../..");

/** Hodnoty, které dosazuje cold-start ze svých konfiguračních souborů. */
function nactiZnameHodnoty(): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const soubor of ["config/image-versions.env"]) {
    const cesta = join(ROOT, soubor);
    if (!existsSync(cesta)) continue;
    for (const radek of readFileSync(cesta, "utf8").split("\n")) {
      const m = radek.match(/^([A-Z0-9_]+)=(.*)$/);
      // Soubor se SOURCUJE (bash): hodnota smí odkazovat na dřív deklarovaný klíč
      // (`AISHA_DB_IMAGE=aisha-db-pg${POSTGRES_MAJOR}:local`). Rozvinout tak, jak
      // to udělá shell i env-doktor (`expandEnvRefs`), jinak brána soudí literál.
      if (m) mapa[m[1]] = rozvin(m[2].trim(), mapa);
    }
  }
  return mapa;
}

/**
 * Rozvine `${VAR}`, `${VAR:-default}` i `${VAR:?zpráva}` na hodnotu, kterou
 * cold-start doopravdy dosadí. Nerozpoznanou proměnnou nechá být — o takové
 * brána nic netvrdí.
 */
function rozvin(hodnota: string, znameHodnoty: Record<string, string>): string {
  return hodnota.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?(?::\?[^}]*)?\}/g, (cele, klic, vychozi) => {
    if (znameHodnoty[klic] !== undefined) return znameHodnoty[klic];
    if (vychozi !== undefined) return vychozi;
    return cele;
  });
}

/**
 * Jde ten odkaz STÁHNOUT? Registr poznáme podle lomítka — `netbirdio/netbird`,
 * `library/busybox`, `repo.id3a.cz/aisha/x`. Holé `neco:tag` je lokální tag,
 * který existuje jen na tom stroji, kde ho někdo postavil.
 *
 * ⚠️ Nerozvinutá `${VAR}` se počítá jako stažitelná — o hodnotě, kterou brána
 * neumí zjistit, se nic netvrdí. Mlčet je správně; hádat by znamenalo vyrábět
 * falešné nálezy.
 */
function jdeStahnout(odkaz: string): boolean {
  if (/\$\{/.test(odkaz)) return true;
  return odkaz.includes("/");
}

type Nalez = { soubor: string; sluzba: string; odkaz: string };

/**
 * Z celé služby brána čte jen dvě pole, takže je jen na ně typovaná — `unknown`
 * je tu poctivější než `any`: `build:` může být řetězec i objekt a brána se ptá
 * pouze „je tam?", `image:` prochází `String()`. Širší typ by sliboval znalost
 * tvaru, kterou tahle brána nemá ani nepotřebuje.
 */
type Sluzba = { build?: unknown; image?: unknown };
type ComposeDokument = { services?: Record<string, Sluzba | null> };

function projdiComposy(): { sBuildem: number; nalezy: Nalez[] } {
  const soubory = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f));
  expect(soubory.length, "nenašel jsem žádný docker-compose.coolify*.yml — brána měří prázdno").toBeGreaterThan(5);

  const zname = nactiZnameHodnoty();
  const nalezy: Nalez[] = [];
  let sBuildem = 0;

  for (const soubor of soubory) {
    let dokument: ComposeDokument;
    try {
      dokument = parseYaml(readFileSync(join(ROOT, soubor), "utf8")) as ComposeDokument;
    } catch {
      continue; // nevalidní YAML řeší jiná brána
    }
    for (const [sluzba, def] of Object.entries(dokument?.services ?? {})) {
      if (!def || typeof def !== "object" || !def.build) continue;
      sBuildem++;
      if (!def.image) continue;
      const odkaz = rozvin(String(def.image), zname);
      if (!jdeStahnout(odkaz)) nalezy.push({ soubor, sluzba, odkaz });
    }
  }
  return { sBuildem, nalezy };
}

describe("obraz, který stack potřebuje, musí někdo vyrobit nebo vydat", () => {
  it("žádná stavěná služba nepřipíná image na lokální tag bez registru", () => {
    const { sBuildem, nalezy } = projdiComposy();

    // Sonda musí umět odpovědět „ne" — a taky doložit, že vůbec měřila.
    expect(sBuildem, "nenašel jsem ani jednu službu s `build:` — univerzum je prázdné, verdikt by nic neznamenal").toBeGreaterThan(20);

    const vypis = nalezy.map((n) => `${n.soubor} → ${n.sluzba}: image=${n.odkaz}`);
    expect(
      vypis,
      "Služba deklaruje `build:` a zároveň připíná `image:` na tag, který nejde stáhnout.\n" +
        "Nasazovací cesta si postavený obraz tavuje SAMA (<app-uuid>_<služba>:<commit>), takže\n" +
        "připnutý lokální tag nikdy nevznikne: `up` ho zkusí stáhnout (není odkud) a pak\n" +
        "postavit (v adresáři, kde repo není) — a nasazení padne.\n" +
        "Náprava: `image:` u stavěné služby VYPUSTIT, nebo připnout odkaz do registru.\n  " +
        vypis.join("\n  "),
    ).toEqual([]);
  });

  it("rozvinutí proměnných odpovídá tomu, co dosazuje cold-start", () => {
    const zname = nactiZnameHodnoty();
    // Kotva měření: kdyby se image-versions.env přestal číst, horní test by
    // zezelenal tím, že by všechno vypadalo jako nerozvinutá `${VAR}`.
    expect(Object.keys(zname).length, "config/image-versions.env se nenačetl — horní test by měřil naprázdno").toBeGreaterThan(5);
    expect(rozvin("${AISHA_DB_IMAGE:?nutné}", zname)).not.toMatch(/\$\{/);
  });

  it("rozpozná stažitelný odkaz od lokálního tagu", () => {
    expect(jdeStahnout("netbirdio/netbird:0.70.0")).toBe(true);
    expect(jdeStahnout("repo.id3a.cz/aisha/web:1")).toBe(true);
    expect(jdeStahnout("${REGISTRY_PROXY}library/busybox")).toBe(true);
    expect(jdeStahnout("aisha-db-pg17:local")).toBe(false);
    expect(jdeStahnout("svc-source-broker:latest")).toBe(false);
  });
});
