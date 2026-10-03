import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Revize, ze které je tenhle artefakt postavený.
 *
 * ⛔ PROČ TO TU DOSUD NEBYLO A PROČ TO VADILO
 * `__GIT_SHA__` bylo DEKLAROVANÉ (`src/vite-env.d.ts`), ČETLO se
 * (`useBuildInfo.ts`) a UKAZOVALO se (`BuildSignature` ve `Footer.tsx`) —
 * jen ho nikdo nikdy nedefinoval. Celý řetěz byl hotový a chyběl mu jediný
 * článek.
 *
 * ⚠️ A protože se čte přes `typeof __GIT_SHA__ !== "undefined" ? … : ""`,
 * chybějící hodnota NEKŘIČELA: podpis se prostě nezobrazil. Naměřeno
 * 2026-08-09 na otázce „která revize je nasazená?" — nešlo odpovědět jinak
 * než porovnáváním otisků bundlu, tedy „něco se změnilo" místo „je tam X".
 *
 * Hodnota se BERE, nevymýšlí: `GIT_SHA` posílá CI, `SOURCE_COMMIT` dodává
 * Coolify při buildu obrazu (viz scripts/coolify-deploy-init.sh). Když není
 * ani jedno, zůstává prázdno — je to lokální build a lhát o revizi by bylo
 * horší než ji neuvést.
 */
const REVIZE = process.env.GIT_SHA ?? process.env.SOURCE_COMMIT ?? "";

// ─── Brand SEO/OG placeholder defaults ────────────────────────────────────
//
// index.html ships with `%VITE_PUBLIC_BRAND_*%` placeholders for all
// crawler-visible identity (title, meta description, og:*, twitter:*,
// theme-color, html lang). Vite's built-in HTML env substitution
// (`loadEnv()` → replace `%FOO%` with `import.meta.env.FOO`) only fires
// when a matching VITE_-prefixed env var is set; if missing, the literal
// placeholder ships to production — visible to crawlers and share-card
// preview engines as raw template text.
//
// Defaults nesou identitu SAMOTNÉ PLATFORMY (build, který zdědí
// nenakonfigurovaný fork). Instance přepíše tytéž klíče ve svém
// .env.coolify a zapeče si vlastní identitu do HTML už při buildu.
//
// Why this lives in the build config rather than in .env / .env.example:
//   - .env is gitignored (per repo .gitignore line `.env`), so a default
//     committed there would never reach a CI/Coolify build context.
//   - .env.example is documentation, not loaded by Vite at build time.
//   - Hardcoding the defaults here (next to the plugin that uses them)
//     keeps the override contract explicit and TypeScript-checkable.
//
// Per-hostname SEO (dvě značky na témže jediném buildu) NENÍ tímhle
// pluginem vyřešené — it requires SSR or
// an edge worker rewriting HTML per Host header. The umbrella brand is
// the build-time default for the deployment; a secondary brand variant
// inherits the umbrella SEO until per-host rendering lands. The runtime
// useDocumentTitle hook + BrandContext keep the title in sync once the
// SPA mounts, so JS-enabled visitors see brand-correct titles per route.

const BRAND_PLACEHOLDER_DEFAULTS = {
  VITE_PUBLIC_BRAND_LANG: "en",
  VITE_PUBLIC_BRAND_TITLE: "AISHA Dirigent by Evymo — AI-powered software delivery platform",
  VITE_PUBLIC_BRAND_DESCRIPTION:
    "AISHA Dirigent is an AI-powered software delivery platform by Evymo. It connects clients who need tailored software with verified specialists, turning one expert into a full delivery team through AI orchestration, workflow engines, and a shared knowledge base.",
  VITE_PUBLIC_BRAND_AUTHOR: "Evymo s.r.o.",
  VITE_PUBLIC_BRAND_THEME_COLOR: "#0f1b2d",
  // ⛔ BARVA PRVNÍHO VYKRESLENÍ (přidáno 2026-08-30).
  // Načítací spinner (`PageLoader`, `text-primary`) i všechny bloky se
  // spinnerem berou `--primary` z src/index.css:19 — platformní oranžové
  // `20 100% 55%`. Instanční barvu vkládá BrandingThemeProvider až
  // v useEffect PO doběhnutí RPC `get_branding_for_hostname`, takže
  // návštěvník sanghy viděl oranžové načítání a teprve pak modrý web.
  // Tenhle placeholder je jediný build-time kanál, kterým se barva dostane
  // do PRVNÍHO paintu — runtime cesta je ze své podstaty pozdě.
  // Formát je BARE HSL trojice (bez `hsl()`), protože tak ji šablona
  // dosazuje do `hsl(var(--primary))`; hex by se tiše rozbil.
  // Výchozí hodnota = platformní oranžová, aby čistý `git clone && build`
  // reprodukoval upstream vzhled.
  VITE_PUBLIC_BRAND_PRIMARY: "20 100% 55%",
  VITE_PUBLIC_BRAND_OG_LOCALE: "en_US",
  VITE_PUBLIC_BRAND_OG_SITE_NAME: "AISHA Dirigent by Evymo",
  VITE_PUBLIC_BRAND_OG_DESCRIPTION:
    "AISHA Dirigent is an AI-powered software delivery platform by Evymo. It connects clients who need tailored software with verified specialists, turning one expert into a full delivery team.",
  // Bez výchozího obrázku: odkaz na cizí CDN by každý fork, který si ho
  // nepřepíše, sdílel jako svůj — a ta adresa nám nepatří. Instance dodá
  // vlastní přes VITE_PUBLIC_BRAND_OG_IMAGE.
  VITE_PUBLIC_BRAND_OG_IMAGE: "",
} as const satisfies Record<`VITE_PUBLIC_BRAND_${string}`, string>;

/**
 * Vite plugin: fill in `%VITE_PUBLIC_BRAND_*%` literals in index.html
 * with overrides from `process.env` (Coolify build context) first, then
 * the defaults above. Runs after Vite's built-in HTML env substitution,
 * so any placeholder Vite couldn't resolve is caught here.
 *
 * Why a custom plugin instead of just relying on Vite's built-in `%FOO%`
 * substitution: Vite's substitution silently leaves unset variables as
 * literal `%FOO%` strings in the output. For SEO/social-card-critical
 * content that's a regression vector — a deploy that forgets to set
 * one variable ships a `<title>%VITE_PUBLIC_BRAND_TITLE%</title>` to
 * production. Forcing a default at this layer means the worst case is
 * "shows upstream Evymo identity," which is correct + recoverable.
 */
const brandPlaceholderPlugin = (): Plugin => ({
  name: "aisha-brand-placeholder-defaults",
  // ⛔ OTOČENO NA `pre` (2026-08-25). Stálo tu `post` s odůvodněním, že „tak sem
  // dorazí jen placeholdery, které Vite nedokázalo rozřešit". Ten předpoklad
  // platí jen pro NEDEFINOVANOU proměnnou. Definovaná-a-prázdná se rozřeší —
  // na prázdný řetězec — a placeholder tím zmizí dřív, než ho tahle pojistka
  // uvidí.
  //
  // Naměřeno na živém webu: Dockerfile.web předává všech devět brand proměnných
  // jako `${VAR:-}`, takže jsou definované a prázdné. Výsledek na produkci:
  //     <html lang=""> <title></title> <meta name="description" content="">
  //     <meta property="og:site_name" content="">
  // — tedy prázdná záložka prohlížeče, žádné SEO a prázdný náhled při sdílení.
  // Log buildu u toho hlásil, že fallback proběhl. Neproběhl.
  //
  // Tenhle plugin má být JEDINÝ, kdo brand placeholdery vyplňuje: prázdná
  // hodnota se chová jako nedeklarovaná (`fromEnv.length > 0`), takže se použije
  // default a vestavěná substituce už nemá co potkat.
  //
  // ⛔ ŘAZENÍ PATŘÍ NA HOOK, NE NA PLUGIN (naměřeno 2026-08-25). První pokus
  // otočil `enforce: "post"` → `"pre"` a NEPOMOHLO: `enforce` řadí plugin
  // pipeline, ale `transformIndexHtml` má vlastní pořadí přes `order` na hooku.
  // Ověřeno reprodukcí na minimálním projektu (vite 7) s proměnnými
  // DEFINOVANÝMI A PRÁZDNÝMI, přesně jak je předává Dockerfile.web:
  //     enforce: "pre"                        → <title></title>
  //     transformIndexHtml: { order: "pre" }  → <title>DEFAULT-TITULEK</title>
  transformIndexHtml: {
    order: "pre" as const,
    handler(html: string) {
    return html.replace(/%(VITE_PUBLIC_BRAND_[A-Z0-9_]+)%/g, (literal, key: string) => {
      const fromEnv = process.env[key];
      if (typeof fromEnv === "string" && fromEnv.length > 0) {
        return fromEnv;
      }
      const fallback = (BRAND_PLACEHOLDER_DEFAULTS as Record<string, string>)[key];
      if (typeof fallback === "string") {
        return fallback;
      }
        // Unknown key — leave the literal so it's caught in QA rather than
        // silently shipping an empty string. Crawlers seeing `%FOO%` is a
        // louder signal than a blank meta tag.
        return literal;
      });
    },
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __GIT_SHA__: JSON.stringify(REVIZE),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    watch: {
      ignored: [
        "**/.claude/**",
        "**/archive/**",
        "**/openxpki-config/**",
        "**/playwright-report/**",
        "**/test-results/**",
        "**/trash/**",
        "**/workbench/**",
      ],
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, // 8 MiB — shared chunk ~5 MB
      },
    }),
    // Brand SEO/OG placeholder fallback — see plugin definition + the
    // BRAND_PLACEHOLDER_DEFAULTS map above index.html for full rationale.
    // Listed last so it runs AFTER Vite's built-in HTML env substitution.
    brandPlaceholderPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@aisha/api-core": path.resolve(__dirname, "./packages/api-core/src/index.ts"),
      "@aisha/flowboard-core": path.resolve(__dirname, "./packages/flowboard-core/src/index.ts"),
      "@aisha/capture-ui": path.resolve(__dirname, "./packages/capture-ui/src/index.ts"),
        // ⛔ ALIAS NENÍ POHODLÍ, JE TO PODMÍNKA STAVBY. `npm ci` běží v obrazu
        // DŘÍV, než se nakopíruje `packages/`, takže symlink
        // `node_modules/@aisha/web-canvas` v Dockeru NEVZNIKNE — lokálně ano,
        // a proto build prošel na stroji a spadl v nasazení na
        // „Rollup failed to resolve import". Alias míří na ZDROJ, stejně jako
        // u tří sourozenců výš, takže rozlišení nezávisí na node_modules.
        "@aisha/web-canvas": path.resolve(__dirname, "./packages/web-canvas/src/index.ts"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    modulePreload: {
      // Exclude heavy vendor-flow chunk from inline preloading
      resolveDependencies: (
        _filename: string,
        deps: string[],
      ) => {
        return deps.filter(
          (dep) => !dep.includes("vendor-flow"),
        );
      },
    },
    rollupOptions: {
      output: {
        experimentalMinChunkSize: 0,
        manualChunks(id: string) {
          const normalizedId = id.replace(/\\/g, "/");

          // ── Virtual modules & CJS helpers → vendor ────────────────
          if (
            normalizedId.includes("\u0000") ||
            normalizedId.includes("commonjsHelpers")
          ) {
            return "vendor";
          }

          // ── Vendor isolation ──────────────────────────────────────

          // @xyflow + zustand — co-located to avoid cross-chunk cycles
          if (
            normalizedId.includes("@xyflow") ||
            normalizedId.includes("zustand")
          ) {
            return "vendor-flow";
          }

          // ── Těžké knihovny, které veřejný web nepotřebuje ────────
          //
          // Naměřeno 2026-08-30: `vendor` měl 3,76 MB a stahoval ho i
          // anonymní návštěvník landing page. GrapesJS je potřeba jen
          // v editoru (storyloop-area, admin-area), pdf.js + pdf-lib jen
          // v archivu (archive-area). Oba směry ověřeny: vendor z nich
          // neimportuje, takže hrana je jednosměrná a cyklus nevzniká.
          if (
            normalizedId.includes("/grapesjs/") ||
            normalizedId.includes("/@grapesjs/")
          ) {
            return "vendor-editor";
          }
          if (
            normalizedId.includes("/pdfjs-dist/") ||
            normalizedId.includes("/react-pdf/") ||
            normalizedId.includes("/pdf-lib/")
          ) {
            return "vendor-pdf";
          }

          // recharts + d3 → base vendor (co-located with React).
          // recharts depends on d3 modules; keeping them in separate
          // chunks (vendor vs vendor-d3) creates a vendor ↔ vendor-d3
          // cycle that triggers TDZ. Merging d3 into vendor adds only
          // ~105 KB uncompressed (~34 KB gzip) and eliminates the cycle.
          if (
            normalizedId.includes("recharts") ||
            normalizedId.includes("d3-")
          ) {
            return "vendor";
          }

          // Backend SDK compatibility packages and React core → base vendor
          if (
            normalizedId.includes("@supabase") ||
            normalizedId.includes("/react/") ||
            normalizedId.includes("/react-dom/")
          ) {
            return "vendor";
          }

          // Remaining node_modules → vendor
          if (normalizedId.includes("node_modules")) {
            return "vendor";
          }

          // ── Překlady: NECHAT ROLLUPU ─────────────────────────────
          //
          // ⛔ NAMĚŘENO 2026-08-30: `shared` chunk měl 5,26 MB a 4,5 MB z toho
          // byly PŘEKLADY — všech šest jazyků (en/cs/de/fr/ru/th, každý
          // 0,6–1,1 MB), které stahoval i návštěvník, jenž jich potřebuje JEDEN.
          //
          // Přitom `src/i18n/index.ts:15-20` je importuje správně dynamicky
          // (`en: () => import('./locales/en.json')`). Jenže manualChunks
          // přiřazuje modul do chunku BEZ OHLEDU na to, jestli je hrana
          // statická nebo dynamická — catch-all `/src/` níže je tedy všechny
          // vtáhl do `shared` a udělal z lazy načítání eager balík.
          //
          // `undefined` = „nech rozhodnout Rollup", který dynamický import
          // umí vydat jako samostatný chunk. Aktivní jazyk se pak stáhne sám.
          if (normalizedId.includes("/src/i18n/locales/")) return undefined;
          if (normalizedId.includes("/src/i18n/segments/")) return undefined;

          // ── Application chunks ────────────────────────────────────

          // ── Area-specific chunks (components + pages) ─────────────
          //
          // ⛔ NOVÝ CHUNK SMÍ VZNIKNOUT JEN JAKO UZAVŘENÁ MNOŽINA.
          // Invariant níže („shared nikdy neimportuje z area chunků")
          // je to jediné, co drží graf bez cyklů. Před přidáním výjimky
          // se MĚŘÍ, kdo do adresáře importuje ZVENČÍ — když je mezi nimi
          // cokoli, co spadne do `shared`, vznikne shared ↔ chunk cyklus
          // a s ním TDZ pád (viz historie v komentáři u `shared` níže).
          //
          // Naměřeno 2026-08-30, importy zvenčí (mimo testy):
          //   storyloop → pages/member/, pages/partner/     → jiné chunky, OK
          //   flowboard → pages/admin/                      → admin-area, OK
          //   archive   → pages/Archive*.tsx                → proto jsou pages
          //                                                   ve stejném chunku
          //   chat      → components/layout/RootLayout.tsx  → proto je import
          //                                                   v RootLayoutu lazy
          // Opačný směr ověřen taky: archive→storyloop 0, chat→ostatní 0.
          // storyloop má jeden import do admin/ (RuntimeBlockSuggestionsReview) —
          // jednosměrný, admin z storyloop neimportuje, cyklus tedy nevzniká.
          //
          // Důvod, proč to vůbec dělíme: veřejný návštěvník stahoval
          // 9,2 MB rozbaleného JS včetně GrapesJS editoru (storyloop),
          // react-pdf + pdf-lib (archive) a celého chatu.
          if (normalizedId.includes("/src/components/storyloop/")) return "storyloop-area";
          if (normalizedId.includes("/src/components/flowboard/")) return "flowboard-area";
          if (normalizedId.includes("/src/components/chat/")) return "chat-area";
          if (normalizedId.includes("/src/components/archive/")) return "archive-area";
          // ⛔ DocumentRedactor leží v components/common/, ale staticky importuje
          // react-pdf + pdf-lib. Převedení jeho importu na lazy (v
          // DocumentUploadZone) přesunulo HRANU, ne MODUL — manualChunks
          // přiřazuje podle CESTY, takže modul dál padal do `shared` a jeho
          // statický pdf import se stal statickým importem shared. Chunk se
          // tím pádem načítal eagerně dál. Naměřeno 2026-08-30: vendor-pdf
          // (647 kB) zmizel z eager sady teprve po TÉHLE řádce.
          // Táž past jako u překladů níže: lazy hranice v kódu sama o sobě
          // nestačí, dokud modul zůstane přiřazený do eager chunku.
          if (normalizedId.includes("/src/components/common/DocumentRedactor")) return "archive-area";
          if (normalizedId.includes("/src/pages/Archive")) return "archive-area";
          if (normalizedId.includes("/src/components/production/")) return "admin-production";
          if (normalizedId.includes("/src/components/admin/")) return "admin-area";
          if (normalizedId.includes("/src/pages/admin/")) return "admin-area";
          if (normalizedId.includes("/src/components/partner/")) return "partner-area";
          if (normalizedId.includes("/src/pages/partner/")) return "partner-area";
          if (normalizedId.includes("/src/components/member/")) return "member-area";
          if (normalizedId.includes("/src/pages/member/")) return "member-area";
          // Top-level Member* pages also belong in member-area
          if (normalizedId.includes("/src/pages/Member")) return "member-area";

          // ── Shared foundation (everything else in src/) ───────────
          // All hooks, lib, integrations, schemas, config, UI components,
          // common/layout/gamification components, i18n, pages (landing,
          // auth, etc.) go into `shared`.
          //
          // Barrel: hooks/index.ts is intentionally NOT assigned to a
          // separate chunk — it re-exports from all sub-hooks via live
          // bindings (export { X } from './Y'), which are TDZ-safe.
          //
          // This is the ONLY way to guarantee zero circular chunk deps.
          // The shared chunk never imports from area chunks because
          // nothing in hooks/lib/integrations/ui/common imports from
          // src/components/{admin,member,partner,production}/.
          //
          // Previous approach (cherry-picking individual files into
          // shared) left foundational modules (cn, useAuth, safeLogger,
          // recharts, etc.) in area chunks, creating TDZ-fatal cycles:
          //   shared ↔ admin-area, shared ↔ admin-production,
          //   shared ↔ member-area, ui ↔ admin-production
          if (normalizedId.includes("/src/")) return "shared";
        },
      },
    },
  },
}));
