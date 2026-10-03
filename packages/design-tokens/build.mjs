/**
 * AISHA Design Token Build
 * ------------------------------------------------------------------------
 * Reads tokens.json (the committed in-stack mirror of the canonical AISHA
 * brand — see tokens.json $meta) and generates, for the INTERNAL stack
 * surfaces, one artifact per consumption format:
 *
 *   dist/aisha.css          CSS custom properties  → web (src/) + workbench webviews
 *   dist/aisha-theme.ts     TypeScript constants    → mobile-app (React Native)
 *   dist/vscode-colors.json workbench.colorCustomizations snippet → workbench chrome
 *
 * The marketing WEB is operator-self-branded per AISHA_SEED_DOMAIN and does
 * NOT consume these. The zero-dependency setup cockpit ships its own committed
 * snapshot (scripts/setup-cockpit/ui/aisha-tokens.css) kept in sync by the
 * design-tokens drift gate.
 *
 * Usage: node packages/design-tokens/build.mjs   (or: npm run gen:tokens)
 *
 * @module packages/design-tokens/build
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DIST = join(__dirname, "dist");

// --brand <file> — which brand the CUSTOMER-FACING mobile surface is built from.
// An instance supplies its own values so the app comes out in ITS colours:
// branding is then a property of the build, exactly like .env.production,
// version.json and assets/ already are. The SHAPE stays ours; only the values
// differ, so no call site changes.
// --out <file>  — where to write the mobile theme (default: dist/mobile-theme.ts).
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

// The stack's INTERNAL surfaces (cockpit, workbench chrome, VS Code) are always
// AISHA — they are the platform's own face, not a tenant's. Only the mobile theme
// follows the instance brand, so the two inputs are deliberately separate: an
// instance brand file carries a `mobile` slice alone and would crash buildCSS().
const PLATFORM_TOKENS = join(__dirname, "tokens.json");
const tokens = JSON.parse(readFileSync(PLATFORM_TOKENS, "utf-8"));

/**
 * Which brand file the mobile theme is built from.
 *
 * Brand VALUES are instance data — they live in the instance repo next to
 * app.config.json and public/tokens.css, and reach a build through the same
 * overlay channel (`SURFACE_OVERLAY_GIT_URL` → `instances/_overlay`, see
 * deploy/surface-host/Dockerfile). Resolution, first hit wins:
 *
 *   1. --brand <file>                                explicit (CI, one-off builds)
 *   2. instances/_overlay/brand.tokens.json          the overlay a build materialised
 *   3. instances/$AISHA_INSTANCE/brand.tokens.json   named instance in this tree
 *   4. the SOLE instances/<slug>/brand.tokens.json, when exactly one exists
 *   5. packages/design-tokens/tokens.json            AISHA (upstream, no instance)
 *
 * Rule 2 is what makes a deployed build use the instance repo's values. Rule 4 is
 * what makes `npm run gen:tokens` correct in a single-instance checkout with no env:
 * without it a bare regeneration would silently repaint the app in the PLATFORM's
 * brand — the exact drift this file exists to prevent. Two instances make it
 * ambiguous, so it then asks for AISHA_INSTANCE rather than guessing.
 *
 * Rule 5 keeps upstream and a fresh checkout building exactly as before.
 */
function resolveBrandFile() {
  const explicit = flag("--brand", null);
  if (explicit) return explicit;

  const overlay = join(ROOT, "instances", "_overlay", "brand.tokens.json");
  if (existsSync(overlay)) return overlay;

  // ⛔ DEKLAROVANÁ INSTANCE BEZ OVERLAYE JE PÁD, NE DŮVOD SÁHNOUT PO PLATFORMĚ.
  //
  // Dřív se tady jen „nenašlo" a běh pokračoval až na pravidlo 5 (platformní
  // tokeny) — takže `AISHA_INSTANCE=<fork>` bez overlaye TIŠE přebarvilo appku do
  // barev platformy. Dokud fork nosil `instances/<fork>/` u sebe, ta větev nikdy
  // nenastala a nikdo o ní nevěděl. Jakmile instanční data z forku zmizí (a to
  // je záměr — fork má být shodný s upstreamem), stane se z ní hlavní cesta.
  //
  // ⭐ Kdo jmenuje instanci, ten o ní něco tvrdí. Nenaplněné tvrzení se musí
  // ozvat, ne vyústit v jiný, tišší výsledek. Táž věta jako u split-rule brány:
  // „a declared tenant with no overlay is a dissolved instance".
  const slug = process.env.AISHA_INSTANCE;
  if (slug) {
    const named = join(ROOT, "instances", slug, "brand.tokens.json");
    if (existsSync(named)) return named;
    throw new Error(
      `[design-tokens] AISHA_INSTANCE=${slug}, ale ${relative(ROOT, named)} neexistuje.\n` +
        `  Overlay instance se do stromu dostává kanálem SURFACE_OVERLAY_GIT_URL\n` +
        `  (→ instances/_overlay), nebo ho předej výslovně: --brand <soubor>.\n` +
        `  Pokračovat na platformní tokeny by appku TIŠE přebarvilo do barev AISHA.`,
    );
  }

  const instancesDir = join(ROOT, "instances");
  if (existsSync(instancesDir)) {
    const found = readdirSync(instancesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => join(instancesDir, e.name, "brand.tokens.json"))
      .filter((p) => existsSync(p));
    if (found.length === 1) return found[0];
    if (found.length > 1) {
      throw new Error(
        `[design-tokens] ${found.length} instance brand files found — set AISHA_INSTANCE ` +
          `(or pass --brand) to say which one the mobile theme is built from:\n  ` +
          found.map((p) => relative(ROOT, p)).join("\n  "),
      );
    }
  }
  return PLATFORM_TOKENS;
}

const BRAND_FILE = resolveBrandFile();
const brand = JSON.parse(readFileSync(BRAND_FILE, "utf-8"));

mkdirSync(DIST, { recursive: true });

const camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const banner = (syntax) =>
  syntax === "css"
    ? "/* AUTO-GENERATED from packages/design-tokens/tokens.json — do not edit. Run `npm run gen:tokens`. */"
    : "// AUTO-GENERATED from packages/design-tokens/tokens.json — do not edit. Run `npm run gen:tokens`.";

// ---------------------------------------------------------------------------
// dist/aisha.css — CSS custom properties
// ---------------------------------------------------------------------------
function buildCSS() {
  const v = [];
  const push = (name, value) => v.push(`  --${name}: ${value};`);

  for (const [k, val] of Object.entries(tokens.color)) push(`color-${camelToKebab(k)}`, val);
  for (const [k, val] of Object.entries(tokens.alpha)) push(camelToKebab(k), val);
  for (const [k, val] of Object.entries(tokens.font)) push(`font-${camelToKebab(k)}`, val);
  for (const [k, val] of Object.entries(tokens.type)) push(`text-${camelToKebab(k)}`, val);
  for (const [k, val] of Object.entries(tokens.tracking)) push(`tracking-${k}`, val);
  for (const [k, val] of Object.entries(tokens.radius)) push(`radius-${k}`, val);
  for (const [k, val] of Object.entries(tokens.space)) push(`space-${k}`, val);
  for (const [k, val] of Object.entries(tokens.motion)) push(camelToKebab(k === "easeDefault" ? "ease-default" : `duration-${k}`), val);
  for (const [k, val] of Object.entries(tokens.skew)) push(k === "angle" ? "skew-angle" : `skew-${k}`, val);

  // ── signature ember background (the editorial near-black canvas) ──
  push(
    "ember-bg",
    "radial-gradient(ellipse at 50% 24%, var(--ember-strong), transparent 52%), " +
      "radial-gradient(ellipse at 16% 84%, var(--ember-soft), transparent 50%), " +
      "linear-gradient(180deg, var(--color-bg0) 0%, var(--color-bg1) 100%)"
  );

  writeFileSync(join(DIST, "aisha.css"), `${banner("css")}\n:root {\n${v.join("\n")}\n}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// dist/aisha-theme.ts — TypeScript constants (React Native / mobile)
// ---------------------------------------------------------------------------
function buildTS() {
  const obj = (o) =>
    "{\n" +
    Object.entries(o)
      .map(([k, val]) => `  ${/^\d/.test(k) ? `"${k}"` : k}: ${JSON.stringify(val)},`)
      .join("\n") +
    "\n} as const;";

  const out = [
    banner("ts"),
    "",
    `export const aishaColors = ${obj(tokens.color)}`,
    "",
    `export const aishaAlpha = ${obj(tokens.alpha)}`,
    "",
    `export const aishaFont = ${obj(tokens.font)}`,
    "",
    `export const aishaType = ${obj(tokens.type)}`,
    "",
    `export const aishaTracking = ${obj(tokens.tracking)}`,
    "",
    `export const aishaRadius = ${obj(tokens.radius)}`,
    "",
    `export const aishaSpace = ${obj(tokens.space)}`,
    "",
    `export const aishaMotion = ${obj(tokens.motion)}`,
    "",
    `export const aishaSkew = ${obj(tokens.skew)}`,
    "",
  ].join("\n");

  writeFileSync(join(DIST, "aisha-theme.ts"), `${out}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// mobile theme — the shape mobile-app/src/theme/index.ts exposes
// ---------------------------------------------------------------------------
//
// The mobile app consumes `colors` / `spacing` / `typography` at ~37 call sites.
// That shape is the contract; the values are the brand. Generating it from a brand
// file is what makes "this instance looks like TENANT" a property rather than a fork:
// the app is untouched, only the token file differs.
//
// It is written into the app's tree rather than imported because mobile-app is
// outside the root workspace (metro cannot resolve up), which is also why it was
// hand-maintained until now — and drifted: several colours here never existed in
// tokens.json, and nothing checked them.
/**
 * ⛔ ZNAČKA PŘEBÍJÍ, NEMAŽE. Dřív se brala `brand.mobile` CELÁ a platformní
 * základ z `tokens.json` se zahodil — takže značka se sedmi typografickými
 * klíči vyrobila téma se sedmi, ačkoli kód jich používá čtrnáct.
 *
 * NAMĚŘENO 2026-09-09 na RIQ Řidiči (build 12): `brand.tokens.json` nesl
 * `body bodySmall caption h1 h2 h3 label`; chyběly
 * `data dataHero dataMicro dataSmall ghost micro nano`. `BlockRenderer.tsx:783`
 * pak sáhl na `typography.dataMicro.fontSize` PŘI VYHODNOCOVÁNÍ MODULU, tedy
 * dřív, než se cokoli vykreslilo — celý proces spadl a záchytná síť to nechytla:
 *
 *     TypeError: Cannot read property 'fontSize' of undefined
 *     loadRoute → getQualifiedRouteComponent → SceneView
 *
 * Ve zdrojovém stromě přitom všech 14 klíčů JE. Rozdíl vzniká až tady, při
 * generování — proto to lokálně vypadalo v pořádku.
 *
 * ⭐ Merge NENÍ nový nápad: role písma se slučují o pár řádků níž
 * (`{ ...tokens.font, ...brand.font }`). Tahle sekce se jen slučovat zapomněla.
 *
 * Slučuje se PO SEKCÍCH, ne mělce: `{...floor, ...brand}` nad celým `mobile` by
 * značčinu `typography` pořád položil přes platformní jako celek.
 */
function slucSekce(floor = {}, znacka = {}) {
  const out = { ...floor };
  for (const [k, v] of Object.entries(znacka)) {
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && floor[k] && typeof floor[k] === "object" && !Array.isArray(floor[k])
        ? { ...floor[k], ...v }
        : v;
  }
  return out;
}

function buildMobileTheme(outFile) {
  const znacka = brand.mobile;
  if (!znacka) {
    throw new Error(
      `${BRAND_FILE} has no "mobile" section — a brand must supply the mobile ` +
        `surface values (colors/spacing/typography). See packages/design-tokens/tokens.json.`,
    );
  }
  const floor = tokens.mobile ?? {};
  const m = {
    ...znacka,
    colors: slucSekce(floor.colors, znacka.colors),
    spacing: slucSekce(floor.spacing, znacka.spacing),
    typography: slucSekce(floor.typography, znacka.typography),
  };

  /**
   * ⛔ ZDĚDĚNÉ MUSÍ BÝT VIDĚT. Sloučení vyměnilo hlasitý pád za tichý posun:
   * hubená značka teď mlčky převezme platformní hodnoty a appka může být
   * z části neobrandovaná, aniž si toho kdo všimne. Ticho je lepší než pád,
   * ale pořád je to ticho — proto se vypíše, CO se zdědilo, a totéž se zapíše
   * do hlavičky vygenerovaného souboru, kde to přečte i ten, kdo build neviděl.
   */
  const zdedeno = [];
  for (const sekce of ["colors", "spacing", "typography"]) {
    const zn = znacka[sekce] ?? {};
    for (const k of Object.keys(floor[sekce] ?? {})) {
      if (k.startsWith("$")) continue;
      if (!(k in zn)) zdedeno.push(`${sekce}.${k}`);
    }
  }
  if (zdedeno.length) {
    console.warn(
      `[design-tokens] značka nedeklaruje ${zdedeno.length} hodnot — DĚDÍ se z platformy:\n` +
        `  ${zdedeno.join(", ")}\n` +
        `  (appka nespadne, ale v těchto místech nenese značku instance)`,
    );
  }
  const brandName = brand.$meta?.name ?? "brand";

  // A brand may annotate its own colours ($colorNotes). These read as the reason a
  // value is what it is ("editorial near-black", "warm orange tint (was violet)") —
  // knowledge that would otherwise be lost the moment the file became generated.
  const notes = m.$colorNotes ?? {};
  // $colorSections annotates a GROUP: emitted as its own line before that key. These
  // carry decisions ("Severity scale … — kept"), not descriptions, so they survive.
  const sections = m.$colorSections ?? {};
  const width = Math.max(...Object.entries(m.colors).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`.length));
  const colorLines = Object.entries(m.colors).flatMap(([k, v]) => {
    const decl = `  ${k}: ${JSON.stringify(v)},`;
    const line = notes[k] ? `${decl.padEnd(width + 2)}// ${notes[k]}` : decl;
    return sections[k] ? [`  // ${sections[k]}`, line] : [line];
  });
  // `$`-prefix je v tomhle souboru konvence pro POZNÁMKU (`$meta`, `$note`,
  // `$fontNote`). Generátor ji dosud ctil jen na nejvyšší úrovni, takže poznámka
  // uvnitř sekce se vyložila jako role a shodila build. Konvence platí všude.
  const jePoznamka = ([k]) => k.startsWith("$");
  const spacingLines = Object.entries(m.spacing).filter((e) => !jePoznamka(e)).map(([k, v]) => `  ${k}: ${v},`);
  const typeLines = Object.entries(m.typography).filter((e) => !jePoznamka(e)).map(([k, t]) => {
    // `color` names a key of `colors` — resolved through the object so the two
    // can never disagree, and so a brand swap carries the typography with it.
    // An unknown name would emit `colors.undefined` and render transparent, so
    // it fails here rather than at runtime on someone's phone.
    if (!(t.color in m.colors)) {
      throw new Error(
        `${BRAND_FILE}: typography.${k}.color = "${t.color}" is not a key of mobile.colors ` +
          `(available: ${Object.keys(m.colors).join(", ")})`,
      );
    }
    // `font` je NEPOVINNÉ a odkazuje na roli z kořenového `font` (např. `mono`).
    // ⛔ Neznámá role se ODMÍTNE, nevynechá: tiché vynechání by vyrobilo roli,
    // která vypadá jako datová a sází se jako věta — tedy přesně tu vadu, kvůli
    // které se `font` přidával (naměřeno 2026-09-02: `font.mono` byl v brandu
    // deklarovaný, ale do mobilu se nedostal, protože ho tvar neuměl nést).
    let famDecl = "";
    if (t.font) {
      // ⛔ NEJDŘÍV brand, teprve pak platforma. `m` pochází z BRAND_FILE, který si
      // instance může dodat vlastní — kdyby se role hledala jen v platformních
      // tokenech, instance s vlastním `mono` by dostala cizí písmo a nikdo by si
      // toho nevšiml (obojí je monospace, jen jiné).
      const fam = brand.font?.[t.font] ?? tokens.font?.[t.font];
      if (!fam) {
        throw new Error(
          `${BRAND_FILE}: typography.${k}.font = "${t.font}" není role v kořenovém \`font\` ` +
            `(dostupné: ${Object.keys({ ...(tokens.font ?? {}), ...(brand.font ?? {}) }).join(", ")})`,
        );
      }
      famDecl = ` fontFamily: ${JSON.stringify(fam)},`;
    }
    return `  ${k}: { fontSize: ${t.fontSize}, fontWeight: "${t.fontWeight}" as const, color: colors.${t.color},${famDecl} },`;
  });

  // The brand this file was built from, repo-relative so the design-tokens gate can
  // regenerate and compare. A fork's brand file may live outside this repo (e.g.
  // tenant-design/brand/tenant.mobile-brand.json); the path is then simply unresolvable
  // here and the gate skips the regeneration check rather than pinning us to AISHA.
  const brandRel = relative(ROOT, resolve(BRAND_FILE)).split("\\").join("/");

  const out = [
    "/**",
    ` * Theme constants for the mobile surface — ${brandName}.`,
    " *",
    " * AUTO-GENERATED from a design-tokens brand file — do not edit.",
    " *   npm run gen:tokens                      (this stack's brand)",
    " *   node packages/design-tokens/build.mjs --brand <file> --out <path>",
    " *",
    ` * @brand ${brandRel}`,
    " *",
    " * The shape (colors/spacing/typography) is the contract this app's call sites",
    " * depend on; the values are the brand. Instances re-skin by supplying their own",
    " * brand file — the app is not forked.",
    " */",
    `export const colors = {`,
    ...colorLines,
    "} as const;",
    "",
    "export const spacing = {",
    ...spacingLines,
    "} as const;",
    "",
    "export const typography = {",
    ...typeLines,
    "} as const;",
    "",
  ].join("\n");

  // mobile-app is a SEPARATE metro workspace outside this repo's web/edge build
  // context — the web/edge image builds run this script but never COPY mobile-app/
  // in. Writing the mobile theme there ENOENTs the whole image build. The mobile
  // theme is only meaningful where the app is actually present, so skip LOUDLY
  // when the target dir is absent rather than failing a web/edge build.
  const outDir = dirname(outFile);
  if (!existsSync(outDir)) {
    console.warn(
      `[design-tokens] SKIP mobile theme (${outFile}): target dir absent — ` +
        `mobile-app is a separate workspace, not in this build context`,
    );
    return false;
  }

  writeFileSync(outFile, out, "utf-8");
}

// ---------------------------------------------------------------------------
// dist/vscode-colors.json — workbench.colorCustomizations (IDE chrome)
// ---------------------------------------------------------------------------
function buildVSCode() {
  const c = tokens.color;
  const colors = {
    "titleBar.activeBackground": c.bg0,
    "titleBar.activeForeground": "#E6E6E6",
    "activityBar.background": c.bg0,
    "activityBar.foreground": c.primary,
    "activityBarBadge.background": c.primary,
    "activityBarBadge.foreground": c.white,
    "statusBar.background": c.bg0,
    "statusBar.foreground": "#E6E6E6",
    "sideBar.background": c.bg1,
    "sideBarSectionHeader.background": c.bg0,
    "editorGroupHeader.tabsBackground": c.bg1,
    "tab.activeBorderTop": c.primary,
    "tab.activeBackground": c.bg0,
    "focusBorder": c.primary,
    "progressBar.background": c.primary,
    "button.background": c.primary,
    "button.foreground": c.white,
    "button.hoverBackground": c.primaryDark,
    "badge.background": c.primary,
    "badge.foreground": c.white,
    "list.highlightForeground": c.primary,
    "textLink.foreground": c.primary,
  };
  writeFileSync(
    join(DIST, "vscode-colors.json"),
    JSON.stringify({ "//": "AUTO-GENERATED — npm run gen:tokens", "workbench.colorCustomizations": colors }, null, 2) + "\n",
    "utf-8"
  );
}

// Default target is the app's own file: mobile-app sits outside the root workspace,
// so metro cannot import from dist/ — the theme has to LIVE there. It was written by
// hand until now, which is how it drifted (colours that never existed in tokens.json,
// and a docstring promising a generator that never wrote here).
const MOBILE_OUT = flag("--out", join(__dirname, "..", "..", "mobile-app", "src", "theme", "index.ts"));

// An instance building only its own skin wants the mobile theme and nothing else:
// the CSS/VS Code artifacts are this stack's internal surfaces, not theirs.
if (argv.includes("--mobile-only")) {
  buildMobileTheme(MOBILE_OUT);
  console.log(`[design-tokens] wrote ${MOBILE_OUT} from ${BRAND_FILE}`);
} else {
  buildCSS();
  buildTS();
  buildVSCode();
  // The mobile theme must LIVE in mobile-app/src/theme (metro cannot import from
  // dist/). But mobile-app/ is excluded from the web/service Docker build context
  // (.dockerignore), so its parent dir is absent there — writing it ENOENTs and
  // fails the WHOLE token build. Prod 2026-07-19: every aisha-core rebuild died
  // here, so Coolify kept serving a stale unhealthy container → api/ask 502.
  // Generate the mobile theme only when its target tree is part of THIS build
  // (CI and the mobile build have it); skip it silently otherwise.
  const wroteMobile = existsSync(dirname(MOBILE_OUT));
  if (wroteMobile) buildMobileTheme(MOBILE_OUT);
  console.log(
    "[design-tokens] wrote dist/aisha.css, dist/aisha-theme.ts, dist/vscode-colors.json" +
      (wroteMobile
        ? `, ${MOBILE_OUT.startsWith(DIST) ? "dist/mobile-theme.ts" : MOBILE_OUT}`
        : " (mobile theme skipped — mobile-app not in this build context)"),
  );
}
