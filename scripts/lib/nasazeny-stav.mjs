#!/usr/bin/env node
/**
 * nasazeny-stav.mjs — co na instanci SKUTEČNĚ běží: commit posledního ÚSPĚŠNÉHO
 * nasazení každé aplikace, jak ho vede Coolify. Jen čte, nic nenasazuje.
 *
 * ⛔ PROČ (naměřeno 2026-09-26/27 na aisha.guru): CI nasazuje podle rozdílu
 * `event.before..sha`. Tiše tím předpokládá, že PŘEDCHOZÍ nasazení uspělo. Core
 * z #1090 padl na plném disku build serveru, stacky vln 3+ se přeskočily, protože
 * padl Edge — a další push je už neviděl: rozdíl proti předchozímu commitu jejich
 * změnu nenesl. Nový web pak volal `/storage/v1/upload-complete` proti starému
 * storage-auth (404). Rozdíl proti HISTORII je odhad; rozdíl proti tomu, co
 * běží, je měření.
 *
 * Tohle je K1 návrhu „spadlé nasazení se zopakuje samo“ (rekonciliace): JEN
 * HLÁŠENÍ. Detekce nasazení se nemění; skript vypíše, co by se nasadilo NAVÍC,
 * kdyby základem byl poslední úspěch aplikace místo předchozího commitu.
 *
 * CLI:
 *   node scripts/lib/nasazeny-stav.mjs --json
 *        → { "<suffix>": { uuid, uspesny, pokus: { commit, status } } }
 *   node scripts/lib/nasazeny-stav.mjs --navic --head <sha> --deploy-apps ",a,b,"
 *        → hlášení: aplikace, které by rekonciliace nasadila navíc k deploy_apps
 * Prostředí: COOLIFY_URL (nebo COOLIFY_BASE_URL), COOLIFY_API_TOKEN,
 *            APP_NAME_PREFIX (identita instance; nic se nedosazuje).
 *
 * Kódy: 0 = změřeno · 2 = chybný vstup / chybí přístup (NEMĚŘENO)
 *       3 = část aplikací změřit nešlo (vypsány jménem). Mlčení se nesmí dát
 *       odlišit od „není co nasadit“ jen barvou.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Coolify vrací historii nasazení v několika tvarech — sjednotit na pole. */
export function seznamNasazeni(odpoved) {
  if (Array.isArray(odpoved)) return odpoved;
  if (Array.isArray(odpoved?.deployments)) return odpoved.deployments;
  if (Array.isArray(odpoved?.data)) return odpoved.data;
  return null; // nečitelný tvar ≠ prázdná historie
}

/**
 * Stav jedné aplikace z její historie nasazení. Řadí se podle času, ne podle
 * pořadí v odpovědi — na pořadí API se neopírá nic, co rozhoduje o nasazení.
 * `finished` v Coolify znamená, že doběhlo `up -d` (zdraví hlídá deploy-and-verify).
 */
export function stavAplikace(nasazeni) {
  const cas = (n) => Date.parse(n?.created_at ?? n?.updated_at ?? "") || 0;
  const serazena = [...nasazeni].sort((a, b) => cas(b) - cas(a));
  const pokus = serazena[0] ? { commit: serazena[0].commit ?? null, status: serazena[0].status ?? null } : null;
  const uspech = serazena.find((n) => n?.status === "finished" && n?.commit);
  return { uspesny: uspech ? uspech.commit : null, pokus };
}

/** `,a,b,` (výstup deploy_apps) → Set jmen. */
export function mnozinaAplikaci(seznam) {
  return new Set(String(seznam ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Co by rekonciliace nasadila NAVÍC k `deployApps`.
 * `nasaditOd(zaklad)` vrací Set aplikací k nasazení pro rozdíl zaklad..head
 * (v CLI aisha-changed-apps.mjs, výstup `nasadit`); smí vyhodit — pak je
 * aplikace NEZMĚŘENÁ s důvodem, nikdy tiše „v pořádku“.
 */
export function navicKNasazeni({ stav, head, deployApps, nasaditOd }) {
  const navic = [];
  const bezUspechu = [];
  const nezmereno = [];
  const podleZakladu = new Map();
  for (const [app, s] of Object.entries(stav)) {
    if (s.chyba) { nezmereno.push({ app, duvod: s.chyba }); continue; }
    if (!s.uspesny) { bezUspechu.push(app); continue; }
    if (s.uspesny === head || head.startsWith(s.uspesny) || s.uspesny.startsWith(head)) continue;
    podleZakladu.set(s.uspesny, [...(podleZakladu.get(s.uspesny) ?? []), app]);
  }
  for (const [zaklad, apps] of podleZakladu) {
    let dotcene;
    try {
      dotcene = nasaditOd(zaklad);
    } catch (e) {
      for (const app of apps) nezmereno.push({ app, duvod: `rozdíl ${zaklad.slice(0, 9)}..head: ${e.message}` });
      continue;
    }
    for (const app of apps) {
      if (dotcene.has(app) && !deployApps.has(app)) navic.push({ app, zaklad });
    }
  }
  const podleJmena = (a, b) => (a.app < b.app ? -1 : a.app > b.app ? 1 : 0);
  return { navic: navic.sort(podleJmena), bezUspechu: bezUspechu.sort(), nezmereno: nezmereno.sort(podleJmena) };
}

/**
 * Změří stav všech aplikací instance. `coolify` je klient (createCoolifyClient),
 * `scope` rozsah projektu (createProjectScope) — obojí se podává zvenku, aby
 * test mohl podstrčit falešné API. Aplikace = ty v projektu instance, jejichž
 * jméno začíná `<prefix>-` (Coolify je zdroj pravdy o tom, co existuje).
 */
export async function zmerStav({ coolify, scope, prefix, take = 20 }) {
  const vsechny = await coolify("/applications");
  if (!Array.isArray(vsechny)) throw new Error("GET /applications nevrátil pole — nelze změřit");
  const moje = vsechny.filter(scope.inProject).filter((a) => String(a?.name ?? "").startsWith(`${prefix}-`));
  const stav = {};
  for (const a of moje) {
    const app = a.name.slice(prefix.length + 1);
    try {
      const odpoved = await coolify(`/deployments/applications/${a.uuid}?take=${take}`, { timeoutMs: 20_000 });
      const seznam = seznamNasazeni(odpoved);
      if (seznam === null) { stav[app] = { uuid: a.uuid, chyba: "nečitelný tvar historie nasazení" }; continue; }
      stav[app] = { uuid: a.uuid, ...stavAplikace(seznam) };
    } catch (e) {
      stav[app] = { uuid: a.uuid, chyba: e.message };
    }
  }
  return stav;
}

/** Aplikace k nasazení pro rozdíl zaklad..head — týmž nástrojem jako detekce v CI. */
function nasaditPodleDetektoru(head) {
  return (zaklad) => {
    const out = execFileSync(
      "node",
      [join(REPO_ROOT, "scripts/aisha-changed-apps.mjs"), `--base=${zaklad}`, `--head=${head}`, "--json"],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const n = JSON.parse(out).nasadit;
    return new Set(Array.isArray(n) ? n : Object.keys(n ?? {}));
  };
}

async function hlavni(argv) {
  const hodnota = (jmeno) => {
    const i = argv.indexOf(jmeno);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const jenJson = argv.includes("--json");
  const navicRezim = argv.includes("--navic");
  if (jenJson === navicRezim) {
    process.stderr.write("nasazeny-stav: zvol právě jeden režim: --json, nebo --navic --head <sha> --deploy-apps <,a,b,>\n");
    return 2;
  }
  const baseUrl = process.env.COOLIFY_BASE_URL || process.env.COOLIFY_URL;
  const token = process.env.COOLIFY_API_TOKEN;
  const prefix = process.env.APP_NAME_PREFIX;
  if (!baseUrl || !token || !prefix) {
    process.stderr.write("nasazeny-stav: NEMĚŘENO — chybí COOLIFY_URL, COOLIFY_API_TOKEN nebo APP_NAME_PREFIX (identita se nedosazuje)\n");
    return 2;
  }
  const head = hodnota("--head");
  if (navicRezim && !head) {
    process.stderr.write("nasazeny-stav: --navic potřebuje --head <sha>\n");
    return 2;
  }
  const { createCoolifyClient } = await import("./coolify-http.mjs");
  const { createProjectScope } = await import("./coolify-project-scope.mjs");
  const coolify = createCoolifyClient({ baseUrl, token, timeoutMs: 120_000 });
  let stav;
  try {
    const scope = await createProjectScope(coolify);
    stav = await zmerStav({ coolify, scope, prefix });
  } catch (e) {
    process.stderr.write(`nasazeny-stav: NEMĚŘENO — ${e.message}\n`);
    return 2;
  }
  if (Object.keys(stav).length === 0) {
    process.stderr.write(`nasazeny-stav: NEMĚŘENO — projekt instance nemá žádnou aplikaci '${prefix}-*'\n`);
    return 2;
  }
  if (jenJson) {
    process.stdout.write(JSON.stringify(stav, null, 2) + "\n");
    return Object.values(stav).some((s) => s.chyba) ? 3 : 0;
  }
  const deployApps = mnozinaAplikaci(hodnota("--deploy-apps"));
  const r = navicKNasazeni({ stav, head, deployApps, nasaditOd: nasaditPodleDetektoru(head) });
  const aplikaci = Object.keys(stav).length;
  console.log(`rekonciliace K1 (jen hlášení): změřeno ${aplikaci - r.nezmereno.length}/${aplikaci} aplikací`);
  if (r.navic.length === 0) console.log("  navíc by se nenasadilo nic — detekce a skutečnost se shodují");
  for (const { app, zaklad } of r.navic) {
    console.log(`  NAVÍC: ${app} (poslední úspěšné nasazení ${zaklad.slice(0, 9)}, od té doby se jí změna týká)`);
  }
  for (const app of r.bezUspechu) console.log(`  BEZ ÚSPĚCHU v historii: ${app} (zakládá cold-start, CI ji nenasazuje)`);
  for (const { app, duvod } of r.nezmereno) console.log(`  NEZMĚŘENO: ${app} — ${duvod}`);
  return r.nezmereno.length > 0 ? 3 : 0;
}

if (isDirectRun(import.meta.url)) {
  hlavni(process.argv.slice(2)).then((kod) => process.exit(kod));
}
