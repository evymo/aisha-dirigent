/**
 * derive-bundle-consumers.mjs — kdo po rotaci kořene CA potřebuje přenasadit
 *
 * ⛔ NAMĚŘENO 2026-08-22. `infra/pki/pki-renewer.sh` držel tenhle seznam RUČNĚ:
 *
 *     BUNDLE_CONSUMER_ROLES="${BUNDLE_CONSUMER_ROLES:-core integration local-ingest potok ledger netbird}"
 *
 * Proměnná se přitom nikde nenastavovala — ani v compose, ani v .env.coolify —
 * takže ten výchozí seznam BYL tou hodnotou ve 100 % běhů. Odvození z katalogu
 * dává 21 konzumentů; ruční seznam jich měl 6, z toho jeden (`netbird`) tam
 * podle komentáře o dva řádky výš vůbec nepatří (používá env certifikát, ne
 * svazkový bundle). Špatně tedy v OBOU směrech.
 *
 * Následek: při rotaci kořene se přenasadilo 6 z 21 stacků. Zbylým 15 zůstaly
 * v `pki-certs` kořeny zmrazené 2026-04-13 a jejich netbird-agent přestal
 * důvěřovat čemukoli. Přes `pki` (TVRDÁ brána) to zastavilo 27 aplikací včetně
 * databáze — a majitel to uviděl jako „interní chyba serveru" při přihlášení.
 *
 * DEFINICE (převzatá z komentáře nad tím seznamem, ne vymyšlená):
 * konzument svazkového bundlu = stack, jehož `netbird-agent` míří důvěru
 * (`SSL_CERT_FILE` / `NB_SSL_TRUST_BUNDLE`) do svazku, který zapisuje jeho
 * VLASTNÍ jednorázový `pki-init`. Stacky s certifikátem z env (netbird) sem
 * nepatří — ty obslouží renewer doručením hodnoty.
 *
 * ⭐ Univerzum se HLEDÁ v katalogu, nepíše se globem. První verze tohohle
 * měření použila `docker-compose.coolify-*.yml` a minula `docker-compose.coolify.yml`
 * (bez pomlčky), tedy CORE — nejdůležitější stack ze všech.
 */
import { readFileSync, existsSync } from "node:fs";
import { isDirectRun } from "./cli-entry.mjs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Vrátí SEŘAZENÉ role, které po rotaci kořene CA musí znovu stáhnout bundle. */
export function odvodKonzumentyBundlu(root = ROOT) {
  const katalogCesta = join(root, "config/services.json");
  if (!existsSync(katalogCesta)) {
    throw new Error(`katalog služeb nenalezen: ${katalogCesta} — bez něj nelze univerzum HLEDAT`);
  }
  const katalog = JSON.parse(readFileSync(katalogCesta, "utf-8"));
  const sluzby = katalog.services ?? katalog;

  const konzumenti = new Set();
  for (const [role, def] of Object.entries(sluzby)) {
    const composeRel = def?.compose;
    if (!composeRel) continue;
    const composeAbs = join(root, composeRel);
    if (!existsSync(composeAbs)) continue;

    let doc;
    try {
      doc = yaml.load(readFileSync(composeAbs, "utf-8"));
    } catch (e) {
      // Nečitelný SLEDOVANÝ compose není "nula konzumentů", je to díra v pokrytí.
      throw new Error(`${composeRel} nelze načíst (${e.message}) — odvození by tiše vynechalo celý stack`);
    }
    const sluzbyC = doc?.services ?? {};
    const agent = sluzbyC["netbird-agent"];
    if (!agent) continue;

    const env = normalizujEnv(agent.environment);
    const duvera = String(env.SSL_CERT_FILE ?? env.NB_SSL_TRUST_BUNDLE ?? "");
    if (!duvera) continue;

    const svazkyAgenta = svazkyProCestu(agent.volumes, duvera);
    const svazkyInitu = new Set(
      (sluzbyC["pki-init"]?.volumes ?? []).filter((v) => typeof v === "string").map((v) => v.split(":")[0]),
    );
    if ([...svazkyAgenta].some((s) => svazkyInitu.has(s))) konzumenti.add(role);
  }
  return [...konzumenti].sort();
}

function normalizujEnv(env) {
  if (!env) return {};
  if (!Array.isArray(env)) return env;
  return Object.fromEntries(env.filter((x) => typeof x === "string" && x.includes("=")).map((x) => {
    const i = x.indexOf("=");
    return [x.slice(0, i), x.slice(i + 1)];
  }));
}

/** Svazky agenta, jejichž přípojný bod je předponou cesty k trust bundlu. */
function svazkyProCestu(volumes, cesta) {
  const out = new Set();
  for (const v of volumes ?? []) {
    if (typeof v !== "string") continue;
    const [zdroj, cil] = v.split(":");
    if (cil && cesta.startsWith(cil)) out.add(zdroj);
  }
  return out;
}

// CLI: vypíše role oddělené mezerou (tvar, který pki-renewer.sh čte).
// isDirectRun (cli-entry.mjs) porovnává SOUBOR (dev+ino), ne zápis cesty: dřívější
// resolve(argv[1]) === fileURLToPath(…) se přes symlink (macOS /var → /private/var)
// tiše přeskočil a cold-start vygeneroval prázdný env soubor (naměřeno 2026-09-27).
if (isDirectRun(import.meta.url)) {
  const role = odvodKonzumentyBundlu();
  if (role.length === 0) {
    console.error("derive-bundle-consumers: odvozeno NULA konzumentů — to by po rotaci CA nepřenasadilo nic");
    process.exit(1);
  }
  process.stdout.write(role.join(" ") + "\n");
}
