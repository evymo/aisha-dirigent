#!/usr/bin/env node
/**
 * build.mjs — zabalí zdroj pluginu do artefaktu, který UMÍ SPUSTIT sandbox.
 *
 * PROČ TOHLE EXISTUJE (naměřeno 2026-08-12)
 * -----------------------------------------
 * Dráha pluginu byla postavená na obou koncích a uprostřed chyběl článek:
 *
 *   plugins/<id>/src/index.ts   ✅ zdroj, testy
 *   plugin_catalog + plugin_versions ✅ registr
 *   svc-plugin-system           ✅ stáhne, ověří SHA-256, dispatchne
 *   images/plugin-exec/shim     ✅ spustí
 *   ——— zdroj → artefakt ———    ⛔ NIKDO
 *
 * ⭐ A ty dva konce navíc mluví JINÝM JAZYKEM. Shim obaluje artefakt takhle
 * (viz `images/plugin-exec/shim/src/main.ts`):
 *
 *     (async (ctx, action, params) => {
 *     <ARTEFAKT>
 *     })(ctx, action, params)
 *
 * Tedy TĚLO FUNKCE — `import`/`export` jsou tam syntaktická chyba. Plugin je
 * přitom psaný jako ESM modul (`export async function handle`, `import … from
 * "./mappers.js"`). Bez tohohle kroku by artefakt spadl na prvním řádku,
 * a to až za běhu v sandboxu — tedy daleko od místa, kde se chyba udělala.
 *
 * CO SE MĚŘÍ (a proč to není jen „zavolat esbuild")
 * ------------------------------------------------
 * Zabalit nestačí — bundler smí legálně vyprodukovat kód, který sandbox
 * odmítne: `require(...)`, `process.env`, `globalThis`. Sandbox tyhle globály
 * VYPÍNÁ (`createContext({ require: undefined, process: undefined, … })`),
 * takže výsledek by byl `undefined is not a function` za běhu.
 * Proto se hotový artefakt PROJDE a tvrzení se ověří na něm, ne na záměru.
 *
 * ŽÁDNÉ FALLBACKY: plugin bez `adapter_entry` se NEODHADUJE z konvence cest.
 * Vypíše se jako přeskočený s důvodem — „nevím" musí jít poznat od „nic tam
 * není".
 *
 * ADAPTÉR BROKERU SE NEBALÍ. `source_spec.host: "source-broker"` znamená, že
 * adaptér načítá plugin host `svc-source-broker` v procesu a cestuje obrazem
 * brokeru — do sandboxu nepatří a jeho pravidla (bez `require`/`process`) pro
 * něj neplatí. Build u něj ověří jen to, že vstupní soubor existuje, a přeskočí
 * ho s důvodem. Rozhoduje scripts/plugins/host.mjs, ne odhad z exportů.
 *
 * Použití:
 *   node scripts/plugins/build.mjs                 # všechny
 *   node scripts/plugins/build.mjs tcars-fleet     # vybrané
 *   OUT_DIR=/tmp/x node scripts/plugins/build.mjs  # jiný cíl
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { hostOf } from "./host.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PLUGINS_DIR = join(ROOT, "plugins");
const OUT_DIR = process.env.OUT_DIR ?? join(ROOT, "dist", "plugins");

/** Jméno globálu, pod kterým IIFE vydá exporty modulu. */
const GLOBAL = "__aishaPlugin";

/**
 * Zakázané vzory v HOTOVÉM artefaktu. Každý odpovídá globálu, který sandbox
 * vypíná — kdyby se do balíčku dostal, projeví se to až za běhu.
 */
const ZAKAZANE = [
  { vzor: /(^|[^.\w])require\s*\(/, proc: "sandbox `require` vypíná (createContext: require: undefined)" },
  { vzor: /(^|[^.\w])process\s*\./, proc: "sandbox `process` vypíná" },
  { vzor: /(^|[^.\w])globalThis\b/, proc: "sandbox `globalThis` vypíná" },
  { vzor: /^\s*import\s/m, proc: "artefakt je TĚLO funkce — `import` je tam syntaktická chyba" },
  { vzor: /^\s*export\s/m, proc: "artefakt je TĚLO funkce — `export` je tam syntaktická chyba" },
];

function nactiManifest(slug) {
  const cesta = join(PLUGINS_DIR, slug, "manifest.json");
  if (!existsSync(cesta)) return null;
  return JSON.parse(readFileSync(cesta, "utf8"));
}

/**
 * Vstupní bod pluginu. Nese ho ten `*_spec`, který odpovídá druhu pluginu —
 * spec JE kontrakt (viz komentář u `plugin_catalog.provider_spec`), takže se
 * nehádá z toho, co náhodou leží v `src/`.
 */
function vstupniBod(manifest) {
  const specy = ["source_spec", "agent_spec", "provider_spec", "node_spec", "auth_spec", "tracking_spec"];
  for (const s of specy) {
    const e = manifest[s]?.adapter_entry;
    if (typeof e === "string" && e.length > 0) return { entry: e, spec: s };
  }
  return null;
}

async function zabal(slug) {
  const manifest = nactiManifest(slug);
  if (!manifest) return { slug, stav: "chyba", duvod: "manifest.json chybí" };

  const bod = vstupniBod(manifest);
  if (!bod) {
    return {
      slug,
      stav: "přeskočen",
      duvod: `žádný *_spec nenese adapter_entry (kind=${manifest.kind}) — bez deklarace se vstupní bod NEODHADUJE`,
    };
  }

  const vstup = join(ROOT, bod.entry);
  if (!existsSync(vstup)) {
    return { slug, stav: "chyba", duvod: `adapter_entry ukazuje na neexistující soubor: ${bod.entry}` };
  }

  // Existence se ověřuje i u adaptéru brokeru: přeskočení není kontrola, a překlep
  // v cestě by se jinak ukázal až v obraze brokeru, daleko od manifestu.
  let host;
  try {
    host = hostOf(manifest);
  } catch (e) {
    return { slug, stav: "chyba", duvod: e instanceof Error ? e.message : String(e) };
  }
  if (host === "source-broker") {
    return {
      slug,
      stav: "přeskočen",
      duvod: "host=source-broker — adaptér běží v procesu brokeru a cestuje jeho obrazem, ne sandboxem",
    };
  }

  const esbuild = await import("esbuild");
  const vysledek = await esbuild.build({
    entryPoints: [vstup],
    bundle: true,
    write: false,
    format: "iife",
    globalName: GLOBAL,
    // `neutral` schválně: sandbox nemá `require`, takže se do artefaktu NESMÍ
    // dostat nic, co by se dotahovalo za běhu. Cokoli nerozřešitelného tu padne
    // hlasitě při buildu místo tiše v sandboxu. `mainFields` je u `neutral`
    // povinné — bez něj esbuild ignoruje `main` a nenajde ani řádné balíky.
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    target: "node20",
    external: [],
    metafile: true,
    legalComments: "none",
    // Determinismus: stejný vstup → stejný bajt. Bez toho by se SHA-256
    // měnila mezi buildy a registr by hlásil „nová verze" tam, kde se nic
    // nezměnilo.
    minify: false,
    sourcemap: false,
  });

  const telo = vysledek.outputFiles[0].text;

  // ── Deklarace závislostí musí odpovídat tomu, co se SKUTEČNĚ zabalilo ────
  // Sandbox instaluje jen závislosti shimu, takže balík, který se nezabalí,
  // za běhu prostě není. `dependencies` v manifestu je proto tvrzení o realitě,
  // ne poznámka — a tady se porovnává s tím, co bundler doopravdy vtáhl.
  //
  // Porovnává se PŘÍMÁ závislost (co importuje zdroj pluginu) proti manifestu —
  // tranzitivní balíky do `dependencies` nepatří, stejně jako v npm. Celou
  // rozřešenou množinu nese `plugin_versions.resolved_deps`; proto se vrací
  // zvlášť a proto se tomu sloupci tak říká.
  const zabaleneVse = new Set();
  for (const cesta of Object.keys(vysledek.metafile.inputs)) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(cesta);
    if (m) zabaleneVse.add(m[1]);
  }
  const zabalene = new Set();
  for (const [cesta, vstup] of Object.entries(vysledek.metafile.inputs)) {
    if (cesta.includes("node_modules/")) continue; // jen zdroj pluginu, ne jeho závislosti
    for (const imp of vstup.imports ?? []) {
      if (imp.external) continue;
      // esbuild v metafile uvádí ROZŘEŠENOU cestu, ne původní specifier —
      // takže `./tc-client.js` je tu `plugins/…/tc-client.ts`. Balík se proto
      // pozná podle toho, že cíl leží v node_modules, ne podle tvaru zápisu.
      const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(imp.path);
      if (m) zabalene.add(m[1]);
    }
  }
  const deklarovane = new Set(Object.keys(manifest.dependencies ?? {}));
  const chybiVManifestu = [...zabalene].filter((d) => !deklarovane.has(d)).sort();
  const navicVManifestu = [...deklarovane].filter((d) => !zabalene.has(d)).sort();
  if (chybiVManifestu.length > 0 || navicVManifestu.length > 0) {
    const casti = [];
    if (chybiVManifestu.length > 0) {
      casti.push(`zabaleno, ale manifest to nedeklaruje: ${chybiVManifestu.join(", ")}`);
    }
    if (navicVManifestu.length > 0) {
      casti.push(`manifest deklaruje, ale nezabalilo se: ${navicVManifestu.join(", ")}`);
    }
    return { slug, stav: "chyba", duvod: `dependencies v manifestu neodpovídají balíčku — ${casti.join(" · ")}` };
  }

  // Dispečer: shim volá s (ctx, action, params); plugin vystavuje init/handle/dispose.
  // `init` deklaruje plány přes ctx.schedule — shim je zaznamená a vydá v obálce
  // výsledku; tikání je vrstva výš a záměrně tu není.
  const dispecer = [
    "",
    `if (typeof ${GLOBAL} !== "object" || ${GLOBAL} === null) {`,
    `  throw new Error("plugin bundle nevydal exporty — očekával se objekt ${GLOBAL}");`,
    "}",
    `if (typeof ${GLOBAL}.handle !== "function") {`,
    `  throw new Error("plugin nevystavuje handle(ctx, action, params)");`,
    "}",
    `if (typeof ${GLOBAL}.init === "function") { await ${GLOBAL}.init(ctx); }`,
    // Zapálení (2026-09-24): host spustí plugin s vyhrazenou akcí `__declare`, aby
    // init() deklaroval rozvrhy — a NIC dalšího: žádné stahování, žádné handle().
    // Jméno s podtržítky nemůže kolidovat s capability z manifestu (cron.*, http.*).
    `if (action === "__declare") {`,
    `  if (typeof ${GLOBAL}.dispose === "function") { await ${GLOBAL}.dispose(ctx); }`,
    `  return { declared: true };`,
    "}",
    "try {",
    `  return await ${GLOBAL}.handle(ctx, action, params);`,
    "} finally {",
    `  if (typeof ${GLOBAL}.dispose === "function") { await ${GLOBAL}.dispose(ctx); }`,
    "}",
    "",
  ].join("\n");

  const artefakt = telo + dispecer;

  // ── Tvrzení nad HOTOVÝM artefaktem ──────────────────────────────────────
  const nalezy = [];
  for (const { vzor, proc } of ZAKAZANE) {
    const m = vzor.exec(artefakt);
    if (m) {
      const radek = artefakt.slice(0, m.index).split("\n").length;
      nalezy.push(`${proc} — nalezeno na řádku ${radek}: ${JSON.stringify(m[0].trim())}`);
    }
  }
  // Syntaktická zkouška v tom TVARU, ve kterém to shim spustí. Bez tohohle by
  // se chyba projevila až v sandboxu, kde je nejdráž viditelná.
  //
  // `new vm.Script` zdroj POUZE ZKOMPILUJE — nespustí ho a nevytvoří nic
  // volatelného. Přesně to tu chceme: ptáme se „dá se to přečíst?", ne „co to
  // udělá". Je to i týž nástroj, jakým artefakt pouští shim (`node:vm`), takže
  // se ptáme jeho parserem, ne cizím.
  try {
    new Script(`(async (ctx, action, params) => {\n${artefakt}\n})`, { filename: `${slug}.plugin.js` });
  } catch (e) {
    nalezy.push(`artefakt se nedá načíst jako tělo async funkce: ${e.message}`);
  }
  if (nalezy.length > 0) return { slug, stav: "chyba", duvod: nalezy.join("\n            ") };

  const sha = createHash("sha256").update(artefakt).digest("hex");
  mkdirSync(OUT_DIR, { recursive: true });
  const soubor = join(OUT_DIR, `${slug}-${manifest.version}.js`);
  writeFileSync(soubor, artefakt);
  writeFileSync(`${soubor}.sha256`, sha + "\n");

  return {
    slug,
    stav: "ok",
    verze: manifest.version,
    soubor,
    sha,
    bajtu: Buffer.byteLength(artefakt),
    // Celá rozřešená množina — do `plugin_versions.resolved_deps` při publikaci.
    resolvedDeps: [...zabaleneVse].sort(),
  };
}

// ── Běh ────────────────────────────────────────────────────────────────────
const vybrane = process.argv.slice(2);
const vsechny = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const slugy = vybrane.length > 0 ? vybrane : vsechny;

if (slugy.length === 0) {
  console.error("V plugins/ není žádný plugin — měřidlo ztratilo předmět.");
  process.exit(2);
}

const vysledky = [];
for (const slug of slugy) vysledky.push(await zabal(slug));

let chyb = 0;
for (const v of vysledky) {
  if (v.stav === "ok") {
    console.log(`  ✓ ${v.slug.padEnd(22)} ${v.verze.padEnd(8)} ${String(v.bajtu).padStart(7)} B  ${v.sha.slice(0, 12)}`);
  } else if (v.stav === "přeskočen") {
    console.log(`  ∅ ${v.slug.padEnd(22)} přeskočen — ${v.duvod}`);
  } else {
    chyb += 1;
    console.log(`  ✗ ${v.slug.padEnd(22)} ${v.duvod}`);
  }
}

const ok = vysledky.filter((v) => v.stav === "ok").length;
const presk = vysledky.filter((v) => v.stav === "přeskočen").length;
console.log(`\n  ${ok} zabaleno · ${presk} přeskočeno · ${chyb} chyb → ${OUT_DIR}`);
process.exit(chyb > 0 ? 1 : 0);
