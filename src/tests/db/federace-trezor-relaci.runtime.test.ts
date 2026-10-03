/**
 * Trezor relací federovaného zdroje (ADR-004, PR A) — CHOVÁNÍ na živé DB.
 *
 * Měří vlastnosti z katalogu kritérií rady (d8/7b), ne text:
 *   A1  šifrový text ani tabulku nepřečte authenticated ani admin; obecný decrypt token neotevře
 *   A4  stráž stojí na volajícím (is_service_role), ne na current_user
 *   A5  SECURITY DEFINER funkce trezoru mají search_path
 *   A6  put jen servis · A7 jedna aktivní relace · A8 nahrazená jde do fronty odhlášení
 *   A9  odvolaná/prošlá se nevrací · A10 revoke cizí odmítnut, vlastní a admin smí
 *   A11 v DB není otevřený token · A12 1 řádek auditu na čtení šifrového textu
 *   A13 sentinel tokenu nikde v auditu · A14 rotace CAS, prohraný souběh = STALE
 *   + nonce jednorázově, servisní limit fail-closed, fronta odhlášení, osiřelé relace,
 *     paměť brokeru respektuje odvolání hned, dvě repliky údržby nezdvojí odhlášení.
 * Každá negativní kontrola má kotvu ve stejném běhu (co MÁ projít, projde).
 *
 * Spouští se přes: npm run test:db:federace-trezor (throwaway DB)
 */
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";
import { klicZProstredi } from "../../../services/svc-source-broker/src/lib/trezor-sifra.js";
import { jakoSluzba, vytvorTrezor } from "../../../services/svc-source-broker/src/lib/trezor-relaci.js";
import { udrzbaFederace, type VysledekOdhlaseni } from "../../../services/svc-source-broker/src/lib/udrzba-federace.js";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const RUN = randomUUID().slice(0, 8);
const ZDROJ = `zdroj-${RUN}`;
const JINY_ZDROJ = `jiny-${RUN}`;
const UA = randomUUID();
const UB = randomUUID();
const UC = randomUUID();
const ADMIN = randomUUID();
const SIROTEK = randomUUID();
const KLIC = klicZProstredi({ FEDERATION_VAULT_KEY: randomBytes(32).toString("hex"), FEDERATION_VAULT_KEY_ID: "k-test" });
const sentinel = (n: string) => `sentinel-${n}-${RUN}-${randomBytes(6).toString("hex")}`;

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
function jako(uid: string, sql: string): { ok: true; out: string } | { ok: false; err: string } {
  try {
    return { ok: true, out: psql(`{"sub":"${uid}","role":"authenticated"}`, sql, "authenticated") };
  } catch (e) {
    return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
  }
}
const odmitnuto = (r: ReturnType<typeof jako>) => !r.ok && /42501|permission denied|INSUFFICIENT_PRIVILEGE/i.test(r.err);

async function sezeniSluzby(): Promise<pg.Client> {
  const c = new pg.Client({ host: PG_HOST, port: Number(PG_PORT), user: PG_USER, password: PG_PASSWORD, database: PG_DATABASE });
  await c.connect();
  await jakoSluzba(c);
  return c;
}
const zaHodinu = () => new Date(Date.now() + 3_600_000);
const pocetAuditu = (akce: string, entita: string) =>
  Number(svc(`SELECT count(*) FROM public.audit_journal WHERE action = '${akce}' AND entity_id = '${entita}'`));

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("trezor relací federovaného zdroje (ADR-004, PR A)", () => {
  let c: pg.Client;
  let trezor: ReturnType<typeof vytvorTrezor>;

  beforeAll(async () => {
    if (!isPgReachable()) throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES
           ('${UA}', 'fed-a-${RUN}@test.local'), ('${UB}', 'fed-b-${RUN}@test.local'),
           ('${UC}', 'fed-c-${RUN}@test.local'), ('${ADMIN}', 'fed-admin-${RUN}@test.local')`);
    svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);
    c = await sezeniSluzby();
    trezor = vytvorTrezor({ pg: c, klic: KLIC });
  });

  afterAll(async () => {
    await c?.end().catch(() => {});
    try {
      svc(`DELETE FROM public.federated_source_sessions WHERE provider IN ('${ZDROJ}', '${JINY_ZDROJ}')`);
      svc(`DELETE FROM public.federated_flow_nonces WHERE provider = '${ZDROJ}'`);
      svc(`DELETE FROM public.api_rate_limits WHERE user_id IN ('${UA}', '${UB}', '${UC}', '${ADMIN}')`);
    } catch {
      /* throwaway DB */
    }
  });

  it("kontrola měřidla: servis uloží a přečte relaci, token se vrátí beze změny", async () => {
    const tok = sentinel("a");
    await trezor.uloz({ userId: UA, provider: ZDROJ, providerId: `pa-${RUN}`, token: tok, refresh: sentinel("ra"), expiresAt: zaHodinu() });
    const r = await trezor.nactiProZapis(UA, ZDROJ);
    expect(r?.token).toBe(tok);
    expect(r?.providerId).toBe(`pa-${RUN}`);
  });

  it("A1/A4/A6: tabulku ani RPC trezoru nepřečte authenticated ani admin; put jen servis", () => {
    for (const uid of [UA, ADMIN]) {
      expect(odmitnuto(jako(uid, `SELECT count(*) FROM public.federated_source_sessions`))).toBe(true);
      expect(odmitnuto(jako(uid, `SELECT * FROM public.federated_source_session_get_for_caller('${UA}', '${ZDROJ}')`))).toBe(true);
      expect(odmitnuto(jako(uid, `SELECT * FROM public.federated_source_session_version('${UA}', '${ZDROJ}')`))).toBe(true);
      expect(
        odmitnuto(
          jako(uid, `SELECT * FROM public.federated_source_session_put(gen_random_uuid(), '${UB}', '${ZDROJ}', 'x', '\\x01'::bytea, NULL, 'k', now() + interval '1 hour')`),
        ),
      ).toBe(true);
    }
  });

  it("A4: stráž SAMA odmítne i volajícího, kterého by grant omylem pustil (měří stráž, ne grant)", () => {
    // Grant i stráž jsou dvě vrstvy. Test výš by prošel už na grantu; tady se EXECUTE pro authenticated
    // v transakci DOČASNĚ přidělí (jako chyba budoucího grantu) — rozhodnout musí stráž na volajícím.
    const pokus = (volani: string, podpis: string) => {
      try {
        const out = execFileSync(
          "psql",
          ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
          {
            input:
              `\\o /dev/null\nBEGIN;\nGRANT EXECUTE ON FUNCTION public.${podpis} TO authenticated;\n` +
              `SET LOCAL request.jwt.claims = '{"sub":"${UA}","role":"authenticated"}';\nSET LOCAL ROLE authenticated;\n\\o\n` +
              `SELECT count(*) FROM public.${volani};\nROLLBACK;`,
            encoding: "utf-8",
            env: { ...process.env, PGPASSWORD: PG_PASSWORD },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        return { ok: true, out };
      } catch (e) {
        return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
      }
    };
    const r = pokus(`federated_source_session_get_for_caller('${UB}', '${ZDROJ}')`, "federated_source_session_get_for_caller(uuid, text)");
    expect(r.ok, "stráž pustila volajícího, kterého pustil grant").toBe(false);
    expect(!r.ok && /INSUFFICIENT_PRIVILEGE/.test(String(r.err))).toBe(true); // odmítla STRÁŽ, ne chybějící grant
    const v = pokus(`federated_source_session_version('${UB}', '${ZDROJ}')`, "federated_source_session_version(uuid, text)");
    expect(!v.ok && /INSUFFICIENT_PRIVILEGE/.test(String(v.err))).toBe(true);
  });

  it("A1(c)/A11: v DB není otevřený token a obecný decrypt šifrový text neotevře (ani admin)", async () => {
    const tok = sentinel("b");
    await trezor.uloz({ userId: UB, provider: ZDROJ, providerId: `pb-${RUN}`, token: tok, expiresAt: zaHodinu() });
    const hex = svc(`SELECT encode(token_ct, 'hex') FROM public.federated_source_sessions WHERE user_id = '${UB}' AND revoked_at IS NULL`);
    expect(hex.length).toBeGreaterThan(40); // kotva: šifrový text tam JE
    expect(Buffer.from(hex, "hex").includes(Buffer.from(tok))).toBe(false);
    const r = jako(ADMIN, `SELECT public.aisha_decrypt_column_audited(decode('${hex}', 'hex'))`);
    expect(r.ok && r.out.includes(tok)).toBe(false);
  });

  it("A5: SECURITY DEFINER funkce trezoru mají search_path", () => {
    const bez = svc(`SELECT string_agg(proname, ',') FROM pg_proc
                      WHERE (proname LIKE 'federated_source_session_%' OR proname LIKE 'federated_flow_nonce%'
                             OR proname IN ('enforce_rate_limit_for', 'cleanup_old_rate_limits'))
                        AND pronamespace = 'public'::regnamespace
                        AND (NOT prosecdef OR NOT coalesce(array_to_string(proconfig, ',') LIKE '%search_path%', false))`);
    expect(bez).toBe("");
    expect(Number(svc(`SELECT count(*) FROM pg_proc WHERE proname LIKE 'federated_source_session_%' AND pronamespace = 'public'::regnamespace`))).toBe(7);
  });

  it("put pro uživatele, který v aishe není = vlastní chyba (ne pád na FK auditu)", async () => {
    await expect(
      trezor.uloz({ userId: randomUUID(), provider: ZDROJ, providerId: `px-${RUN}`, token: sentinel("x0"), expiresAt: zaHodinu() }),
    ).rejects.toThrow(/FEDERATED_UNKNOWN_USER/);
  });

  it("A7/A8: druhé uložení odvolá první (nahrazena) a zařadí ho do fronty odhlášení; aktivní je jedna", async () => {
    const prvni = await trezor.uloz({ userId: UC, provider: ZDROJ, providerId: `pc-${RUN}`, token: sentinel("c1"), expiresAt: zaHodinu() });
    const druha = await trezor.uloz({ userId: UC, provider: ZDROJ, providerId: `pc-${RUN}`, token: sentinel("c2"), expiresAt: zaHodinu() });
    expect(druha.nahrazenaSessionId).toBe(prvni.sessionId);
    expect(Number(svc(`SELECT count(*) FROM public.federated_source_sessions WHERE user_id = '${UC}' AND provider = '${ZDROJ}' AND revoked_at IS NULL`))).toBe(1);
    expect(svc(`SELECT revoke_reason || '|' || (logout_next_at IS NOT NULL) FROM public.federated_source_sessions WHERE id = '${prvni.sessionId}'`)).toBe("nahrazena|true");
  });

  it("účet zdroje živě jen u jednoho uživatele: tentýž provider_id u jiného uživatele = odmítnuto", async () => {
    await expect(
      trezor.uloz({ userId: UB, provider: ZDROJ, providerId: `pc-${RUN}`, token: sentinel("x"), expiresAt: zaHodinu() }),
    ).rejects.toThrow(/FEDERATED_PROVIDER_ID_TAKEN/);
  });

  it("A12/S2: čtení šifrového textu = 1 řádek auditu; paměť brokeru bez auditu, odvolání platí HNED", async () => {
    const tok = sentinel("d");
    const { sessionId } = await trezor.uloz({ userId: UA, provider: ZDROJ, providerId: `pa-${RUN}`, token: tok, expiresAt: zaHodinu() });
    const pred = pocetAuditu("federace.relace_ctena", sessionId);
    expect((await trezor.nacti(UA, ZDROJ))?.token).toBe(tok);
    expect(pocetAuditu("federace.relace_ctena", sessionId)).toBe(pred + 1);
    expect((await trezor.nacti(UA, ZDROJ))?.token).toBe(tok); // z paměti
    expect(pocetAuditu("federace.relace_ctena", sessionId)).toBe(pred + 1);
    // Odvolání JINOU cestou (jiná replika / uživatel) — paměť tohohle brokeru ho musí poznat hned.
    expect(svc(`SELECT public.federated_source_session_revoke('${UA}', '${ZDROJ}', 'test')`)).toBe("1");
    expect(await trezor.nacti(UA, ZDROJ)).toBeNull();
  });

  it("A9: odvolaná ani prošlá relace se nevrací", async () => {
    await trezor.uloz({ userId: UA, provider: ZDROJ, providerId: `pa-${RUN}`, token: sentinel("e"), expiresAt: zaHodinu() });
    svc(`UPDATE public.federated_source_sessions SET expires_at = now() - interval '1 second' WHERE user_id = '${UA}' AND provider = '${ZDROJ}' AND revoked_at IS NULL`);
    expect(await trezor.nactiProZapis(UA, ZDROJ)).toBeNull();
    expect(await trezor.nacti(UA, ZDROJ)).toBeNull();
  });

  it("A10/S5: cizí relaci běžný uživatel neodvolá; vlastní ano; admin ano", async () => {
    await trezor.uloz({ userId: UA, provider: JINY_ZDROJ, providerId: `ja-${RUN}`, token: sentinel("f"), expiresAt: zaHodinu() });
    await trezor.uloz({ userId: UB, provider: JINY_ZDROJ, providerId: `jb-${RUN}`, token: sentinel("g"), expiresAt: zaHodinu() });
    expect(odmitnuto(jako(UA, `SELECT public.federated_source_session_revoke('${UB}', '${JINY_ZDROJ}', 'cizi')`))).toBe(true);
    expect(jako(UA, `SELECT public.federated_source_session_revoke('${UA}', '${JINY_ZDROJ}', 'vlastni')`)).toEqual({ ok: true, out: "1" });
    expect(jako(ADMIN, `SELECT public.federated_source_session_revoke('${UB}', '${JINY_ZDROJ}', 'admin')`)).toEqual({ ok: true, out: "1" });
  });

  it("A14: rotace je compare-and-swap; prohraný souběh = STALE, relace se NEodvolá", async () => {
    const { sessionId } = await trezor.uloz({ userId: UB, provider: ZDROJ, providerId: `pb2-${RUN}`, token: sentinel("h1"), expiresAt: zaHodinu() });
    const nova = sentinel("h2");
    expect(await trezor.obnov({ userId: UB, provider: ZDROJ, sessionId, ocekavanaVerze: 1, token: nova, refresh: sentinel("rh"), expiresAt: zaHodinu() })).toBe(2);
    await expect(
      trezor.obnov({ userId: UB, provider: ZDROJ, sessionId, ocekavanaVerze: 1, token: sentinel("h3"), expiresAt: zaHodinu() }),
    ).rejects.toThrow(/FEDERATED_SESSION_STALE/);
    const r = await trezor.nactiProZapis(UB, ZDROJ);
    expect(r?.token).toBe(nova);
    expect(r?.version).toBe(2);
  });

  it("nonce toku je jednorázové; prošlé se nepřijme", () => {
    const n = randomBytes(16).toString("hex");
    const pouzij = (nonce: string, exp: string) =>
      svc(`SELECT public.federated_flow_nonce_use('${nonce}', '${UA}', '${ZDROJ}', ${exp})`);
    expect(pouzij(n, "now() + interval '5 minutes'")).toBe("t");
    expect(pouzij(n, "now() + interval '5 minutes'")).toBe("f");
    expect(pouzij(randomBytes(16).toString("hex"), "now() - interval '1 second'")).toBe("f");
    expect(odmitnuto(jako(UA, `SELECT public.federated_flow_nonce_use('${randomBytes(16).toString("hex")}', '${UA}', '${ZDROJ}', now() + interval '5 minutes')`))).toBe(true);
  });

  it("servisní limit je fail-closed: 3 projdou, 4. = P0429; neznámý uživatel = chyba; authenticated nesmí", () => {
    const klic = `federace:connect:${ZDROJ}:${RUN}`;
    for (let i = 0; i < 3; i += 1) svc(`SELECT public.enforce_rate_limit_for('${UA}', '${klic}', 60000, 3)`);
    expect(() => svc(`SELECT public.enforce_rate_limit_for('${UA}', '${klic}', 60000, 3)`)).toThrow(/RATE_LIMIT_EXCEEDED/);
    expect(() => svc(`SELECT public.enforce_rate_limit_for('${randomUUID()}', '${klic}', 60000, 3)`)).toThrow(/RATE_LIMIT_UNKNOWN_USER/);
    expect(odmitnuto(jako(UA, `SELECT public.enforce_rate_limit_for('${UA}', 'x', 60000, 3)`))).toBe(true);
    expect(odmitnuto(jako(UA, `SELECT public.cleanup_old_rate_limits()`))).toBe(true);
    expect(Number(svc(`SELECT public.cleanup_old_rate_limits()`))).toBeGreaterThanOrEqual(0); // kotva: servis smí
  });

  it("fronta odhlášení: selhání odstupňuje, hotovo smaže šifrový text; jiný zdroj se nečte; osiřelá relace se odvolá", async () => {
    const { sessionId } = await trezor.uloz({ userId: UC, provider: JINY_ZDROJ, providerId: `jc-${RUN}`, token: sentinel("i"), expiresAt: zaHodinu() });
    expect(svc(`SELECT public.federated_source_session_revoke('${UC}', '${JINY_ZDROJ}', 'odpojeni')`)).toBe("1");
    const due = (zdroje: string) => svc(`SELECT string_agg(source_session_id::text, ',') FROM public.federated_source_session_logout_due(ARRAY[${zdroje}]::text[], 100)`);
    expect(due(`'${ZDROJ}-neexistuje'`)).toBe("");
    expect(due(`'${JINY_ZDROJ}'`).split(",")).toContain(sessionId);
    svc(`SELECT public.federated_source_session_logout_result('${sessionId}', 'selhalo')`);
    expect(svc(`SELECT logout_attempts || '|' || (logout_next_at > now()) FROM public.federated_source_sessions WHERE id = '${sessionId}'`)).toBe("1|true");
    svc(`SELECT public.federated_source_session_logout_result('${sessionId}', 'hotovo')`);
    expect(svc(`SELECT (logout_done_at IS NOT NULL) || '|' || length(token_ct) FROM public.federated_source_sessions WHERE id = '${sessionId}'`)).toBe("true|0");
    // osiřelá relace: uživatel v aishe není → odvolat a zařadit
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES ('${SIROTEK}', 'fed-s-${RUN}@test.local')`);
    const s = await trezor.uloz({ userId: SIROTEK, provider: JINY_ZDROJ, providerId: `js-${RUN}`, token: sentinel("j"), expiresAt: zaHodinu() });
    svc(`DELETE FROM aisha_auth.users WHERE id = '${SIROTEK}'`);
    expect(due(`'${JINY_ZDROJ}'`).split(",")).toContain(s.sessionId);
    expect(svc(`SELECT revoke_reason FROM public.federated_source_sessions WHERE id = '${s.sessionId}'`)).toBe("uzivatel_neexistuje");
    // audit osiřelé relace vznikl (user_id NULL, uživatel v metadatech) — FK auditu ho neshodil
    expect(Number(svc(`SELECT count(*) FROM public.audit_journal WHERE action = 'federace.odhlaseni_cteno' AND entity_id = '${s.sessionId}' AND user_id IS NULL AND metadata->>'uzivatel' = '${SIROTEK}'`))).toBe(1);
  });

  it("(d) dvě repliky údržby nezdvojí odhlášení: každý token u zdroje právě jednou", async () => {
    const tokeny: string[] = [];
    for (const [uid, n] of [[UA, "k1"], [UB, "k2"], [UC, "k3"]] as const) {
      const t = sentinel(n);
      tokeny.push(t);
      await trezor.uloz({ userId: uid, provider: `${ZDROJ}-d`, providerId: `d-${uid}`, token: t, expiresAt: zaHodinu() });
      svc(`SELECT public.federated_source_session_revoke('${uid}', '${ZDROJ}-d', 'test-d')`);
    }
    const volani: string[] = [];
    const pomaly = async (token: string): Promise<VysledekOdhlaseni> => {
      volani.push(token);
      await new Promise((r) => setTimeout(r, 400)); // drží zámek, aby se repliky překrývaly
      return "hotovo";
    };
    const odhlasovace = new Map([[`${ZDROJ}-d`, pomaly]]);
    const log = { warn: () => {}, info: () => {} };
    const r1 = await sezeniSluzby();
    const r2 = await sezeniSluzby();
    try {
      const [a, b] = await Promise.all([
        udrzbaFederace({ pg: r1, klic: KLIC, odhlasovace, logger: log }),
        udrzbaFederace({ pg: r2, klic: KLIC, odhlasovace, logger: log }),
      ]);
      expect([a.zamek, b.zamek].filter(Boolean).length).toBe(1); // jen jedna replika udržovala
      expect(volani.sort()).toEqual([...tokeny].sort()); // každý token právě jednou (kotva: všechny tři)
      expect(a.odhlaseno + b.odhlaseno).toBe(3);
    } finally {
      await r1.end();
      await r2.end();
    }
  });

  it("A13: sentinel tokenu nikde v auditu (kotva: audit tohoto běhu existuje)", () => {
    expect(Number(svc(`SELECT count(*) FROM public.audit_journal WHERE action LIKE 'federace.%' AND metadata::text LIKE '%${ZDROJ}%'`))).toBeGreaterThan(0);
    expect(Number(svc(`SELECT count(*) FROM public.audit_journal WHERE coalesce(metadata::text, '') || coalesce(details::text, '') || coalesce(summary, '') LIKE '%sentinel-%-${RUN}-%'`))).toBe(0);
  });
});
