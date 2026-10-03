/**
 * Gate: self-contained web-template i18n integrity.
 *
 * The demo design templates under `domains/templates/<name>/` are ingested by
 * the REAL web-artifact pipeline (svc-web-artifact `export-web-seed` /
 * `/seed-default`): `manifest.json` → pages + css, `index.html` → canvas +
 * `data-i18n-key` references, `i18n.json` → DB `translations` rows. Because the
 * binding is through the DB (translations.key × locale), a template only renders
 * correctly in every language if EVERY referenced key resolves to a value in
 * EVERY supported locale. Nothing else enforces that at build time.
 *
 * This gate is that enforcement. For each self-contained template (a folder that
 * ships its own `i18n.json`) it asserts, using the SAME extraction rules as the
 * live parser (`extractI18nKeys` = text + safe attribute i18n values; `collectBrokenAssets`
 * = relative media `src`):
 *   1. the convention files exist (tokens.css, styles.css, the page html);
 *   2. every referenced key (manifest title/description + every data-i18n-key)
 *      has an `i18n.json` value for ALL SUPPORTED_LOCALES, none empty;
 *   3. no orphan keys (every i18n.json key is actually referenced) — no drift;
 *   4. no broken assets (no <img/source/video/audio> with a relative src that
 *      the seed pipeline could not resolve).
 *
 * SUPPORTED_LOCALES is imported from the i18n SoT lib so this gate can never
 * drift from the platform's locale set.
 *
 * @module
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_LOCALES } from "../../../scripts/i18n/lib/content-translations.mjs";

const ROOT = join(__dirname, "../../..");
const TEMPLATES_DIR = join(ROOT, "domains/templates");

/**
 * Je šablona připojená jako git submodul?
 *
 * OSS demo šablony jsou obyčejné adresáře ve stromu; instanční web forku se
 * připojuje submodulem. Rozdíl je strukturální a čitelný z `.gitmodules`, takže
 * se dá použít jako rozlišovač, aniž by ve stromu stálo jméno instance (to
 * zakazuje brána `stack-nesmi-znat-jmeno-instance`).
 */
function isSubmoduleTemplate(name: string): boolean {
  const gitmodules = join(ROOT, ".gitmodules");
  if (!existsSync(gitmodules)) return false;
  return new RegExp(`^\\s*path\\s*=\\s*domains/templates/${name}\\s*$`, "m").test(
    readFileSync(gitmodules, "utf-8"),
  );
}

/** The committed demo templates. Removing one is a deliberate spec change — it
 *  must update this floor, so the gate can never silently pass on an empty set. */
const REQUIRED_TEMPLATES = [
  "garden-blog",
  "legal-advisory",
  "farm-shop",
  "cafe-shop",
  "company-wiki",
  "electrician-trade",
  "site-supervision",
];

const LOCALES: string[] = SUPPORTED_LOCALES;

interface Page {
  html: string;
  titleKey: string;
  descriptionKey: string;
}
interface Plan {
  pages: Page[];
  cssFiles: string[];
}

/** Minimal, dependency-free mirror of svc-web-artifact `parseSeedManifest`. */
function parseManifest(raw: string, fallbackSlug: string): Plan {
  let m: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) m = parsed as Record<string, unknown>;
  } catch {
    m = {};
  }
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  const dTitle = str(m.title_key) ?? "web.default.title";
  const dDesc = str(m.description_key) ?? "web.default.description";
  const safeHtml = (html: string | undefined, slug: string): string =>
    html && !html.includes("..") && !html.includes("/") && !html.includes("\\")
      ? html
      : slug === "index"
        ? "index.html"
        : `${slug}.html`;
  const cssRaw = Array.isArray(m.shared_css) ? (m.shared_css as unknown[]) : null;
  const cssFiles = cssRaw
    ? cssRaw.filter((c): c is string => typeof c === "string" && !c.includes("..") && !c.includes("/"))
    : ["tokens.css", "styles.css"];
  if (Array.isArray(m.pages) && m.pages.length) {
    const pages: Page[] = [];
    for (const pg of m.pages as Array<Record<string, unknown>>) {
      const slug = str(pg?.slug);
      if (!slug) continue;
      pages.push({
        html: safeHtml(str(pg.html), slug),
        titleKey: str(pg.title_key) ?? dTitle,
        descriptionKey: str(pg.description_key) ?? dDesc,
      });
    }
    if (pages.length) return { pages, cssFiles };
  }
  const slug = str(m.slug) ?? fallbackSlug;
  return { pages: [{ html: safeHtml(undefined, slug), titleKey: dTitle, descriptionKey: dDesc }], cssFiles };
}

const I18N_KEY_ATTR_REGEX =
  /\b(?:data-i18n-key|data-i18n|data-i18n-placeholder-key|data-i18n-title-key|data-i18n-aria-label-key|data-i18n-alt-key)=["']([^"']+)["']/g;

/** Mirror of `extractI18nKeys`: every distinct text/attribute i18n key value. */
function extractI18nKeys(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(I18N_KEY_ATTR_REGEX)) out.add(m[1].trim());
  return out;
}

/** Mirror of `collectBrokenAssets`: media elements whose src the seed pipeline
 *  cannot resolve (relative, i.e. not http(s):// and not a data: URI). */
function brokenAssets(html: string): string[] {
  const broken: string[] = [];
  for (const m of html.matchAll(/<(?:img|source|video|audio)\b[^>]*?\ssrc=["']([^"']+)["']/gi)) {
    const src = m[1];
    if (!/^https?:\/\//i.test(src) && !/^data:/i.test(src)) broken.push(src);
  }
  return broken;
}

function discoverTemplates(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(TEMPLATES_DIR, d.name, "i18n.json")))
    .map((d) => d.name)
    .sort();
}

const templates = discoverTemplates();

describe("web-template i18n integrity gate", () => {
  it("uses the canonical 6-locale set from the i18n SoT", () => {
    expect([...LOCALES].sort()).toEqual(["cs", "de", "en", "fr", "ru", "th"]);
  });

  it("discovers every committed demo template (no silent-empty)", () => {
    for (const name of REQUIRED_TEMPLATES) {
      expect(templates, `missing self-contained template "${name}" (needs i18n.json)`).toContain(name);
    }
  });

  describe.each(templates)("template: %s", (name) => {
    const dir = join(TEMPLATES_DIR, name);
    const plan = parseManifest(readFileSync(join(dir, "manifest.json"), "utf-8"), name === "default" ? "index" : "index");
    const i18n = JSON.parse(readFileSync(join(dir, "i18n.json"), "utf-8")) as Record<string, unknown>;
    const i18nKeys = Object.keys(i18n).filter((k) => !k.startsWith("_") && !k.startsWith("$"));

    // referenced keys = manifest title/description + every data-i18n-key in every page
    const referenced = new Set<string>();
    for (const pg of plan.pages) {
      referenced.add(pg.titleKey);
      referenced.add(pg.descriptionKey);
      const html = existsSync(join(dir, pg.html)) ? readFileSync(join(dir, pg.html), "utf-8") : "";
      for (const k of extractI18nKeys(html)) referenced.add(k);
    }

    it("ships the convention files (css + page html)", () => {
      for (const css of plan.cssFiles) {
        expect(existsSync(join(dir, css)), `${name}: missing ${css}`).toBe(true);
      }
      for (const pg of plan.pages) {
        expect(existsSync(join(dir, pg.html)), `${name}: missing page ${pg.html}`).toBe(true);
      }
    });

    it("resolves every referenced key in all locales (no missing)", () => {
      const problems: string[] = [];
      for (const key of [...referenced].sort()) {
        const entry = i18n[key];
        if (!entry || typeof entry !== "object") {
          problems.push(`${key}: absent from i18n.json`);
          continue;
        }
        const vals = entry as Record<string, unknown>;
        for (const loc of LOCALES) {
          const v = vals[loc];
          if (typeof v !== "string" || !v.trim()) problems.push(`${key}.${loc}: missing/empty`);
        }
      }
      expect(problems, `${name} translation gaps:\n  ${problems.join("\n  ")}`).toEqual([]);
    });

    // Sirotky se měří JEN u self-contained OSS šablon (obyčejný adresář v repu).
    //
    // ⛔ NAMĚŘENO 2026-09-01: šablona připojená jako SUBMODUL je instanční web
    // forku, ne demo. Její `i18n.json` obsluhuje i stránky, které nežijí tady —
    // u <fork> je 183 „sirotků" beze zbytku referencováno seedy `web_pages`
    // v privátním instance-data repu (změřeno: 183/183, nula skutečně mrtvých).
    // Trvat tu na self-containmentu by znamenalo buď smazat živý obsah 12
    // stránek, nebo do `index.html` dopsat falešné reference. Kontrola
    // CHYBĚJÍCÍCH klíčů výše platí dál i pro submoduly — ta je smysluplná vždy.
    //
    // Rozlišuje se STRUKTUROU (je to submodul?), ne jménem — žádné tenant jméno
    // se do stromu nedostane a upstream se chová beze změny: jeho šablony
    // submoduly nejsou, takže se u nich sirotci měří jako dosud.
    it.skipIf(isSubmoduleTemplate(name))("has no orphan i18n keys (every key is referenced)", () => {
      const orphans = i18nKeys.filter((k) => !referenced.has(k));
      expect(orphans, `${name}: i18n.json keys never referenced by the html/manifest`).toEqual([]);
    });

    it("has no broken (unresolvable relative) media assets", () => {
      const broken: string[] = [];
      for (const pg of plan.pages) {
        const html = existsSync(join(dir, pg.html)) ? readFileSync(join(dir, pg.html), "utf-8") : "";
        broken.push(...brokenAssets(html));
      }
      expect(broken, `${name}: media <img/source/video/audio> with a relative src the seed can't resolve`).toEqual([]);
    });
  });
});
