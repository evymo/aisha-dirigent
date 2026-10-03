/**
 * Novinky: koncept vs. živá verze, historie, souběh, média — RUNTIME nad throwaway DB.
 *
 * ⛔ PROČ (naměřeno 2026-09-24): veřejná stránka čte `canvas_html` článku přímo
 * (`get_news_article_by_slug`) a editor plátna ukládá 5 s po poslední změně.
 * U ZVEŘEJNĚNÉHO článku tedy každá nedopsaná věta šla na web. Oprava má několik
 * půlek a každá je sama o sobě tichá, proto se měří dohromady:
 *
 *   1. nezveřejněný článek: uložení jde ŽIVĚ (není vidět, koncept by byl zdvojení);
 *   2. zveřejnění: článek dostane is_published + snímek 'published' do historie;
 *   3. zveřejněný článek: uložení jde do KONCEPTU — web dál servíruje starý stav,
 *      editor dostane koncept v `get_news_article_admin.draft`;
 *   4. souběh: zápis s razítkem, které už neplatí, skončí PT409 (409), ne přepsáním;
 *   5. „Zveřejnit změny" přelije koncept do živého stavu a koncept zanikne;
 *   6. obnova verze u zveřejněného článku jde do konceptu (web nedotčen), zahození
 *      konceptu ho zruší;
 *   7. stažení z webu s rozdělaným konceptem koncept přelije do (neviditelného)
 *      živého stavu — práce se neztratí;
 *   8. retence: ruční snímky jen posledních 30, zveřejněné zůstávají;
 *   9. seznam pro administraci nese TITULEK v jazyce rozhraní, štítky a has_draft;
 *  10. média: záznam zapíše jen service_role, admin ho vidí a umí měkce smazat;
 *  11. bez role admin/staff se nezapíše nic.
 *
 * Zapisovatelé jsou SECURITY DEFINER (RLS je neomezuje), takže autorizace žije
 * v jejich těle — měří se pod `authenticated` a dvěma identitami; service_role by
 * predikát obešel a o autorizaci nic neřekl.
 *
 * Run: npm run test:db:novinky   (node scripts/db/with-throwaway-db.mjs -- npx vitest run <tento soubor>)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const ADMIN2 = randomUUID();
const OUTSIDER = randomUUID();
const SLUG = `t-koncept-${RUN}`;
let articleId = "";

function psql(claims: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-q"],
    {
      encoding: "utf8",
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n${sql};`,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
}
const svc = (sql: string) => psql('{"role":"service_role"}', sql);
const jako = (uid: string, sql: string) => psql(`{"sub":"${uid}","role":"authenticated"}`, sql);
const admin = (sql: string) => jako(ADMIN, sql);
/** Vrátí text chyby (nebo "" když prošlo) — pro měření „nesmí projít". */
function chyba(fn: () => string): string {
  try {
    fn();
    return "";
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? (e as Error).message);
  }
}

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`
    INSERT INTO aisha_auth.users (id, email) VALUES
      ('${ADMIN}', 'admin-${RUN}@test.local'),
      ('${ADMIN2}', 'admin2-${RUN}@test.local'),
      ('${OUTSIDER}', 'outsider-${RUN}@test.local');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin') ON CONFLICT DO NOTHING
  `);
  articleId = admin(
    `SELECT public.create_news_article_admin(
       p_content_key := 'news.${SLUG}.content', p_excerpt_key := 'news.${SLUG}.excerpt',
       p_slug := '${SLUG}', p_tags := ARRAY['home'], p_title_key := 'news.${SLUG}.title')`,
  );
  expect(articleId).toMatch(/^[0-9a-f-]{36}$/);
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`
    DELETE FROM public.news_articles WHERE slug = '${SLUG}';
    DELETE FROM public.translations WHERE namespace = 'news' AND key LIKE 'news.${SLUG}.%';
    DELETE FROM public.media_assets WHERE object_key LIKE 'test-${RUN}/%';
    DELETE FROM public.user_roles WHERE user_id IN ('${ADMIN}', '${ADMIN2}');
    DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}', '${ADMIN2}', '${OUTSIDER}')
  `);
});

describe("novinky: koncept, verze, souběh", () => {
  it.skipIf(!dbAvailable)("1. nezveřejněný článek: uložení jde živě, koncept nevzniká", () => {
    admin(`SELECT public.save_news_article_draft_admin(
      '${articleId}', 'p{color:red}', '{"pages":[]}'::jsonb, '<p>prvni</p>', NULL,
      '{"texts":{"cs":{"title":"Ahoj"},"en":{"title":"Hello"}},"tags":["a","b"],"image_focus_x":0.2,"image_zoom":2}'::jsonb)`);
    const radek = svc(`SELECT canvas_html || '|' || array_to_string(tags, ',') || '|' || image_focus_x || '|' || image_zoom
                       FROM public.news_articles WHERE id = '${articleId}'`);
    expect(radek).toBe("<p>prvni</p>|a,b|0.200|2.00");
    expect(svc(`SELECT value FROM public.translations WHERE namespace='news' AND key='news.${SLUG}.title' AND locale='cs'`)).toBe("Ahoj");
    expect(svc(`SELECT count(*) FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='draft'`)).toBe("0");
  });

  it.skipIf(!dbAvailable)("2. zveřejnění: is_published + snímek 'published' s texty", () => {
    admin(`SELECT public.publish_news_article_admin('${articleId}')`);
    expect(svc(`SELECT is_published::text || '|' || (published_at IS NOT NULL)::text FROM public.news_articles WHERE id='${articleId}'`)).toBe("true|true");
    expect(
      svc(`SELECT kind || '|' || version_number || '|' || (fields->'texts'->'cs'->>'title')
           FROM public.news_article_versions WHERE article_id='${articleId}' ORDER BY version_number DESC LIMIT 1`),
    ).toBe("published|1|Ahoj");
  });

  it.skipIf(!dbAvailable)("3. zveřejněný článek: uložení jde do konceptu, web čte starý stav", () => {
    admin(`SELECT public.save_news_article_draft_admin('${articleId}', NULL, NULL, '<p>rozepsane</p>', NULL, NULL)`);
    expect(svc(`SELECT canvas_html FROM public.news_articles WHERE id='${articleId}'`)).toBe("<p>prvni</p>");
    expect(psql('{"role":"anon"}', `SELECT canvas_html FROM public.get_news_article_by_slug('${SLUG}')`)).toBe("<p>prvni</p>");
    // Koncept je ÚPLNÝ snímek: plátno nové, hlavička (texty) zděděná ze živého stavu.
    expect(
      svc(`SELECT canvas_html || '|' || (fields->'texts'->'cs'->>'title') || '|' || (fields->>'image_zoom')
           FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='draft'`),
    ).toBe("<p>rozepsane</p>|Ahoj|2.00");
    const adminView = admin(`SELECT (draft IS NOT NULL)::text || '|' || (draft->>'canvas_html') || '|' || (edit_stamp = (draft->>'updated_at')::timestamptz)::text
                             FROM public.get_news_article_admin('${articleId}')`);
    expect(adminView).toBe("true|<p>rozepsane</p>|true");
  });

  it.skipIf(!dbAvailable)("4. souběh: zastaralé razítko končí PT409, platné projde a vrátí novější", () => {
    const stamp = admin(`SELECT public.news_article_edit_stamp('${articleId}')`);
    const stare = `('${stamp}'::timestamptz - interval '1 second')`;
    const err = chyba(() =>
      jako(ADMIN2, `SELECT public.save_news_article_draft_admin('${articleId}', NULL, NULL, '<p>cizi</p>', ${stare}, NULL)`),
    );
    expect(err).toMatch(/PT409|changed since/);
    expect(svc(`SELECT canvas_html FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='draft'`)).toBe("<p>rozepsane</p>");

    const nove = jako(ADMIN2, `SELECT public.save_news_article_draft_admin('${articleId}', NULL, NULL, '<p>druhy</p>', '${stamp}'::timestamptz, NULL)`);
    expect(svc(`SELECT ('${nove}'::timestamptz >= '${stamp}'::timestamptz)::text`)).toBe("true");
    expect(svc(`SELECT canvas_html FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='draft'`)).toBe("<p>druhy</p>");
  });

  it.skipIf(!dbAvailable)("5. zveřejnit změny: koncept se přelije do živého stavu a zanikne", () => {
    admin(`SELECT public.publish_news_article_admin('${articleId}')`);
    expect(svc(`SELECT canvas_html FROM public.news_articles WHERE id='${articleId}'`)).toBe("<p>druhy</p>");
    expect(psql('{"role":"anon"}', `SELECT canvas_html FROM public.get_news_article_by_slug('${SLUG}')`)).toBe("<p>druhy</p>");
    expect(svc(`SELECT count(*) FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='draft'`)).toBe("0");
    expect(svc(`SELECT count(*) FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='published'`)).toBe("2");
  });

  it.skipIf(!dbAvailable)("6. obnova verze u zveřejněného článku jde do konceptu; zahození ho zruší", () => {
    const v1 = admin(`SELECT id FROM public.get_news_article_versions('${articleId}') WHERE version_number = 1`);
    admin(`SELECT public.restore_news_article_version('${articleId}', '${v1}')`);
    expect(svc(`SELECT canvas_html FROM public.news_articles WHERE id='${articleId}'`)).toBe("<p>druhy</p>");
    expect(svc(`SELECT canvas_html FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='draft'`)).toBe("<p>prvni</p>");
    admin(`SELECT public.discard_news_article_draft_admin('${articleId}')`);
    expect(svc(`SELECT count(*) FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='draft'`)).toBe("0");
  });

  it.skipIf(!dbAvailable)("7. stažení z webu s konceptem: koncept se přelije do živého stavu", () => {
    admin(`SELECT public.save_news_article_draft_admin('${articleId}', NULL, NULL, '<p>treti</p>', NULL, '{"tags":["x"]}'::jsonb)`);
    admin(`SELECT public.update_news_article_admin(p_id := '${articleId}', p_is_published := false)`);
    expect(svc(`SELECT is_published::text || '|' || canvas_html || '|' || array_to_string(tags, ',') FROM public.news_articles WHERE id='${articleId}'`))
      .toBe("false|<p>treti</p>|x");
    expect(svc(`SELECT count(*) FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='draft'`)).toBe("0");
    // A zveřejnění přes strukturální update = publish (snímek do historie).
    admin(`SELECT public.update_news_article_admin(p_id := '${articleId}', p_is_published := true)`);
    expect(svc(`SELECT count(*) FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='published'`)).toBe("3");
  });

  it.skipIf(!dbAvailable)("8. retence: ruční snímky jen posledních 30, zveřejněné zůstávají", () => {
    admin(`SELECT count(public.create_news_article_version('${articleId}', 'manual', 'r' || g)) FROM generate_series(1, 32) g`);
    expect(svc(`SELECT count(*) FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='manual'`)).toBe("30");
    expect(svc(`SELECT count(*) FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='published'`)).toBe("3");
    expect(svc(`SELECT min(label) FROM public.news_article_versions WHERE article_id='${articleId}' AND kind='manual'`)).not.toBe("r1");
  });

  it.skipIf(!dbAvailable)("9. seznam pro administraci: titulek v jazyce rozhraní, štítky, has_draft", () => {
    expect(admin(`SELECT title || '|' || array_to_string(tags, ',') || '|' || has_draft::text FROM public.get_news_articles_admin('cs') WHERE slug='${SLUG}'`))
      .toBe("Ahoj|x|false");
    expect(admin(`SELECT title FROM public.get_news_articles_admin('en') WHERE slug='${SLUG}'`)).toBe("Hello");
    // Bez jazyka se NIC nedosazuje.
    expect(admin(`SELECT (title IS NULL)::text FROM public.get_news_articles_admin(NULL) WHERE slug='${SLUG}'`)).toBe("true");
  });

  it.skipIf(!dbAvailable)("10. média: zapíše jen service_role, admin vidí a měkce maže", () => {
    const err = chyba(() => admin(`SELECT public.record_media_asset('page-assets', 10, 'image/png', 'test-${RUN}/a.png')`));
    expect(err).toMatch(/Unauthorized/);
    const id = svc(`SELECT public.record_media_asset('page-assets', 10, 'image/png', 'test-${RUN}/a.png', 'a.png', '${ADMIN}')`);
    expect(svc(`SELECT public.record_media_asset('page-assets', 12, 'image/png', 'test-${RUN}/a.png', 'a.png', '${ADMIN}')`)).toBe(id);
    expect(admin(`SELECT bytes::text || '|' || original_name FROM public.get_media_assets_admin(60, 0, 'a.png') WHERE id='${id}'`)).toBe("12|a.png");
    admin(`SELECT public.delete_media_asset_admin('${id}')`);
    expect(admin(`SELECT count(*) FROM public.get_media_assets_admin(60, 0, NULL) WHERE id='${id}'`)).toBe("0");
    expect(chyba(() => jako(OUTSIDER, `SELECT count(*) FROM public.get_media_assets_admin(60, 0, NULL)`))).toMatch(/Unauthorized/);
  });

  it.skipIf(!dbAvailable)("11. bez role admin/staff se nezapíše nic", () => {
    expect(chyba(() => jako(OUTSIDER, `SELECT public.save_news_article_draft_admin('${articleId}', NULL, NULL, '<p>vetrelec</p>', NULL, NULL)`))).toMatch(/Unauthorized/);
    expect(chyba(() => jako(OUTSIDER, `SELECT public.publish_news_article_admin('${articleId}')`))).toMatch(/Unauthorized/);
    expect(chyba(() => jako(OUTSIDER, `SELECT public.get_news_article_admin('${articleId}')`))).toMatch(/Unauthorized/);
    expect(svc(`SELECT canvas_html FROM public.news_articles WHERE id='${articleId}'`)).toBe("<p>treti</p>");
  });
});
