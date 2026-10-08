/**
 * Webové stránky: koncept vs. živá verze — a verze/šablony bez 403.
 *
 * ⛔ NAMĚŘENO 2026-10-02 (na instanci, správkyně webu):
 *   1. veřejný web čte `canvas_html` zveřejněné stránky přímo a editor plátna
 *      ukládá 5 s po poslední změně → každý rozpracovaný pokus šel na web;
 *   2. create_web_page_version / restore_web_page_version / apply_web_page_template
 *      byly SECURITY INVOKER s INSERTem do audit_journal, jehož jediná politika je
 *      čtecí → správci/staffovi padaly na RLS (zveřejnění bez historie, šablona
 *      nešla použít). Prošel jen service_role (BYPASSRLS) — proto to žádný test
 *      pouštěný jako superuživatel nezachytil.
 *
 * Všechno tady běží pod SKUTEČNOU rolí `authenticated` (SET ROLE) — RLS platí.
 *
 * Spouští se přes: npm run test:db:web-koncept (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const STAFF = randomUUID();
const CLEN = randomUUID();
const ZVEREJNENA = randomUUID();
const NEZVEREJNENA = randomUUID();
const SABLONA = randomUUID();

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

/** Volání pod rolí `authenticated` (uid) nebo `anon` (null). */
function jako(uid: string | null, sql: string): Vysledek {
  const claims = uid ? `{"sub":"${uid}","role":"authenticated"}` : '{"role":"anon"}';
  try {
    return { ok: true, out: psql(claims, sql, uid ? "authenticated" : "anon") };
  } catch (e) {
    return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
  }
}

const zivyHtml = (id: string) => svc(`SELECT canvas_html FROM public.web_pages WHERE id = '${id}'`);
const konceptHtml = (id: string) =>
  svc(`SELECT canvas_html FROM public.web_page_versions WHERE page_id = '${id}' AND kind = 'draft'`);
const razitko = (id: string) => svc(`SELECT public.web_page_edit_stamp('${id}')::text`);

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("webové stránky: koncept vs. živá verze (2026-10-02)", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES
           ('${STAFF}', 'koncept-staff-${RUN}@test.local'),
           ('${CLEN}',  'koncept-clen-${RUN}@test.local')
         ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${STAFF}', 'staff') ON CONFLICT DO NOTHING`);
    svc(`INSERT INTO public.web_pages (id, slug, title_key, status, canvas_data, canvas_html, canvas_css, page_settings) VALUES
           ('${ZVEREJNENA}',   'koncept-zive-${RUN}', 'web.test.title', 'published',
            '{"pages":[]}'::jsonb, '<p>zive</p>', '.a{}', '{"chrome":"none","seed_fingerprint":"otisk-${RUN}","role":"partial"}'::jsonb),
           ('${NEZVEREJNENA}', 'koncept-skryte-${RUN}', 'web.test.title', 'draft',
            '{"pages":[]}'::jsonb, '<p>skryte</p>', '.a{}', '{}'::jsonb)`);
    svc(`INSERT INTO public.web_page_templates (id, name, canvas_data, canvas_html, canvas_css, page_settings) VALUES
           ('${SABLONA}', 'Šablona ${RUN}', '{"pages":[]}'::jsonb, '<p>sablona</p>', '.s{}',
            '{"chrome":"none","seed_fingerprint":"cizi-otisk","role":"page","background":"#fff"}'::jsonb)`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.web_pages WHERE id IN ('${ZVEREJNENA}', '${NEZVEREJNENA}')`);
    svc(`DELETE FROM public.web_page_templates WHERE id = '${SABLONA}'`);
    svc(`DELETE FROM public.user_roles WHERE user_id IN ('${STAFF}', '${CLEN}')`);
  });

  it("uložení zveřejněné stránky jde do konceptu — web se nezmění", () => {
    const r = jako(STAFF, `SELECT public.update_web_page_canvas_admin(p_id => '${ZVEREJNENA}', p_canvas_html => '<p>rozpracovano</p>')::text`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(zivyHtml(ZVEREJNENA)).toBe("<p>zive</p>");
    expect(konceptHtml(ZVEREJNENA)).toBe("<p>rozpracovano</p>");
  });

  it("koncept se v historii verzí nevypisuje a editor ho dostane v get_web_page_admin", () => {
    const verze = jako(STAFF, `SELECT count(*) FROM public.get_web_page_versions('${ZVEREJNENA}')`);
    expect(verze.ok && verze.out).toBe("0");
    const detail = jako(STAFF, `SELECT draft->>'canvas_html' FROM public.get_web_page_admin('${ZVEREJNENA}')`);
    expect(detail.ok && detail.out).toBe("<p>rozpracovano</p>");
  });

  it("zastaralé razítko → 409, aktuální projde", () => {
    const stare = jako(STAFF, `SELECT public.update_web_page_canvas_admin(p_id => '${ZVEREJNENA}', p_canvas_html => '<p>x</p>',
                                 p_expected_stamp => '2000-01-01T00:00:00Z')`);
    expect(stare.ok).toBe(false);
    expect(!stare.ok && stare.err).toMatch(/changed since it was loaded/);

    const ted = razitko(ZVEREJNENA);
    const ok = jako(STAFF, `SELECT public.update_web_page_canvas_admin(p_id => '${ZVEREJNENA}', p_canvas_html => '<p>rozpracovano 2</p>',
                              p_expected_stamp => '${ted}')::text`);
    expect(ok.ok, ok.ok ? "" : ok.err).toBe(true);
    expect(konceptHtml(ZVEREJNENA)).toBe("<p>rozpracovano 2</p>");
  });

  it("„Zveřejnit změny“ přelije koncept na web, smaže ho a zapíše verzi i audit (bez 403)", () => {
    const auditPred = Number(svc(`SELECT count(*) FROM public.audit_journal WHERE user_id = '${STAFF}'`));
    const r = jako(STAFF, `SELECT public.update_web_page_canvas_admin(p_id => '${ZVEREJNENA}', p_publish => true)::text`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(zivyHtml(ZVEREJNENA)).toBe("<p>rozpracovano 2</p>");
    expect(konceptHtml(ZVEREJNENA)).toBe("");
    expect(svc(`SELECT kind || ':' || label FROM public.web_page_versions WHERE page_id = '${ZVEREJNENA}'`)).toBe("published:publish");
    expect(Number(svc(`SELECT count(*) FROM public.audit_journal WHERE user_id = '${STAFF}'`))).toBeGreaterThan(auditPred);
  });

  it("ruční verze jde staffovi založit (create_web_page_version byla INVOKER → RLS 403)", () => {
    const r = jako(STAFF, `SELECT public.create_web_page_version('${ZVEREJNENA}', 'ručně')::text`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
  });

  it("zahození konceptu vrátí editor ke zveřejněnému stavu", () => {
    jako(STAFF, `SELECT public.update_web_page_canvas_admin(p_id => '${ZVEREJNENA}', p_canvas_html => '<p>omyl</p>')`);
    expect(konceptHtml(ZVEREJNENA)).toBe("<p>omyl</p>");
    const r = jako(STAFF, `SELECT public.discard_web_page_draft_admin('${ZVEREJNENA}')::text`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(konceptHtml(ZVEREJNENA)).toBe("");
    expect(zivyHtml(ZVEREJNENA)).toBe("<p>rozpracovano 2</p>");
  });

  it("obnova verze u zveřejněné stránky jde do konceptu, web se nezmění", () => {
    const verze = svc(`SELECT id FROM public.web_page_versions WHERE page_id = '${ZVEREJNENA}' AND kind = 'published'`);
    jako(STAFF, `SELECT public.update_web_page_canvas_admin(p_id => '${ZVEREJNENA}', p_canvas_html => '<p>novejsi</p>', p_publish => true)`);
    const r = jako(STAFF, `SELECT public.restore_web_page_version('${ZVEREJNENA}', '${verze}')`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(zivyHtml(ZVEREJNENA)).toBe("<p>novejsi</p>");
    expect(konceptHtml(ZVEREJNENA)).toBe("<p>rozpracovano 2</p>");
    jako(STAFF, `SELECT public.discard_web_page_draft_admin('${ZVEREJNENA}')`);
  });

  it("šablona u zveřejněné stránky jde do konceptu a nepřepíše vlastní otisk ani roli stránky", () => {
    const r = jako(STAFF, `SELECT public.apply_web_page_template('${ZVEREJNENA}', '${SABLONA}')`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(zivyHtml(ZVEREJNENA)).toBe("<p>novejsi</p>");
    expect(konceptHtml(ZVEREJNENA)).toBe("<p>sablona</p>");
    const nastaveni = JSON.parse(
      svc(`SELECT page_settings::text FROM public.web_page_versions WHERE page_id = '${ZVEREJNENA}' AND kind = 'draft'`),
    ) as Record<string, string>;
    expect(nastaveni.seed_fingerprint).toBe(`otisk-${RUN}`); // jinak by seed stránku přepsal
    expect(nastaveni.role).toBe("partial");
    expect(nastaveni.background).toBe("#fff"); // zbytek ze šablony
    jako(STAFF, `SELECT public.discard_web_page_draft_admin('${ZVEREJNENA}')`);
  });

  it("nezveřejněná stránka koncept nepotřebuje — ukládá se rovnou", () => {
    const r = jako(STAFF, `SELECT public.update_web_page_canvas_admin(p_id => '${NEZVEREJNENA}', p_canvas_html => '<p>skryte 2</p>')::text`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(zivyHtml(NEZVEREJNENA)).toBe("<p>skryte 2</p>");
    expect(konceptHtml(NEZVEREJNENA)).toBe("");
  });

  it("člen bez role → Unauthorized; anonym → bez grantu", () => {
    const clen = jako(CLEN, `SELECT public.update_web_page_canvas_admin(p_id => '${ZVEREJNENA}', p_canvas_html => '<p>cizi</p>')`);
    expect(!clen.ok && clen.err).toMatch(/Unauthorized/);
    const anon = jako(null, `SELECT public.save_web_page_draft_admin('${ZVEREJNENA}')`);
    expect(!anon.ok && anon.err).toMatch(/permission denied/);
    expect(zivyHtml(ZVEREJNENA)).toBe("<p>novejsi</p>");
  });
});
