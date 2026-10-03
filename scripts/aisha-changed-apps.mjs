#!/usr/bin/env node
// =============================================================================
// aisha-changed-apps.mjs — Change detection: git diff → seznam ovlivněných apps
// =============================================================================
// Identifikuje, které AISHA apps potřebují redeploy mezi dvěma git revisions.
// Klíčové pro selektivní deploy — neměnit zbytečně apps, jejichž compose ani
// dependencies se nezměnily.
//
// Detection rules (v pořadí specificity):
//   1. Compose file changed (`docker-compose.coolify-X.yml`)         → app "X"
//   2. Manifest line changed (`coolify/manifests/aisha.manifest`)   → all apps in changed lines
//   3. Image versions changed (`config/image-versions.env`)         → apps using changed IMAGE_*
//   4. Env contract / domains.env changed                            → all apps (may impact all)
//   5. infra/postgres/* changed (DB role/schema)                         → core + downstream DB consumers
//   6. PG17 image scripts                                             → core (DB layer)
//   + odvozené z compose: build adresář, Dockerfile (i v kořeni repa) → appka, která z něj staví
//
// TŘÍDA DŮVODU (2026-09-16): pravidla 2–4 jsou KONTRAKT — dotčenou aplikaci
// změní až doručení hodnot z trezoru (.env.coolify), tedy cold-start
// `--skip-create`. CI trezor nemá (rozhodnutí majitele 2026-09-16), takže nasadit
// z něj umí jen STAVBU. JSON proto nese `nasadit` (aspoň jeden stavební důvod)
// a `jen_kontrakt` (dotčené jen kontraktem); `affected_apps` zůstává sjednocením.
//
// Usage:
//   node scripts/aisha-changed-apps.mjs                           # HEAD~1 → HEAD
//   node scripts/aisha-changed-apps.mjs --base=main --head=HEAD
//   node scripts/aisha-changed-apps.mjs --json                    # machine-readable
//
// Exit codes:
//   0 — analysis OK (output may be empty list)
//   1 — git diff failed
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MANIFEST_PATH = join(REPO_ROOT, "coolify/manifests/aisha.manifest");

const argv = process.argv.slice(2);
const arg = (name) => {
  const m = argv.find((a) => a.startsWith(`${name}=`));
  return m ? m.slice(name.length + 1) : null;
};
const flag = (name) => argv.includes(name);

if (flag("--help") || flag("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf-8")
    .split("\n").filter((_, i) => i < 28).join("\n"));
  process.exit(0);
}

const BASE = arg("--base") || "HEAD~1";
const HEAD = arg("--head") || "HEAD";
const JSON_MODE = flag("--json");

// ── Parse manifest: name → { composeFile, host } ────────────────────────────
function parseManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    process.stderr.write("manifest not found\n");
    process.exit(1);
  }
  const apps = new Map();
  for (const line of readFileSync(MANIFEST_PATH, "utf-8").split("\n")) {
    const m = line.match(/^app:\s*([a-z0-9_-]+):([a-z0-9_-]+):(\S+?\.yml)(?::(\S+))?\s*$/i);
    if (!m) continue;
    const tags = {};
    if (m[4]) {
      for (const part of m[4].split(/[,:]/)) {
        const eq = part.indexOf("=");
        if (eq > 0) tags[part.slice(0, eq)] = part.slice(eq + 1);
        else if (part) tags[part] = true;
      }
    }
    apps.set(m[1], { name: m[1], host: m[2], composeFile: m[3], tags });
  }
  return apps;
}

// ── Get list of changed files between BASE..HEAD ────────────────────────────
function changedFiles() {
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${BASE}..${HEAD}`], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
    return out.split("\n").filter(Boolean);
  } catch (e) {
    process.stderr.write(`git diff failed: ${e.message}\n`);
    process.exit(1);
  }
}

// ── Soubory, jejichž změna je KONTRAKT, ne stavba ───────────────────────────
// Aplikaci změní až cold-start (doručení z trezoru). CI trezor nemá, takže je
// NENASAZUJE — a říká nahlas, že je potřeba dorovnání (viz `jen_kontrakt`).
const KONTRAKTNI_SOUBORY = new Set([
  "coolify/manifests/aisha.manifest",
  "config/image-versions.env",
  "config/domains.env",
  "config/cold-start-timeouts.env",
  "scripts/aisha-env-doctor.mjs",
]);

// ── Map a single changed file to affected app names ─────────────────────────
function affectedApps(file, manifest) {
  const apps = new Set();

  // Rule 1: compose file → app whose composeFile field matches
  if (file.startsWith("docker-compose.coolify")) {
    for (const [name, meta] of manifest) {
      if (meta.composeFile === file) apps.add(name);
    }
    if (apps.size === 0) {
      // Could be a shared compose (livekit, monitoring, shared) — affects multiple
      // apps or none in manifest. Conservative: nothing without explicit mapping.
    }
    return apps;
  }

  // Rules 2–4: KONTRAKT — manifest (2), verze obrazů (3), domény / env kontrakt
  // (4). Dotknou se všech aplikací, protože se k nim dostanou přes doručení
  // hodnot z trezoru, ne stavbou. Množina je JEDNA — čte z ní i třída důvodu
  // v hlavní smyčce, takže pravidlo a třída se nemohou rozejít.
  //   2: manifest itself — caller decides
  //   3: image-versions.env — mapping IMAGE_X→app requires parsing compose deeply
  //   4: domains / env contract — cross-stack env propagation
  if (KONTRAKTNI_SOUBORY.has(file)) {
    for (const name of manifest.keys()) apps.add(name);
    return apps;
  }

  // Rule 5: PG17 init scripts — affects "core" + downstream DB consumers
  if (file.startsWith("infra/postgres/")) {
    apps.add("core");        // hosts the DB
    apps.add("keycloak");    // schema keycloak
    apps.add("orchestration"); // schema n8n
    apps.add("messaging");   // synapse DB
    apps.add("observability"); // schema langfuse
    apps.add("admin");       // nocodb
    apps.add("netbird");     // schema netbird
    return apps;
  }

  // Rule 6: cold-start orchestrator scripts — meta only, ne app deploy
  // (změna v scripts/aisha-cold-start.sh nemění apps, ale jejich orchestraci)
  if (file.startsWith("scripts/")) {
    return apps;  // empty
  }

  // Rule 7: web SPA + gateway.
  //
  // ⛔ NAMĚŘENO 2026-08-09/10. Tohle pravidlo posílalo `src/` POUZE na `core` —
  // tedy tvrdilo, že web SPA patří core stacku. Nepatří:
  //
  //   `Dockerfile.web` je JEDINÉ místo v repu, kde běží `vite build`, a používají
  //   ho DVA composy — `docker-compose.coolify.yml` (core, služba `web` BEZ
  //   `args:`) a `docker-compose.coolify-prebuilt.yml` (edge, s plným `args:`).
  //   Živý web servíruje EDGE: v nasazeném bundlu jsou instanční hodnoty (JWT,
  //   `api.<tld>`), které se tam dostanou jedině přes build args, a ty předává
  //   jen prebuilt compose.
  //
  // Než se to opravilo, neexistovalo pravidlo, které by na `edge` poslalo
  // COKOLI kromě změny jeho vlastního compose souboru. Slovo „edge" bylo
  // v celém skriptu jen v komentáři u Rule 8 — a ta přidává `core`.
  //
  // Následek byl měřitelný: web servíroval bundle starý dva dny, zatímco se do
  // mainu slilo deset PR. Táž mylná představa („SPA je core") seděla i v
  // `.forgejo/workflows/ci.yml`, kde se opravila v #174. Tady je podruhé.
  //
  // ⚠️ `core` se NEODEBÍRÁ: core svou `web` službu opravdu staví (byť bez args),
  // takže změna `src/` se ho týká taky. Nejde o přesunutí, ale o doplnění.
  // ⛔ `src/tests/` NENASAZUJE. Naměřeno 2026-08-11: merge, který sáhl jen na
  // `ci.yml` a dva soubory bran, poslal na nasazení edge i core — a `Deploy:
  // Extranet` pak spadl na tvrzení „artefakt se musí změnit". Změnit se nemohl:
  // `vite build` testy neimportuje, do žádného bundlu se nedostanou.
  // Nadbytečné nasazení není neutrální — restartuje provoz a kazí měřidlo.
  if (file.startsWith("src/tests/")) return apps;   // prázdno

  if (file.startsWith("src/")) {
    apps.add("edge");   // ← bundle, který vidí uživatel
    apps.add("core");   // ← core staví Dockerfile.web taky
    return apps;
  }
  if (file.startsWith("services/gateway/")) {
    apps.add("core");
    return apps;
  }

  // Rule 7b: ostatní vstupy, ze kterých `vite build` staví bundle.
  // Bez nich by změna designového jazyka nebo `vite.config.ts` neposlala na edge
  // nic — přesně tak vypadla z dosahu #169 (barvy) i #170 (razítko revize).
  if (file.startsWith("packages/") ||
      file === "index.html" ||
      file.startsWith("vite.config.") ||
      file.startsWith("tsconfig") ||
      file.startsWith("postcss.config.") ||
      file.startsWith("tailwind.config.")) {
    apps.add("edge");
    apps.add("core");
    return apps;
  }

  // Rule 8: ws-gateway / event-worker (edge build artifact)
  if (file.startsWith("services/ws-gateway/") || file.startsWith("services/event-worker/")) {
    apps.add("core");
    return apps;
  }

  return apps;  // unknown file — no app affected
}

// ── Odvozený vlastník: adresář, ze kterého se staví, → appka ────────────────
//
// ⭐ PROČ ODVOZOVAT, A NE VYJMENOVAT (naměřeno 2026-08-11)
// Pravidla níž jmenovala `services/gateway/`, `services/ws-gateway/` a
// `services/event-worker/` NATVRDO — a dvě z nich byla ŠPATNĚ: podle compose
// staví `ws-gateway` i `event-worker` stack `realtime`, ne `core`.
// Zbylých osm stacků, které také staví ze `services/*` (ai-chat, clamav,
// ledger, domain-services, messaging, openclaw, pki, realtime), v seznamu
// nebylo VŮBEC. Ruční seznam stárne tiše: nová služba se prostě nepřidá a nic
// to neřekne.
//
// Vlastník je přitom ZAPSANÝ — v `build.dockerfile` každé služby v compose
// souboru, který manifest přiřazuje appce. Odsud se čte, takže nová služba
// je pokrytá tím, že vznikne.
//
// Bez YAML parseru schválně: tenhle skript běží i v krocích CI, kde ještě
// nejsou `node_modules`. Blok `build:` se čte po řádcích (viz stavebniVstupy).
//
// ⛔ NAMĚŘENO 2026-09-16: mapa brala jen `dockerfile:` s lomítkem a Dockerfile
// v kořeni repa (`dockerfile: Dockerfile.pki-init`, context `.`) PŘESKOČILA
// (`dir === ""`). Takových služeb je v compose přes padesát — pki-init ve 22
// stacích, keycloak, netbird-runtime, cosmos, migrate, svc-source-broker… Změna
// kteréhokoli z těch souborů se nenasadila NIKAM. Vlastník je proto dvojí:
// ADRESÁŘ (kontext nebo adresář Dockerfilu mimo kořen) a SOUBOR (sám Dockerfile,
// cesta = context + dockerfile, jak ji čte Docker).
function odstranUvozovky(v) {
  return String(v ?? "").trim().replace(/^["']|["']$/g, "");
}

/** [{ context, dockerfile, inline }] pro každý blok `build:` v compose textu. */
function stavebniVstupy(text) {
  const out = [];
  const radky = text.split("\n");
  for (let i = 0; i < radky.length; i++) {
    const m = /^(\s*)build:\s*([^#]*?)\s*(?:#.*)?$/.exec(radky[i]);
    if (!m) continue;
    const odsazeni = m[1].length;
    const hodnota = odstranUvozovky(m[2]);
    if (hodnota) {
      // Krátký tvar `build: ./adresar` — kontext s výchozím Dockerfile.
      out.push({ context: hodnota, dockerfile: "Dockerfile", inline: false });
      continue;
    }
    let context = ".";
    let dockerfile = "Dockerfile";
    let inline = false;
    let potomek = -1;
    for (let j = i + 1; j < radky.length; j++) {
      const r = radky[j];
      if (!r.trim() || r.trim().startsWith("#")) continue;
      const o = r.match(/^\s*/)[0].length;
      if (o <= odsazeni) break;
      // Jen PŘÍMÍ potomci `build:` — hlubší řádky (obsah `dockerfile_inline: |`,
      // `args:`) klíč nevedou, i kdyby v nich stálo „context:".
      if (potomek < 0) potomek = o;
      if (o !== potomek) continue;
      const k = /^\s*(context|dockerfile|dockerfile_inline):\s*([^#]*?)\s*(?:#.*)?$/.exec(r);
      if (!k) continue;
      if (k[1] === "context") context = odstranUvozovky(k[2]);
      else if (k[1] === "dockerfile") dockerfile = odstranUvozovky(k[2]);
      else inline = true;
    }
    out.push({ context, dockerfile, inline });
  }
  return out;
}

/**
 * Zdroje `COPY`/`ADD` z Dockerfile (cesty v repu). Obraz se mění i tehdy, když
 * se změní soubor, který do něj Dockerfile KOPÍRUJE — ne jen Dockerfile sám.
 *
 * ⛔ NAMĚŘENO 2026-09-16 nad posledními 60 merge do main (detektor bez COPY vs.
 * s COPY): všechny zdroje COPY přidaly 77 nasazení, skoro výhradně z celoplošné
 * kopie `COPY scripts/` (Dockerfile.migrate, Dockerfile.web) → edge, core,
 * orchestration při každé změně skriptu. Bez celého stromu `scripts` přibylo 15
 * nasazení a VŠECHNA oprávněná: `package-lock.json` (npm ci v obrazu keycloak,
 * orchestration, integration) a `keycloak/aisha-realm.json`, jehož změna se
 * předtím do Keycloaku nenasadila vůbec.
 *
 * Proto se nesleduje: kořen kontextu (`COPY . .` — celý repozitář) a celý strom
 * `scripts` (Rule 6: skripty jsou orchestrace, ne aplikace). PŘESNÁ kopie souboru
 * ze `scripts/` (`COPY scripts/docker-migrate-entrypoint.sh /entrypoint.sh`) se
 * sleduje — to je vstup obrazu, ne orchestrace.
 * Přeskakuje se i `--from=` (mezivrstva, ne repo), heredoc a cesta s proměnnou.
 */
/**
 * Výstupy buildu, které se kopírují z build stupně: jejich ZDROJEM je adresář
 * nad nimi (`services/x/dist` staví `services/x`). Kořenové `node_modules`
 * vzniká z `package-lock.json`.
 */
const VYSTUPY_BUILDU = new Set(["dist", "build", "node_modules", ".next", "out"]);

/** Cesta z `COPY --from=<celorepový stupeň> <workdir>/<rel>` → vstup v repu (nebo null). */
function vstupZVystupuBuildu(rel) {
  const casti = rel.split("/").filter(Boolean);
  const i = casti.findIndex((c) => VYSTUPY_BUILDU.has(c));
  const zdroj = i < 0 ? casti : casti.slice(0, i);
  if (zdroj.length > 0) return zdroj.join("/");
  return i >= 0 && casti[i] === "node_modules" ? "package-lock.json" : null;
}

function zdrojeKopii(dockerfileText, ctx, dockerfile) {
  const out = [];
  const text = dockerfileText.replace(/\\\r?\n/g, " ");
  // ⛔ NAMĚŘENO 2026-09-18: oprava #1010 (services/svc-plugin-system) se po merge
  // NENASADILA — detektor vydal „0 dotčených appek". Dockerfile.svc-plugin-system
  // leží v kořeni (kontext `.`), build stupeň kopíruje celé repo (`COPY . .`, to se
  // záměrně nesleduje) a skutečné vstupy obrazu jsou jen ve `COPY --from=build
  // /app/services/svc-plugin-system/dist …`. Týž tvar má sedm Dockerfilů v kořeni.
  // Proto se stupně sledují: `COPY --from=<stupeň, který zkopíroval celé repo>`
  // prozrazuje, co z repa obraz opravdu nese.
  const stupne = new Map(); // jméno stupně → { workdir, celorepovy }
  let stupen = { workdir: "/", celorepovy: false };
  for (const line of text.split("\n")) {
    const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      const rodic = stupne.get(from[1]);
      stupen = { workdir: rodic?.workdir ?? "/", celorepovy: rodic?.celorepovy ?? false };
      if (from[2]) stupne.set(from[2], stupen);
      continue;
    }
    const wd = /^\s*WORKDIR\s+(\S+)/i.exec(line);
    if (wd) {
      if (!wd[1].includes("$")) stupen.workdir = posix.resolve(stupen.workdir, wd[1]);
      continue;
    }
    const m = /^\s*(?:COPY|ADD)\s+(.*)$/i.exec(line);
    if (!m) continue;
    const zbytek = m[1].trim();
    if (zbytek.includes("<<")) continue;
    const odkud = /(?:^|\s)--from=(\S+)/.exec(zbytek);
    if (odkud) {
      const zdrojovy = stupne.get(odkud[1]);
      if (!zdrojovy?.celorepovy) continue; // mezivrstva, ne repo
      const cesty = zbytek.split(/\s+/).filter((t) => !t.startsWith("--")).slice(0, -1);
      for (const c of cesty) {
        if (c.includes("$") || c.includes("*")) continue;
        const abs = posix.resolve(zdrojovy.workdir, c);
        const rel = posix.relative(zdrojovy.workdir, abs);
        if (rel.startsWith("..")) continue;
        const vstup = vstupZVystupuBuildu(rel);
        if (vstup && vstup !== "scripts" && !vstup.startsWith("scripts/")) out.push({ cesta: posix.normalize(posix.join(ctx, vstup)) });
      }
      continue;
    }
    let tokeny;
    if (zbytek.startsWith("[")) {
      try {
        tokeny = JSON.parse(zbytek);
      } catch (e) {
        // Nečitelný exec tvar = zdroj, o kterém detektor NEVÍ. Tiché přeskočení
        // by vypadalo jako „nic se netýká" — říká se to nahlas.
        process.stderr.write(`aisha-changed-apps: ${dockerfile}: COPY v exec tvaru nejde přečíst (${e.message}) — jeho zdroje se nesledují: ${zbytek.slice(0, 120)}\n`);
        continue;
      }
      if (!Array.isArray(tokeny)) continue;
    } else {
      tokeny = zbytek.split(/\s+/).filter((t) => !t.startsWith("--"));
    }
    for (const t of tokeny.slice(0, -1)) {
      if (typeof t !== "string" || t.includes("$") || /^[a-z]+:\/\//i.test(t)) continue;
      const cesta = posix.normalize(posix.join(ctx, t)).replace(/\/+$/, "");
      if (cesta === ".") stupen.celorepovy = true; // tento stupeň nese celé repo
      if (cesta === "." || cesta === "scripts" || cesta.startsWith("..")) continue;
      out.push(cesta.includes("*")
        ? { vzor: new RegExp("^" + cesta.split("*").map((c) => c.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "(/|$)") }
        : { cesta });
    }
  }
  return out;
}

// ── Celorepová kopie (`COPY . .`): co z repa obraz SKUTEČNĚ čte ─────────────
//
// `zdrojeKopii` kořen kontextu záměrně nesleduje — `COPY . .` by jinak nasazoval
// při KAŽDÉ změně (změřeno výš: +77 nasazení za 60 merge). Jenže pro některé
// obrazy je celorepová kopie jediná cesta, kudy se jejich vstup do obrazu
// dostane, a detektor pak změnu NEVIDĚL vůbec:
//
// ⛔ NAMĚŘENO 2026-09-17 (sonda: jeden změněný soubor → výstup detektoru):
//   aisha/db/sql/functions/*.sql, aisha/db/migrations/*, aisha/db/heals.sql → nic
//     Migrace přitom běží z obrazu `migrate` (Dockerfile.migrate: `COPY . .`),
//     který staví core a orchestration. Nasazovalo se to jen díky hrubému
//     příznaku `app` v ci.yml — tomu, který zároveň nasazoval core/edge/extranet
//     i při změně jen v integration compose (run 3750, #1001).
//   apps/workbench-shell/**, instances/** → nic
//     Extranet (deploy/surface-host/Dockerfile: `COPY . .`) staví
//     `apps/${SHELL_APP}` s `INSTANCE_DIR` z `instances/`; shell importuje
//     @aisha/surface-blocks, design-language, extranet-sdk-ui, capture-ui
//     (packages/) a `npm ci` čte package-lock.json.
//
// Klíč je CESTA Dockerfilu, ne jméno appky: vlastník se odvodí z compose
// (`build.dockerfile`) stejně jako u ostatních vstupů, takže se nerozejde.
const CELOREPOVA_KOPIE = new Map([
  ["Dockerfile.migrate", ["aisha/db"]],
  ["deploy/surface-host/Dockerfile", ["apps", "instances", "packages", "package-lock.json"]],
]);

function buildDirOwners(manifest) {
  const adresare = new Map();   // "services/svc-x" → Set(appName)
  const soubory = new Map();    // "Dockerfile.pki-init" → Set(appName)
  const kopie = [];             // [{ cesta | vzor, app }] — zdroje COPY/ADD
  const pridej = (mapa, klic, app) => {
    if (!mapa.has(klic)) mapa.set(klic, new Set());
    mapa.get(klic).add(app);
  };
  let composeNalezeno = 0;
  for (const app of manifest.values()) {
    const p = join(REPO_ROOT, app.composeFile);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf-8");
    // Za compose se počítá jen soubor, který DEKLARUJE SLUŽBY. Bez téhle
    // podmínky by atrapa o jednom řádku (fixtura v bráně `detektor-zna-edge`)
    // vypadala jako compose se změněným formátem a shodila by sondu níž.
    if (!/^\s*services:\s*$/m.test(text)) continue;
    composeNalezeno++;
    for (const { context, dockerfile, inline } of stavebniVstupy(text)) {
      // Hodnota s proměnnou se staticky nerozřeší — radši nic než špatný vlastník.
      if (context.includes("$") || dockerfile.includes("$")) continue;
      const ctx = posix.normalize(context);
      if (ctx.startsWith("..")) continue;
      if (ctx !== ".") pridej(adresare, ctx.replace(/\/+$/, ""), app.name);
      if (inline) continue;
      const cesta = posix.normalize(posix.join(ctx, dockerfile));
      if (cesta.startsWith("..")) continue;
      pridej(soubory, cesta, app.name);
      for (const vstup of CELOREPOVA_KOPIE.get(cesta) ?? []) kopie.push({ cesta: vstup, app: app.name });
      const dir = posix.dirname(cesta);
      if (dir !== ".") pridej(adresare, dir, app.name);
      const plna = join(REPO_ROOT, cesta);
      if (existsSync(plna)) {
        for (const zdroj of zdrojeKopii(readFileSync(plna, "utf-8"), ctx, cesta)) kopie.push({ ...zdroj, app: app.name });
      }
    }
  }
  // ⭐ SONDA MUSÍ ROZLIŠIT „NENÍ CO MĚŘIT" OD „MĚŘIDLO JE ROZBITÉ".
  //
  // První verze padala vždycky, když mapa vyšla prázdná — a shodila tím sedm
  // tvrzení brány `detektor-zna-edge`, jejíž dočasné repo compose soubory nemá
  // (schválně: měří pravidla nad `src/` a `packages/`, ne mapování služeb).
  // Prázdno tam NENÍ porucha, je to neúplný strom.
  //
  // Porucha je až případ, kdy compose soubory EXISTUJÍ a přesto z nich nejde
  // přečíst ani jeden stavební vstup — tehdy se změnil formát a tiché prázdno by
  // vypnulo celé pravidlo, aniž by se cokoli ozvalo.
  if (composeNalezeno > 0 && adresare.size === 0 && soubory.size === 0) {
    process.stderr.write(
      `aisha-changed-apps: přečteno ${composeNalezeno} compose souborů a ANI V JEDNOM ` +
      "se nenašel stavební vstup (`build:`).\nFormát se změnil — odmítám pokračovat s prázdnou mapou, " +
      "vypadala by jako „nic se netýká ničeho.\n",
    );
    process.exit(2);
  }
  return { adresare, soubory, kopie };
}

// ── Submoduly: samostatná repa, jejichž konzumenta určuje COPY v Dockerfile ──
//
// ⛔ NAMĚŘENO 2026-09-14. Posun submodulu `packages/local-ingest` (Python
// engine ingestu) padl pod Rule 7b „`packages/` = vstup vite buildu" a detektor
// ho poslal na CORE a EDGE — tedy na přestavbu databáze — zatímco appka, která
// se skutečně měnila (`local-ingest`), v seznamu nebyla. Stejně dopadl každý
// předchozí bump (#343, #347).
//
// Submodul NENÍ npm balík webu: je to cizí repo, které do obrazu kopíruje
// konkrétní Dockerfile (`COPY packages/local-ingest/src/ src/`). Tenhle řádek
// je zapsaný vlastník — čte se, nepíše. Seznam submodulů je `.gitmodules`.
function submodulePaths() {
  const p = join(REPO_ROOT, ".gitmodules");
  if (!existsSync(p)) return [];
  return [...readFileSync(p, "utf-8").matchAll(/^\s*path\s*=\s*(\S+)\s*$/gm)]
    .map((m) => m[1].replace(/\/+$/, ""));
}

/** submodul → appky, jejichž Dockerfile (z compose přiřazeného v manifestu) ho kopíruje. */
function submoduleOwners(manifest, submoduly) {
  const owners = new Map(submoduly.map((s) => [s, new Set()]));
  if (submoduly.length === 0) return owners;
  for (const app of manifest.values()) {
    const compose = join(REPO_ROOT, app.composeFile);
    if (!existsSync(compose)) continue;
    for (const m of readFileSync(compose, "utf-8").matchAll(/^\s*dockerfile:\s*["']?([^"'\s#]+)/gm)) {
      // Konzumenti submodulů staví s `context: .` — cesta Dockerfilu je od kořene repa.
      const dockerfile = join(REPO_ROOT, m[1]);
      if (!existsSync(dockerfile)) continue;
      for (const radek of readFileSync(dockerfile, "utf-8").split("\n")) {
        const c = radek.match(/^\s*(?:COPY|ADD)\s+(.*)$/i);
        if (!c || /--from=/i.test(c[1])) continue;   // kopie z jiné stage není vstup z repa
        const casti = c[1].trim().split(/\s+/).filter((t) => !t.startsWith("--"));
        for (const zdroj of casti.slice(0, -1)) {
          const z = zdroj.replace(/^\.\//, "").replace(/\/+$/, "");
          for (const s of submoduly) {
            if (z === s || z.startsWith(s + "/")) owners.get(s).add(app.name);
          }
        }
      }
    }
  }
  return owners;
}

/** Submodul, pod nímž soubor leží (posun gitlinku hlásí git jako cestu submodulu samotnou). */
function submoduleForFile(file, submoduly) {
  return submoduly.find((s) => file === s || file.startsWith(s + "/")) ?? null;
}

/** Appky, které ze souboru staví: sám Dockerfile, zdroj jeho COPY, adresář, pod nímž leží (nejdelší shoda). */
function ownersForFile(file, { adresare, soubory, kopie }) {
  const out = new Set(soubory.get(file) ?? []);
  for (const k of kopie) {
    const zasah = k.vzor ? k.vzor.test(file) : file === k.cesta || file.startsWith(k.cesta + "/");
    if (zasah) out.add(k.app);
  }
  let nejlepsi = null;
  for (const dir of adresare.keys()) {
    if (file.startsWith(dir + "/") && (!nejlepsi || dir.length > nejlepsi.length)) nejlepsi = dir;
  }
  if (nejlepsi) for (const a of adresare.get(nejlepsi)) out.add(a);
  return out.size ? out : null;
}

// ── Main ────────────────────────────────────────────────────────────────────
const manifest = parseManifest();
const files = changedFiles();
const result = {
  base: BASE,
  head: HEAD,
  changed_files: files,
  affected_apps: {},   // name → list of files that touched it (sjednocení tříd)
  nasadit: {},         // name → soubory se STAVEBNÍM důvodem (nasadí CI)
  jen_kontrakt: {},    // name → soubory, když appku změní JEN kontrakt (cold-start)
};

const vlastnici = buildDirOwners(manifest);
const submoduly = submodulePaths();
const vlastniciSubmodulu = submoduleOwners(manifest, submoduly);
const bezKonzumenta = new Set();

for (const file of files) {
  const submodul = submoduleForFile(file, submoduly);
  if (submodul) {
    // Jen zapsaný konzument — NE plošné pravidlo pro `packages/` (to patří npm balíkům webu).
    const konzumenti = vlastniciSubmodulu.get(submodul);
    if (konzumenti.size === 0) bezKonzumenta.add(submodul);
    for (const app of konzumenti) {
      if (!result.affected_apps[app]) result.affected_apps[app] = [];
      result.affected_apps[app].push(file);
      // ⛔ NAMĚŘENO 2026-09-27: posun gitlinku je nový vstup STAVBY obrazu (Dockerfile
      // z něj kopíruje), ne změna kontraktu. Bez zápisu sem skončil konzument v
      // `jen_kontrakt` („dorovná cold-start") a CI ho po merge nenasadilo — engine
      // ingestu z kola 8 (4e0044392) v provozu neběžel a verze faktur se neoznačily.
      if (!result.nasadit[app]) result.nasadit[app] = [];
      result.nasadit[app].push(file);
    }
    continue;
  }
  const affected = affectedApps(file, manifest);
  // Odvozený vlastník se PŘIDÁVÁ ke stávajícím pravidlům, neruší je: ta nesou
  // vazby, které z compose neplynou (např. `src/` staví edge I core).
  const odvozeni = ownersForFile(file, vlastnici);
  if (odvozeni) for (const a of odvozeni) affected.add(a);
  // Kontraktní soubor, který je ZÁROVEŇ vstupem stavby (zdroj COPY), nasazuje
  // jen aplikace, které ho opravdu stavějí — ostatní dostane cold-start.
  const kontrakt = KONTRAKTNI_SOUBORY.has(file);
  for (const app of affected) {
    if (!result.affected_apps[app]) result.affected_apps[app] = [];
    result.affected_apps[app].push(file);
    if (!kontrakt || odvozeni?.has(app)) {
      if (!result.nasadit[app]) result.nasadit[app] = [];
      result.nasadit[app].push(file);
    }
  }
}
for (const [app, soubory] of Object.entries(result.affected_apps)) {
  if (!result.nasadit[app]) result.jen_kontrakt[app] = soubory;
}

const affectedNames = Object.keys(result.affected_apps).sort();

// Submodul, který nekopíruje žádný Dockerfile appky z manifestu, nemá co nasadit.
// Říká se to NAHLAS: mlčení by vypadalo stejně jako „konzument existuje, ale nenašel se".
if (bezKonzumenta.size) {
  process.stderr.write(
    `aisha-changed-apps: submodul bez konzumenta v manifestu (nic se nenasadí): ${[...bezKonzumenta].join(", ")}\n`,
  );
}

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({
    ...result,
    affected_count: affectedNames.length,
    unowned_submodules: [...bezKonzumenta].sort(),
  }, null, 2) + "\n");
} else {
  process.stderr.write(`\nChange detection: ${BASE}..${HEAD}\n`);
  process.stderr.write(`Changed files: ${files.length}\n`);
  process.stderr.write(`Affected apps: ${affectedNames.length}\n\n`);
  if (affectedNames.length === 0) {
    process.stderr.write(`  (none — žádný redeploy potřeba)\n`);
  } else {
    for (const name of affectedNames) {
      process.stderr.write(`  ${name}\n`);
      for (const f of result.affected_apps[name]) {
        process.stderr.write(`    ← ${f}\n`);
      }
    }
    // Nasazuje se AUTOMATICKY (rozhodnutí majitele 2026-09-16): stavbu nasadí CI
    // po merge do main ve vlnách, kontrakt dorovná cold-start. Ruční
    // `aisha-redeploy --only` tu schválně NENÍ — byla to druhá cesta, kterou
    // nikdo neměřil.
    const nasadit = Object.keys(result.nasadit).sort();
    const jenKontrakt = Object.keys(result.jen_kontrakt).sort();
    process.stderr.write(`\nStavba — nasadí CI po merge do main (vlny aisha-redeploy): ${nasadit.join(",") || "(nic)"}\n`);
    if (jenKontrakt.length) {
      process.stderr.write(`Jen kontrakt (hodnoty z trezoru) — dorovná: bash scripts/aisha-cold-start.sh --skip-create\n`);
      process.stderr.write(`  ${jenKontrakt.join(",")}\n`);
    }
  }
  // Stdout: comma-separated names (pro pipe → aisha-redeploy.mjs --only=...)
  process.stdout.write(affectedNames.join(",") + "\n");
}
