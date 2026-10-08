/**
 * Příjem pošty: e-mail se do story zapíše JEN přes sken (revize integrátora 2026-10-05).
 *
 * ⛔ Dřív `append_inbound_comm_entry_audited` žádný verdikt antiviru nekontroloval —
 * komentář sliboval „downstream gate“, ale nikdo ji nevynucoval. Teď pro kanál `email`:
 *   · bez p_event_id                       → výjimka (nic se nezapíše)
 *   · event bez verdiktu (nezměřeno)        → výjimka
 *   · verdikt infected (event exhausted)    → výjimka
 *   · verdikt error (event failed)          → výjimka
 *   · čistý verdikt JINÉ zprávy             → výjimka
 *   · event jiné story / jiného zdroje      → výjimka
 *   · čistý verdikt téže zprávy             → záznam interní, s odkazem na event a verdikt;
 *                                              event uzavřen (completed) a nese story_id;
 *                                              opakované volání = dedup (jeden záznam)
 *   · dva SOUBĚŽNÉ appendy téže zprávy      → jeden záznam (zámek eventu FOR UPDATE)
 * Stráž: obě funkce (append i výběr opakování) zastaví volajícího bez role služby i tehdy, když
 * by mu grant EXECUTE prošel (is_service_role; search_path pg_catalog, public, pg_temp).
 * Kotvy: jiný kanál bez eventu se zapíše jako dřív (viditelný partnerovi); výběr opakování
 * vrátí jen jmenované zdroje; stará signatura appendu a jednorázový ingest neexistují.
 *
 * Spouští se přes: npm run test:db (jednorázová DB).
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER, isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { psqlQuery, psqlQueryAs } from "./validation-utils";

const dbAvailable = isPgReachable();
const APPEND = "public.append_inbound_comm_entry_audited(uuid,text,text,text,text,text,uuid,jsonb,uuid)";
const RETRY = "public.get_retryable_integration_events(text[],integer)";

const story: string[] = [];
const udalost: string[] = [];

const svc = (q: string): string => psqlQueryAs("service_role", q);
/** Text chyby, nebo "" když dotaz prošel. */
function chyba(f: () => unknown): string {
  try {
    f();
    return "";
  } catch (e) {
    return String(e);
  }
}
function novaStory(): string {
  // CTE, ne holé INSERT … RETURNING: psql k němu tiskne i značku „INSERT 0 1“ a ID by bylo poškozené.
  const id = psqlQuery(`WITH s AS (INSERT INTO public.partner_stories (title, status, origin) VALUES ('posta-rt', 'inbox', 'manual') RETURNING id) SELECT id FROM s`);
  story.push(id);
  return id;
}
function novaUdalost(ext: string, o: { zdroj?: string; story?: string } = {}): string {
  const id = svc(
    `SELECT public.record_integration_event('${o.zdroj ?? "email_inbound"}', '${ext}', 'email.inbound', NULL, ${o.story ? `'${o.story}'` : "NULL"}, NULL, 'test:posta', NULL)->>'event_id'`,
  );
  udalost.push(id);
  return id;
}
const verdikt = (ev: string, v: "clean" | "infected" | "error") =>
  svc(`SELECT public.record_comm_av_scan_audited('${ev}', '${v}', 'clamav', ${v === "infected" ? "'Eicar-Test-Signature'" : "NULL"}, 'sha256:test', '{}'::jsonb)`);
const append = (st: string, kanal: string, ext: string, ev: string | null) =>
  svc(
    `SELECT public.append_inbound_comm_entry_audited('${st}', '${kanal}', '${ext}', 'odesilatel@example.test', 'Předmět', 'Tělo zprávy', NULL, '{}'::jsonb, ${ev ? `'${ev}'` : "NULL"})`,
  );
const pocet = (ext: string) => Number(psqlQuery(`SELECT count(*) FROM public.story_entries WHERE metadata->>'external_id' = '${ext}'`));

beforeAll(async () => {
  await reportTestCapabilities("Příjem pošty — append jen po skenu");
});

afterAll(() => {
  if (!dbAvailable) return;
  const s = story.map((x) => `'${x}'`).join(",");
  const u = udalost.filter(Boolean).map((x) => `'${x}'`).join(",");
  if (s) psqlQuery(`DELETE FROM public.story_entries WHERE story_id IN (${s})`);
  if (u) psqlQuery(`DELETE FROM public.integration_events WHERE id IN (${u})`);
  if (s) psqlQuery(`DELETE FROM public.partner_stories WHERE id IN (${s})`);
});

describe("append e-mailu jen s čistým verdiktem skenu", () => {
  it.skipIf(!dbAvailable)("granty: nová signatura jen service_role; stará signatura appendu, ingest bez skenu a výběr opakování bez zdrojů NEEXISTUJÍ", () => {
    const r = psqlQuery(`SELECT
      has_function_privilege('anon','${APPEND}','EXECUTE'),
      has_function_privilege('authenticated','${APPEND}','EXECUTE'),
      has_function_privilege('service_role','${APPEND}','EXECUTE'),
      to_regprocedure('public.append_inbound_comm_entry_audited(uuid,text,text,text,text,text,uuid,jsonb)') IS NULL,
      to_regprocedure('public.ingest_inbound_comm_audited(text,text,uuid,text,text,text,uuid,text,jsonb)') IS NULL,
      to_regprocedure('public.get_retryable_integration_events(integer)') IS NULL,
      has_function_privilege('authenticated','${RETRY}','EXECUTE')`);
    expect(r.split("|")).toEqual(["f", "f", "t", "t", "t", "t", "f"]);
  });

  it.skipIf(!dbAvailable)("⛔ přihlášený BEZ role služby: zastaví ho STRÁŽ uvnitř obou funkcí, i kdyby grant prošel (fork s výchozím EXECUTE) → 42501", () => {
    // Grant se v transakci dočasně udělí, aby se měřila vnitřní stráž (is_service_role), ne granty.
    const pod = (fn: string, volani: string) =>
      chyba(() =>
        psqlQuery(
          `BEGIN; GRANT EXECUTE ON FUNCTION ${fn} TO authenticated; SET LOCAL ROLE authenticated; SELECT ${volani}; ROLLBACK;`,
        ),
      );
    expect(pod(APPEND, `public.append_inbound_comm_entry_audited(gen_random_uuid(), 'chat', 'x', NULL, NULL, NULL, NULL, '{}'::jsonb, NULL)`)).toMatch(
      /append_inbound_comm_entry_audited: jen role služby/,
    );
    expect(pod(RETRY, `public.get_retryable_integration_events(ARRAY['github_webhook'], 1)`)).toMatch(
      /get_retryable_integration_events: jen role služby/,
    );
  });

  it.skipIf(!dbAvailable)("⛔ e-mail bez p_event_id se nezapíše", () => {
    const st = novaStory();
    const ext = `bez-eventu-${randomUUID()}`;
    expect(chyba(() => append(st, "email", ext, null))).toMatch(/jen s p_event_id/);
    expect(pocet(ext)).toBe(0);
  });

  it.skipIf(!dbAvailable)("⛔ event bez verdiktu = nezměřeno = nečisté; infected (exhausted) i error se nezapíšou", () => {
    const st = novaStory();
    const nezmereno = `nezmereno-${randomUUID()}`;
    const evN = novaUdalost(nezmereno, { story: st });
    expect(chyba(() => append(st, "email", nezmereno, evN))).toMatch(/bez čistého verdiktu .* nezměřeno/);

    const infikovano = `infikovano-${randomUUID()}`;
    const evI = novaUdalost(infikovano, { story: st });
    verdikt(evI, "infected");
    expect(psqlQuery(`SELECT status FROM public.integration_events WHERE id = '${evI}'`)).toBe("exhausted");
    expect(chyba(() => append(st, "email", infikovano, evI))).toMatch(/exhausted/);

    const selhani = `chyba-skenu-${randomUUID()}`;
    const evE = novaUdalost(selhani, { story: st });
    verdikt(evE, "error");
    expect(chyba(() => append(st, "email", selhani, evE))).toMatch(/bez čistého verdiktu .* error/);

    expect([pocet(nezmereno), pocet(infikovano), pocet(selhani)]).toEqual([0, 0, 0]);
  });

  it.skipIf(!dbAvailable)("⛔ čistý verdikt JINÉ zprávy, event jiné story nebo jiného zdroje → výjimka", () => {
    const st = novaStory();
    const jina = novaStory();
    const cizi = `cizi-${randomUUID()}`;
    const evC = novaUdalost(cizi, { story: st });
    verdikt(evC, "clean");
    const ext = `moje-${randomUUID()}`;
    expect(chyba(() => append(st, "email", ext, evC))).toMatch(/patří jiné zprávě/);

    const evS = novaUdalost(`jina-story-${randomUUID()}`, { story: jina });
    verdikt(evS, "clean");
    const extS = psqlQuery(`SELECT external_id FROM public.integration_events WHERE id = '${evS}'`);
    expect(chyba(() => append(st, "email", extS, evS))).toMatch(/patří story/);

    const extZ = `manual-${randomUUID()}`;
    const evZ = novaUdalost(extZ, { zdroj: "manual", story: st });
    verdikt(evZ, "clean");
    expect(chyba(() => append(st, "email", extZ, evZ))).toMatch(/není e-mailový/);
    expect([pocet(ext), pocet(extS), pocet(extZ)]).toEqual([0, 0, 0]);
  });

  it.skipIf(!dbAvailable)("kotva: čistý verdikt téže zprávy → záznam interní s odkazem na event a verdikt; event completed + story; opakování = dedup", () => {
    const st = novaStory();
    const ext = `cista-${randomUUID()}`;
    const ev = novaUdalost(ext);
    verdikt(ev, "clean");
    const prvni = JSON.parse(append(st, "email", ext, ev));
    expect(prvni.deduped).toBe(false);
    const zaznam = psqlQuery(
      `SELECT entry_type, is_internal, metadata->>'integration_event_id', metadata->'av'->>'verdict', created_by IS NULL FROM public.story_entries WHERE id = '${prvni.entry_id}'`,
    );
    expect(zaznam.split("|")).toEqual(["inbound_email", "t", ev, "clean", "t"]);
    expect(psqlQuery(`SELECT status || '|' || story_id FROM public.integration_events WHERE id = '${ev}'`)).toBe(`completed|${st}`);
    const druhy = JSON.parse(append(st, "email", ext, ev));
    expect(druhy).toMatchObject({ deduped: true, entry_id: prvni.entry_id });
    expect(pocet(ext)).toBe(1);
  });

  it.skipIf(!dbAvailable)("kotva: jiný kanál bez eventu se zapíše jako dřív (viditelný partnerovi)", () => {
    const st = novaStory();
    const ext = `chat-${randomUUID()}`;
    const r = JSON.parse(append(st, "chat", ext, null));
    expect(psqlQuery(`SELECT entry_type || '|' || is_internal FROM public.story_entries WHERE id = '${r.entry_id}'`)).toBe("inbound_chat|false");
  });

  it.skipIf(!dbAvailable)("⛔ dva SOUBĚŽNÉ appendy téže zprávy → jeden záznam (druhý čeká na zámek eventu a vrátí dedup)", async () => {
    const st = novaStory();
    const ext = `soubeh-${randomUUID()}`;
    const ev = novaUdalost(ext);
    verdikt(ev, "clean");
    const pripoj = async () => {
      const c = new pg.Client({ host: PG_HOST, port: Number(PG_PORT), user: PG_USER, password: PG_PASSWORD, database: PG_DATABASE });
      await c.connect();
      return c;
    };
    const dotaz = `SELECT public.append_inbound_comm_entry_audited($1, 'email', $2, 'odesilatel@example.test', 'Předmět', 'Tělo', NULL, '{}'::jsonb, $3) AS r`;
    const a = await pripoj();
    const b = await pripoj();
    try {
      await a.query("BEGIN");
      await a.query("SET LOCAL role service_role");
      const ra = await a.query(dotaz, [st, ext, ev]);
      expect(ra.rows[0].r.deduped).toBe(false);
      await b.query("SET role service_role");
      let bHotovo = false;
      const rbSlib = b.query(dotaz, [st, ext, ev]).then((x) => {
        bHotovo = true;
        return x;
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(bHotovo, "druhý append musí čekat na zámek eventu, dokud první nedokončí transakci").toBe(false);
      await a.query("COMMIT");
      const rb = await rbSlib;
      expect(rb.rows[0].r).toMatchObject({ deduped: true, entry_id: ra.rows[0].r.entry_id });
      expect(pocet(ext)).toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
  });
});

describe("výběr událostí k opakování: jen zdroje, které volající umí", () => {
  it.skipIf(!dbAvailable)("⛔ bez seznamu zdrojů výjimka; e-mail se do github mostu nedostane; kotva: github_webhook ano; p_limit omezuje", () => {
    const st = novaStory();
    const extE = `retry-email-${randomUUID()}`;
    const evE = novaUdalost(extE, { story: st });
    verdikt(evE, "error"); // failed + next_retry_at
    const evG1 = novaUdalost(`retry-gh-${randomUUID()}`, { zdroj: "github_webhook" });
    const evG2 = novaUdalost(`retry-gh-${randomUUID()}`, { zdroj: "github_webhook" });
    for (const e of [evE, evG1, evG2]) {
      psqlQuery(`UPDATE public.integration_events SET status = 'failed', next_retry_at = now() - interval '1 minute', attempt = 1, max_attempts = 3 WHERE id = '${e}'`);
    }
    expect(chyba(() => svc(`SELECT public.get_retryable_integration_events(NULL::text[], 20)`))).toMatch(/p_sources je povinný/);
    expect(chyba(() => svc(`SELECT public.get_retryable_integration_events(ARRAY[]::text[], 20)`))).toMatch(/p_sources je povinný/);
    const gh = JSON.parse(svc(`SELECT public.get_retryable_integration_events(ARRAY['github_webhook'], 100)`)) as Array<{ id: string; event_source: string }>;
    const ids = gh.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([evG1, evG2]));
    expect(ids).not.toContain(evE);
    expect(new Set(gh.map((x) => x.event_source))).toEqual(new Set(["github_webhook"]));
    const jeden = JSON.parse(svc(`SELECT public.get_retryable_integration_events(ARRAY['github_webhook'], 1)`)) as unknown[];
    expect(jeden).toHaveLength(1);
  });
});
