/**
 * Gate: na SDÍLENÉ síti musí mít služba alias nesoucí identitu ZÁKAZNÍKA.
 *
 * PROČ (změřeno 2026-08-04 na sdíleném Coolify)
 * --------------------------------------------
 * Síť `coolify` není naše — Coolify po ní vede provoz VŠECH instancí na daném
 * serveru. Naměřeno: 149 aplikací, osm zákaznických prefixů (např. tenant-a, tenant-b,
 * a další) a **pět různých Keycloaků**.
 *
 * `SERVICE_ALIAS_PREFIX` je jméno IMPLEMENTACE stacku, ne zákazníka: u forku má
 * hodnotu `aisha`, takže se jeho Keycloak na sdílené síti hlásil jako
 * `aisha-keycloak` — přesně jako Keycloak zákazníka aisha. Konzumenti z jiných
 * compose stacků (`ai-chat`, `exec`, `ledger`, `domain-services`, `matrix`)
 * vytáčejí `http://aisha-keycloak:80`, takže mohli dostat CIZÍ Keycloak, a tím
 * cizí podpisové klíče.
 *
 * Repo tu vadu zná z jiného místa — brána `network-alias-unique` ji popisuje
 * doslova: čtyři po sobě jdoucí DNS dotazy vrátily jednu adresu, další tři jinou —
 * dva různé buildy pod jedním jménem. Tam šlo o dva compose v jednom repu; tady
 * o dva zákazníky na jednom hostiteli, což ta brána vidět nemůže.
 *
 * CO SE ZÁMĚRNĚ NEKONTROLUJE
 * --------------------------
 * - Sítě `internal`, `mesh-dns` a další per-stack sítě. Tam je alias odvozený
 *   z implementace SPRÁVNĚ: síť je izolovaná, kolize nevzniká a stack má právo
 *   na svůj slovník. Vyžadovat instanční jméno i tam by byl šum.
 * - Jestli je alias na sdílené síti globálně unikátní. To by vyžadovalo znát
 *   ostatní instance, což z repa nejde; kontroluje se VLASTNOST (jméno je
 *   odvozené od identity zákazníka), ne výsledek na konkrétním hostiteli.
 * - Odstranění sdíleného jména. Instanční alias se přidává NAVÍC, aby rollout
 *   neměl okno výpadku (Keycloak odpovídá na obě jména, konzumenti se přepnou
 *   až potom). Vyžadovat exkluzivitu by tenhle mezikrok zakázalo.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Sítě, které NEJSOU naše — jede po nich provoz cizích instancí. */
const SHARED_NETWORKS = ["coolify"];

/** Identita ZÁKAZNÍKA (na rozdíl od SERVICE_ALIAS_PREFIX = jméno stacku). */
const INSTANCE_VARS = ["APP_NAME_PREFIX", "AISHA_STORY"];

function composeFiles(): string[] {
  return readdirSync(ROOT).filter(
    (f) => /^docker-compose\..*\.ya?ml$/.test(f) && !f.includes("local") && !f.endsWith(".example"),
  );
}

interface AliasBlock {
  file: string;
  service: string;
  network: string;
  aliases: string[];
}

/**
 * Posbírá `networks: → <síť>: → aliases:` po službách. Odsazení je nositelem
 * struktury, takže se čte podle něj — YAML parser by tu byl těžší kalibr, než
 * jedna vlastnost potřebuje.
 */
function aliasBlocks(file: string): AliasBlock[] {
  const out: AliasBlock[] = [];
  let service = "";
  let inNetworks = false;
  let network = "";
  let inAliases = false;

  for (const raw of readFileSync(resolve(ROOT, file), "utf-8").split("\n")) {
    if (raw.trimStart().startsWith("#")) continue;

    const svc = raw.match(/^ {2}([a-z][a-z0-9_-]*):\s*$/);
    if (svc) {
      service = svc[1];
      inNetworks = inAliases = false;
      network = "";
      continue;
    }
    if (/^ {4}networks:\s*$/.test(raw)) {
      inNetworks = true;
      inAliases = false;
      continue;
    }
    if (/^ {4}\S/.test(raw) && !/^ {4}networks:/.test(raw)) {
      inNetworks = inAliases = false;
    }
    if (!inNetworks) continue;

    const net = raw.match(/^ {6}([a-z][a-z0-9_-]*):/);
    if (net) {
      network = net[1];
      inAliases = false;
      continue;
    }
    if (/^ {8}aliases:\s*$/.test(raw)) {
      inAliases = true;
      out.push({ file, service, network, aliases: [] });
      continue;
    }
    const item = raw.match(/^ {10}-\s*(.+?)\s*$/);
    if (inAliases && item && out.length) out[out.length - 1].aliases.push(item[1]);
  }
  return out;
}

const ALL = composeFiles().flatMap(aliasBlocks);

describe("alias na sdílené síti nese identitu zákazníka", () => {
  it("univerzum se seeduje ze skutečnosti a není prázdné", () => {
    // Brána nad nulou aliasů projde vždycky — a vypadá stejně jako zdravé repo.
    expect(composeFiles().length).toBeGreaterThan(10);
    expect(ALL.length).toBeGreaterThan(0);
    expect(ALL.filter((b) => SHARED_NETWORKS.includes(b.network)).length).toBeGreaterThan(0);
  });

  it("každý alias na sdílené síti má variantu odvozenou od identity instance", () => {
    const violations: string[] = [];
    for (const block of ALL) {
      if (!SHARED_NETWORKS.includes(block.network)) continue;
      const hasInstance = block.aliases.some((a) =>
        INSTANCE_VARS.some((v) => a.includes(`\${${v}`)),
      );
      if (!hasInstance) {
        violations.push(`${block.file}: ${block.service} (síť ${block.network})`);
      }
    }
    expect(
      violations,
      "Síť `coolify` je SDÍLENÁ mezi instancemi na jednom hostiteli (naměřeno: " +
        "149 aplikací, 8 zákazníků, 5 Keycloaků). Alias odvozený jen z " +
        "SERVICE_ALIAS_PREFIX je jméno IMPLEMENTACE stacku — u víc instancí " +
        "vyjde stejné a DNS pak odpovídá střídavě cizím kontejnerem. Přidej " +
        "alias odvozený z ${APP_NAME_PREFIX}:\n  " +
        violations.join("\n  "),
    ).toEqual([]);
  });
});
