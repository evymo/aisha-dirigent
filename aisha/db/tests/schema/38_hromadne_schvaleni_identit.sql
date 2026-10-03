-- pgTAP schema-contract tests — hromadné schválení návrhů identit
-- ============================================================================
-- ⛔ PRAVIDLO MAJITELE (2026-09-28): „teprve dva zdroje pravdy se shodou sto procent
-- opravňují k návrhu na hromadné sloučení"; jméno bez IČO může být soukromá osoba;
-- IČO v závislosti na časovém údaji; IČO + název + datum z veřejného rejstříku =
-- potvrzení existence. Vše vratné, s původem u dat.
--
-- Měří:
--   · třídy twin_ref_tridy — shoda s rejstříkem, shoda dvou tříd dokladů bez
--     rejstříku, jeden zdroj, rozpor, PŘEJMENOVÁNÍ (staré jméno na starém dokladu
--     je shoda, ne rozpor), jiné jméno mezi dvěma zdroji, jméno nesedí na dvojče,
--     smíšené dvojče, samotné jméno = nepodporováno;
--   · blok skupin nabídne jen třídy povolené v datech bloku, bez nároku nic;
--   · dávka přepočítá třídu v okamžiku provedení (co vypadlo, se neschválí),
--     jde touž ratifikací, píše deník a audit; jen 'confirmed';
--   · vrácení v opačném pořadí, změněné položky přeskočí.
--
-- Fixture: předpona `pgtap-hrom`, UNSEEDED jako superuser, ROLLBACK.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(31);

SELECT set_config('hs.admin', gen_random_uuid()::text, true);
SELECT set_config('hs.plain', gen_random_uuid()::text, true);
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES (current_setting('hs.admin')::uuid), (current_setting('hs.plain')::uuid);
INSERT INTO user_roles (user_id, role) VALUES (current_setting('hs.admin')::uuid, 'admin');
SET session_replication_role = origin;

-- ── Dvojčata firem a návrhy IČO ───────────────────────────────────────────────
CREATE TEMP TABLE hs_t (k text PRIMARY KEY, twin uuid, ref uuid);
WITH t AS (
  INSERT INTO twin_entities (entity_type, label)
  SELECT 'company', x.label FROM (VALUES
    ('Alfa s.r.o.'), ('Beta a.s.'), ('Gama s.r.o.'), ('Delta s.r.o.'), ('Epsilon s.r.o.'),
    ('Petr Novák'), ('Kappa s.r.o.'), ('Lambda s.r.o.'), ('Sigma s.r.o.')) x(label)
  RETURNING id, label)
INSERT INTO hs_t (k, twin) SELECT label, id FROM t;

WITH r AS (
  INSERT INTO twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confidence, valid_from)
  SELECT hs_t.twin, 'pgtap-hrom', x.klic, x.druh, 'proposed', 'pgtap', 1, timestamptz '2026-01-01 00:00:00+00'
  FROM (VALUES ('Alfa s.r.o.', '11111111', 'company_ico'), ('Beta a.s.', '22222222', 'company_ico'),
               ('Gama s.r.o.', '33333333', 'company_ico'), ('Delta s.r.o.', '44444444', 'company_ico'),
               ('Epsilon s.r.o.', '55555555', 'company_ico'), ('Petr Novák', 'Petr Novák', 'company_name'),
               ('Kappa s.r.o.', '77777777', 'company_ico'), ('Lambda s.r.o.', '88888888', 'company_ico'),
               ('Sigma s.r.o.', '99999999', 'company_ico')) x(label, klic, druh)
  JOIN hs_t ON hs_t.k = x.label
  RETURNING id, twin_id)
UPDATE hs_t SET ref = r.id FROM r WHERE r.twin_id = hs_t.twin;
-- Sigma nese i jméno CIZÍ firmy (šum návrhů z ingestu) → smíšené dvojče
INSERT INTO twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by)
SELECT twin, 'pgtap-hrom', 'Moravská nemovitostní a.s.', 'company_name', 'proposed', 'pgtap'
FROM hs_t WHERE k = 'Sigma s.r.o.';

-- ── Doklady: účetnictví (transactional) a smlouvy (contractual) ───────────────
CREATE TEMP TABLE hs_d (n int, ico text, jmeno text, dt date, trida text, typ text);
INSERT INTO hs_d VALUES
  (1,  '11111111', 'ALFA, s. r. o.',     '2025-03-01', 'transactional', 'invoice'),
  (2,  '22222222', 'Beta a.s.',          '2025-03-01', 'transactional', 'invoice'),
  (3,  '33333333', 'Gama s.r.o.',        '2025-03-01', 'transactional', 'invoice'),
  (4,  '44444444', 'Stará Delta s.r.o.', '2023-06-01', 'transactional', 'invoice'),
  (5,  '44444444', 'Delta s.r.o.',       '2025-06-01', 'transactional', 'invoice'),
  (6,  '55555555', 'Omega s.r.o.',       '2025-03-01', 'transactional', 'invoice'),
  (7,  '77777777', 'Kappa s.r.o.',       '2025-03-01', 'transactional', 'invoice'),
  (8,  '77777777', 'Kappa, s.r.o.',      '2025-02-01', 'contractual',   'contract'),
  (9,  '88888888', 'Lambda s.r.o.',      '2019-01-01', 'contractual',   'contract'),
  (10, '88888888', 'Mu s.r.o.',          '2021-01-01', 'transactional', 'invoice'),
  (11, '88888888', 'Lambda s.r.o.',      '2026-01-01', 'transactional', 'invoice'),
  (12, '99999999', 'Sigma s.r.o.',       '2025-03-01', 'transactional', 'invoice');
INSERT INTO li_source_registry (source_sha256, doc_slug, doc_type, doc_class, filename, fields)
SELECT md5('pgtap-hrom-' || n) || md5('pgtap-hrom-x' || n), 'pgtap-hrom-' || n, typ, trida,
       'pgtap-hrom-' || n || '.json',
       jsonb_build_object('counterparty_id', jsonb_build_object('value', ico),
                          'counterparty', jsonb_build_object('value', jmeno),
                          case when typ = 'invoice' then 'issue_date' else 'signature_date' end,
                          jsonb_build_object('value', dt::text))
FROM hs_d;

-- ── Výpis z veřejného rejstříku: období jmen [od, do) ─────────────────────────
INSERT INTO li_source_registry (source_sha256, doc_slug, doc_type, doc_class, filename, fields, line_items)
SELECT md5('pgtap-hrom-rg-' || x.ico) || md5('pgtap-hrom-rgx-' || x.ico), 'pgtap-hrom-rg-' || x.ico,
       'pgtap_rejstrik', 'public_register', 'pgtap-hrom-rg-' || x.ico || '.json',
       jsonb_build_object('subject_ico', jsonb_build_object('value', ltrim(x.ico, '0'))), x.obdobi
FROM (VALUES
  ('11111111', jsonb_build_array(jsonb_build_object('fields', jsonb_build_object(
      'name', jsonb_build_object('value', 'Alfa s.r.o.'), 'valid_from', jsonb_build_object('value', '2019-01-01'))))),
  ('33333333', jsonb_build_array(jsonb_build_object('fields', jsonb_build_object(
      'name', jsonb_build_object('value', 'Gamma Holding s.r.o.'), 'valid_from', jsonb_build_object('value', '2019-01-01'))))),
  ('44444444', jsonb_build_array(
      jsonb_build_object('fields', jsonb_build_object('name', jsonb_build_object('value', 'Stara Delta s.r.o.'),
        'valid_from', jsonb_build_object('value', '2019-01-01'), 'valid_to', jsonb_build_object('value', '2024-01-01'))),
      jsonb_build_object('fields', jsonb_build_object('name', jsonb_build_object('value', 'Delta s.r.o.'),
        'valid_from', jsonb_build_object('value', '2024-01-01'))))),
  ('55555555', jsonb_build_array(jsonb_build_object('fields', jsonb_build_object(
      'name', jsonb_build_object('value', 'Omega s.r.o.'), 'valid_from', jsonb_build_object('value', '2019-01-01'))))),
  ('99999999', jsonb_build_array(jsonb_build_object('fields', jsonb_build_object(
      'name', jsonb_build_object('value', 'Sigma s.r.o.'), 'valid_from', jsonb_build_object('value', '2019-01-01')))))
) x(ico, obdobi);

SELECT set_config('hs.params', jsonb_build_object(
  'source', 'pgtap-hrom', 'entity_type', 'company',
  'date_fields', jsonb_build_object('invoice', jsonb_build_array('issue_date'),
                                    'contract', jsonb_build_array('signature_date', 'valid_from')),
  'register', jsonb_build_object('doc_type', 'pgtap_rejstrik', 'ico_field', 'subject_ico',
                                 'name_field', 'name', 'from_field', 'valid_from', 'to_field', 'valid_to'),
  'batch_classes', jsonb_build_array('shoda_dva_zdroje'),
  'title_template', '{trida} ({pocet})', 'quote_template', '{zdroje}',
  'class_titles', jsonb_build_object('shoda_dva_zdroje', 'Shoda dvou zdrojů'))::text, true);

CREATE TEMP TABLE hs_c AS
SELECT hs_t.k, t.trida, t.zdroje FROM twin_ref_tridy(current_setting('hs.params')::jsonb) t
JOIN hs_t ON hs_t.ref = t.ref_id;

-- ── 1–11) Třídy ───────────────────────────────────────────────────────────────
SELECT is((SELECT trida FROM hs_c WHERE k = 'Alfa s.r.o.'), 'shoda_dva_zdroje',
  'faktura + rejstřík: IČO a jméno k datu dokladu sedí (zápis „ALFA, s. r. o." = „Alfa s.r.o.") → shoda');
SELECT is((SELECT zdroje FROM hs_c WHERE k = 'Alfa s.r.o.'), array['transactional', 'rejstrik'],
  'shoda s rejstříkem přizná oba zdroje');
SELECT is((SELECT trida FROM hs_c WHERE k = 'Beta a.s.'), 'jeden_zdroj',
  'jen účetnictví → jeden zdroj (hromadně ne)');
SELECT is((SELECT trida FROM hs_c WHERE k = 'Gama s.r.o.'), 'rozpor',
  'rejstřík k datu dokladu vede jiné jméno → rozpor');
SELECT is((SELECT trida FROM hs_c WHERE k = 'Delta s.r.o.'), 'shoda_dva_zdroje',
  'PŘEJMENOVÁNÍ: starý doklad se starým jménem i nový s novým sedí na rejstřík v čase → shoda');
SELECT is((SELECT trida FROM hs_c WHERE k = 'Epsilon s.r.o.'), 'jmeno_nesedi_na_twin',
  'zdroje se shodnou, ale na jiné jméno, než nese dvojče → hromadně ne');
SELECT is((SELECT trida FROM hs_c WHERE k = 'Petr Novák'), 'nepodporovano',
  'samotné jméno bez IČO (může být soukromá osoba) → nikdy hromadně');
SELECT is((SELECT trida FROM hs_c WHERE k = 'Kappa s.r.o.'), 'shoda_dva_zdroje',
  'bez rejstříku: smlouva a faktura (dvě třídy dokladů) nesou totéž jméno → shoda');
SELECT is((SELECT zdroje FROM hs_c WHERE k = 'Kappa s.r.o.'), array['contractual', 'transactional'],
  'shoda bez rejstříku přizná obě třídy dokladů');
SELECT is((SELECT trida FROM hs_c WHERE k = 'Lambda s.r.o.'), 'jeden_zdroj',
  'totéž jméno ve dvou zdrojích, ale mezi nimi jiné jméno → shoda NEPLATÍ');
SELECT is((SELECT trida FROM hs_c WHERE k = 'Sigma s.r.o.'), 'smisene_dvojce',
  'dvojče nese i jméno, které IČO nikdy nemělo → smíšené dvojče, hromadně ne');

-- ── 12–15) Blok skupin ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('hs.plain'))::text, true);
SELECT is(jsonb_array_length(get_twin_ref_group_block(current_setting('hs.params')::jsonb)->'data'->'items'), 0,
  'bez nároku: žádná skupina');
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('hs.admin'))::text, true);
SELECT is(get_twin_ref_group_block(current_setting('hs.params')::jsonb)->'data'->>'entity_kind', 'twin_identity_group',
  'blok skupin vydává entity_kind twin_identity_group');
SELECT is(get_twin_ref_group_block(current_setting('hs.params')::jsonb)->'data'->'items'->0->>'title',
  'Shoda dvou zdrojů (3)', 'jediná povolená třída, tři návrhy (Alfa, Delta, Kappa)');
SELECT is(jsonb_array_length(get_twin_ref_group_block(
    (current_setting('hs.params')::jsonb) || '{"batch_classes": ["jeden_zdroj", "shoda_dva_zdroje"]}')->'data'->'items'), 2,
  'která třída smí do dávky, říkají DATA bloku');

-- ── Blok v datech (dávka podle něj najde konfiguraci skupiny) ────────────────
INSERT INTO surface_data_rpcs (rpc_name, description, is_active)
VALUES ('get_twin_ref_group_block', 'pgtap', true) ON CONFLICT (rpc_name) DO NOTHING;
INSERT INTO surface_blocks (block_slug, block_type, title_key, source_rpc, source_params, namespace, sensitivity, is_active)
VALUES ('pgtap-hrom-skupiny', 'review_queue', 'app.pgtap', 'get_twin_ref_group_block',
        current_setting('hs.params')::jsonb, 'pgtap/hrom', 'internal', true);
SELECT set_config('hs.skupina',
  get_twin_ref_group_block(current_setting('hs.params')::jsonb)->'data'->'items'->0->>'id', true);

-- PŘEOVĚŘENÍ: mezi zobrazením a potvrzením se smlouva Kappa změnila → Kappa ze skupiny vypadne
UPDATE li_source_registry SET fields = jsonb_set(fields, '{counterparty,value}', '"Kappa Nova s.r.o."')
WHERE doc_slug = 'pgtap-hrom-8';

-- ── 16–22) Dávka ──────────────────────────────────────────────────────────────
SELECT throws_ok(format('SELECT submit_evidence_review_audited(%L, %L::uuid, %L)',
  'twin_identity_group', current_setting('hs.skupina'), 'rejected'), '22023', NULL,
  'hromadně jen potvrzení — zamítnutí skupiny se nenabízí');
SELECT throws_ok(format('SELECT submit_evidence_review_audited(%L, %L::uuid, %L)',
  'twin_identity_group', gen_random_uuid(), 'confirmed'), 'P0002', NULL,
  'neznámá skupina (konfigurace se změnila) → chyba, žádné hádání');
SELECT set_config('hs.vysledek', (submit_evidence_review_audited('twin_identity_group',
  current_setting('hs.skupina')::uuid, 'confirmed', 'pgtap'))::text, true);
SELECT is((current_setting('hs.vysledek')::jsonb)->'batch'->>'potvrzeno', '2',
  'dávka potvrdila dva návrhy — Kappa po změně smlouvy do skupiny už nepatří');
SELECT is((SELECT array_agg(k ORDER BY k) FROM hs_t JOIN twin_external_refs r ON r.id = hs_t.ref
            WHERE r.state = 'confirmed'), array['Alfa s.r.o.', 'Delta s.r.o.'],
  'potvrzené jsou právě Alfa a Delta');
SELECT is((SELECT state FROM twin_external_refs WHERE id = (SELECT ref FROM hs_t WHERE k = 'Beta a.s.')), 'proposed',
  'jeden zdroj zůstal návrhem');
SELECT is((SELECT count(*)::int FROM twin_ref_davky
            WHERE batch_id = ((current_setting('hs.vysledek')::jsonb)->'batch'->>'batch_id')::uuid
              AND vysledek = 'potvrzeno' AND provedl = current_setting('hs.admin')::uuid), 2,
  'deník dávky nese obě položky a kdo je provedl');
SELECT is((SELECT count(*)::int FROM audit_journal WHERE action = 'twin_external_refs.batch_confirmed'
            AND details->>'batch_id' = (current_setting('hs.vysledek')::jsonb)->'batch'->>'batch_id'), 1,
  'audit dávky: jeden záznam s počty');

-- ── 23–30) Vrácení ────────────────────────────────────────────────────────────
-- Alfa se po dávce změnila (předání klíče jinam) → vrácení ji přeskočí
UPDATE twin_external_refs SET valid_to = now() WHERE id = (SELECT ref FROM hs_t WHERE k = 'Alfa s.r.o.');
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('hs.plain'))::text, true);
SELECT throws_ok(format('SELECT twin_ref_davka_vratit(%L::uuid)',
  (current_setting('hs.vysledek')::jsonb)->'batch'->>'batch_id'), '42501', NULL,
  'vrátit dávku smí jen správa');
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('hs.admin'))::text, true);
SELECT set_config('hs.vraceni', twin_ref_davka_vratit(
  ((current_setting('hs.vysledek')::jsonb)->'batch'->>'batch_id')::uuid, 'pgtap')::text, true);
SELECT is((current_setting('hs.vraceni')::jsonb)->>'vraceno', '1', 'vrácena jedna položka (Delta)');
SELECT is((current_setting('hs.vraceni')::jsonb)->>'preskoceno_zmenene', '1', 'změněná položka (Alfa) přeskočena');
SELECT is((SELECT state FROM twin_external_refs WHERE id = (SELECT ref FROM hs_t WHERE k = 'Delta s.r.o.')), 'proposed',
  'Delta je zase návrhem');
SELECT is((SELECT valid_from FROM twin_external_refs WHERE id = (SELECT ref FROM hs_t WHERE k = 'Delta s.r.o.')),
  timestamptz '2026-01-01 00:00:00+00', 'vrácení obnoví původní platnost návrhu');
SELECT is((SELECT confirmed_by FROM twin_external_refs WHERE id = (SELECT ref FROM hs_t WHERE k = 'Delta s.r.o.')),
  NULL::uuid, 'vrácení smaže ratifikaci');
SELECT is((SELECT state FROM twin_external_refs WHERE id = (SELECT ref FROM hs_t WHERE k = 'Alfa s.r.o.')), 'confirmed',
  'přeskočená položka zůstala, jak ji někdo změnil');
SELECT is((SELECT array_agg(vraceno ORDER BY vraceno) FROM twin_ref_davky
            WHERE batch_id = ((current_setting('hs.vysledek')::jsonb)->'batch'->>'batch_id')::uuid),
  array['preskoceno_zmenene', 'vraceno'], 'deník nese výsledek vrácení u každé položky');

-- ── 31) Klíč jména: zápis ano, jiné slovo ne ──────────────────────────────────
SELECT ok(nazev_firmy_klic('Alfa, spol. s r. o.') = nazev_firmy_klic('ALFA s.r.o.')
          AND nazev_firmy_klic('EUROVIA CS, a.s.') <> nazev_firmy_klic('EUROVIA CZ, a.s.'),
  'klíč jména srovná zápis právní formy, jiné slovo zůstane jiným jménem');

SELECT * FROM finish();
ROLLBACK;
