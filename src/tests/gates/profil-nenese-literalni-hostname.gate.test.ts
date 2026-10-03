/**
 * Brána: profilová šablona nenese literální hostname
 *
 * ⛔ NAMĚŘENO 2026-09-03 na produkci forku. `config/profiles/<fork>.json`
 * měl v `_notes` napsané „a Phase-0 profile ships zero literal hostnames" a
 * o devět řádků níž:
 *
 *     "keycloak": { "placement": "frontend", "external_domain": "auth.aisha.guru" }
 *
 * Profil je ŠABLONA, kterou sdílejí VŠECHNA prostředí instance. Literální hostname
 * v něm tedy nasměruje produkci i staging na totéž — a produkce forku dostala
 * doménu stagingu. Táž třída jako `REGISTRY_PROXY=` v .env.local (obcházka Varry,
 * která vyřadila registry cache i produkci) nebo popis profilu tvrdící „Single
 * shared Talos node", což poslalo produkci na cizí stroj.
 *
 * PRAVIDLO: co se liší mezi prostředími, nepatří do souboru, který prostředí
 * sdílejí. Hostname deklaruje PROSTŘEDÍ (config/domains-<env>.env,
 * COOLIFY_<ENV>_SERVER_NAME_<SLOT>) nebo profil v PRIVÁTNÍM overlayi instance.
 *
 * Měří se HODNOTY, ne próza: `_notes` a `description` smějí incident popsat —
 * brána, která zakáže i popis vlastní příčiny, si vynutí mlčení tam, kde je
 * vysvětlení nejcennější.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PROFILES = join(ROOT, "config/profiles");

/**
 * Vypadá to jako hostname? `<label>.<label>…<tld>` s aspoň jednou tečkou.
 *
 * Cesty a jména souborů se NEPOČÍTAJÍ: `$schema = ../profiles.schema.json` má taky
 * tečky a třípísmennou koncovku, ale je to odkaz na soubor. Bez téhle výjimky brána
 * hlásila všechny čtyři profily včetně upstreamových šablon — a brána, která
 * červená vždycky, je stejně neužitečná jako ta, co neumí zčervenat vůbec.
 */
const KONCOVKY_SOUBORU = new Set([
  "json", "yml", "yaml", "sql", "env", "mjs", "cjs", "js", "ts", "tsx",
  "sh", "md", "txt", "example", "schema", "lock", "toml", "conf",
]);
const HOSTNAME_TVAR = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/i;

/**
 * Zóny, které se ve veřejném DNS NIKDY nerozřeší — nemohou tedy pojmenovat stroj
 * ani doménu žádného prostředí: `local` (RFC 6762, mDNS), `internal` (ICANN 2024,
 * rezervováno pro privátní použití), `localhost`/`invalid`/`test`/`example`
 * (RFC 2606/6761). Hodnota `mesh.local.internal` v `local-dev.json` (upstream
 * 7e8631547) je TVAR zóny lokálního zrcadla — má touž vlastnost jako produkční
 * mesh zóna (mimo mesh se nerozřeší), ale identitu žádné instance ani prostředí
 * nenese. Incident, kvůli němuž brána vznikla (`auth.aisha.guru`, 2026-09-03),
 * má TLD veřejné — ten tahle výjimka nepouští.
 */
const REZERVOVANE_TLD = new Set(["local", "internal", "localhost", "invalid", "test", "example"]);

function jeHostname(v: string): boolean {
  const s = v.trim();
  if (s.includes("/") || s.includes(" ")) return false; // cesta nebo věta
  if (!HOSTNAME_TVAR.test(s)) return false;
  const tld = s.split(".").pop()!.toLowerCase();
  if (REZERVOVANE_TLD.has(tld)) return false; // zóna, ne adresa
  return !KONCOVKY_SOUBORU.has(tld);
}

/** Klíče, které jsou PRÓZA — smějí incident pojmenovat včetně hostnamu. */
const PROZA = (key: string) => key.startsWith("_") || key === "description";

/** Vrátí [cesta, hodnota] pro každý řetězec, který NENÍ próza. */
function hodnoty(node: unknown, cesta: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[cesta.join("."), node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => hodnoty(v, [...cesta, String(i)]));
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>)
      .filter(([k]) => !PROZA(k))
      .flatMap(([k, v]) => hodnoty(v, [...cesta, k]));
  }
  return [];
}

const profily = existsSync(PROFILES)
  ? readdirSync(PROFILES).filter((f) => f.endsWith(".json") && !f.endsWith(".example"))
  : [];

describe("profilová šablona nenese literální hostname", () => {
  test("v config/profiles/ jsou vůbec nějaké profily (jinak brána nic neměří)", () => {
    expect(profily.length, `config/profiles/ neobsahuje žádný .json — brána by tiše prošla`).toBeGreaterThan(0);
  });

  test.each(profily)("%s deklaruje roli, ne konkrétní stroj ani doménu", (soubor) => {
    const profil = JSON.parse(readFileSync(join(PROFILES, soubor), "utf8"));
    const nalezy = hodnoty(profil)
      .filter(([, v]) => jeHostname(v))
      .map(([cesta, v]) => `  ${cesta} = ${v}`);

    expect(
      nalezy,
      `${soubor} nese literální hostname v HODNOTĚ:\n${nalezy.join("\n")}\n\n` +
        `Profil sdílejí VŠECHNA prostředí instance, takže tahle hodnota nasměruje\n` +
        `produkci i staging na totéž. Naměřeno 2026-09-03: external_domain=auth.aisha.guru\n` +
        `v tomhle souboru dalo produkci forku doménu stagingu.\n` +
        `Deklaruj to v config/domains-<prostředí>.env, v COOLIFY_<ENV>_SERVER_NAME_<SLOT>,\n` +
        `nebo v profilu privátního overlaye instance. Próza (_notes, description) smí\n` +
        `hostname zmínit — ta se neměří.`,
    ).toEqual([]);
  });

  test("umí zčervenat: podstrčený hostname v hodnotě brána najde", () => {
    const podstrceny = {
      id: "test",
      description: "auth.example.com v próze projít SMÍ",
      _notes: "stejně tak auth.example.com tady",
      service_overrides: { keycloak: { placement: "frontend", external_domain: "auth.example.com" } },
      domain: { mesh_tld: "mesh.local.internal", public_tld: "svc.example.test" },
    };
    const nalezy = hodnoty(podstrceny).filter(([, v]) => jeHostname(v));
    expect(
      nalezy.map(([c]) => c),
      "brána musí najít hostname v hodnotě a přitom nechat prózu na pokoji",
    ).toEqual(["service_overrides.keycloak.external_domain"]);
  });

  test("umí zčervenat i na rezervovanou zónu s VEŘEJNÝM TLD: výjimka platí jen pro rezervované TLD", () => {
    // `mesh.internal.example.org` končí veřejným TLD — rezervované slovo uvnitř nic nezachrání.
    expect(jeHostname("mesh.internal.example.org")).toBe(true);
    expect(jeHostname("auth.aisha.guru")).toBe(true);
    expect(jeHostname("mesh.local.internal")).toBe(false);
  });
});
