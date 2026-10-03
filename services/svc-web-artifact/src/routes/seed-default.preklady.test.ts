/**
 * Texty se seedují NEZÁVISLE na stránkách — měřeno spuštěním routy.
 *
 * PROČ (naměřeno 2026-08-10 na nasazené instanci)
 * ----------------------------------------------
 * `seedSiteTranslations()` se volalo VÝHRADNĚ ve větvi pro více domén
 * (`plan.sites`). Šablona s jednoduchým manifestem — `{title_key,
 * description_key, slug}`, což je tvar, který má `domains/default` i každá
 * instanční šablona — tedy dostala stránku, ale texty NIKDY.
 *
 * Web pak trvale kreslil syrové klíče:
 *     ▮ <Fork> Investments
 *     WEB.<FORK>.EYEBROW
 *     WEB.<FORK>.HERO.HEADING
 * a `/seed-default` k tomu hlásil `{"ok": true, "errors": []}`.
 *
 * ⭐ Druhá půlka vady: jakmile stránka jednou existovala, seed skončil na 304
 * („already_seeded") a texty se nedoplnily UŽ NIKDY. Plátno se před přepsáním
 * chrání SCHVÁLNĚ (ať přežije ruční editaci v editoru) — jenže text není plátno.
 * Klíč bez hodnoty je vada, ne obsah, který by někdo chtěl uchovat.
 *
 * CO SE MĚŘÍ
 * ----------
 * Ne to, že v souboru je řádek `seedTranslations(...)` — to by prošlo
 * i zakomentované. Routa se ZAREGISTRUJE do Fastify, zavolá se přes `inject()`
 * nad dočasnou složkou a kontroluje se, co dostal `upsertTranslations`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Náhodný per-běh, ne literál. Dvojí užitek: brána `service-security` hlídá
// natvrdo zapsaná tajemství ve `services/svc-*` (chytila mě při psaní tohohle
// testu) a náhodná hodnota navíc DOKAZUJE, že se guard porovnává s nastavenou
// konfigurací, ne s nějakým pevným řetězcem.
const TOKEN = randomUUID();

/** Zaznamenané volání upsert_translations napříč testem. */
const vlozeneRadky: Array<{ key: string; locale: string; value: string; namespace: string }> = [];
/** Vrací se z getWebPageBySlug — nastavuje jednotlivý test. */
let existujiciStranka: Array<Record<string, unknown>> = [];

vi.mock('../lib/rpcClient.js', () => ({
  rpcClient: {
    getWebPageBySlug: vi.fn(async () => existujiciStranka),
    upsertTranslations: vi.fn(async (rows: typeof vlozeneRadky) => {
      vlozeneRadky.push(...rows);
      return null;
    }),
    upsertDefaultWebPage: vi.fn(async () => 'page-id'),
    ensureStackDefaultStory: vi.fn(async () => 'story-id'),
    start: vi.fn(async () => 'job-id'),
    markProcessing: vi.fn(async () => null),
    complete: vi.fn(async () => null),
    apply: vi.fn(async () => null),
    seedBrandingSite: vi.fn(async () => 'brand-id'),
  },
}));

let slozka: string;

/** Dočasná designová složka v tom tvaru, jaký vyrábí designový overlay. */
function pripravSlozku(): string {
  const koren = mkdtempSync(join(tmpdir(), 'seed-preklady-'));
  const sablona = join(koren, 'templates', 'test.example');
  mkdirSync(sablona, { recursive: true });
  writeFileSync(
    join(sablona, 'index.html'),
    '<!doctype html><html><body><h1 data-i18n-key="web.t.heading">H</h1></body></html>',
  );
  // ⚠️ ZÁMĚRNĚ jednoduchý manifest — BEZ `sites[]`. Přesně ten tvar, u kterého
  // se texty nevkládaly. Kdyby tu bylo `sites`, brána by měřila opravenou cestu.
  writeFileSync(
    join(sablona, 'manifest.json'),
    JSON.stringify({ slug: 'index', title_key: 'web.t.title', description_key: 'web.t.desc' }),
  );
  writeFileSync(
    join(sablona, 'i18n.json'),
    JSON.stringify({
      _note: 'podtržítkové klíče se ignorují',
      'web.t.title': { en: 'Title', cs: 'Nadpis' },
      'web.t.heading': { en: 'Heading', cs: 'Titulek' },
    }),
  );
  return koren;
}

async function postavServer() {
  vi.resetModules();
  const Fastify = (await import('fastify')).default;
  const { seedDefaultRoutes } = await import('./seed-default.js');
  const app = Fastify();
  await app.register(seedDefaultRoutes);
  return app;
}

beforeEach(() => {
  vlozeneRadky.length = 0;
  existujiciStranka = [];
  slozka = pripravSlozku();
  vi.stubEnv('DOMAINS_DIR', slozka);
  vi.stubEnv('AISHA_SEED_DOMAIN', 'test.example');
  vi.stubEnv('POSTGREST_SERVICE_TOKEN', TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(slozka, { recursive: true, force: true });
});

describe('/seed-default — texty nezávisle na stránkách', () => {
  it('u jednoduchého manifestu (bez sites[]) vloží překlady', async () => {
    const app = await postavServer();
    const r = await app.inject({
      method: 'POST',
      url: '/seed-default',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });
    await app.close();

    expect(r.statusCode, `odpověď: ${r.body}`).toBeLessThan(400);
    expect(
      vlozeneRadky.length,
      'upsertTranslations se nezavolal ANI JEDNOU. Přesně tak vypadala vada z 2026-08-10:\n' +
        'stránka se naseedovala, texty ne, a odpověď hlásila ok:true / errors:[].\n' +
        'Web pak kreslil syrové klíče typu WEB.<FORK>.HERO.HEADING.',
    ).toBeGreaterThan(0);

    const klice = vlozeneRadky.map((x) => x.key);
    expect(klice).toContain('web.t.title');
    expect(klice).toContain('web.t.heading');
    expect(klice, 'klíče s podtržítkem (_note) nejsou překlady').not.toContain('_note');
    expect(new Set(vlozeneRadky.map((x) => x.namespace))).toEqual(new Set(['web']));
  });

  it('vloží překlady I KDYŽ se všechny stránky přeskočí (304)', async () => {
    // Stránka už plátno má → seedOnePage ji přeskočí. Přesně stav produkce:
    // stránka z 20. 7. existovala, takže seed vracel 304 a texty nedorazily NIKDY.
    existujiciStranka = [{ canvas_data: { komponenty: [] } }];

    const app = await postavServer();
    const r = await app.inject({
      method: 'POST',
      url: '/seed-default',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });
    await app.close();

    expect(r.statusCode, 'přeskočené stránky mají dát 304').toBe(304);
    expect(
      vlozeneRadky.length,
      'TOHLE je jádro vady: stránka existuje → 304 → a texty se nedoplní už nikdy.\n' +
        'Plátno se chrání schválně, text ne. Klíč bez hodnoty je vada, ne obsah.',
    ).toBeGreaterThan(0);
  });

  it('odmítne volajícího bez service-role tokenu', async () => {
    const app = await postavServer();
    const r = await app.inject({ method: 'POST', url: '/seed-default', payload: {} });
    await app.close();
    expect(r.statusCode).toBe(401);
    expect(vlozeneRadky.length, 'neautorizovaný požadavek nesmí nic zapsat').toBe(0);
  });
});
