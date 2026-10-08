/**
 * Brána: řídicí roviny meshe jsou VÝSTUP jednoho generátoru
 *
 * Varianta C (aisha.decision 2026-10-05 03:17:54Z): každý fork má vedle hlavního meshe
 * SAMOSTATNÝ MODELOVÝ mesh — druhou instanci téhož stacku NetBird z téhož generátoru
 * a deklarace. Zdroj je jeden: šablona (`coolify/netbird/*.tpl`) + deklarace
 * (`config/netbird-instances.json`). Compose i šablona management.json každé instance
 * jsou výstup `scripts/gen-netbird-instance.mjs`.
 *
 * Co brána tvrdí:
 *   · každý deklarovaný výstup je PŘESNĚ to, co generátor vykreslí (ruční úprava
 *     výstupu = červená; náprava je u šablony nebo deklarace, ne u výstupu);
 *   · hlavní instance vlastní dosavadní soubory řídicí roviny (`docker-compose.coolify-
 *     netbird.yml`, `coolify/netbird-management.json.template`) — fork bez modelového
 *     meshe se zavedením generátoru nemění (kontrakt meshe DT4/MM4: bajtová shoda);
 *   · šablona selhává NAHLAS: neznámý zástupný znak, nedeklarovaná sekce i zbylé `{{`
 *     jsou výjimka, ne prázdný řetězec (šablona doručená místo hodnoty je tichá vada).
 *
 * Spouští se přes: npm run test:gates -- netbird-instance-z-generatoru
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { join } from "node:path";
import {
  DEKLARACE,
  SABLONA_COMPOSE,
  SABLONA_MANAGEMENT,
  nactiDeklaraci,
  vykresli,
  vystupy,
} from "../../../scripts/gen-netbird-instance.mjs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("řídicí roviny meshe = výstup jednoho generátoru", () => {
  test("šablony a deklarace existují (měřidlo má co měřit)", () => {
    for (const p of [DEKLARACE, SABLONA_COMPOSE, SABLONA_MANAGEMENT]) {
      expect(existsSync(join(ROOT, p)), `${p} chybí`).toBe(true);
    }
  });

  test("hlavní instance vlastní dosavadní soubory řídicí roviny", () => {
    const hlavni = nactiDeklaraci(ROOT).find((i: { id: string }) => i.id === "hlavni");
    expect(hlavni, `${DEKLARACE}: chybí instance "hlavni"`).toBeTruthy();
    expect(hlavni.compose).toBe("docker-compose.coolify-netbird.yml");
    expect(hlavni.management).toBe("coolify/netbird-management.json.template");
  });

  for (const { instance, cesta, obsah } of vystupy(ROOT)) {
    test(`${cesta} (${instance}) = výstup generátoru`, () => {
      expect(existsSync(join(ROOT, cesta)), `${cesta} chybí — spusť node scripts/gen-netbird-instance.mjs`).toBe(true);
      expect(
        read(cesta) === obsah,
        `${cesta} se rozešel s generátorem. Výstup se needituje ručně: uprav šablonu ` +
          `(${SABLONA_COMPOSE} / ${SABLONA_MANAGEMENT}) nebo deklaraci (${DEKLARACE}) a spusť ` +
          `node scripts/gen-netbird-instance.mjs.`,
      ).toBe(true);
    });
  }
});

describe("šablona selhává nahlas (kontrolní vzorky)", () => {
  const instance = { id: "vzorek", hodnoty: { A: "a" }, sekce: { s: true, n: false } };

  test("hodnota i sekce se dosadí; vypnutá sekce zmizí i se svými řádky", () => {
    const sablona = "x={{A}}\n{{#s}}\nzapnuto\n{{/s}}\n{{#n}}\nvypnuto\n{{/n}}\nkonec\n";
    expect(vykresli(sablona, instance)).toBe("x=a\nzapnuto\nkonec\n");
  });

  test("vložená značka sekce bere jen svůj obsah (čárka v JSON)", () => {
    expect(vykresli('{\n  "a": 1{{#n}},\n  "b": 2{{/n}}\n}\n', instance)).toBe('{\n  "a": 1\n}\n');
    expect(vykresli('{\n  "a": 1{{#s}},\n  "b": 2{{/s}}\n}\n', instance)).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
  });

  test("neznámý zástupný znak = výjimka", () => {
    expect(() => vykresli("{{NEZNAMY}}", instance)).toThrow(/nemá hodnotu/);
  });

  test("nedeklarovaná sekce = výjimka", () => {
    expect(() => vykresli("{{#jina}}x{{/jina}}", instance)).toThrow(/není v deklaraci/);
  });

  test("zbylé {{ po vykreslení = výjimka", () => {
    expect(() => vykresli("{{#s}}neuzavřená", instance)).toThrow(/zůstalo/);
  });

  test("jiná hodnota tokenu dá jiný výstup hlavní šablony (měřidlo je citlivé)", () => {
    const hlavni = nactiDeklaraci(ROOT).find((i: { id: string }) => i.id === "hlavni");
    const jina = { ...hlavni, hodnoty: { ...hlavni.hodnoty, T: "netbird-jina" } };
    expect(vykresli(read(SABLONA_COMPOSE), jina)).not.toBe(read(hlavni.compose));
  });
});

// ── Krok 2: modelová instance (varianta C) ────────────────────────────────────
// Kontrakt meshe v4 (0c, f8ae45e): C3 — druhá instance téhož stacku na témž hostiteli
// forku nekoliduje (jména kontejnerů, aliasy, pojmenované svazky, porty na hostiteli,
// klíče služeb); D2 — management modelového meshe inzeruje Signal/Relay pod veřejným
// vstupem :443; C1 — peery jen jednorázovým klíčem (žádný device flow ani PKCE).
// Pravidlo majitele „žádné fallbacky“: modelová instance nenese záložní literály.

type Tvar = {
  kontejnery: Set<string>;
  aliasy: Set<string>;
  svazky: Set<string>;
  porty: Set<string>;
  sluzby: Set<string>;
};

const PREFIX = /\$\{APP_NAME_PREFIX[^}]*\}/g;

function tvar(obsah: string): Tvar {
  const d = parseYaml(obsah) as {
    services: Record<string, Record<string, unknown>>;
    volumes?: Record<string, { name?: string } | null>;
  };
  const t: Tvar = { kontejnery: new Set(), aliasy: new Set(), svazky: new Set(), porty: new Set(), sluzby: new Set() };
  for (const [klic, s] of Object.entries(d.services)) {
    t.sluzby.add(klic);
    if (typeof s.container_name === "string") t.kontejnery.add(s.container_name.replace(PREFIX, "P"));
    const site = s.networks;
    if (site && !Array.isArray(site)) {
      for (const sit of Object.values(site as Record<string, { aliases?: string[] } | null>)) {
        for (const a of sit?.aliases ?? []) t.aliasy.add(a.replace(PREFIX, "P"));
      }
    }
    for (const p of (s.ports as string[] | undefined) ?? []) t.porty.add(String(p).split(":")[0]);
  }
  for (const v of Object.values(d.volumes ?? {})) {
    if (v?.name) t.svazky.add(v.name.replace(PREFIX, "P"));
  }
  return t;
}

const compose = vystupy(ROOT).filter((v: { cesta: string }) => v.cesta.endsWith(".yml"));
const management = vystupy(ROOT).filter((v: { cesta: string }) => v.cesta.endsWith(".template"));

describe("instance stacku NetBird na jednom hostiteli forku nekolidují (C3)", () => {
  test("deklarované jsou aspoň dvě instance (měřidlo má co porovnat)", () => {
    expect(compose.length).toBeGreaterThanOrEqual(2);
  });
  for (let i = 0; i < compose.length; i++) {
    for (let j = i + 1; j < compose.length; j++) {
      const a = compose[i];
      const b = compose[j];
      test(`${a.instance} × ${b.instance}: žádné společné jméno, alias, svazek, port ani klíč služby`, () => {
        const ta = tvar(a.obsah);
        const tb = tvar(b.obsah);
        for (const k of ["kontejnery", "aliasy", "svazky", "porty", "sluzby"] as const) {
          const spolecne = [...ta[k]].filter((x) => tb[k].has(x));
          expect(spolecne, `${a.instance} × ${b.instance}: společné ${k}: ${spolecne.join(", ")}`).toEqual([]);
        }
      });
    }
  }
});

describe("modelová instance má tvar varianty C", () => {
  const model = nactiDeklaraci(ROOT).find((i: { id: string }) => i.id === "model");
  const c = compose.find((v: { instance: string }) => v.instance === "model");
  const m = management.find((v: { instance: string }) => v.instance === "model");

  test("modelová instance je deklarovaná a vykreslená", () => {
    expect(model).toBeTruthy();
    expect(c).toBeTruthy();
    expect(m).toBeTruthy();
  });

  test("bez portu na hostiteli a bez vnitřního TLS (vstup jen přes edge forku)", () => {
    expect(tvar(c.obsah).porty.size).toBe(0);
    expect(c.obsah).not.toMatch(/internal-tls:\s*\n/);
    expect(c.obsah).not.toMatch(/^\s{2}pki-init:/m);
  });

  test("žádná stopa hlavního meshe (klíč stacku, síť mesh-dns)", () => {
    expect(c.obsah).not.toMatch(/\$\{NETBIRD_STACK_KEY_/);
    expect(c.obsah).not.toMatch(/\$\{MESH_DNS_NETWORK\b/);
  });

  test("žádné záložní literály (pravidlo majitele: nic se nedosazuje, selže nahlas)", () => {
    const zalohy = c.obsah.match(/\$\{[A-Z0-9_]+:-[^}]+\}/g) ?? [];
    expect(zalohy, `modelová instance nese záložní literály: ${zalohy.join(", ")}`).toEqual([]);
  });

  test("D2: Signal a Relay inzerované pod veřejným vstupem :443", () => {
    const j = JSON.parse(m.obsah);
    expect(j.Signal.URI).toBe("${NETBIRD_DOMAIN}:443");
    expect(j.Relay.Addresses).toEqual(["rels://${NETBIRD_DOMAIN}:443/relay"]);
  });

  test("C1: peery jen jednorázovým klíčem — bez device flow a PKCE, vlastní klient IdP", () => {
    const j = JSON.parse(m.obsah);
    expect(j.DeviceAuthorizationFlow).toBeUndefined();
    expect(j.PKCEAuthorizationFlow).toBeUndefined();
    const hlavni = JSON.parse(management.find((v: { instance: string }) => v.instance === "hlavni").obsah);
    expect(j.IdpManagerConfig.ClientConfig.ClientID).not.toBe(hlavni.IdpManagerConfig.ClientConfig.ClientID);
  });

  test("vlastní DNS doména meshe (ne MESH_TLD hlavního)", () => {
    expect(c.obsah).toMatch(/--dns-domain=\$\{NETBIRD_MODEL_DNS_DOMAIN\}/);
    expect(c.obsah).not.toMatch(/--dns-domain=\$\{MESH_TLD\}/);
  });
});

describe("modelová instance v1: jen relay přes TCP 443 (bez STUN/TURN)", () => {
  const c = compose.find((v: { instance: string }) => v.instance === "model");
  const m = management.find((v: { instance: string }) => v.instance === "model");
  const h = management.find((v: { instance: string }) => v.instance === "hlavni");

  test("management modelového meshe neinzeruje STUN ani TURN (UDP 3478 na vstupu forku není)", () => {
    const j = JSON.parse(m.obsah);
    expect(j.Stuns).toEqual([]);
    expect(j.TURNConfig.Turns).toEqual([]);
    expect(m.obsah).not.toMatch(/3478/);
  });

  test("compose modelového meshe nenese TURN přihlašovací údaje", () => {
    expect(c.obsah).not.toMatch(/TURN/);
  });

  test("kotva: hlavní mesh STUN i TURN dál inzeruje (sekce měřidlo nevypnula všem)", () => {
    const j = JSON.parse(h.obsah);
    expect(j.Stuns.length).toBeGreaterThan(0);
    expect(j.TURNConfig.Turns.length).toBeGreaterThan(0);
  });
});
