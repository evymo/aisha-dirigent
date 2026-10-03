import { beforeAll, describe, expect, it } from "vitest";
import { validateBlockData } from "@aisha/surface-blocks";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * RATIFIKACE IDENTIT Z PLOCHY — real-DB runtime test (throwaway PG přes `npm run test:db`).
 *
 * ⛔ NAMĚŘENO 2026-09-15: návrhy identit z ingestu (Raynet, 907 položek) plocha
 * nezobrazila a nešlo o nich rozhodnout. Dvě vady, každá sama stačila:
 *   1. get_twin_ref_review_block vracel jen {items} — maska review_queue chce
 *      {entity_kind, items, actions}, klient blok zahodil.
 *   2. submit_evidence_review_audited kind 'twin_identity' neznal (22023), takže
 *      ani sesterská fronta get_twin_identity_queue neuměla zapsat rozhodnutí.
 *
 * Tvrdí se:
 *   · blok ve VŠECH větvích (data / bez konfigurace / bez nároku) projde maskou;
 *   · potvrzení z plochy = autoritativní vazba (resolve ji vidí) + audit bez PII;
 *   · zamítnutí = verdikt na návrhu, ne smazání;
 *   · neznámé rozhodnutí NEROZHODNE (ani potvrzení, ani tiché zamítnutí);
 *   · bez role správce se nezapíše nic.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const ZDROJ = `ratif-plocha-${process.pid}-${Date.now()}`;

beforeAll(async () => {
  await reportTestCapabilities("Ratifikace identit z plochy");
});

const FIXTURE = `
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
    WHERE ur.role IN ('admin','staff') ORDER BY ur.user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'fixture: no admin/staff user seeded'; END IF;
`;

/** Zavolá výraz jako `authenticated` s daným sub ve vrácené transakci; vrátí jsonb. */
function jakoUzivatel(sub: string, vyraz: string, priprava = ""): unknown {
  const ZNACKA = "@@ODPOVED@@";
  const out = psqlQuery(
    `begin; ${priprava} ` +
      `select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true); ` +
      `set local role authenticated; ` +
      `select '${ZNACKA}' || (${vyraz})::text; rollback;`,
  );
  const radek = out.split("\n").map((r) => r.trim()).find((r) => r.startsWith(ZNACKA));
  if (!radek) throw new Error(`ve výstupu psql chybí odpověď: ${out.slice(0, 200)}`);
  return JSON.parse(radek.slice(ZNACKA.length));
}

describe("ratifikace identit z plochy", () => {
  it.skipIf(!dbAvailable)("blok review_queue projde maskou ve všech větvích a nese návrhy zdroje", () => {
    const admin = psqlQuery(
      `select user_id from public.user_roles where role in ('admin','staff') order by user_id limit 1`,
    );
    expect(admin, "fixture: no admin/staff user seeded").toMatch(/^[0-9a-f-]{36}$/);

    // Návrh vznikne ve stejné vrácené transakci — nic nezůstane v DB.
    const priprava =
      `select set_config('request.jwt.claim.sub', '${admin}', true); ` +
      `select public.twin_identity_propose_binding(` +
      `(public.twin_upsert_entity_audited('person', '${ZDROJ}-prim', 'p-1', 'Jana Testová')->>'twin_id')::uuid, ` +
      `'${ZDROJ}', 'RAY-1', 'primary_id', 'rule:email', 0.87); `;
    const params = `'{"source":"${ZDROJ}","title_template":"{label}","quote_template":"{confidence} %"}'::jsonb`;

    const sData = jakoUzivatel(admin, `public.get_twin_ref_review_block(${params})`, priprava) as {
      data: { entity_kind: string; items: { id: string; title: string }[]; actions: unknown[] };
    };
    const v = validateBlockData(sData.data);
    expect(v.ok, `maska: ${JSON.stringify(v)}`).toBe(true);
    expect(sData.data.entity_kind).toBe("twin_identity");
    expect(sData.data.items.map((i) => i.title)).toContain("Jana Testová");
    expect(sData.data.actions).toHaveLength(2);

    // Bez konfigurace i bez nároku: prázdná fronta, ale POŘÁD platný blok —
    // jinak ho klient zahodí a uživatel neuvidí ani „nic k rozhodnutí".
    for (const [sub, vyraz] of [
      [admin, `public.get_twin_ref_review_block('{}'::jsonb)`],
      ["00000000-0000-4000-8000-00000000abcd", `public.get_twin_ref_review_block(${params})`],
    ] as const) {
      const r = jakoUzivatel(sub, vyraz) as { data: { items: unknown[] } };
      expect(validateBlockData(r.data).ok, `${vyraz} jako ${sub}`).toBe(true);
      expect(r.data.items).toEqual([]);
    }
  });

  it.skipIf(!dbAvailable)("potvrzení a zamítnutí z plochy; neznámé rozhodnutí ani cizí role nezapíšou", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_admin uuid; v_twin uuid; v_ref_ok uuid; v_ref_ne uuid; v_ref_typo uuid;
  v_r jsonb; v_state text; v_failed boolean; v_n int;
BEGIN
  ${FIXTURE}
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  v_twin := (public.twin_upsert_entity_audited('person', '${ZDROJ}-prim', 'p-2', 'Petr Test')->>'twin_id')::uuid;
  v_ref_ok   := (public.twin_identity_propose_binding(v_twin, '${ZDROJ}', 'RAY-OK',   'primary_id', 'rule:email', 0.9)->>'ref_id')::uuid;
  v_ref_ne   := (public.twin_identity_propose_binding(v_twin, '${ZDROJ}', 'RAY-NE',   'primary_id', 'rule:name',  0.4)->>'ref_id')::uuid;
  v_ref_typo := (public.twin_identity_propose_binding(v_twin, '${ZDROJ}', 'RAY-TYPO', 'primary_id', 'rule:name',  0.5)->>'ref_id')::uuid;

  -- 1. potvrzení z plochy → autoritativní vazba
  v_r := public.submit_evidence_review_audited('twin_identity', v_ref_ok, 'confirmed', 'ověřeno telefonem');
  IF v_r->>'state' <> 'confirmed' THEN RAISE EXCEPTION 'confirm: expected state confirmed, got %', v_r; END IF;
  IF public.twin_identity_resolve('${ZDROJ}', 'RAY-OK') IS DISTINCT FROM v_twin THEN
    RAISE EXCEPTION 'confirmed binding must resolve to the twin';
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_journal
   WHERE action = 'evidence.review_decided' AND details->>'entity_id' = v_ref_ok::text
     AND details->>'entity_kind' = 'twin_identity' AND NOT (details ? 'source_key');
  IF v_n <> 1 THEN RAISE EXCEPTION 'audit row missing or carries source_key (n=%)', v_n; END IF;

  -- 2. zamítnutí → verdikt, řádek zůstává
  v_r := public.submit_evidence_review_audited('twin_identity', v_ref_ne, 'rejected', 'jiná osoba');
  SELECT state INTO v_state FROM public.twin_external_refs WHERE id = v_ref_ne;
  IF v_r->>'state' <> 'rejected' OR v_state <> 'rejected' THEN
    RAISE EXCEPTION 'reject: expected rejected, got % / row %', v_r, v_state;
  END IF;

  -- 3. neznámé rozhodnutí nerozhodne NIC
  v_failed := false;
  BEGIN
    PERFORM public.submit_evidence_review_audited('twin_identity', v_ref_typo, 'confirmd');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  SELECT state INTO v_state FROM public.twin_external_refs WHERE id = v_ref_typo;
  IF NOT v_failed OR v_state <> 'proposed' THEN
    RAISE EXCEPTION 'typo decision must raise 22023 and leave proposed (failed=%, state=%)', v_failed, v_state;
  END IF;

  -- 4. bez role správce se nezapíše nic
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000abcd', true);
  v_failed := false;
  BEGIN
    PERFORM public.submit_evidence_review_audited('twin_identity', v_ref_typo, 'confirmed');
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  SELECT state INTO v_state FROM public.twin_external_refs WHERE id = v_ref_typo;
  IF NOT v_failed OR v_state <> 'proposed' THEN
    RAISE EXCEPTION 'non-reviewer must get 42501 and leave proposed (failed=%, state=%)', v_failed, v_state;
  END IF;

  RAISE NOTICE 'ratifikace z plochy OK';
END $$;
`);
    expect(run).not.toThrow();
  });
});
