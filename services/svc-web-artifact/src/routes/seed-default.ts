/**
 * POST /seed-default — bootstrap-time idempotent seed of the stack's public web
 * from a design folder, resolved by CONVENTION (folder name == domain):
 *
 *   1. explicit `source_dir` in the body ("default" → domains/default/, else
 *      domains/templates/<source_dir>/), else
 *   2. domains/templates/<AISHA_SEED_DOMAIN>/ when that folder has an index.html
 *      (the operator's public domain, e.g. "aisha.guru"), else
 *   3. domains/default/  (neutral fallback).
 *
 * The folder's manifest.json drives the page set (multi-page) + title/description
 * i18n keys. Each page runs through the same ingest chain operators use:
 *   upsert_web_page_admin → start_web_artifact_ingest → mark_processing →
 *   complete → apply_web_artifact_to_page (publish=true).
 *
 * Idempotent: a page whose web_pages row already has canvas_data is skipped
 * unless force=true. All pages skipped → 304.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SeedDefaultRequestSchema } from '../schemas.js';
import { rpcClient } from '../lib/rpcClient.js';
import { htmlToProjectData } from '../lib/htmlToProjectData.js';
import { config } from '../config.js';
import { verifyServiceRole, AuthError } from '../auth.js';

/** A single page to seed, resolved from the folder manifest. */
export interface SeedPage {
  slug: string;
  /** Relative path under the folder (e.g. "index.html" or "corp/index.html"). */
  html: string;
  titleKey: string;
  descriptionKey: string;
}

/**
 * Optional brand visuals for a multi-domain site. All optional — the marketing
 * canvas is self-styled via --sc-* tokens; the branding_profile mainly carries
 * identity + routing. Maps to seed_branding_site() arguments.
 */
export interface BrandVisuals {
  operatorName?: string;
  operatorEmail?: string;
  operatorUrl?: string;
  colorPrimary?: string;
  colorBackground?: string;
  colorSurface?: string;
  colorForeground?: string;
  darkColorBackground?: string;
  darkColorSurface?: string;
  darkColorForeground?: string;
  fontFamilyBrand?: string;
}

/**
 * One brand "site" within a multi-domain manifest: an inbound hostname routed
 * to its own branding_profile, with its own page set + translations. Materialised
 * via seed_branding_site() → web_pages.branding_profile_id + branding_hostname_mapping.
 */
export interface SeedSite {
  /** Inbound hostname, e.g. "corp.aisha.guru". Idempotency key for the brand. */
  domain: string;
  /** branding_hostname_mapping.brand_variant slug (^[a-z][a-z0-9_-]*$). */
  brandVariant: string;
  /** Default landing path for the hostname (NULL = platform default homepage). */
  landingPath?: string;
  /** Translation values file under the folder (flat key → {locale: value}). */
  i18nFile: string;
  /** Files concatenated into this site's canvas_css, in order. */
  cssFiles: string[];
  pages: SeedPage[];
  brand: BrandVisuals;
}

/** Concrete seed plan derived from a folder's manifest.json. */
export interface SeedPlan {
  /** Legacy single-site (global, branding_profile_id NULL) pages. Empty when sites[] is used. */
  pages: SeedPage[];
  /** Files concatenated into canvas_css, in order (default/shared). */
  cssFiles: string[];
  /**
   * Translation values file for the FOLDER (flat key → {locale: value}).
   *
   * ⭐ Patří sem, ne jen do `sites[]`. Naměřeno 2026-08-10 na nasazené instanci:
   * překlady se seedovaly VÝHRADNĚ ve větvi pro více domén, takže šablona
   * s jednoduchým manifestem (`{title_key, description_key, slug}`) dostala
   * stránku, ale texty NIKDY. Web pak trvale kreslil syrové klíče
   * (`WEB.<FORK>.HERO.HEADING` místo nadpisu) a seed k tomu hlásil
   * `ok: true, errors: []`.
   */
  i18nFile: string;
  /**
   * Multi-domain manifest: each entry seeds its own brand + hostname mapping +
   * brand-scoped pages + translations. When present, the route ignores top-level
   * `pages` and iterates `sites` instead.
   */
  sites?: SeedSite[];
}

/**
 * Sanitize an operator-supplied folder/domain name to a single safe path
 * segment. Returns null for anything that could escape the templates dir
 * (env-supplied, so MUST be guarded).
 */
export function sanitizeDomainSegment(name: string | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (!n || n.length > 255) return null;
  if (n.includes('/') || n.includes('\\') || n.includes('..')) return null;
  // domain-ish: alphanumerics + dot/hyphen only. Single-quantifier charset
  // regex (star height 1 → ReDoS-safe, satisfies security/detect-unsafe-regex);
  // start/end must be alphanumeric, checked with plain comparisons to avoid any
  // nested-quantifier pattern.
  if (!/^[a-z0-9.-]+$/.test(n)) return null;
  const isAlnum = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
  if (!isAlnum(n[0]) || !isAlnum(n[n.length - 1])) return null;
  return n;
}

/**
 * Parse a folder manifest.json into a concrete seed plan. Tolerant: a malformed
 * or absent manifest yields a single index page with the neutral default i18n
 * keys (i.e. the historical domains/default behaviour).
 */
export function parseSeedManifest(raw: string, fallbackSlug: string): SeedPlan {
  let m: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) m = parsed as Record<string, unknown>;
  } catch {
    m = {};
  }

  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const dTitle = str(m.title_key) ?? 'web.default.title';
  const dDesc = str(m.description_key) ?? 'web.default.description';

  // Allow one or more safe relative segments (e.g. "corp/index.html") so several
  // sites can coexist in one design repo, while still blocking traversal /
  // absolute / backslash / odd chars. readIfExists() additionally confines reads
  // to the folder root, so this is defence-in-depth, not the only guard.
  const isSafeRelativeFile = (file: string | undefined): file is string =>
    !!file &&
    !file.includes('..') &&
    !file.includes('\\') &&
    !file.startsWith('/') &&
    /^[A-Za-z0-9._/-]+$/.test(file);

  const safeHtml = (html: string | undefined, slug: string): string => {
    return isSafeRelativeFile(html) ? html : slug === 'index' ? 'index.html' : `${slug}.html`;
  };

  const parseCss = (raw: unknown, fallback: string[]): string[] => {
    const arr = Array.isArray(raw) ? (raw as unknown[]) : null;
    return arr ? arr.filter((c): c is string => typeof c === 'string' && isSafeRelativeFile(c)) : fallback;
  };

  const parsePages = (raw: unknown, pTitle: string, pDesc: string): SeedPage[] => {
    if (!Array.isArray(raw)) return [];
    const out: SeedPage[] = [];
    for (const pg of raw as Array<Record<string, unknown>>) {
      const slug = str(pg?.slug);
      if (!slug) continue;
      out.push({
        slug,
        html: safeHtml(str(pg.html), slug),
        titleKey: str(pg.title_key) ?? pTitle,
        descriptionKey: str(pg.description_key) ?? pDesc,
      });
    }
    return out;
  };

  const cssFiles = parseCss(m.shared_css, ['tokens.css', 'styles.css']);

  // Soubor s texty pro CELOU složku. `i18n.json` je konvence šablon (viz
  // domains/templates/README.md), manifest ji smí přepsat. Platí pro OBĚ větve
  // níž — texty nejsou vlastnost „více domén v jednom repu", ale složky.
  const mI18n = str(m.i18n);
  const i18nFile = isSafeRelativeFile(mI18n) && mI18n.endsWith('.json') ? mI18n : 'i18n.json';

  // Multi-domain manifest: each site seeds its own brand + hostname mapping +
  // brand-scoped pages + translations. Takes precedence over top-level pages[].
  if (Array.isArray(m.sites) && m.sites.length) {
    const sites: SeedSite[] = [];
    for (const s of m.sites as Array<Record<string, unknown>>) {
      const domain = sanitizeDomainSegment(str(s?.domain));
      if (!domain) continue;
      const brandVariant = (str(s.brand_variant) ?? domain.split('.')[0]).toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(brandVariant)) continue;
      const sTitle = str((s as Record<string, unknown>).title_key) ?? dTitle;
      const sDesc = str((s as Record<string, unknown>).description_key) ?? dDesc;
      const pages = parsePages(s.pages, sTitle, sDesc);
      if (!pages.length) continue;
      const i18nRaw = str(s.i18n);
      const i18nFile = isSafeRelativeFile(i18nRaw) && i18nRaw.endsWith('.json') ? i18nRaw : 'i18n.json';
      const b = (s.brand && typeof s.brand === 'object' ? (s.brand as Record<string, unknown>) : {}) as Record<string, unknown>;
      sites.push({
        domain,
        brandVariant,
        landingPath: str(s.landing_path),
        i18nFile,
        cssFiles: parseCss(s.shared_css, cssFiles),
        pages,
        brand: {
          operatorName: str(b.operator_name),
          operatorEmail: str(b.operator_email),
          operatorUrl: str(b.operator_url),
          colorPrimary: str(b.color_primary),
          colorBackground: str(b.color_background),
          colorSurface: str(b.color_surface),
          colorForeground: str(b.color_foreground),
          darkColorBackground: str(b.dark_color_background),
          darkColorSurface: str(b.dark_color_surface),
          darkColorForeground: str(b.dark_color_foreground),
          fontFamilyBrand: str(b.font_family_brand),
        },
      });
    }
    if (sites.length) return { pages: [], cssFiles, i18nFile, sites };
  }

  const pages = parsePages(m.pages, dTitle, dDesc);
  if (pages.length) return { pages, cssFiles, i18nFile };

  const slug = str(m.slug) ?? fallbackSlug;
  return { pages: [{ slug, html: safeHtml(undefined, slug), titleKey: dTitle, descriptionKey: dDesc }], cssFiles, i18nFile };
}

/**
 * Parse a design folder's i18n.json (flat `key → { locale: value }`) into the
 * row shape upsert_translations() consumes. Keys starting with `_` (e.g. `_note`)
 * are ignored; empty/non-string values are dropped. Pure + tolerant — a malformed
 * file yields zero rows rather than throwing.
 */
export function parseI18nRows(
  raw: string,
  namespace = 'web',
): Array<{ key: string; locale: string; value: string; namespace: string }> {
  if (!raw) return [];
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    obj = parsed as Record<string, unknown>;
  } catch {
    return [];
  }
  const rows: Array<{ key: string; locale: string; value: string; namespace: string }> = [];
  for (const [key, locales] of Object.entries(obj)) {
    if (key.startsWith('_')) continue;
    if (!locales || typeof locales !== 'object' || Array.isArray(locales)) continue;
    for (const [locale, value] of Object.entries(locales as Record<string, unknown>)) {
      if (typeof value === 'string' && value) rows.push({ key, locale, value, namespace });
    }
  }
  return rows;
}

/** Per-run page outcomes handed to summarizeSeedResult. */
export interface SeedResult {
  seeded: Array<{ slug: string; page_id: string; job_id: string }>;
  skipped: string[];
  errors: Array<{ slug: string; error: string }>;
}

/**
 * Map per-page outcomes to an HTTP status + body. Pure, so the status branching
 * (502 all-failed / 304 all-skipped / 200 otherwise) is unit-testable without a
 * live Fastify route + RPC chain.
 */
export function summarizeSeedResult(label: string, r: SeedResult): { status: number; body: Record<string, unknown> } {
  if (r.errors.length && !r.seeded.length && !r.skipped.length) {
    return { status: 502, body: { ok: false, source_dir: label, seeded: r.seeded, skipped: r.skipped, errors: r.errors } };
  }
  if (!r.seeded.length && !r.errors.length && r.skipped.length) {
    return { status: 304, body: { ok: true, seeded: false, source_dir: label, reason: 'already_seeded', skipped: r.skipped } };
  }
  return { status: 200, body: { ok: true, source_dir: label, seeded: r.seeded, skipped: r.skipped, errors: r.errors } };
}

/**
 * Read a file if it exists. Path MUST resolve under `expectedRoot` to defend
 * against traversal — belt-and-braces even though callers pre-join.
 */
async function readIfExists(p: string, expectedRoot: string): Promise<string> {
  const resolved = path.resolve(p);
  const resolvedRoot = path.resolve(expectedRoot);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error(`Refusing fs op outside ${resolvedRoot}: ${resolved}`);
  }
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path guarded above
    return await readFile(resolved, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

/**
 * Resolve the seed source folder by convention. Returns the absolute root and a
 * short label for logs/metadata. Falls back to domains/default when the
 * explicit/convention folder has no index.html.
 */
async function resolveSeedRoot(sourceDir: string | undefined): Promise<{ root: string; label: string }> {
  const defaultRoot = { root: path.resolve(config.domainsDir, 'default'), label: 'default' };

  const fromTemplate = async (name: string): Promise<{ root: string; label: string } | null> => {
    const root = path.resolve(config.domainsDir, 'templates', name);
    const idx = await readIfExists(path.join(root, 'index.html'), root);
    return idx ? { root, label: `templates/${name}` } : null;
  };

  // 1. explicit override
  if (sourceDir !== undefined) {
    if (sourceDir === 'default') return defaultRoot;
    const safe = sanitizeDomainSegment(sourceDir);
    if (safe) {
      const c = await fromTemplate(safe);
      if (c) return c;
    }
    return defaultRoot;
  }

  // 2. domain convention (folder name == operator's public domain)
  const domain = sanitizeDomainSegment(config.seedDomain);
  if (domain) {
    const c = await fromTemplate(domain);
    if (c) return c;
  }

  // 3. fallback
  return defaultRoot;
}

export async function seedDefaultRoutes(app: FastifyInstance): Promise<void> {
  app.post('/seed-default', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(err.statusCode);
        return { error: err.message };
      }
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    const parsed = SeedDefaultRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', issues: parsed.error.issues };
    }
    const { source_dir, target_slug, force } = parsed.data;

    const { root, label } = await resolveSeedRoot(source_dir);

    // Manifest + shared CSS from the resolved folder (traversal-guarded).
    const manifestRaw = await readIfExists(path.join(root, 'manifest.json'), root);
    const plan = parseSeedManifest(manifestRaw, target_slug);
    const cssParts = await Promise.all(plan.cssFiles.map((f) => readIfExists(path.join(root, f), root)));
    const css = cssParts.filter(Boolean).join('\n\n');

    // Default seed iterates inside the singleton stack-default story.
    // Identical mechanics as any operator/client story — uniform abstraction.
    let stackStoryId: string;
    try {
      stackStoryId = await rpcClient.ensureStackDefaultStory();
    } catch (err) {
      reply.code(502);
      return { error: 'ensure_stack_default_story_failed', detail: (err as Error).message };
    }

    const seeded: Array<{ slug: string; page_id: string; job_id: string }> = [];
    const skipped: string[] = [];
    /** Co se stalo s texty. Vlastní pole, protože stránka a text jsou dvě různé věci. */
    const translations: Array<{ file: string; domain?: string; rows: number; note?: string }> = [];
    const errors: Array<{ slug: string; error: string }> = [];

    /**
     * Seed one page through the same ingest chain operators use.
     * `brandingProfileId` scopes the row to a brand/site (multi-domain);
     * `hostname` selects the brand-scoped row for the idempotency check.
     */
    const seedOnePage = async (
      page: SeedPage,
      pageCss: string,
      brandingProfileId: string | undefined,
      hostname: string | undefined,
    ): Promise<void> => {
      // Per-page idempotency: skip pages already carrying canvas_data unless force.
      try {
        const existing = await rpcClient.getWebPageBySlug(page.slug, hostname);
        if (Array.isArray(existing) && existing.length && existing[0].canvas_data && !force) {
          skipped.push(page.slug);
          return;
        }
      } catch (err) {
        app.log.warn({ err: (err as Error).message, slug: page.slug }, 'seed-default: slug lookup failed, continuing');
      }

      const html = await readIfExists(path.join(root, page.html), root);
      if (!html) {
        errors.push({ slug: page.slug, error: `missing_html:${page.html}` });
        return;
      }

      const parsedDoc = htmlToProjectData({ html, css: pageCss });
      try {
        const pageId = await rpcClient.upsertDefaultWebPage({
          slug: page.slug,
          titleKey: page.titleKey,
          descriptionKey: page.descriptionKey,
          brandingProfileId,
        });
        const idempotencyKey = createHash('sha256')
          .update(`default_seed|${label}|${hostname ?? 'global'}|${page.slug}|${pageId}|${html.length}|${pageCss.length}`)
          .digest('hex');
        const jobId = await rpcClient.start({
          storyId: stackStoryId,
          kind: 'ingest_upload',
          sourceType: 'default_seed',
          idempotencyKey,
          metadata: {
            primary_html_path: `domains/${label}/${page.html}`,
            stack_default: true,
            source_dir: label,
            hostname: hostname ?? null,
          },
        });
        try {
          await rpcClient.markProcessing(jobId);
        } catch {
          // already processing — fine for idempotent re-run
        }
        try {
          await rpcClient.complete({
            jobId,
            canvasData: parsedDoc.canvas_data,
            canvasHtml: parsedDoc.canvas_html,
            canvasCss: parsedDoc.canvas_css,
            extractedTokens: parsedDoc.extracted_tokens,
            metadata: {
              runtime_block_suggestions: parsedDoc.runtime_block_suggestions,
              i18n_keys_used: parsedDoc.i18n_keys_used,
              source: 'default_seed',
            },
          });
        } catch (err) {
          app.log.warn({ err: (err as Error).message, slug: page.slug }, 'seed-default: complete failed (may already be completed)');
        }
        await rpcClient.apply({ jobId, pageId, publish: true });
        seeded.push({ slug: page.slug, page_id: pageId, job_id: jobId });
      } catch (err) {
        errors.push({ slug: page.slug, error: (err as Error).message });
      }
    };

    /**
     * Read + upsert a folder's translation rows (chunked).
     *
     * ⭐ Pád se NEPOLYKÁ. Do 2026-08-10 tu byl jen `app.log.warn(... 'continuing')`
     * a odpověď dál hlásila `errors: []` — kanál s výsledkem tedy nenesl
     * diagnostiku a „texty se nevložily" bylo k nerozeznání od „texty tam jsou".
     * Neúspěch NEBLOKUJE stránky (obsah je užitečný i bez překladu), ale MUSÍ být
     * v odpovědi vidět.
     */
    const seedTranslations = async (i18nFile: string, domain?: string): Promise<void> => {
      const raw = await readIfExists(path.join(root, i18nFile), root);
      const rows = parseI18nRows(raw, 'web');
      if (!rows.length) {
        // Prázdno je nález, ne ticho: šablona s `data-i18n-key` bez hodnot vykreslí
        // syrové klíče, a to na produkci nikdo nepozná od „tak to má být".
        translations.push({ file: i18nFile, domain, rows: 0, note: 'i18n soubor chybí nebo je prázdný' });
        return;
      }
      let vlozeno = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const davka = rows.slice(i, i + 500);
        try {
          await rpcClient.upsertTranslations(davka);
          vlozeno += davka.length;
        } catch (err) {
          const zprava = (err as Error).message;
          app.log.warn({ err: zprava, domain }, 'seed-default: translations upsert failed');
          errors.push({ slug: `i18n:${i18nFile}`, error: `translations_upsert_failed:${zprava}` });
        }
      }
      translations.push({ file: i18nFile, domain, rows: vlozeno });
    };

    if (plan.sites && plan.sites.length) {
      // Multi-domain: each site → its own brand + hostname mapping + brand-scoped
      // pages + translations. A brand-seed failure fails only that site's pages.
      for (const site of plan.sites) {
        let brandingProfileId: string;
        try {
          brandingProfileId = await rpcClient.seedBrandingSite({
            hostname: site.domain,
            brandVariant: site.brandVariant,
            landingPath: site.landingPath,
            operatorName: site.brand.operatorName,
            operatorEmail: site.brand.operatorEmail,
            operatorUrl: site.brand.operatorUrl,
            colorPrimary: site.brand.colorPrimary,
            colorBackground: site.brand.colorBackground,
            colorSurface: site.brand.colorSurface,
            colorForeground: site.brand.colorForeground,
            darkColorBackground: site.brand.darkColorBackground,
            darkColorSurface: site.brand.darkColorSurface,
            darkColorForeground: site.brand.darkColorForeground,
            fontFamilyBrand: site.brand.fontFamilyBrand,
          });
        } catch (err) {
          for (const page of site.pages) {
            errors.push({ slug: page.slug, error: `seed_branding_site_failed:${(err as Error).message}` });
          }
          continue;
        }
        await seedTranslations(site.i18nFile, site.domain);
        const siteCssParts = await Promise.all(site.cssFiles.map((f) => readIfExists(path.join(root, f), root)));
        const siteCss = siteCssParts.filter(Boolean).join('\n\n');
        for (const page of site.pages) {
          await seedOnePage(page, siteCss, brandingProfileId, site.domain);
        }
      }
    } else {
      // Legacy single-site: global pages (branding_profile_id NULL).
      //
      // ⭐ Texty se seedují PŘED stránkami a BEZ OHLEDU na to, jestli se stránky
      // přeskočí. Do 2026-08-10 se tenhle řádek volal jen ve větvi pro více domén,
      // takže šablona s jednoduchým manifestem měla stránku a nikdy texty — a co
      // hůř, jakmile stránka jednou existovala, seed skončil na 304 a texty se
      // nedoplnily UŽ NIKDY. Plátno se chrání před přepsáním schválně; text ne.
      await seedTranslations(plan.i18nFile, undefined);
      for (const page of plan.pages) {
        await seedOnePage(page, css, undefined, undefined);
      }
    }

    const { status, body } = summarizeSeedResult(label, { seeded, skipped, errors });
    // Texty jsou samostatný výsledek — u 304 je to JEDINÁ věc, která se stala.
    body.translations = translations;
    // 304 bodies are dropped by Fastify — log the skip diagnostic server-side.
    if (status === 304) {
      app.log.info({ source_dir: label, skipped }, 'seed-default: all pages already seeded (304)');
    }
    reply.code(status);
    return body;
  });
}
