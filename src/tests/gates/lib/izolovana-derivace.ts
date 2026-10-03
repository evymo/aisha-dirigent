/**
 * Derivace topologie spuštěná V PROCESU brány, ale bez prostředí běžce.
 *
 * ⛔ NAMĚŘENO 2026-09-13. Brána `povrch-se-stavi-z-instancniho-overlaye` volala
 * `buildTopology()` přímo a ze vstupů resolveru si ošetřila jen DVA
 * (AISHA_INSTANCE, APP_NAME_PREFIX). Běžec, který měl v prostředí
 * `AISHA_INSTANCE_CONFIG_DIR` (checkout instančních dat), dostal profil
 * z overlaye — ten deklaruje povrchy — a derivace fail-closed spadla na
 * `surfaces/zkouska/app.config.json`, který v overlayi pochopitelně není.
 * Tatáž brána nad týmž kódem: zelená na čistém stroji, červená u operátora.
 * Verdikt tedy popisoval prostředí, ne kód.
 *
 * Z devatenácti různých vstupů (RESOLVER_ENV_INPUTS na HEAD 5d00abe11) jich
 * brána nekontrolovala sedmnáct — mezi nimi AISHA_OVERLAY_REQUIRED (bez
 * overlaye → výjimka), AISHA_PROFILE, všechny TLD a provisioning příznaky
 * z katalogu (EXTRANET_ENABLED, …). Ošetřit jen ten jeden, který zrovna
 * spadl, by nechalo šestnáct dalších čekat na svého běžce.
 *
 * Proto se tu NEŘEŠÍ jednotlivá jména: odebere se CELÝ seznam, který
 * resolver sám vydává a který brána `resolver-env-inputs-complete` drží
 * v souladu s tím, co kód opravdu čte. Nový vstup resolveru se sem dostane
 * sám. Subprocess (vzor `traefik-host-coverage`) tu není potřeba: měří se
 * v procesu a prostředí se po měření VRACÍ — i když měření vyhodí.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../../scripts/lib/derive-domains.mjs";
import { OVERLAY_ENV } from "../../../../scripts/lib/instance-overlay.mjs";

/** Kořen repa — `src/tests/gates/lib` → 4 úrovně výš. */
const ROOT = join(__dirname, "../../../..");

/**
 * Pustí `fn` s prostředím, ve kterém je KAŽDÝ vstup resolveru odebraný a
 * nastavené jsou jen hodnoty z `nastav`. Po návratu (i po výjimce) vrátí
 * prostředí přesně do stavu před voláním — včetně proměnných, které předtím
 * neexistovaly.
 */
export function sIzolovanymVstupem<T>(nastav: Record<string, string>, fn: () => T): T {
  const klice = new Set<string>([...RESOLVER_ENV_INPUTS, ...Object.keys(nastav)]);
  const ulozeno = new Map<string, string | undefined>();
  for (const k of klice) {
    ulozeno.set(k, process.env[k]);
    delete process.env[k];
  }
  try {
    for (const [k, v] of Object.entries(nastav)) process.env[k] = v;
    return fn();
  } finally {
    for (const [k, v] of ulozeno) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Jméno proměnné overlaye — přes rozcestník, ne literálem (brána overlay-jde-jen-jednemi-dvermi). */
export const PROMENNA_OVERLAYE = OVERLAY_ENV;

/**
 * TLD DEKLAROVANÉ jako u instance (ne z referenčního `.json.example`).
 * Derivace s overlayem povrchu porovnává overlay jen s topologií instance;
 * referenční TLD přizná jako NEZMĚŘENO. Kdo chce kontrolu shody měřit, musí
 * TLD deklarovat — jinak by měřil referenční větev, ne porovnání.
 */
export const DEKLAROVANE_TLD: Record<string, string> = {
  PUBLIC_TLD: "povrch.example",
  INTERNAL_TLD: "vnitrni.povrch.example",
  MESH_TLD: "mesh.povrch.example",
};

export interface Povrch {
  name: string;
  shell: string;
  subdomain: string;
}

/**
 * Dočasný instanční overlay: profil `<profil>` = platformní šablona
 * z `config/profiles/` + deklarované povrchy, a volitelně
 * `surfaces/<identita>/app.config.json`.
 *
 * Profil se BERE ZE ŠABLONY, nepíše se znovu: kdyby se šablona změnila,
 * fixture ji následuje a měří pořád tvar, který platforma skutečně vydává.
 */
export function docasnyOverlay(o: {
  profil: string;
  povrchy: Povrch[];
  identita?: string;
  appConfig?: unknown;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "aisha-overlay-povrchu-"));
  const sablona = JSON.parse(readFileSync(join(ROOT, `config/profiles/${o.profil}.json`), "utf8"));
  mkdirSync(join(dir, "profiles"), { recursive: true });
  writeFileSync(
    join(dir, "profiles", `${o.profil}.json`),
    JSON.stringify({ ...sablona, surfaces: o.povrchy }, null, 2),
  );
  if (o.identita && o.appConfig !== undefined) {
    mkdirSync(join(dir, "surfaces", o.identita), { recursive: true });
    writeFileSync(join(dir, "surfaces", o.identita, "app.config.json"), JSON.stringify(o.appConfig, null, 2));
  }
  return dir;
}

/**
 * app.config.json, který SOUHLASÍ s derivací — hodnoty se skládají z vydaných
 * domén a z prefixu PostgREST přečteného ze zdroje gateway, ne z literálů.
 */
export function souhlasnyAppConfig(o: {
  apiDomena: string;
  keycloakDomena: string;
  restPrefix: string;
  realm: string;
  klient: string;
}): Record<string, unknown> {
  return {
    instance_slug: "zkouska",
    api: { postgrest_url: `https://${o.apiDomena}${o.restPrefix}`, token_exchange_url: "" },
    auth: { issuer: `https://${o.keycloakDomena}/realms/${o.realm}`, client_id: o.klient },
    i18n: { default_locale: "cs", locales: ["cs"] },
    snapshot_public_jwk: null,
    preview: { enabled: false },
  };
}

/** Hodnota klíče z výstupu `formatShellExports` (bez okrajových uvozovek), nebo `undefined`. */
export function hodnotaZVystupu(vystup: string, klic: string): string | undefined {
  const radek = vystup.split("\n").find((l) => l.startsWith(`${klic}=`));
  return radek === undefined ? undefined : radek.slice(klic.length + 1).replace(/^'([\s\S]*)'$/, "$1");
}
