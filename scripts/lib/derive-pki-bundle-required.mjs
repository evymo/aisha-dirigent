/**
 * PKI_BUNDLE_REQUIRED — JEDEN domov odvození z manifestu příběhu.
 *
 * Otázka je jediná: nasazuje tenhle příběh `app: pki:`? Když ano, CA bundle
 * je POŽADAVEK (pki-init na něj čeká a bez něj padá `migrate` i celý core).
 * Když ne, požadavek se vypíná — jinak pki-init čeká PKI_BUNDLE_WAIT_S (600 s)
 * a skončí exit 1 (naměřeno 2026-09-04 na produkci <fork>: devatenáct minut
 * buildu do koše).
 *
 * ⛔ PROČ SAMOSTATNÝ SOUBOR A NE `grep` V COLD-STARTU (naměřeno 2026-09-12):
 * osmnáct compose souborů čte `${PKI_BUNDLE_REQUIRED:?}` — fail-loud stráž bez
 * dosazeného literálu, jak repo chce. Jenže jediný ZAPISOVATEL té hodnoty byl
 * heredoc cold-startu, a ten se spouští jen při cold-startu. Instance nasazené
 * z base fcd9156c1 (compose ještě `:-true`, heredoc klíč nepsal) ho v Coolify
 * env NEMAJÍ — a `npm run redeploy` klíč nedoručí, protože env-sync posílá jen
 * to, co v `.env.coolify` leží, a env-doktor (jediný, kdo na cestě redeploye
 * do SoT ZAPISUJE, viz aisha-redeploy.mjs `srovnejOdvozeneKlice`) ten klíč
 * neznal. Každý redeploy před dalším cold-startem by tedy spadl na interpolaci.
 *
 * Řešení podle pravidla „spouští se vlastník, nedělá se druhý": odvození žije
 * TADY, cold-start i env-doktor ho VOLAJÍ. Dva volající téže funkce nad týmž
 * manifestem nejsou dva zapisovatelé, kteří tlačí opačně — je to táž hodnota
 * na obou doručovacích cestách (cold-start heredoc, redeploy → env-doktor → sync).
 *
 * Operátorská deklarace má přednost tam, kde má smysl: s nasazenou PKI smí
 * operátor požadavek vypnout (`PKI_BUNDLE_REQUIRED=false` v .env-prod-backup —
 * env-doktor čte prodEnv první, cold-start `[ -n ]` výš). BEZ nasazené PKI
 * se `true` nedá zapnout — čekat 600 s na bundle, který nikdo nevydá, není
 * volba, je to výpadek.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInstanceIdentity, resolveManifestPath } from "./coolify-instance-scope.mjs";
import { overlayDir } from "./instance-overlay.mjs";
import { isDirectRun } from "./cli-entry.mjs";
import { aplikaceManifestu } from "./vlastnictvi-aplikaci.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Zakládá manifest aplikaci `pki`? Řádky `app:` čte JEDINÝ parser (domov vlastnictví,
 * lib/vlastnictvi-aplikaci.mjs) — týž, podle kterého ji story-init zakládá. Otázka je
 * inventářová (nese instance PKI vůbec), ne vlastnická.
 * @param {string} manifestText obsah `coolify/manifests/<story>.manifest`
 * @returns {"true"|"false"} hodnota pro `${PKI_BUNDLE_REQUIRED:?}` v compose
 */
export function pkiBundleRequiredFromManifest(manifestText) {
  return aplikaceManifestu(String(manifestText ?? "")).some((a) => a.role === "pki") ? "true" : "false";
}

/**
 * Odvození pro TUHLE instanci: manifest se hledá týmiž dveřmi jako v cold-startu
 * (`coolify-instance-scope.mjs --manifest-path`: overlay → repo), nikdy dosazením
 * cizího inventáře.
 *
 * @param {{ manifestPath?: string, explicitHint?: string }} [opts] výslovná cesta
 *   a to, JAK ji volající přijímá (`--manifest <path>` v CLI, `MANIFEST_FILE=<path>`
 *   u env-doktora) — rada v chybě musí jít provést tam, kde ji čtenář vidí.
 * @returns {"true"|"false"}
 * @throws když manifest nejde najít — chybějící inventář je odpověď „nevím",
 *   ne „false"; volající rozhodne, jestli je to pro něj fatální.
 */
export function pkiBundleRequiredForInstance({ manifestPath, explicitHint } = {}) {
  return pkiBundleRequiredFromManifest(readFileSync(najdiManifest(manifestPath, explicitHint), "utf8"));
}

/**
 * Manifest TÉTO instance — týmž pořadím jako cold-start (aisha-cold-start.sh:
 * `coolify-instance-scope.mjs --manifest-path || coolify/manifests/${STORY}.manifest`).
 *
 * Resolver hledá podle PREFIXU (jména aplikací); story-scoped nasazení má ale
 * manifest pojmenovaný podle PŘÍBĚHU (`story ≠ prefix`, viz cold-start u
 * validace .env.coolify), a tam resolver nenajde nic. Cold-start pro ten
 * případ sahá po `<story>.manifest`; kdyby tahle funkce sahala jen po
 * resolveru, odpověděla by pro story-scoped instanci prázdnem — a to je
 * přesně ta díra, kterou se sem klíč dostal: hodnota bez plniče.
 */
function najdiManifest(explicit, explicitHint) {
  if (explicit) return resolve(explicit);
  let chybaResolveru;
  try {
    return resolveManifestPath(explicitHint ? { explicitHint } : {});
  } catch (err) {
    chybaResolveru = err;
  }
  const { story } = resolveInstanceIdentity({ required: false });
  if (story) {
    const overlay = overlayDir();
    for (const kandidat of [
      overlay ? join(overlay, `manifests/${story}.manifest`) : null,
      join(REPO_ROOT, `coolify/manifests/${story}.manifest`),
    ]) {
      if (kandidat && existsSync(kandidat)) return kandidat;
    }
  }
  throw new Error(
    `${chybaResolveru.message}${story ? ` (ani coolify/manifests/${story}.manifest podle AISHA_STORY neexistuje)` : ""}`,
  );
}

// isDirectRun (cli-entry.mjs): přes symlink se CLI dřív tiše přeskočilo (naměřeno 2026-09-27).
if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--manifest");
  const manifestPath = i > -1 ? argv[i + 1] : undefined;
  try {
    process.stdout.write(pkiBundleRequiredForInstance({ manifestPath }) + "\n");
  } catch (err) {
    process.stderr.write(`derive-pki-bundle-required: ${err.message}\n`);
    process.exit(3);
  }
}
