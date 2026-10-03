// ─────────────────────────────────────────────────────────────────────
// Kontrakt klientských parametrů restricted bloku (ADR-003, K3)
// ─────────────────────────────────────────────────────────────────────
//
// W4 (2026-09-03) vzal restricted bloku parametry klienta úplně — správně,
// protože `columns`/`view` od klienta nad SECURITY DEFINER zdrojem = čtení
// libovolných sloupců napříč RLS. Tím ale zmizela legální cesta pro detail
// (`twin_id`), hledání (`q`) a osu pohledu. K3 ji vrací jako DEKLARACI v datech:
//
//   1. deklarovaný klíč se správným typem PROJDE,
//   2. nedeklarovaný klíč se ZAHODÍ (columns, junk),
//   3. deklarovaný klíč se špatným typem se ZAHODÍ (uuid, enum, int),
//   4. klíč, který nese konfigurace, klient NEPŘEPÍŠE ani deklarací (config wins),
//   5. blok BEZ deklarace nepropustí nic (chování W4 zůstává výchozí),
//   6. ne-restricted blok merguje dál všechno (regrese vůči starému chování),
//   7. samotná deklarace `client_params` se RPC nepředává.
//
// Sonda je echo-RPC založená uvnitř transakce: vrátí, co dostala. Měří se tedy
// přesně to, co dispečer PŘEDAL, ne co si RPC domyslela. Offline se přeskočí.
import { describe, it, expect, beforeAll } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const USER = "c3000000-1111-4000-8000-0000000000c3";
const TWIN = "c3000000-2222-4000-8000-0000000000c4";

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES ('${USER}', 'k3-user@test.local') ON CONFLICT DO NOTHING;
CREATE FUNCTION public.k3_echo_block(p jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_object(
    'data', jsonb_build_object('markdown', 'echo', 'echo', p),
    'provenance', jsonb_build_object('source_slug', 'echo', 'trace_id', 'echo',
                                     'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
$f$;
GRANT EXECUTE ON FUNCTION public.k3_echo_block(jsonb) TO authenticated;
INSERT INTO public.surface_data_rpcs (rpc_name, description, is_active) VALUES ('k3_echo_block', 'k3 probe', true);
INSERT INTO public.surface_blocks (block_slug, block_type, title_key, source_rpc, source_params, namespace, sensitivity, is_active) VALUES
  ('k3_declared', 'narrative', 'k3.t', 'k3_echo_block',
   '{"fixed":"config","client_params":{"twin_id":"uuid","q":"text","tier":{"enum":["a","b"]},"n":"int","flag":"bool","fixed":"text"}}'::jsonb,
   'k3', 'restricted', true),
  ('k3_bare', 'narrative', 'k3.t', 'k3_echo_block', '{"fixed":"config"}'::jsonb, 'k3', 'restricted', true),
  ('k3_internal', 'narrative', 'k3.t', 'k3_echo_block', '{"fixed":"config"}'::jsonb, 'k3', 'internal', true);
INSERT INTO public.surface_layouts (surface, block_id, audience, position, is_active)
SELECT 'k3_probe', b.id, '{}'::jsonb, 0, true FROM public.surface_blocks b WHERE b.namespace = 'k3';
`;

const asUser = `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${USER}","role":"authenticated"}', true);`;

function probe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser}
-- 1+2+3+4+7: deklarované a platné projde; nedeklarované, neplatné a kolizní ne; deklarace se nepředává
SELECT 'declared=' || (
  public.get_block_data('k3_declared',
    '{"twin_id":"${TWIN}","q":"hello","tier":"b","n":"7","flag":true,"fixed":"HACK","columns":["x"],"junk":1,"client_params":{"x":"text"}}'::jsonb
  )->'data'->'echo'
  = '{"fixed":"config","twin_id":"${TWIN}","q":"hello","tier":"b","n":"7","flag":true}'::jsonb)::text AS out;
-- 3: špatné typy se zahodí (uuid bez tvaru, enum mimo výčet, int s písmeny, bool jako text)
SELECT 'bad_types=' || (
  public.get_block_data('k3_declared', '{"twin_id":"nope","tier":"zzz","n":"x7","flag":"true"}'::jsonb)->'data'->'echo'
  = '{"fixed":"config"}'::jsonb)::text AS out;
-- 5: bez deklarace nepropustí nic (W4 zůstává výchozí)
SELECT 'bare=' || (
  public.get_block_data('k3_bare', '{"twin_id":"${TWIN}","q":"hello"}'::jsonb)->'data'->'echo'
  = '{"fixed":"config"}'::jsonb)::text AS out;
-- 6: ne-restricted blok merguje všechno jako dřív
SELECT 'internal=' || (
  public.get_block_data('k3_internal', '{"extra":"yes"}'::jsonb)->'data'->'echo'
  = '{"fixed":"config","extra":"yes"}'::jsonb)::text AS out;
-- filtr sám: čistá funkce, testovatelná bez bloku
SELECT 'filter_pure=' || (
  public.surface_client_params_filter('{"view":"v","client_params":{"since":"date","at":"timestamptz","view":"text"}}'::jsonb,
                                      '{"since":"2026-09-05","at":"2026-09-05T10:00:00Z","view":"other","since_x":"2026-01-01"}'::jsonb)
  = '{"since":"2026-09-05","at":"2026-09-05T10:00:00Z"}'::jsonb)::text AS out;
RESET ROLE;
ROLLBACK;
`);
}

describe("kontrakt klientských parametrů restricted bloku (K3)", () => {
  beforeAll(async () => {
    await reportTestCapabilities("client params contract");
  });

  it.skipIf(!dbAvailable)("propustí jen deklarované klíče správného typu, konfigurace vždy vyhrává", () => {
    const out = probe();
    expect(out).toContain("declared=true");
    expect(out).toContain("bad_types=true");
  });

  it.skipIf(!dbAvailable)("bez deklarace zůstává W4: restricted blok nebere nic; ne-restricted merguje dál", () => {
    const out = probe();
    expect(out).toContain("bare=true");
    expect(out).toContain("internal=true");
  });

  it.skipIf(!dbAvailable)("filtr je čistá funkce: typy date/timestamptz, kolize s konfigurací zahozena", () => {
    const out = probe();
    expect(out).toContain("filter_pure=true");
  });
});
