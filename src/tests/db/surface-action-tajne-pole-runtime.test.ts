import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Tajné pole akce správy (`type: 'secret'`) — heslo dodavatele z formuláře
 * nesmí skončit v logu, v auditu ani ve výchozí hodnotě (2026-09-26).
 *
 * ⛔ PROČ: `submit_surface_action` skládal hodnoty do TEXTU příkazu jako literály
 * (`p_x => 'hodnota'::text`). Když cílové RPC spadlo, Postgres zalogoval chybu
 * i s kontextem PL/pgSQL („SQL statement …") — s hodnotou; v provozu je
 * log_min_error_statement=error. Pro heslo dodavatele by to byl únik do logu.
 *
 * Měří se nad skutečnou DB: hodnota DOJDE do cílového RPC (délka sedí), chyba
 * cílového RPC ji NENESE (ani v CONTEXT), audit nese jen klíč, `default` u
 * tajného pole se nepoužije.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const SPRAVCE = "c7100000-1111-4000-8000-0000000000a1";
const TAJNE = "Zz-TAJNA-hodnota-7c1e";

const jakoSpravce = (sql: string): string =>
  psqlMultiline(`${HEADER}BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${SPRAVCE}","role":"authenticated"}', true);
${sql};
COMMIT;`);

/** Pokus, který MÁ selhat — vrací celý text chyby (stderr vč. CONTEXT), nebo 'PROSLO'. */
const zkus = (sql: string): string => {
  try {
    jakoSpravce(sql);
    return "PROSLO";
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return `${String(e.stderr ?? "")}\n${String(e.message ?? err)}`;
  }
};

beforeAll(async () => {
  await reportTestCapabilities("tajné pole akce");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
INSERT INTO aisha_auth.users (id, email) VALUES ('${SPRAVCE}', 'tajne-spravce@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${SPRAVCE}', 'tajne-spravce@test.local') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${SPRAVCE}', 'admin') ON CONFLICT DO NOTHING;

-- Cílové RPC testu: s heslem 'selhat' spadne, jinak vrátí jen DÉLKU (nikdy hodnotu).
CREATE OR REPLACE FUNCTION public.zz_tajne_cil(p_heslo text, p_popis text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $f$
BEGIN
  IF p_popis = 'selhat' THEN
    RAISE EXCEPTION 'cílové RPC selhalo schválně' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('delka', length(p_heslo));
END $f$;
GRANT EXECUTE ON FUNCTION public.zz_tajne_cil(text, text) TO authenticated;

DELETE FROM public.surface_actions WHERE action_slug LIKE 'zz_tajne.%';
INSERT INTO public.surface_actions (action_slug, title_key, target_kind, rpc_name, arg_map, fields, returns_void, audience, namespace, is_active) VALUES
  ('zz_tajne.nastav', 'k.tajne', 'none', 'zz_tajne_cil',
   '[{"name":"p_heslo","from":"payload","key":"heslo","type":"text"},
     {"name":"p_popis","from":"payload","key":"popis","type":"text","required":false}]'::jsonb,
   '[{"key":"heslo","label_key":"k.heslo","type":"secret","required":true,"default":"vychozi-heslo-z-deklarace"},
     {"key":"popis","label_key":"k.popis","type":"text"}]'::jsonb,
   false, '{"roles":["admin"]}'::jsonb, 'zz_tajne', true);`);
});

describe("tajné pole akce správy", () => {
  it.skipIf(!dbAvailable)("hodnota dojde do cílového RPC (jako parametr, ne literál)", () => {
    const out = jakoSpravce(
      `SELECT 'vysledek=' || (public.submit_surface_action('zz_tajne.nastav', '{}'::jsonb, '{"heslo":"${TAJNE}"}'::jsonb))::text`,
    );
    expect(out).toContain(`"delka": ${TAJNE.length}`);
    expect(out, "výsledek akce nesmí hodnotu vracet").not.toContain(TAJNE);
  });

  it.skipIf(!dbAvailable)("když cílové RPC spadne, chyba ani její CONTEXT hodnotu NENESE", () => {
    const chyba = zkus(
      `SELECT public.submit_surface_action('zz_tajne.nastav', '{}'::jsonb, '{"heslo":"${TAJNE}","popis":"selhat"}'::jsonb)`,
    );
    expect(chyba).toMatch(/selhalo schválně/);
    // Kontext PL/pgSQL tam JE (text příkazu) — jen bez hodnoty: `($1)[n]`.
    expect(chyba).toMatch(/zz_tajne_cil/);
    const bezZadani = chyba.replace(new RegExp(`'\\{"heslo":"${TAJNE}"[^']*'`, "g"), "<zadani>");
    expect(bezZadani, "hodnota v chybě = únik do logu serveru").not.toContain(TAJNE);
  });

  it.skipIf(!dbAvailable)("audit nese jen klíč pole, nikdy hodnotu", () => {
    const pocet = psqlMultiline(`SELECT 'nalez=' || count(*) FROM public.audit_journal
       WHERE details::text LIKE '%${TAJNE}%' OR summary LIKE '%${TAJNE}%';`);
    expect(pocet).toContain("nalez=0");
    const klice = psqlMultiline(`SELECT 'klice=' || (details->'payload_keys')::text FROM public.audit_journal
       WHERE action = 'zz_tajne.nastav' ORDER BY created_at DESC LIMIT 1;`);
    expect(klice).toContain('klice=["heslo"]');
  });

  it.skipIf(!dbAvailable)("tajné pole nemá výchozí hodnotu — prázdné = chybí, ne heslo z deklarace", () => {
    const chyba = zkus(`SELECT public.submit_surface_action('zz_tajne.nastav', '{}'::jsonb, '{}'::jsonb)`);
    expect(chyba).toMatch(/missing required field\(s\): heslo/);
  });
});
