#!/usr/bin/env node
/**
 * vlastnictvi-aplikaci.mjs — JEDEN DOMOV ODPOVĚDI „které aplikace manifestu toto prostředí VLASTNÍ“
 *
 * PROČ VZNIKL (změřeno čtením 2026-10-04)
 * ----------------------------------------------------------------------------
 * Manifest instance je INVENTÁŘ: jeden na instanci (`<overlay>/manifests/<instance>.manifest`),
 * sdílený všemi jejími prostředími. Prostředí ale nemusí vlastnit všechno, co inventář
 * jmenuje: staging může konzumovat sdílený Keycloak jiné instance, zatímco produkce téže
 * instance Keycloak vlastní. Studený start přitom o vlastnictví Keycloaku rozhodoval
 * `grep '^app: *keycloak:'` nad tím jediným manifestem — prostředí s cizím Keycloakem by
 * ho „vlastnilo“: založilo by si aplikaci na doméně cizí instance a importovalo realm do
 * cizího Keycloaku. Řádky `app:` přitom četlo přes dvacet míst, každé vlastní kopií.
 *
 * PRAVIDLO
 * --------
 * Co je v prostředí NAŠE, říká efektivní topologie profilu prostředí: služba, které profil
 * dává `service_overrides.<id>.external_domain`, běží jinde a je dosažitelná na té adrese.
 * V tomhle prostředí se NEZAKLÁDÁ, NENASAZUJE, NESROVNÁVÁ, NEMAŽE a nikdy se do ní
 * neimportuje realm. Odpověď dává jen tenhle modul; řádky `app:` manifestu pro rozhodnutí
 * o nasazení čte JEN on (brána `vlastnictvi-z-topologie`).
 *   · Profil se čte TÝMIŽ dveřmi jako topologie (`loadProfileRaw` z derive-domains: overlay
 *     instance, pak šablona) — prostředí tedy může externí adresu deklarovat samo
 *     (`external_domain: "${…}"` v profilu, hodnota v souboru domén prostředí) a profil se
 *     mezi prostředími nekopíruje.
 *   · `${VAR}` v `external_domain` dosazuje TENHLE modul, ne `substitute()` derive-domains:
 *     ten z nenastavené proměnné dělá "", a "" by se přečetlo jako „vlastní“ — samostatně
 *     spuštěný nástroj, který soubor domén prostředí nevidí, by staging s cizím Keycloakem
 *     četl jako vlastník (revize integrátora 2026-10-04, bod 2). Proto: hodnota z prostředí
 *     procesu (i prázdná = deklarovaná), jinak poslední přiřazení v souborech prostředí
 *     (`--env-soubor`, čteno jako data), jinak výchozí hodnota `${VAR:-…}`, jinak „nevím“.
 *     Prostředí, které službu VLASTNÍ, to říká výslovně prázdnou hodnotou (`VAR=`).
 *   · „Nevím“ není „vlastním“: nedeklarovaný profil (AISHA_PROFILE), profil, který nejde
 *     najít, nedeklarovaná proměnná v `external_domain`, chybějící nebo nečitelný manifest
 *     = výjimka, nikdy prázdná odpověď.
 *   · Role = první pole řádku `app:` = klíč katalogu služeb (`config/services.json`).
 *
 * „Externí“ ≠ „držená“: držená aplikace (overlay `nasazeni-drzene.json`) je NAŠE a zmrazená;
 * externí v tomhle prostředí naše není a v našem projektu Coolify ani nemusí existovat.
 * Domov mutace (`coolify-mutace.mjs`) proto vrací dva různé kódy a hlášky.
 *
 * CLI
 * ---
 *   node scripts/lib/vlastnictvi-aplikaci.mjs --manifest <cesta> [--profil <id>] [--env-soubor <soubor>] [--tvar tsv|json]
 *     --profil      id profilu prostředí; bez něj AISHA_PROFILE z prostředí procesu, pak ze
 *                   souboru prostředí instance (--env-soubor, čtený jako data, ne `source`);
 *                   žádný = kód 2
 *     tsv       řádky „vlastni<TAB>role<TAB>slot<TAB>compose<TAB>volby“ a „externi<TAB>role<TAB>doména<TAB>hláška“,
 *               poslední řádek patička „__VLASTNICTVI_END__<TAB>počet řádků<TAB>popis“ (důkaz úplnosti)
 *     json      { profil, vlastni: [...], externi: [...] }
 *                 a zdroj proměnných `${VAR}` v external_domain (poslední přiřazení, i prázdné)
 *   Kódy: 0 = odpověď · 2 = chybné zadání nebo „nevím“ (důvod na stderr)
 *
 * Shell: `scripts/lib/vlastnictvi.sh` je obal TOHOTO CLI — žádná druhá logika.
 */
import { existsSync, readFileSync } from "node:fs";
import { isDirectRun } from "./cli-entry.mjs";
import { loadProfileRaw } from "./derive-domains.mjs";
import { isUnexpandedTemplate, readConfigKey, stripInlineComment } from "./config-env-files.mjs";
import { odUvozovkuj } from "./env-hodnota.mjs";

export const PATICKA_TSV = "__VLASTNICTVI_END__";
/** Kód domova mutace pro externí aplikaci (držená = KOD_DRZENO 100 v nasazeni-drzene.mjs). */
export const KOD_EXTERNI = 101;

const ROLE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * JEDINÝ čtenář řádků `app:` manifestu pro rozhodnutí o nasazení.
 * Tvar řádku: `app: <role>:<slot>:<compose>[:<volby>]` (volby např. `bluegreen=on`).
 * Komentář `#` se odřízne; řádek `app:` jiného tvaru je chyba (výjimka), ne „není tam“.
 * @param {string} text
 * @returns {Array<{ role: string, slot: string, compose: string, volby: string, radek: number }>}
 */
export function aplikaceManifestu(text) {
  if (typeof text !== "string") throw new Error("vlastnictví: manifest není text");
  const out = [];
  const chyby = [];
  text.split("\n").forEach((surovy, i) => {
    const radek = surovy.replace(/#.*$/, "").trim();
    if (!/^app:/.test(radek)) return;
    const pole = radek.slice("app:".length).trim().split(":");
    const [role, slot, compose, ...volby] = pole.map((p) => p.trim());
    if (!role || !ROLE.test(role) || !slot || !compose) {
      chyby.push(`ř. ${i + 1}: „${radek}“ nemá tvar app: <role>:<slot>:<compose>[:<volby>]`);
      return;
    }
    out.push({ role, slot, compose, volby: volby.join(":"), radek: i + 1 });
  });
  if (chyby.length) throw new Error(`vlastnictví: manifest má vadné řádky app: — ${chyby.join("; ")}`);
  return out;
}

/**
 * Externí služby profilu: role → adresa (`service_overrides.<id>.external_domain`, neprázdná po trim).
 * @param {{ service_overrides?: Record<string, { external_domain?: unknown }> }} profil
 * @returns {Map<string, string>}
 */
export function externiZProfilu(profil) {
  if (!profil || typeof profil !== "object") throw new Error("vlastnictví: profil není objekt");
  const out = new Map();
  for (const [id, o] of Object.entries(profil.service_overrides ?? {})) {
    const d = o && typeof o === "object" ? o.external_domain : undefined;
    if (typeof d === "string" && d.trim()) out.set(id, d.trim());
  }
  return out;
}

/** „EXTERNÍ: keycloak — auth.… — v tomhle prostředí není naše (profil …), nevlastním“ */
export function hlaskaExterni({ role, domena }, profil = "") {
  return `EXTERNÍ: ${role} — ${domena} — v tomhle prostředí služba není naše (profil${profil ? ` ${profil}` : ""}: external_domain), nevlastním`;
}

/**
 * Rozdělení aplikací manifestu na vlastní a externí.
 * @returns {{ vlastni: ReturnType<typeof aplikaceManifestu>, externi: Array<{ role: string, domena: string, hlaska: string }> }}
 */
export function rozdelVlastnictvi(aplikace, externi, profilId = "") {
  const vlastni = [];
  const cizi = [];
  for (const a of aplikace) {
    if (externi.has(a.role)) {
      const domena = externi.get(a.role);
      cizi.push({ role: a.role, domena, hlaska: hlaskaExterni({ role: a.role, domena }, profilId) });
    } else {
      vlastni.push(a);
    }
  }
  return { vlastni, externi: cizi };
}

/**
 * Id profilu prostředí: zadané, jinak AISHA_PROFILE z prostředí procesu, jinak ze souborů
 * prostředí instance (deklarovaný zdroj — samostatně spuštěný nástroj ho nemá exportovaný).
 * Žádné = výjimka (bez profilu nevím, co je naše).
 */
export function profilProstredi(zadany, { envSoubory = [] } = {}) {
  const id = String(zadany || process.env.AISHA_PROFILE || (envSoubory.length ? readConfigKey("AISHA_PROFILE", { files: envSoubory }) : "") || "").trim();
  if (!id) throw new Error("vlastnictví: profil prostředí není deklarovaný (AISHA_PROFILE / --profil) — bez něj nevím, co je v tomhle prostředí naše");
  return id;
}

/**
 * Profil `legacy` je výslovný režim studeného startu BEZ odvozené topologie (resolver se
 * obchází, soubor profilu neexistuje). Mechanismus `external_domain` v něm není, takže
 * vlastní je celý manifest — deklarovaný stav, ne dosazená odpověď (popis to říká nahlas).
 */
export const PROFIL_BEZ_TOPOLOGIE = "legacy";

/**
 * Poslední PŘIŘAZENÍ klíče v souborech prostředí (čteno jako data, ne `source`) — i prázdné:
 * `VAR=` je deklarace („vlastní“), chybějící řádek není nic. Tím se liší od readConfigKey
 * i parseEnvFile, které prázdnou hodnotu za neprázdnou nepustí (hledají hodnotu, ne
 * deklaraci). Hodnota se dekóduje jako `source` (sdílený odUvozovkuj — brána
 * env-soubor-cte-jako-bash); nerozvinutá šablona `${…}` nic nedeklaruje (jako parseEnvFile).
 * @returns {{ nalezeno: boolean, hodnota: string, soubor?: string }}
 */
export function prirazeniVSouborech(klic, soubory = []) {
  let out = { nalezeno: false, hodnota: "" };
  const prefix = `${klic}=`;
  for (const soubor of soubory) {
    if (!existsSync(soubor)) continue;
    for (const surovy of readFileSync(soubor, "utf8").split(/\r?\n/)) {
      const radek = surovy.trimStart().replace(/^export\s+/, "");
      if (radek.startsWith("#") || !radek.startsWith(prefix)) continue;
      const hodnota = odUvozovkuj(stripInlineComment(radek.slice(prefix.length)).trim());
      if (isUnexpandedTemplate(hodnota)) continue;
      out = { nalezeno: true, hodnota, soubor };
    }
  }
  return out;
}

const ODKAZ_NA_PROMENNOU = /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * `external_domain` ze SUROVÉHO profilu po dosazení `${VAR}` / `${VAR:-výchozí}`.
 * Nenastavená proměnná bez výchozí hodnoty = výjimka „nevím“ (ne "", které by znamenalo
 * „vlastní“). Pořadí zdrojů: prostředí procesu (i prázdná hodnota je deklarace) → poslední
 * přiřazení v souborech prostředí → výchozí hodnota → výjimka.
 * @param {unknown} surova
 * @param {{ sluzba: string, env?: Record<string, string|undefined>, envSoubory?: string[] }} o
 */
export function dosadExterniDomenu(surova, { sluzba, env = process.env, envSoubory = [] } = {}) {
  if (typeof surova !== "string") return surova;
  const chybi = [];
  const hodnota = surova.replace(ODKAZ_NA_PROMENNOU, (_, jmeno, vychozi) => {
    if (env[jmeno] !== undefined) return env[jmeno];
    const zeSouboru = prirazeniVSouborech(jmeno, envSoubory);
    if (zeSouboru.nalezeno) return zeSouboru.hodnota;
    if (vychozi !== undefined) return vychozi;
    chybi.push(jmeno);
    return "";
  });
  if (chybi.length) {
    const kde = envSoubory.length ? `prostředí procesu ani ${envSoubory.join(", ")}` : "prostředí procesu";
    throw new Error(
      `vlastnictví: external_domain služby ${sluzba} odkazuje na ${chybi.map((j) => `\${${j}}`).join(", ")}, ` +
        `ale ${kde} ji NEDEKLARUJE — nevím, jestli je služba v tomhle prostředí naše. ` +
        `Deklaruj ji v souboru domén prostředí: adresa = externí, prázdná hodnota (${chybi[0]}=) = vlastní.`,
    );
  }
  return hodnota;
}

/** Externí služby profilu prostředí (dveřmi derive-domains, `${VAR}` dosazuje dosadExterniDomenu). */
export function externiProstredi(profilId, { envSoubory = [] } = {}) {
  const id = profilProstredi(profilId, { envSoubory });
  if (id === PROFIL_BEZ_TOPOLOGIE) return new Map();
  const surovy = loadProfileRaw(id);
  if (!surovy || typeof surovy !== "object") throw new Error(`vlastnictví: profil ${id} není objekt`);
  const dosazene = {};
  for (const [sluzba, o] of Object.entries(surovy.service_overrides ?? {})) {
    const d = o && typeof o === "object" ? o.external_domain : undefined;
    dosazene[sluzba] = { external_domain: dosadExterniDomenu(d, { sluzba, envSoubory }) };
  }
  return externiZProfilu({ service_overrides: dosazene });
}

/**
 * Vlastnictví aplikací manifestu v prostředí.
 * @param {{ manifest: string, profil?: string, envSoubory?: string[] }} z  manifest = cesta k souboru
 */
export function vlastnictviProstredi({ manifest, profil, envSoubory = [] } = {}) {
  const cesta = String(manifest ?? "").trim();
  if (!cesta) throw new Error("vlastnictví: chybí cesta k manifestu");
  if (!existsSync(cesta)) throw new Error(`vlastnictví: manifest ${cesta} neexistuje — bez inventáře nevím, co je naše`);
  const id = profilProstredi(profil, { envSoubory });
  const aplikace = aplikaceManifestu(readFileSync(cesta, "utf8"));
  return { profil: id, ...rozdelVlastnictvi(aplikace, externiProstredi(id, { envSoubory }), id) };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const ZNAME = new Set(["manifest", "profil", "tvar", "env-soubor"]);

function argumenty(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) return { chyba: `nečekaný argument „${argv[i]}“` };
    const klic = argv[i].slice(2);
    if (!ZNAME.has(klic)) return { chyba: `neznámý přepínač --${klic}` };
    if (i + 1 >= argv.length) return { chyba: `--${klic} bez hodnoty` };
    a[klic] = argv[++i];
  }
  return { a };
}

export function tsv(v) {
  const radky = [
    ...v.vlastni.map((x) => ["vlastni", x.role, x.slot, x.compose, x.volby].join("\t")),
    ...v.externi.map((x) => ["externi", x.role, x.domena, x.hlaska].join("\t")),
  ];
  const popis = v.profil === PROFIL_BEZ_TOPOLOGIE
    ? `profil ${v.profil} — topologie se neodvozuje, external_domain neexistuje: vlastní celý manifest (${v.vlastni.length})`
    : `profil ${v.profil}: vlastní ${v.vlastni.length}, externí ${v.externi.length}${v.externi.length ? ` (${v.externi.map((x) => x.role).join(", ")})` : ""}`;
  return [...radky, [PATICKA_TSV, radky.length, popis].join("\t")].join("\n");
}

function hlavni(argv) {
  const { a, chyba } = argumenty(argv);
  const nevim = (zprava) => {
    console.error(`::error title=vlastnictví aplikací::${zprava}`);
    return 2;
  };
  if (chyba) return nevim(chyba);
  const tvar = a.tvar ?? "tsv";
  if (tvar !== "tsv" && tvar !== "json") return nevim(`--tvar chce tsv|json, dostal „${tvar}“`);
  let v;
  try {
    v = vlastnictviProstredi({ manifest: a.manifest, profil: a.profil, envSoubory: a["env-soubor"] ? [a["env-soubor"]] : [] });
  } catch (e) {
    return nevim(e.message);
  }
  process.stdout.write(`${tvar === "json" ? JSON.stringify(v) : tsv(v)}\n`);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  const kod = hlavni(process.argv.slice(2));
  process.stdout.write("", () => process.exit(kod));
}
