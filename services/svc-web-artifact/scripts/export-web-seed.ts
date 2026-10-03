/**
 * export-web-seed — ingest a design folder through the REAL web-artifact
 * pipeline (htmlToProjectData) and emit an idempotent instance seed `.sql`:
 * faithful brand-scoped `web_pages` canvas rows + the delta `translations` rows.
 *
 * This is how an operator's presentation (e.g. the gitignored
 * domains/templates/aisha.guru/) is delivered DB-only — deployable from zero by
 * loading the generated seed, with nothing brand-specific in the committed tree.
 * It dogfoods the same parser the live ingest uses, so canvas_data is identical
 * to what /seed-default would produce.
 *
 * Requires Node 22 + the service deps (jsdom, isomorphic-dompurify). Run:
 *   npm --prefix services/svc-web-artifact install
 *   npm --prefix services/svc-web-artifact run export-web-seed -- <design-folder> [out.sql]
 *
 * Apply the result:
 *   psql "$AISHA_DB_URL" -v ON_ERROR_STOP=1 -f <out.sql>
 *
 * Translation values come from an optional `<folder>/i18n.json`:
 *   { "web.aisha.title": { "en": "…", "cs": "…", … }, … }
 * Referenced keys without a value are reported (and left for the operator).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { htmlToProjectData } from '../src/lib/htmlToProjectData.js';
import { parseI18nRows, parseSeedManifest, type SeedPage, type SeedSite } from '../src/routes/seed-default.js';

const NAMESPACE = 'web';

async function readIf(p: string): Promise<string> {
  try {
    return await readFile(p, 'utf-8');
  } catch {
    return '';
  }
}

/** Postgres dollar-quote a blob, picking a tag the content can't contain. */
function dollar(s: string): string {
  let tag = 'wp';
  while (s.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${s}$${tag}$`;
}

/** Single-quoted SQL literal for short strings (slugs, keys, locales). */
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function nullableSqlStr(s: string | undefined | null): string {
  return s && s.trim() ? sqlStr(s) : 'NULL';
}

function webPageUpsert(
  page: SeedPage,
  canvasData: unknown,
  html: string,
  css: string,
  brandingProfileSql: string | null,
): string {
  const brandingValue = brandingProfileSql ?? 'NULL';
  const conflict = brandingProfileSql
    ? 'ON CONFLICT (branding_profile_id, slug) WHERE branding_profile_id IS NOT NULL DO UPDATE SET'
    : 'ON CONFLICT (slug) WHERE branding_profile_id IS NULL DO UPDATE SET';
  return [
    // page_settings is intentionally omitted — its NOT NULL DEFAULT '{}'::jsonb
    // supplies the same value, so the seed still applies on a stack whose
    // page_settings-adding migration hasn't run yet.
    `INSERT INTO public.web_pages (slug, title_key, description_key, canvas_data, canvas_html, canvas_css, status, is_active, branding_profile_id)`,
    `VALUES (${sqlStr(page.slug)}, ${sqlStr(page.titleKey)}, ${sqlStr(page.descriptionKey)}, ${dollar(JSON.stringify(canvasData))}::jsonb, ${dollar(html)}, ${dollar(css)}, 'published', true, ${brandingValue})`,
    conflict,
    `  title_key = EXCLUDED.title_key,`,
    `  description_key = EXCLUDED.description_key,`,
    `  canvas_data = EXCLUDED.canvas_data,`,
    `  canvas_html = EXCLUDED.canvas_html,`,
    `  canvas_css = EXCLUDED.canvas_css,`,
    `  status = EXCLUDED.status,`,
    `  is_active = EXCLUDED.is_active,`,
    `  branding_profile_id = EXCLUDED.branding_profile_id,`,
    `  updated_at = now();`,
  ].join('\n');
}

function brandingSiteUpsert(site: SeedSite, varName: string): string {
  const brand = site.brand;
  return [
    `SELECT m.branding_profile_id INTO ${varName}`,
    `FROM public.branding_hostname_mapping m`,
    `WHERE lower(m.hostname) = ${sqlStr(site.domain)}`,
    `LIMIT 1;`,
    ``,
    `IF ${varName} IS NULL THEN`,
    `  INSERT INTO public.branding_profiles (`,
    `    partner_id, status,`,
    `    color_primary, color_background, color_surface, color_foreground,`,
    `    dark_color_background, dark_color_surface, dark_color_foreground,`,
    `    font_family_brand, operator_name, operator_email, operator_url, published_at`,
    `  ) VALUES (`,
    `    NULL, 'published',`,
    `    COALESCE(${nullableSqlStr(brand.colorPrimary)}, '23 100% 55%'),`,
    `    COALESCE(${nullableSqlStr(brand.colorBackground)}, '210 20% 98%'),`,
    `    COALESCE(${nullableSqlStr(brand.colorSurface)}, '0 0% 100%'),`,
    `    COALESCE(${nullableSqlStr(brand.colorForeground)}, '0 0% 10%'),`,
    `    ${nullableSqlStr(brand.darkColorBackground)},`,
    `    ${nullableSqlStr(brand.darkColorSurface)},`,
    `    ${nullableSqlStr(brand.darkColorForeground)},`,
    `    COALESCE(${nullableSqlStr(brand.fontFamilyBrand)}, 'Nunito Sans, sans-serif'),`,
    `    COALESCE(${nullableSqlStr(brand.operatorName)}, 'Platform'),`,
    `    COALESCE(${nullableSqlStr(brand.operatorEmail)}, 'support@platform.com'),`,
    `    ${nullableSqlStr(brand.operatorUrl)},`,
    `    now()`,
    `  ) RETURNING id INTO ${varName};`,
    `ELSE`,
    `  UPDATE public.branding_profiles SET`,
    `    status = 'published',`,
    `    color_primary = COALESCE(${nullableSqlStr(brand.colorPrimary)}, color_primary),`,
    `    color_background = COALESCE(${nullableSqlStr(brand.colorBackground)}, color_background),`,
    `    color_surface = COALESCE(${nullableSqlStr(brand.colorSurface)}, color_surface),`,
    `    color_foreground = COALESCE(${nullableSqlStr(brand.colorForeground)}, color_foreground),`,
    `    dark_color_background = COALESCE(${nullableSqlStr(brand.darkColorBackground)}, dark_color_background),`,
    `    dark_color_surface = COALESCE(${nullableSqlStr(brand.darkColorSurface)}, dark_color_surface),`,
    `    dark_color_foreground = COALESCE(${nullableSqlStr(brand.darkColorForeground)}, dark_color_foreground),`,
    `    font_family_brand = COALESCE(${nullableSqlStr(brand.fontFamilyBrand)}, font_family_brand),`,
    `    operator_name = COALESCE(${nullableSqlStr(brand.operatorName)}, operator_name),`,
    `    operator_email = COALESCE(${nullableSqlStr(brand.operatorEmail)}, operator_email),`,
    `    operator_url = COALESCE(${nullableSqlStr(brand.operatorUrl)}, operator_url),`,
    `    profile_version = profile_version + 1,`,
    `    updated_at = now()`,
    `  WHERE id = ${varName};`,
    `END IF;`,
    ``,
    `INSERT INTO public.branding_hostname_mapping (hostname, branding_profile_id, brand_variant, primary_route)`,
    `VALUES (${sqlStr(site.domain)}, ${varName}, ${sqlStr(site.brandVariant)}, NULLIF(trim(COALESCE(${nullableSqlStr(site.landingPath)}, '')), ''))`,
    `ON CONFLICT (hostname) DO UPDATE SET`,
    `  branding_profile_id = EXCLUDED.branding_profile_id,`,
    `  brand_variant = EXCLUDED.brand_variant,`,
    `  primary_route = EXCLUDED.primary_route,`,
    `  updated_at = now();`,
  ].join('\n');
}

async function readI18nMap(root: string, file: string): Promise<Record<string, Record<string, string>>> {
  const raw = await readIf(path.join(root, file));
  const rows = parseI18nRows(raw, NAMESPACE);
  const map: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    map[row.key] ??= {};
    map[row.key][row.locale] = row.value;
  }
  return map;
}

function collectTranslationRows(
  usedKeys: Set<string>,
  i18nMap: Record<string, Record<string, string>>,
  transRows: Map<string, string>,
  missing: string[],
): void {
  // Emit the design's FULL declared translation corpus (every key in i18n.json),
  // not just the keys referenced by the ingested canvas HTML. Runtime blocks
  // (e.g. the aisha-pruvodce deck) render their text from DB keys that live only
  // in the block's own code and never appear in the canvas markup, so a
  // canvas-only delta silently dropped them — leaving the průvodce untranslated
  // and not editable in the admin. The i18n.json IS the design's contract of
  // translatable keys, so seeding all of it makes every dynamic element (canvas
  // and runtime-block alike) DB-resolved and admin-editable.
  for (const key of Object.keys(i18nMap).sort()) {
    const vals = i18nMap[key];
    const entries = vals && typeof vals === 'object' ? Object.entries(vals) : [];
    for (const [locale, value] of entries) {
      if (typeof value !== 'string') continue;
      transRows.set(
        `${key}\0${locale}`,
        `  (${sqlStr(key)}, ${sqlStr(locale)}, ${sqlStr(NAMESPACE)}, ${dollar(value)})`,
      );
    }
  }
  // Report canvas-referenced keys that have no value in i18n.json (real gaps the
  // operator must fill — distinct from keys that simply aren't on these pages).
  for (const key of [...usedKeys].sort()) {
    const vals = i18nMap[key];
    if (!vals || Object.keys(vals).length === 0) missing.push(key);
  }
}

async function main(): Promise<void> {
  const folder = process.argv[2];
  if (!folder) {
    console.error('usage: export-web-seed <design-folder> [out.sql]');
    process.exit(1);
  }
  const root = path.resolve(folder);
  const outArg = process.argv[3];

  const manifestRaw = await readIf(path.join(root, 'manifest.json'));
  const plan = parseSeedManifest(manifestRaw, 'index');

  const brandDeclarations: string[] = [];
  const seedStatements: string[] = [];
  const brokenAssets = new Set<string>();
  const transRows = new Map<string, string>();
  const missing: string[] = [];

  const ingestPage = async (
    page: SeedPage,
    css: string,
    brandingProfileSql: string | null,
    usedKeys: Set<string>,
  ): Promise<string | null> => {
    const html = await readIf(path.join(root, page.html));
    if (!html) {
      console.error(`warn: missing ${page.html} — skipping page "${page.slug}"`);
      return null;
    }
    const doc = htmlToProjectData({ html, css });
    usedKeys.add(page.titleKey);
    usedKeys.add(page.descriptionKey);
    for (const k of doc.i18n_keys_used) usedKeys.add(k);
    for (const a of doc.broken_assets) brokenAssets.add(a);
    return webPageUpsert(page, doc.canvas_data, doc.canvas_html, doc.canvas_css, brandingProfileSql);
  };

  if (plan.sites && plan.sites.length) {
    for (const [idx, site] of plan.sites.entries()) {
      const brandVar = `v_brand_${idx}`;
      brandDeclarations.push(`  ${brandVar} uuid;`);
      seedStatements.push(brandingSiteUpsert(site, brandVar));

      const cssParts = await Promise.all(site.cssFiles.map((f) => readIf(path.join(root, f))));
      const css = cssParts.filter(Boolean).join('\n\n');
      const usedKeys = new Set<string>();
      for (const page of site.pages) {
        const stmt = await ingestPage(page, css, brandVar, usedKeys);
        if (stmt) seedStatements.push(stmt);
      }
      collectTranslationRows(usedKeys, await readI18nMap(root, site.i18nFile), transRows, missing);
    }
  } else {
    const cssParts = await Promise.all(plan.cssFiles.map((f) => readIf(path.join(root, f))));
    const css = cssParts.filter(Boolean).join('\n\n');
    const usedKeys = new Set<string>();
    for (const page of plan.pages) {
      const stmt = await ingestPage(page, css, null, usedKeys);
      if (stmt) seedStatements.push(stmt);
    }
    collectTranslationRows(usedKeys, await readI18nMap(root, 'i18n.json'), transRows, missing);
  }

  const seedBlock = seedStatements.length
    ? [
        `DO $seed$`,
        brandDeclarations.length ? `DECLARE\n${brandDeclarations.join('\n')}` : ``,
        `BEGIN`,
        seedStatements.join('\n\n'),
        `END`,
        `$seed$;`,
      ].filter(Boolean).join('\n')
    : '';

  const translationValues = [...transRows.values()];

  const sql = [
    `-- Generated by export-web-seed from "${path.basename(root)}" — DO NOT EDIT BY HAND.`,
    `-- Idempotent per-instance seed: branding sites + web_pages canvas + full ${NAMESPACE} translation corpus.`,
    `-- Source design lives out of the committed tree; this seed is the DB-only delivery.`,
    `-- Apply: psql "$AISHA_DB_URL" -v ON_ERROR_STOP=1 -f ${outArg ?? '<this file>'}`,
    ``,
    `-- ${seedStatements.filter((s) => s.startsWith('INSERT INTO public.web_pages')).length} page(s), ${brandDeclarations.length} branded site(s)`,
    seedBlock,
    translationValues.length
      ? `-- ${translationValues.length} translation row(s)\nINSERT INTO public.translations (key, locale, namespace, value) VALUES\n${translationValues.join(',\n')}\nON CONFLICT (key, namespace, locale) DO UPDATE SET value = EXCLUDED.value, updated_at = now();`
      : `-- (no translation rows: design uses static text and/or all keys are already bundled)`,
    ``,
    missing.length
      ? `-- WARNING: ${missing.length} referenced i18n key(s) have no value in i18n.json:\n${missing.map((k) => `--   ${k}`).join('\n')}`
      : `-- all referenced i18n keys resolved from i18n.json`,
    brokenAssets.size
      ? `-- WARNING: ${brokenAssets.size} broken asset reference(s): ${[...brokenAssets].slice(0, 10).join(', ')}`
      : ``,
    ``,
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  const out = outArg ?? path.join(root, 'seed', `${path.basename(root)}.web.seed.sql`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, sql, 'utf-8');
  console.error(
    `✓ wrote ${out}\n  pages=${seedStatements.filter((s) => s.startsWith('INSERT INTO public.web_pages')).length} brands=${brandDeclarations.length} translations=${translationValues.length} missing_keys=${missing.length} broken_assets=${brokenAssets.size}`,
  );
}

main().catch((err: unknown) => {
  console.error('export-web-seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
