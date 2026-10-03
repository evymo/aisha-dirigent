/**
 * Subnety se odvozují z identity a NEZACHOVÁVAJÍ se (CLASS gate)
 *
 * TŘÍDA VADY: zděděná hodnota, která přežije vlastní důvod. `preservedValue()`
 * recykluje existující env napořád — u deterministicky odvozené hodnoty tím
 * nepřidává nic než nesmrtelnost starých čísel.
 *
 * NAMĚŘENO A REPRODUKOVÁNO 2026-08-11 na varra:
 *     <jiná instance>-mesh-dns = 10.99.0.0/24   (cizí nájemník rozsah drží)
 *     aisha MESH_DNS_SUBNET = 10.99.0.0/24  (zděděno z .env-prod-backup)
 *     docker network create --subnet 10.99.0.0/24
 *       → "Pool overlaps with other one on this address space"
 * Odvozený rozsah pro `aisha` je přitom 10.185.167.0/24 — volný. Mechanismus
 * existoval, jen se přes zachovanou hodnotu nikdy nedostal ke slovu.
 *
 * Tenhle soubor je zároveň test, který brána wp-3-4-docker-netseg SLIBOVALA
 * („determinismus, disjunktnost a RFC1918 jsou ověřeny u ZDROJE") a který
 * nikdy neexistoval — táž rodina „deklarováno, neověřeno".
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveSubnets,
  resolverFor,
  isRfc1918,
  POOL_BASE_OCTETS,
  ZONES,
} from "../../../scripts/lib/derive-subnets.mjs";

const ROOT = process.cwd();

/** `10.185.164.0/24` → číselný začátek a konec rozsahu. */
function range(cidr: string): [number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(cidr)!;
  const base =
    ((Number(m[1]) << 24) >>> 0) + (Number(m[2]) << 16) + (Number(m[3]) << 8) + Number(m[4]);
  const size = 2 ** (32 - Number(m[5]));
  return [base, base + size - 1];
}

function overlaps(a: string, b: string): boolean {
  const [a0, a1] = range(a);
  const [b0, b1] = range(b);
  return a0 <= b1 && b0 <= a1;
}

/**
 * Identity, na kterých se derivace ověřuje.
 *
 * ⛔ ŽÁDNÁ SKUTEČNÁ JMÉNA. Brána hlídá REPRODUKOVANÝ incident — dvě instance
 * na jednom hostiteli dostaly týž /24, `docker network create` skončil na
 * „Pool overlaps with other one on this address space" a mesh nenaběhla —
 * ale invariant, který ho vylučuje, zní:
 *
 *     RŮZNÉ identity → DISJUNKTNÍ bloky
 *
 * a ten žádná jména nepotřebuje. Naopak: SYNTETICKÝ vzorek tu derivaci
 * otestuje TVRDĚJI než hrstka skutečných jmen — pokrytí roste s velikostí
 * vzorku, ne s tím, kolik nájemníků zrovna existuje.
 *
 * Historie dvou špatných pokusů, ať se neopakují:
 *   1. natvrdo seznam skutečných jmen nájemníků — jména v generické šabloně,
 *      a jen hrstka dvojic pokrytí;
 *   2. přesun do `process.env.AISHA_COEXISTING_IDENTITIES` s `return` při
 *      prázdnu — tu proměnnou nikdo nenastavuje, takže test byl VŽDY zelený
 *      a neměřil nic. Deklarace, kterou nikdo neplní, je ozdoba.
 *
 * Řešení: syntetický vzorek jako VŽDY BĚŽÍCÍ jádro (bez jmen, velké pokrytí)
 * + operátorský kanál jako ROZŠÍŘENÍ, jehož prázdnota se HLÁSÍ, ne přeskakuje.
 */
const VZOREK_N = 512;

/** Deterministický vzorek identit — bez náhody, aby byl běh reprodukovatelný. */
const SYNTETICKE = Array.from({ length: VZOREK_N }, (_, i) => `inst-${i.toString(36)}-${(i * 7919) % 97}`);

/**
 * Volitelné ROZŠÍŘENÍ: operátor smí přidat identity, které na JEHO strojích
 * skutečně koexistují. Prázdno nic nevypíná — jádro běží tak jako tak —
 * ale test níž ten stav NAHLÁSÍ, aby se z chybějícího kanálu nestala tichá díra.
 *
 *   AISHA_COEXISTING_IDENTITIES="a,b,c" npm run test:gates
 */
const OPERATORSKE = (process.env.AISHA_COEXISTING_IDENTITIES ?? "")
  .split(",").map((x) => x.trim()).filter(Boolean);

const KOEXISTUJICI = [...SYNTETICKE, ...OPERATORSKE].filter((v, i, a) => a.indexOf(v) === i);

/** Širší vzorek pro determinismus/RFC1918 — koexistenci u nich netvrdíme. */
const IDENTITY = [...SYNTETICKE.slice(0, 32), ...OPERATORSKE, "acme", "demo", "a", "instance-42"];

describe("subnety: odvození z identity", () => {
  test("determinismus — táž identita dá týž rozsah", () => {
    for (const id of IDENTITY) {
      expect(deriveSubnets(id)).toEqual(deriveSubnets(id));
    }
  });

  test("čtyři zóny jedné instance jsou navzájem disjunktní", () => {
    for (const id of IDENTITY) {
      const s = deriveSubnets(id) as Record<string, string>;
      for (let i = 0; i < ZONES.length; i++) {
        for (let j = i + 1; j < ZONES.length; j++) {
          expect(
            overlaps(s[ZONES[i]], s[ZONES[j]]),
            `${id}: ${ZONES[i]} (${s[ZONES[i]]}) se překrývá s ${ZONES[j]} (${s[ZONES[j]]})`,
          ).toBe(false);
        }
      }
    }
  });

  test("vzorek identit se rozprostře přes pool — kolizí je jen tolik, kolik teorie připouští", () => {
    // Sonda musí mít co měřit.
    expect(KOEXISTUJICI.length, "vzorek identit je prázdný — brána nemá co měřit").toBeGreaterThan(64);

    const bloky = KOEXISTUJICI.map((id) => deriveSubnets(id).frontend);
    const unikatnich = new Set(bloky).size;

    // 10 bitů = 1024 bloků. Při N identitách je OČEKÁVANÝ počet obsazených
    // bloků 1024 * (1 - (1023/1024)^N) — narozeninový paradox, ne vada.
    // Tvrdíme, že derivace se chová jako slušný rozprostírač: skutečnost
    // nesmí zaostat za očekáváním o víc než 10 %. Konstantní nebo skoro
    // konstantní výstup (nejhorší možná vada) by tady propadl na hlavu.
    const N = KOEXISTUJICI.length;
    const ocekavano = 1024 * (1 - Math.pow(1023 / 1024, N));
    expect(
      unikatnich,
      `derivace se neroprostírá: ${N} identit obsadilo jen ${unikatnich} bloků, ` +
        `teorie čeká ~${Math.round(ocekavano)}`,
    ).toBeGreaterThan(ocekavano * 0.9);
  });

  test("operátorský kanál koexistujících identit: prázdno se HLÁSÍ, ne přeskakuje", () => {
    if (OPERATORSKE.length === 0) {
      // ⚠️ Vědomě NE `return` bez hlášky — přesně tak se z brány stala ozdoba.
      // Jádro výš běží nezávisle; tohle je jen viditelný záznam o tom, že
      // rozšiřující kanál nikdo nenaplnil.
      console.info(
        "[subnety] AISHA_COEXISTING_IDENTITIES není nastaveno — ověřeno jen na " +
          `syntetickém vzorku (${SYNTETICKE.length} identit). Operátor, který ví, ` +
          "které instance sdílejí hostitele, je sem může doručit.",
      );
      expect(SYNTETICKE.length, "jádro musí běžet i bez operátorského kanálu").toBeGreaterThan(64);
      return;
    }
    const bloky = OPERATORSKE.map((id) => deriveSubnets(id).frontend);
    expect(
      new Set(bloky).size,
      `KOLIZE mezi identitami, které operátor označil za koexistující: ${bloky.join(", ")} ` +
        "— použij override MESH_DNS_SUBNET",
    ).toBe(OPERATORSKE.length);
  });

  test("kolize DVOU identit je možná — a je to VĚDOMÝ limit, ne překvapení", () => {
    // 10 bitů = 1024 bloků, takže shoda je otázkou narozeninového paradoxu:
    // při ~38 instancích je pravděpodobnost kolize kolem 50 %. Nalezená dvojice
    // (2026-08-11) to dokládá na krátkých jménech.
    expect(deriveSubnets("demo").frontend).toBe(deriveSubnets("a").frontend);
    // Mechanismus, který kolizi řeší, MUSÍ existovat: operátorský override
    // (--mesh-dns-subnet / MESH_DNS_SUBNET) + fail-loud warmup na živý překryv.
    // Kdyby kolize mlčky prošla, dvě instance by sdílely rozsah — přesně to,
    // čemu se celý mechanismus vyhýbá.
    const gen = readFileSync(join(ROOT, "scripts/generate-secrets.mjs"), "utf-8");
    expect(/meshDnsSubnetOverride/.test(gen), "chybí override kanál pro kolizi bloků").toBe(true);
    const warmup = readFileSync(join(ROOT, "docker-compose.coolify-netinit.yml"), "utf-8");
    expect(/Pool overlaps/.test(warmup), "warmup nepojmenuje živý překryv rozsahů").toBe(true);
  });

  test("žádná zóna se nepřekrývá napříč instancemi (dvojice různých bloků)", () => {
    // Dvě identity, které DEMONSTRATIVNĚ padnou do různých bloků — přesně ta
    // situace, kterou incident vyžadoval: dvě instance na jednom hostiteli.
    const dvojice = SYNTETICKE.filter(
      (id, _i, arr) => deriveSubnets(id).frontend !== deriveSubnets(arr[0]).frontend,
    );
    expect(dvojice.length, "vzorek neobsahuje dvě identity v různých blocích").toBeGreaterThan(0);
    const a = deriveSubnets(SYNTETICKE[0]) as Record<string, string>;
    const t = deriveSubnets(dvojice[0]) as Record<string, string>;
    for (const za of ZONES) {
      for (const zt of ZONES) {
        expect(overlaps(a[za], t[zt]), `${za}=${a[za]} × ${zt}=${t[zt]}`).toBe(false);
      }
    }
  });

  test("všechny rozsahy jsou RFC1918 a uvnitř vyhrazeného poolu", () => {
    for (const id of IDENTITY) {
      const s = deriveSubnets(id) as Record<string, string>;
      for (const z of ZONES) {
        expect(isRfc1918(s[z]), `${id}.${z}=${s[z]} není RFC1918`).toBe(true);
        const [a, b] = s[z].split(".").map(Number);
        expect(a, `${id}.${z} mimo pool`).toBe(POOL_BASE_OCTETS[0]);
        // /12 pool: druhý oktet 176..191
        expect(b >= POOL_BASE_OCTETS[1] && b <= POOL_BASE_OCTETS[1] + 15, `${id}.${z}=${s[z]} mimo /12 pool`).toBe(true);
      }
    }
  });

  test("resolver leží UVNITŘ mesh-dns sítě, ne mimo ni", () => {
    for (const id of IDENTITY) {
      const s = deriveSubnets(id);
      const [lo, hi] = range(s.meshDns);
      const [r] = range(`${s.meshDnsResolver}/32`);
      expect(r >= lo && r <= hi, `${id}: resolver ${s.meshDnsResolver} mimo ${s.meshDns}`).toBe(true);
      expect(resolverFor(s.meshDns)).toBe(s.meshDnsResolver);
    }
  });

  test("prázdná identita se ODMÍTNE (jinak by všichni sdíleli jeden blok)", () => {
    expect(() => deriveSubnets("")).toThrow(/prázdná identita/);
    expect(() => deriveSubnets("   ")).toThrow(/prázdná identita/);
  });

  test("172.32.0.0/24 NENÍ RFC1918 — regrese na starý pevný rozsah", () => {
    expect(isRfc1918("172.32.0.0/24")).toBe(false);
    expect(isRfc1918("172.31.0.0/24")).toBe(true);
    expect(isRfc1918("192.168.1.0/24")).toBe(true);
    expect(isRfc1918("100.64.0.0/24"), "NetBird CGNAT není RFC1918").toBe(false);
  });
});

describe("subnety: generate-secrets je nezachovává", () => {
  const src = readFileSync(join(ROOT, "scripts/generate-secrets.mjs"), "utf-8");

  /** Vrátí nálezy: odvozené subnetové klíče protažené přes preservedValue. */
  function zachovavane(s: string): string[] {
    const klice = [
      "MESH_DNS_SUBNET",
      "MESH_DNS_RESOLVER_IP",
      "NETSEG_FRONTEND_SUBNET",
      "NETSEG_BACKEND_SUBNET",
      "NETSEG_DATA_SUBNET",
    ];
    return klice.filter((k) => new RegExp(`preservedValue\\(\\s*['"]${k}['"]`).test(s));
  }

  test("žádný odvozený subnet nejde přes preservedValue", () => {
    expect(
      zachovavane(src),
      "zachovaná hodnota přebije odvození a udrží při životě zděděný rozsah " +
        "(naměřeno 2026-08-11: aisha nesla 10.99.0.0/24, který držel jiný nájemník)",
    ).toEqual([]);
  });

  test("brána nález POZNÁ (negativní test)", () => {
    const mut = src.replace(
      "emit('MESH_DNS_SUBNET',          _meshDnsSubnet);",
      "emit('MESH_DNS_SUBNET', preservedValue('MESH_DNS_SUBNET', _sub.meshDns));",
    );
    expect(zachovavane(mut)).toContain("MESH_DNS_SUBNET");
  });

  test("operátorský override zůstává zachovaný (deklarace ano, setrvačnost ne)", () => {
    expect(/meshDnsSubnetOverride \|\| _sub\.meshDns/.test(src)).toBe(true);
    expect(/meshDnsResolverIpOverride/.test(src)).toBe(true);
  });

  test("výpočet má JEDEN domov — generate-secrets ho neduplikuje", () => {
    expect(
      /from '\.\/lib\/derive-subnets\.mjs'/.test(src),
      "generate-secrets musí deriveSubnets importovat, ne mít vlastní kopii",
    ).toBe(true);
    expect(
      /function deriveSubnets\(/.test(src),
      "v generate-secrets zůstala druhá definice deriveSubnets — dva domovy pro jeden výpočet",
    ).toBe(false);
  });
});
