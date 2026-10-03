/**
 * Unit tests for the pure logic of /seed-default — the domain-convention
 * folder sanitizer and the manifest → seed-plan parser. The Fastify route +
 * RPC chain are exercised in integration/e2e; here we lock the security and
 * fallback contracts that the convention import relies on.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';
import { sanitizeDomainSegment, parseSeedManifest, summarizeSeedResult, parseI18nRows } from './seed-default.js';
import { htmlToProjectData } from '../lib/htmlToProjectData.js';

describe('sanitizeDomainSegment', () => {
  it('accepts domain-like single segments (lowercased)', () => {
    expect(sanitizeDomainSegment('aisha.guru')).toBe('aisha.guru');
    expect(sanitizeDomainSegment('My-Brand')).toBe('my-brand');
    expect(sanitizeDomainSegment('a1.b2.c3')).toBe('a1.b2.c3');
  });

  it('rejects traversal, separators, leading/trailing punctuation and empties', () => {
    const bad = ['', '   ', '..', '../etc', 'a/b', 'a\\b', '/abs', '.hidden', 'x..y', '-lead', 'trail-', 'a/../b'];
    for (const b of bad) expect(sanitizeDomainSegment(b)).toBeNull();
    expect(sanitizeDomainSegment(undefined)).toBeNull();
  });
});

describe('parseSeedManifest', () => {
  it('falls back to a single index page on empty/invalid manifest', () => {
    for (const raw of ['', '{bad json', 'null', '[]', '42']) {
      const plan = parseSeedManifest(raw, 'index');
      expect(plan.pages).toEqual([
        { slug: 'index', html: 'index.html', titleKey: 'web.default.title', descriptionKey: 'web.default.description' },
      ]);
      expect(plan.cssFiles).toEqual(['tokens.css', 'styles.css']);
    }
  });

  it('honors single-page manifest keys (domains/default shape)', () => {
    const raw = JSON.stringify({ slug: 'index', title_key: 'web.x.title', description_key: 'web.x.desc' });
    const plan = parseSeedManifest(raw, 'index');
    expect(plan.pages).toEqual([
      { slug: 'index', html: 'index.html', titleKey: 'web.x.title', descriptionKey: 'web.x.desc' },
    ]);
  });

  it('uses the fallback slug when the manifest omits slug', () => {
    expect(parseSeedManifest('{}', 'home').pages[0].slug).toBe('home');
  });

  it('expands multi-page manifest with per-page + inherited keys and html defaults', () => {
    const raw = JSON.stringify({
      title_key: 'web.t',
      description_key: 'web.d',
      shared_css: ['tokens.css', 'styles.css'],
      pages: [
        { slug: 'index', html: 'index.html', title_key: 'web.home.t', description_key: 'web.home.d' },
        { slug: 'about' },
      ],
    });
    const plan = parseSeedManifest(raw, 'index');
    expect(plan.pages).toEqual([
      { slug: 'index', html: 'index.html', titleKey: 'web.home.t', descriptionKey: 'web.home.d' },
      { slug: 'about', html: 'about.html', titleKey: 'web.t', descriptionKey: 'web.d' },
    ]);
  });

  it('ignores unsafe html paths in manifest pages (defense in depth)', () => {
    const raw = JSON.stringify({ pages: [{ slug: 'x', html: '../escape.html' }] });
    expect(parseSeedManifest(raw, 'index').pages[0].html).toBe('x.html');
  });

  it('keeps safe shared_css subpaths and drops unsafe entries', () => {
    const raw = JSON.stringify({ shared_css: ['tokens.css', '../secret.css', 'a/b.css', 'styles.css'] });
    expect(parseSeedManifest(raw, 'index').cssFiles).toEqual(['tokens.css', 'a/b.css', 'styles.css']);
  });

  it('derives <slug>.html for a non-index fallback slug (no manifest)', () => {
    const p = parseSeedManifest('{}', 'about').pages[0];
    expect(p).toEqual({ slug: 'about', html: 'about.html', titleKey: 'web.default.title', descriptionKey: 'web.default.description' });
  });
});

describe('summarizeSeedResult', () => {
  const seeded = [{ slug: 'index', page_id: 'p', job_id: 'j' }];

  it('502 when every page errored and none seeded/skipped', () => {
    const r = summarizeSeedResult('default', { seeded: [], skipped: [], errors: [{ slug: 'index', error: 'boom' }] });
    expect(r.status).toBe(502);
    expect(r.body.ok).toBe(false);
  });

  it('304 when every page was already seeded (skipped)', () => {
    const r = summarizeSeedResult('templates/aisha.guru', { seeded: [], skipped: ['index', 'about'], errors: [] });
    expect(r.status).toBe(304);
    expect(r.body.reason).toBe('already_seeded');
  });

  it('200 when at least one page seeded', () => {
    expect(summarizeSeedResult('default', { seeded, skipped: [], errors: [] }).status).toBe(200);
  });

  it('200 (partial) when some pages seeded and some errored', () => {
    const r = summarizeSeedResult('default', { seeded, skipped: [], errors: [{ slug: 'about', error: 'missing_html:about.html' }] });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe('parseSeedManifest — multi-domain sites[]', () => {
  const raw = JSON.stringify({
    schema_version: 2,
    shared_css: ['tokens.css', 'styles.css'],
    sites: [
      {
        domain: 'corp.aisha.guru',
        brand_variant: 'corp',
        landing_path: '/',
        i18n: 'i18n.corp.json',
        brand: { operator_name: 'Evymo', color_primary: '23 100% 55%' },
        pages: [
          { slug: 'index', html: 'corp/index.html', title_key: 'web.index.title', description_key: 'web.index.description' },
          { slug: 'about', html: 'corp/about.html' },
        ],
      },
      {
        domain: 'aisha.guru',
        brand_variant: 'aisha',
        i18n: 'i18n.aisha.json',
        shared_css: ['tokens.css', 'styles.css', 'aisha.css'],
        brand: { operator_name: 'AISHA', dark_color_background: '0 0% 6%' },
        pages: [{ slug: 'index', html: 'aisha/index.html', title_key: 'web.aisha.title' }],
      },
    ],
  });

  it('parses two sites with brand, pages and css', () => {
    const plan = parseSeedManifest(raw, 'index');
    expect(plan.pages).toEqual([]);
    expect(plan.sites).toHaveLength(2);
    const [corp, aisha] = plan.sites!;
    expect(corp).toMatchObject({ domain: 'corp.aisha.guru', brandVariant: 'corp', landingPath: '/', i18nFile: 'i18n.corp.json' });
    expect(corp.brand.operatorName).toBe('Evymo');
    expect(corp.cssFiles).toEqual(['tokens.css', 'styles.css']);
    expect(corp.pages).toEqual([
      { slug: 'index', html: 'corp/index.html', titleKey: 'web.index.title', descriptionKey: 'web.index.description' },
      { slug: 'about', html: 'corp/about.html', titleKey: 'web.default.title', descriptionKey: 'web.default.description' },
    ]);
    expect(aisha.cssFiles).toEqual(['tokens.css', 'styles.css', 'aisha.css']);
    expect(aisha.brand.darkColorBackground).toBe('0 0% 6%');
  });

  it('derives brand_variant from the domain when omitted', () => {
    const r = JSON.stringify({ sites: [{ domain: 'shop.example.com', pages: [{ slug: 'index' }] }] });
    expect(parseSeedManifest(r, 'index').sites![0].brandVariant).toBe('shop');
  });

  it('keeps a safe subfolder html path but rejects traversal', () => {
    const r = JSON.stringify({ sites: [{ domain: 'a.b', pages: [{ slug: 'x', html: '../escape.html' }] }] });
    expect(parseSeedManifest(r, 'index').sites![0].pages[0].html).toBe('x.html');
  });

  it('keeps safe i18n subpaths but rejects traversal and non-json files', () => {
    const ok = JSON.stringify({ sites: [{ domain: 'a.b', i18n: 'corp/i18n.json', pages: [{ slug: 'x' }] }] });
    const traversal = JSON.stringify({ sites: [{ domain: 'a.b', i18n: '../i18n.json', pages: [{ slug: 'x' }] }] });
    const wrongExt = JSON.stringify({ sites: [{ domain: 'a.b', i18n: 'corp/i18n.txt', pages: [{ slug: 'x' }] }] });
    expect(parseSeedManifest(ok, 'index').sites![0].i18nFile).toBe('corp/i18n.json');
    expect(parseSeedManifest(traversal, 'index').sites![0].i18nFile).toBe('i18n.json');
    expect(parseSeedManifest(wrongExt, 'index').sites![0].i18nFile).toBe('i18n.json');
  });

  it('skips sites with unsafe domain or no pages, falls back to single-site when none valid', () => {
    const r = JSON.stringify({ sites: [{ domain: '../evil', pages: [{ slug: 'x' }] }, { domain: 'b.c', pages: [] }] });
    const plan = parseSeedManifest(r, 'index');
    expect(plan.sites).toBeUndefined();
    expect(plan.pages).toHaveLength(1);
  });

  it('legacy single-page manifests still produce pages without sites', () => {
    const plan = parseSeedManifest(JSON.stringify({ slug: 'index' }), 'index');
    expect(plan.sites).toBeUndefined();
    expect(plan.pages[0].slug).toBe('index');
  });
});

describe('parseI18nRows', () => {
  it('flattens key → {locale: value} into translation rows', () => {
    const raw = JSON.stringify({
      _note: 'ignored',
      'web.hero.title': { en: 'Get Aisha', cs: 'Pořiďte si Aishu' },
      'web.hero.sub': { en: '', cs: 'x' },
    });
    const rows = parseI18nRows(raw, 'web');
    expect(rows).toContainEqual({ key: 'web.hero.title', locale: 'en', value: 'Get Aisha', namespace: 'web' });
    expect(rows).toContainEqual({ key: 'web.hero.title', locale: 'cs', value: 'Pořiďte si Aishu', namespace: 'web' });
    // empty value dropped, _note key skipped
    expect(rows.find((r) => r.key === 'web.hero.sub' && r.locale === 'en')).toBeUndefined();
    expect(rows.find((r) => r.key.startsWith('_'))).toBeUndefined();
    expect(rows).toHaveLength(3);
  });

  it('returns [] for empty/invalid/array input', () => {
    expect(parseI18nRows('')).toEqual([]);
    expect(parseI18nRows('not json')).toEqual([]);
    expect(parseI18nRows('[]')).toEqual([]);
  });
});

describe('htmlToProjectData i18n bindings', () => {
  it('preserves and extracts text plus safe attribute i18n keys', () => {
    const result = htmlToProjectData({
      css: '.skip-link{color:var(--sc-brand)}',
      html: `
        <main data-template="aisha-pruvodce">
          <p>
            <span data-i18n-key="web.pruvodce.skip.prompt">Fallback</span>
            <a href="/aisha"
               data-i18n-key="web.pruvodce.skip.link"
               data-i18n-title-key="web.pruvodce.skip.title">Fallback link</a>
          </p>
          <input data-i18n-placeholder-key="web.contact.email_placeholder" />
          <img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" data-i18n-alt-key="web.hero.image_alt" />
        </main>
      `,
    });

    expect(result.canvas_html).toContain('data-template="aisha-pruvodce"');
    expect(result.canvas_html).toContain('data-i18n-title-key="web.pruvodce.skip.title"');
    expect(result.canvas_html).toContain('data-i18n-placeholder-key="web.contact.email_placeholder"');
    expect(result.canvas_html).toContain('data-i18n-alt-key="web.hero.image_alt"');
    expect(result.i18n_keys_used).toEqual([
      'web.contact.email_placeholder',
      'web.hero.image_alt',
      'web.pruvodce.skip.link',
      'web.pruvodce.skip.prompt',
      'web.pruvodce.skip.title',
    ]);
  });
});
