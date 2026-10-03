import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * KATALOGY ZDROJE — real-DB runtime test (throwaway PG přes `npm run test:db`).
 *
 * ⛔ NAMĚŘENO 2026-09-15: plocha extranetu čte jen jádro, ale KPI komunity,
 * akce, místa i členové zdroje existovali jen jako živé /source/* routy brokeru.
 * source_catalog_rows + audience_sync_source_catalog jsou místo, kam je broker
 * v taktu ukládá. Tvrdí se vlastnosti, na kterých plocha stojí:
 *   · snapshot = celá množina: co ve zdroji zmizelo, zmizí; first_seen_at přežije update;
 *   · PRÁZDNÝ snapshot nevymaže dobrá data (refused_empty), vědomé vyprázdnění ano;
 *   · series = přírůstek: starší řádky (historie) zůstávají;
 *   · vadná dávka (bez externalId, vnořené pole, špatný druh/režim) nezapíše NIC;
 *   · zapisuje jen služba; číst smí jen správce (RLS), běžný přihlášený nic.
 * Vše běží v jedné transakci s ROLLBACK — v DB nic nezůstane.
 */

const dbAvailable = isPgReachable();
const ZDROJ = `katalog-test-${process.pid}-${Date.now()}`;
const CIZI = "00000000-0000-4000-8000-00000000cafe";

beforeAll(async () => {
  await reportTestCapabilities("Katalogy zdroje");
});

const SLUZBA = `PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);`;

describe("katalogy zdroje (audience_sync_source_catalog)", () => {
  it.skipIf(!dbAvailable)("snapshot, series, odmítnutí prázdna i vadné dávky, zápis jen službou, čtení jen správcem", () => {
    const run = () =>
      psqlMultiline(`\\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_r jsonb; v_n int; v_first timestamptz; v_failed boolean;
BEGIN
  ${SLUZBA}

  -- 1. snapshot: tři místa
  v_r := public.audience_sync_source_catalog('${ZDROJ}', 'venue', 'snapshot',
    '[{"externalId":"v1","occurredAt":null,"fields":{"title":"Praha","online":false}},
      {"externalId":"v2","occurredAt":null,"fields":{"title":"Brno"}},
      {"externalId":"v3","occurredAt":"2026-01-02T10:00:00Z","fields":{"title":"Wien","capacity":40}}]'::jsonb);
  IF (v_r->>'upserted')::int <> 3 OR (v_r->>'removed')::int <> 0 THEN
    RAISE EXCEPTION 'snapshot #1: expected 3/0, got %', v_r;
  END IF;
  SELECT first_seen_at INTO v_first FROM public.source_catalog_rows
   WHERE source_slug = '${ZDROJ}' AND kind = 'venue' AND external_id = 'v1';
  PERFORM pg_sleep(0.01);

  -- 2. snapshot znovu bez v2, v1 přejmenované → v2 zmizí, v1 se aktualizuje, first_seen_at zůstane
  v_r := public.audience_sync_source_catalog('${ZDROJ}', 'venue', 'snapshot',
    '[{"externalId":"v1","occurredAt":null,"fields":{"title":"Praha — gonpa"}},
      {"externalId":"v3","occurredAt":"2026-01-02T10:00:00Z","fields":{"title":"Wien","capacity":40}}]'::jsonb);
  IF (v_r->>'removed')::int <> 1 THEN RAISE EXCEPTION 'snapshot #2: expected removed=1, got %', v_r; END IF;
  IF EXISTS (SELECT 1 FROM public.source_catalog_rows WHERE source_slug='${ZDROJ}' AND kind='venue' AND external_id='v2') THEN
    RAISE EXCEPTION 'snapshot #2: v2 must be gone';
  END IF;
  IF (SELECT fields->>'title' FROM public.source_catalog_rows WHERE source_slug='${ZDROJ}' AND kind='venue' AND external_id='v1') <> 'Praha — gonpa'
     OR (SELECT first_seen_at FROM public.source_catalog_rows WHERE source_slug='${ZDROJ}' AND kind='venue' AND external_id='v1') <> v_first THEN
    RAISE EXCEPTION 'snapshot #2: v1 must be updated and keep first_seen_at';
  END IF;

  -- 3. prázdný snapshot nad neprázdnými daty se ODMÍTNE, vědomé vyprázdnění projde
  v_r := public.audience_sync_source_catalog('${ZDROJ}', 'venue', 'snapshot', '[]'::jsonb);
  SELECT count(*) INTO v_n FROM public.source_catalog_rows WHERE source_slug='${ZDROJ}' AND kind='venue';
  IF NOT (v_r->>'refused_empty')::boolean OR v_n <> 2 THEN
    RAISE EXCEPTION 'empty snapshot must be refused and keep rows (r=%, n=%)', v_r, v_n;
  END IF;
  v_r := public.audience_sync_source_catalog('${ZDROJ}', 'venue', 'snapshot', '[]'::jsonb, true);
  SELECT count(*) INTO v_n FROM public.source_catalog_rows WHERE source_slug='${ZDROJ}' AND kind='venue';
  IF (v_r->>'removed')::int <> 2 OR v_n <> 0 THEN
    RAISE EXCEPTION 'allow_empty must clear the catalog (r=%, n=%)', v_r, v_n;
  END IF;

  -- 4. series: přírůstek nesmaže historii; duplicitní externalId v dávce vyhraje poslední
  PERFORM public.audience_sync_source_catalog('${ZDROJ}', 'community_kpi', 'series',
    '[{"externalId":"2026-09-14","occurredAt":"2026-09-14T00:00:00Z","fields":{"members_total":10}}]'::jsonb);
  v_r := public.audience_sync_source_catalog('${ZDROJ}', 'community_kpi', 'series',
    '[{"externalId":"2026-09-15","occurredAt":"2026-09-15T00:00:00Z","fields":{"members_total":11}},
      {"externalId":"2026-09-15","occurredAt":"2026-09-15T00:00:00Z","fields":{"members_total":12}}]'::jsonb);
  SELECT count(*) INTO v_n FROM public.source_catalog_rows WHERE source_slug='${ZDROJ}' AND kind='community_kpi';
  IF v_n <> 2 OR (v_r->>'removed')::int <> 0 THEN RAISE EXCEPTION 'series must keep history (n=%, r=%)', v_n, v_r; END IF;
  IF (SELECT (fields->>'members_total')::int FROM public.source_catalog_rows
       WHERE source_slug='${ZDROJ}' AND kind='community_kpi' AND external_id='2026-09-15') <> 12 THEN
    RAISE EXCEPTION 'duplicate externalId in one batch: last occurrence must win';
  END IF;

  -- 5. vadné dávky nezapíšou NIC
  v_failed := false;
  BEGIN
    PERFORM public.audience_sync_source_catalog('${ZDROJ}', 'event', 'snapshot',
      '[{"externalId":"e1","fields":{"title":"ok"}},{"fields":{"title":"bez id"}}]'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed OR EXISTS (SELECT 1 FROM public.source_catalog_rows WHERE source_slug='${ZDROJ}' AND kind='event') THEN
    RAISE EXCEPTION 'row without externalId must reject the whole batch';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.audience_sync_source_catalog('${ZDROJ}', 'event', 'snapshot',
      '[{"externalId":"e1","fields":{"tags":["a","b"]}}]'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'nested field value must be rejected'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.audience_sync_source_catalog('${ZDROJ}', 'Event', 'snapshot', '[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'invalid kind slug must be rejected'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.audience_sync_source_catalog('${ZDROJ}', 'event', 'replace', '[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unknown mode must be rejected'; END IF;

  -- podklad pro kontrolu čtení
  PERFORM public.audience_sync_source_catalog('${ZDROJ}', 'venue', 'snapshot',
    '[{"externalId":"v9","occurredAt":null,"fields":{"title":"Čtení"}}]'::jsonb);

  -- 6. bez služby se nezapíše nic
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"${CIZI}"}', true);
  v_failed := false;
  BEGIN
    PERFORM public.audience_sync_source_catalog('${ZDROJ}', 'venue', 'snapshot', '[]'::jsonb, true);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-service caller must get 42501'; END IF;
END $$;

-- 7. RLS: běžný přihlášený nevidí nic, správce vidí
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${CIZI}"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.source_catalog_rows WHERE source_slug = '${ZDROJ}') <> 0 THEN
    RAISE EXCEPTION 'non-admin must not read catalog rows';
  END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub',
    (SELECT user_id FROM public.user_roles WHERE role IN ('admin','staff') ORDER BY user_id LIMIT 1))::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.source_catalog_rows WHERE source_slug = '${ZDROJ}' AND kind = 'venue') <> 1 THEN
    RAISE EXCEPTION 'admin must read catalog rows';
  END IF;
  RAISE NOTICE 'katalogy zdroje OK';
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });
});
