/**
 * Správa štítků novinek (2026-10-02, naměřeno na instanci): správkyně webu štítky přejmenuje,
 * sloučí a nastaví jim zobrazované názvy sama — bez nás.
 *
 * Pod SKUTEČNOU rolí `authenticated` (SET ROLE) — RLS a granty platí.
 *   1. přehled štítků zahrne i nezveřejněné články a koncepty
 *   2. přejmenování změní živé články i koncept zveřejněného článku
 *   3. sloučení do existujícího štítku: článek s oběma ho má jednou, pořadí zůstane
 *   4. zobrazované názvy se přesunou, cizí (už existující) se nepřepíšou
 *   5. staff smí zapisovat názvy štítků (namespace news-tags)
 *   6. špatný tvar štítku → odmítnutí; člen → Unauthorized; anonym → bez grantu
 *
 * Spouští se přes: npm run test:db:stitky (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const STAFF = randomUUID();
const CLEN = randomUUID();
const A = randomUUID(); // zveřejněný, ['team-news-x', 'base-x']
const B = randomUUID(); // zveřejněný, ['people-x', 'team-news-x'] + koncept ['team-news-x']
const C = randomUUID(); // nezveřejněný, ['skryty-x']
const S = (s: string) => `${s}-${RUN}`;

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

function psql(claims: string, sql: string, role?: string): string {
  const setRole = role ? `SET ROLE ${role};\n` : "";
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n${setRole}\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}
const svc = (sql: string) => psql('{"role":"service_role"}', sql);

type Vysledek = { ok: true; out: string } | { ok: false; err: string };
function jako(uid: string | null, sql: string): Vysledek {
  const claims = uid ? `{"sub":"${uid}","role":"authenticated"}` : '{"role":"anon"}';
  try {
    return { ok: true, out: psql(claims, sql, uid ? "authenticated" : "anon") };
  } catch (e) {
    return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
  }
}

const stitky = (id: string) => svc(`SELECT array_to_string(tags, ',') FROM public.news_articles WHERE id = '${id}'`);
const konceptStitky = (id: string) =>
  svc(`SELECT fields->'tags' FROM public.news_article_versions WHERE article_id = '${id}' AND kind = 'draft'`);

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("správa štítků novinek (2026-10-02)", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES
           ('${STAFF}', 'stitky-staff-${RUN}@test.local'), ('${CLEN}', 'stitky-clen-${RUN}@test.local')
         ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${STAFF}', 'staff') ON CONFLICT DO NOTHING`);
    // Jazyky překladů (cizí klíč) — bez seedu je tabulka prázdná; se seedem nic nemění.
    svc(`INSERT INTO public.supported_languages (code, name_native) VALUES ('en', 'English'), ('cs', 'Čeština'), ('de', 'Deutsch')
         ON CONFLICT (code) DO NOTHING`);
    svc(`INSERT INTO public.news_articles (id, slug, title_key, content_key, tags, is_published) VALUES
           ('${A}', 'stitky-a-${RUN}', 'news.t.a', 'news.c.a', ARRAY['${S("team-news")}', '${S("base")}'], true),
           ('${B}', 'stitky-b-${RUN}', 'news.t.b', 'news.c.b', ARRAY['${S("people")}', '${S("team-news")}'], true),
           ('${C}', 'stitky-c-${RUN}', 'news.t.c', 'news.c.c', ARRAY['${S("skryty")}'], false)`);
    svc(`INSERT INTO public.news_article_versions (article_id, version_number, kind, fields)
           VALUES ('${B}', 0, 'draft', '{"tags":["${S("team-news")}","${S("koncept")}"]}'::jsonb)`);
    svc(`INSERT INTO public.translations (key, namespace, locale, value) VALUES
           ('${S("team-news")}', 'news-tags', 'en', 'Team News'),
           ('${S("team-news")}', 'news-tags', 'cs', 'Týmové novinky'),
           ('${S("people")}', 'news-tags', 'en', 'People')`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.news_articles WHERE id IN ('${A}', '${B}', '${C}')`);
    svc(`DELETE FROM public.translations WHERE namespace = 'news-tags' AND key LIKE '%-${RUN}'`);
    svc(`DELETE FROM public.user_roles WHERE user_id IN ('${STAFF}', '${CLEN}')`);
  });

  it("přehled zahrne i nezveřejněné články a koncepty, s počty", () => {
    const r = jako(STAFF, `SELECT tag || ':' || article_count || ':' || published_count FROM public.get_news_tags_admin() WHERE tag LIKE '%-${RUN}' ORDER BY tag`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    const radky = r.ok ? r.out.split("\n") : [];
    expect(radky).toContain(`${S("team-news")}:2:2`);
    expect(radky).toContain(`${S("skryty")}:1:0`);
    expect(radky).toContain(`${S("koncept")}:1:0`);
  });

  it("sloučení do existujícího štítku: živé články i koncept, bez duplicit, pořadí zůstane", () => {
    const r = jako(STAFF, `SELECT public.rename_news_tag_admin('${S("team-news")}', '${S("people")}')`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(r.ok && r.out).toBe("2");
    expect(stitky(A)).toBe(`${S("people")},${S("base")}`);
    expect(stitky(B)).toBe(S("people"));
    expect(JSON.parse(konceptStitky(B))).toEqual([S("people"), S("koncept")]);
  });

  it("zobrazované názvy se přesunou, existující název cíle se nepřepíše", () => {
    const nazvy = svc(`SELECT string_agg(key || '/' || locale || '=' || value, ' | ' ORDER BY key, locale)
                         FROM public.translations WHERE namespace = 'news-tags' AND key LIKE '%-${RUN}'`);
    expect(nazvy).toBe(`${S("people")}/cs=Týmové novinky | ${S("people")}/en=People`);
  });

  it("staff smí zapsat zobrazovaný název štítku (news-tags)", () => {
    const r = jako(STAFF, `SELECT count(*) FROM public.upsert_translations('[{"key":"${S("people")}","namespace":"news-tags","locale":"de","value":"Menschen"}]'::jsonb)`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(svc(`SELECT value FROM public.translations WHERE namespace = 'news-tags' AND key = '${S("people")}' AND locale = 'de'`)).toBe("Menschen");
  });

  it("špatný tvar štítku se odmítne", () => {
    for (const spatny of ["Team News", "a,b", "", "x".repeat(41)]) {
      const r = jako(STAFF, `SELECT public.rename_news_tag_admin('${S("base")}', '${spatny}')`);
      expect(r.ok, `„${spatny}" neměl projít`).toBe(false);
    }
    expect(stitky(A)).toContain(S("base"));
  });

  it("člen bez role → Unauthorized; anonym → bez grantu", () => {
    const clen = jako(CLEN, `SELECT public.rename_news_tag_admin('${S("base")}', 'cokoli')`);
    expect(!clen.ok && clen.err).toMatch(/Unauthorized/);
    const anon = jako(null, `SELECT public.get_news_tags_admin()`);
    expect(!anon.ok && anon.err).toMatch(/permission denied/);
  });
});
