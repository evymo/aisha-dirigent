#!/usr/bin/env node
/**
 * knock-provision.mjs — DOVODÍ parametry dveří a zapíše je do `.env.coolify`.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-08-19)
 * Klepání chybělo na OBOU stranách naráz a ani jedna to neřekla srozumitelně:
 *
 *   server   `SPA_OPERATORS_B64` prázdný  → svc-knock fail-closed KŘIČÍ a drží
 *                                           celý edge v restarting (spadlo 5 kontejnerů)
 *   klient   `EXPO_PUBLIC_KNOCK_*` nikde  → appka MLČÍ a dveře vůbec nenabídne
 *
 * `mobile-app/src/config/knock.ts` má testy i hlavičku „žádné výchozí hodnoty",
 * ale nikdo mu ty hodnoty nevyráběl — artefakt bez producenta. Tenhle skript je
 * ten producent, a to pro obě strany z JEDNOHO odvození: co si umíme odvodit,
 * odvodíme; co odvodit nejde, VYGENERUJEME a nahlas oznámíme.
 *
 * CO SE ODVOZUJE A Z ČEHO (nic z toho není konstanta v kódu)
 *   SPA_KNOCK_PUBLIC_HOST   ← PUBLIC_TLD            (UDP letí PŘÍMO na server)
 *   SPA_KNOCK_PUBLIC_PORT   ← NEODVOZUJE SE: ruční deklarace operátora (.env-prod-backup);
 *                             chybí-li, provision skončí — port nevymýšlí
 *   SPA_KNOCK_MOBILE_KID    ← `ops-${APP_NAME_PREFIX}`
 *   SPA_KNOCK_MOBILE_SCOPE  ← `ops`
 *
 * ⭐ PROČ SMÍ BÝT `kid` A `scope` ODVOZENÉ, KDYŽ SE NESMÍ DOSAZOVAT
 * `mobile-app/src/config/knock.ts` je zakazuje dosazovat NA KLIENTU — tam by
 * uhodnutá hodnota vyrobila jiné klíče a server by mlčky odmítl. Tady je to
 * opačná situace: týž skript vyrábí roster I hodnotu pro build, takže shoda
 * neplyne z odhadu, ale Z KONSTRUKCE. Kdyby roster vznikl jinde a jinak, tahle
 * derivace by byla přesně ten zakázaný odhad.
 *
 * ⭐ KÓD SE VYGENERUJE A VYPÍŠE. Zakázaný je TICHÝ default — hodnota, kterou
 * nikdo nezvolil a nikdo se o ní nedozví. Vygenerovaný a nahlas oznámený kód
 * tichý default není; je to týž provisioning, jaký cold-start dělá u
 * `PLATFORM_ADMIN_PASSWORD`. Bez něj by fail-closed `svc-knock` zůstal dole
 * a držel s sebou edge. Kdo chce vlastní kód, spustí `--operator`.
 *
 * Použití:
 *   node scripts/knock-provision.mjs                 # odvodit + založit roster (kód VYGENERUJE a vypíše)
 *   node scripts/knock-provision.mjs --operator      # + vyžádat VLASTNÍ kód z terminálu
 *   node scripts/knock-provision.mjs --device <jmeno># + pověření ZAŘÍZENÍ (klepe samo)
 *   node scripts/knock-provision.mjs --print         # vypsat odvozené hodnoty (pro build)
 *
 * ⛔ BĚŽÍ JEN PRO INSTANCI, KTERÁ DVEŘE DEKLARUJE (naměřeno 2026-09-15).
 * Cold-start ho pouštěl bez podmínky, takže roster vznikl všude — a deploy-init
 * podle rosteru zapnul profil `knock`. Instance bez deklarace pak dostala dveře
 * v měřicím režimu s rosterem, tedy svc-knock, který ODMÍTNE START. O zapnutí
 * rozhoduje jediná deklarace (`EDGE_COMPOSE_PROFILES` ∋ knock, viz
 * lib/dvere-soulad.mjs); bez ní se tu nic nezakládá. V měřicím režimu
 * (`SPA_DIAGNOSE=1`) se roster nezakládá taky — svc-knock by s ním nenaběhl.
 *
 * Exit: 0 = hotovo (nebo dveře nedeklarované — není co dělat),
 *       1 = tvrdá chyba (chybí identita instance / roster nevznikl / rozpor deklarace).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dvereDeklarovane } from "./lib/dvere-deklarace.mjs";

import { overlayDir } from "./lib/instance-overlay.mjs";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = process.env.AISHA_INSTANCE_ENV || join(KOREN, ".env.coolify");

const argv = process.argv.slice(2);
const ma = (n) => argv.includes(n);
const hodnota = (n) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };

if (!existsSync(ENV)) {
  console.error(`knock-provision: ${ENV} neexistuje — bez SoT instance není z čeho odvozovat`);
  process.exit(1);
}
let text = readFileSync(ENV, "utf8");

/** Přečte klíč ze SoT. Prázdná hodnota = NENÍ (ne „je prázdný"). */
function cti(klic) {
  const m = text.match(new RegExp(`^${klic}=(.*)$`, "m"));
  const v = m ? m[1].replace(/^["']|["']$/g, "").trim() : "";
  return v || null;
}

/** Idempotentní zápis: existující řádek přepíše, jinak přidá na konec. */
function zapis(klic, val) {
  const re = new RegExp(`^${klic}=.*$`, "m");
  if (re.test(text)) {
    if (cti(klic) === val) return false;
    text = text.replace(re, `${klic}=${val}`);
  } else {
    text = text.replace(/\n*$/, "\n") + `${klic}=${val}\n`;
  }
  return true;
}

// ── Deklarace: bez ní se nic nezakládá ──────────────────────────────────────
// `cti` vrací null pro prázdné; čtenář deklarace chce „není" jako undefined.
const deklarovano = dvereDeklarovane((k) => cti(k) ?? undefined);
const vyzadanoRucne = ma("--operator") || hodnota("--device") !== null;
if (!deklarovano) {
  if (vyzadanoRucne) {
    console.error(
      "knock-provision: dveře NEJSOU deklarované (EDGE_COMPOSE_PROFILES nejmenuje „knock“) — pověření by nemělo\n" +
        "  kam patřit. Zapni je v profilu instance (edge_profiles: [\"knock\"], knock.mode: live), pak znovu.",
    );
    process.exit(1);
  }
  console.log("dveře: instance je nedeklaruje (EDGE_COMPOSE_PROFILES bez „knock“) — roster se nezakládá");
  process.exit(0);
}
const merici = cti("SPA_DIAGNOSE") === "1";
if (merici && !ma("--print")) {
  if (cti("SPA_OPERATORS_B64")) {
    console.error(
      "knock-provision: ROZPOR — SPA_DIAGNOSE=1 (měřicí režim) a v .env.coolify leží roster operátorů.\n" +
        "  svc-knock takový start odmítne a stáhne s sebou edge. Rozhodni v profilu instance:\n" +
        "  knock.mode: live (ostrý provoz), nebo roster odeber.",
    );
    process.exit(1);
  }
  if (vyzadanoRucne) {
    console.error("knock-provision: měřicí režim (SPA_DIAGNOSE=1) pověření nesmí mít — nejdřív knock.mode: live v profilu instance");
    process.exit(1);
  }
  console.log("dveře: deklarované v MĚŘICÍM režimu (SPA_DIAGNOSE=1) — roster se nezakládá, svc-knock jen měří");
  process.exit(0);
}

/**
 * `brand` deklarovaný povrchem appky v overlayi instance.
 *
 * ⛔ Čte se z OVERLAYE, ne z repozitáře stacku: identita appky je instanční data
 *    (`surfaces/<slug>/version.json`), a platforma o konkrétní appce vědět nesmí.
 *    Vrací null, když overlay není nebo povrch v něm chybí — volající pak NEHÁDÁ.
 */
function povrchBrand(slug) {
  const dir = overlayDir();
  if (!dir) return null;
  const soubor = join(dir, "surfaces", slug, "version.json");
  if (!existsSync(soubor)) return null;
  try {
    return JSON.parse(readFileSync(soubor, "utf8")).brand ?? null;
  } catch {
    return null;
  }
}

// ── Odvození ────────────────────────────────────────────────────────────────
const tld = cti("PUBLIC_TLD");
const prefix = cti("APP_NAME_PREFIX");
if (!tld || !prefix) {
  console.error(
    "knock-provision: PUBLIC_TLD nebo APP_NAME_PREFIX chybí — instance se NEHÁDÁ.\n" +
      `  PUBLIC_TLD=${tld ?? "(chybí)"}  APP_NAME_PREFIX=${prefix ?? "(chybí)"}`,
  );
  process.exit(1);
}
// ⛔ Port se NEODVOZUJE ani nedosazuje (rozhodnutí majitele 2026-09-15): na
// sdíleném serveru má každá instance jiný a forward na firewallu nastavuje člověk.
// Dosazený literál by tiše vyrobil appku, která klepe na port JINÉ instance.
const port = cti("SPA_KNOCK_PUBLIC_PORT");
if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error(
    "knock-provision: SPA_KNOCK_PUBLIC_PORT chybí nebo není port — je to RUČNÍ deklarace operátora.\n" +
      "  Zapiš ho do .env-prod-backup (cold-start ho přenese) a nastav forward na firewallu; port se nevymýšlí.",
  );
  process.exit(1);
}
// ⭐ `kid` JE IDENTITA APPKY U DVEŘÍ a odvozuje se ze `slug` jejího povrchu
//    (zadání majitele 2026-09-10: „proč ne app id také automaticky?"). `ops-${prefix}`
//    byl správně, dokud měla instance JEDNU appku; s druhou začal tiše ukazovat na
//    operátora — appka se u vrátného hlásila cizím jménem a z logu nešlo poznat,
//    KDO ťukal (naměřeno 2026-09-21 na appce řidiče).
//
// ⛔ TOTÉŽ ODVOZENÍ MÁ I BUILD (`mobile-app/scripts/instance-env-derive.sh`
//    z `brand.slug` / `brand.knock.scope`). `kid` je SŮL odvození klíče
//    (`deriveFromPassword(kód, kid)`): kdyby se ty dva rozešly, telefon vyrobí
//    jiné klíče, než server čeká, a zaťukání padne na `unknown-kid` — tedy
//    MLČENÍM, k nerozeznání od zavřených dveří. Brána
//    `mobilni-konfigurace-musi-mit-producenta` to hlídá.
//
// ⛔ `scope` se NEODVOZUJE ze slugu: neříká, KDO appka je, ale CO SMÍ — a to je
//    vlastnost instance, ne sestavení. Proto se ČTE z deklarace povrchu.
const appSlug = hodnota("--app");
let mobilniKid = `ops-${prefix}`;
let mobilniScope = "ops";
if (appSlug) {
  const deklarace = povrchBrand(appSlug);
  if (!deklarace) {
    console.error(
      `knock-provision: povrch „${appSlug}" v overlayi instance není — identita appky se NEHÁDÁ.\n` +
        "  Deklarace patří do instančních dat: surfaces/<slug>/version.json → brand.slug + brand.knock.scope",
    );
    process.exit(1);
  }
  mobilniKid = deklarace.knock?.kid || deklarace.slug || "";
  mobilniScope = deklarace.knock?.scope || "";
  if (!mobilniKid || !mobilniScope) {
    console.error(
      `knock-provision: povrch „${appSlug}" nedeklaruje ${!mobilniKid ? "brand.slug" : "brand.knock.scope"}.\n` +
        "  Bez nich by appka klepala pod cizí identitou, nebo by nabídku dveří vůbec nezobrazila.",
    );
    process.exit(1);
  }
}
const odvozene = {
  SPA_KNOCK_PUBLIC_HOST: tld,
  SPA_KNOCK_MOBILE_KID: mobilniKid,
  SPA_KNOCK_MOBILE_SCOPE: mobilniScope,
};

if (ma("--print")) {
  for (const [k, v] of Object.entries(odvozene)) console.log(`${k}=${v}`);
  console.log(`SPA_KNOCK_PUBLIC_PORT=${port}`);
  process.exit(0);
}

const zmeneno = Object.entries(odvozene).filter(([k, v]) => zapis(k, v)).map(([k]) => k);

// ── Roster: jediná hodnota, kterou odvodit NELZE ────────────────────────────
const kid = odvozene.SPA_KNOCK_MOBILE_KID;
const scope = odvozene.SPA_KNOCK_MOBILE_SCOPE;
const stavajici = cti("SPA_OPERATORS_B64");
let rosterHlaska;

function volejRoster(args) {
  // Roster se vyrábí JEDINÝM nástrojem (scripts/knock-roster.mjs) — druhá
  // implementace by odvozovala klíče po svém a telefon by pak klepal jinak,
  // než server čeká. Dědí stdio, aby si mohl vyžádat kód z terminálu.
  return execFileSync("node", [join(KOREN, "scripts/knock-roster.mjs"), ...args], {
    cwd: KOREN, encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"],
  }).trim();
}

const deviceJmeno = hodnota("--device");
if (deviceJmeno) {
  const args = ["--kid", `dev-${deviceJmeno}`, "--scope", scope, "--device"];
  if (stavajici) args.push("--merge", stavajici);
  const novy = volejRoster(args);
  zapis("SPA_OPERATORS_B64", novy);
  rosterHlaska = `pověření zařízení „dev-${deviceJmeno}" přidáno (klepe SAMO, klíče výše se už nezobrazí)`;
} else if (!stavajici && ma("--operator")) {
  // Vlastní kód: člověk si ho zvolí a zadá z terminálu.
  const novy = volejRoster(["--kid", kid, "--scope", scope]);
  zapis("SPA_OPERATORS_B64", novy);
  rosterHlaska = `roster založen pro kid „${kid}" — týž kód zadáš v appce`;
} else if (!stavajici) {
  // ⭐ VÝCHOZÍ CESTA: kód se VYGENERUJE a vypíše (dořešeno 2026-08-19).
  // Dřív tu bylo jen „chybí lidský vstup, exit 3". Jenže `svc-knock` je
  // fail-closed: bez rosteru nenastartuje a stáhne s sebou celý edge — takže
  // čekání na člověka znamenalo, že dveře i edge zůstanou dole neomezeně
  // dlouho (dnes 5 zničených kontejnerů). Cold-start má instanci ZPROVOZNIT.
  //
  // Zakázaný je TICHÝ default, ne provisioning: kód se vypíše stejně nahlas
  // jako `PLATFORM_ADMIN_PASSWORD`. Kdo chce vlastní, spustí `--operator`.
  const novy = volejRoster(["--kid", kid, "--scope", scope, "--generate"]);
  zapis("SPA_OPERATORS_B64", novy);
  rosterHlaska = `roster VYGENEROVÁN pro kid „${kid}" — kód je vypsaný výše, jinde už ho nezjistíš`;
} else {
  const pocet = Object.keys(JSON.parse(Buffer.from(stavajici, "base64").toString("utf8"))).length;
  rosterHlaska = `roster už existuje (${pocet} pověření) — nesahá se na něj`;
}

writeFileSync(ENV, text);

console.log("dveře — odvozeno z instance:");
for (const [k, v] of Object.entries(odvozene)) console.log(`  ${k}=${v}`);
console.log(`  SPA_KNOCK_PUBLIC_PORT=${port} (ruční deklarace operátora)`);
if (zmeneno.length) console.log(`  zapsáno do ${ENV.split("/").pop()}: ${zmeneno.join(", ")}`);
else console.log(`  ${ENV.split("/").pop()}: beze změny`);

console.log(`  ${rosterHlaska}`);
