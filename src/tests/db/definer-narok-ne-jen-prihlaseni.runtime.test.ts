/**
 * SECURITY DEFINER bloky se musí ptát na NÁROK, ne jen na přihlášení.
 *
 * ⛔ NAMĚŘENO 2026-09-11 diferenciální sondou (admin × uživatel BEZ ROLÍ nad
 * týmiž daty). Devět funkcí mělo guard tvaru
 *
 *     if v_uid is null and not is_service_role() then …prázdno…
 *
 * což ověřuje, že volající je PŘIHLÁŠENÝ, ne že na to má nárok. `SECURITY
 * DEFINER` vypne RLS a odpovědnost tím přechází na tělo funkce — chybějící
 * kontrola tedy neznamená „zamítnuto", ale plnou odpověď. Řidič bez jediné
 * role dostával z `get_twin_events_table_block` jména osob i místa:
 *
 *     {"rows": [{"km": "123", "kde": "Sklad Brno", "kdo": "Jan Novak"}]}
 *
 * a cesta vedla mimo appku — přímým voláním `/rpc/…` přes PostgREST, takže
 * `appSlice` ani připnutá brána v tom nehrají roli.
 *
 * ⭐ PROČ RUNTIME, A NE STATICKÁ BRÁNA. Statický odhad tuhle třídu NEPOZNÁ:
 * všech devět funkcí `auth.uid()` zmiňuje (v provenance i v mrtvé větvi), takže
 * grep na „zmiňuje volajícího" je vyloučil — ověřeno, kontrolní vzorek to
 * odhalil. Jediná poctivá otázka zní, jestli VÝSLEDEK závisí na tom, kdo se ptá,
 * a ta jde položit jen živé databázi.
 *
 * ⛔ KONTROLNÍ VZOREK JE POVINNÝ. Prázdno u obou identit neznamená „drží",
 * ale „sonda je slepá" — proto každý případ nejdřív tvrdí, že ADMIN data VIDÍ.
 * Bez toho by test prošel i nad prázdnou databází.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const RIDIC = randomUUID();
const TWIN = randomUUID();
const PERM = `sonda-${RUN}`;
const MISTO = randomUUID();
const STORY_MUJ = randomUUID();
const STORY_CIZI = randomUUID();
const BATCH_MUJ = randomUUID();
const BATCH_CIZI = randomUUID();

function psql(claims: string, sql: string, role?: string): string {
  const setRole = role ? `SET ROLE ${role};\n` : "";
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n${setRole}\\o\n${sql};`, encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}
const svc = (sql: string) => psql('{"role":"service_role"}', sql);
/** Odpověď dané identity. `role` = DB role, aby platila RLS (spojení je superuser). */
const jako = (uid: string, volani: string) =>
  psql(`{"sub":"${uid}","role":"authenticated"}`, `SELECT public.${volani}::text`, "authenticated");
/** Přihlášený BEZ `sub` — token bez subjektu, `auth.uid()` je NULL. */
const bezSub = (volani: string) =>
  psql('{"role":"authenticated"}', `SELECT public.${volani}::text`, "authenticated");
/** Nepřihlášený. U těchhle funkcí nemá ani EXECUTE — druhá vrstva obrany. */
const jakoAnon = (volani: string) =>
  psql('{"role":"anon"}', `SELECT public.${volani}::text`, "anon");

const UDALOSTI_PARAMS = JSON.stringify({
  event_type: `vykladka-${RUN}`,
  columns: [{ key: "kdo", src: "twin_label" }, { key: "kde", src: "place_label" }],
});

describe.skipIf(!isPgReachable())("definer bloky: nárok, ne jen přihlášení", () => {
  beforeAll(() => {
    svc(`INSERT INTO aisha_auth.users (id,email) VALUES
           ('${ADMIN}','narok-admin-${RUN}@test.local'),
           ('${RIDIC}','narok-ridic-${RUN}@test.local')
         ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}','admin') ON CONFLICT DO NOTHING`);
    svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${RIDIC}','member') ON CONFLICT DO NOTHING`);
    // ⭐ Skutečné oprávnění role `member`. Bez něj by `has_permission` vracela
    // `false` i u toho, komu odpovídat SMÍ — a sonda by pak nerozlišila
    // „stráž zavřela" od „to oprávnění prostě nemá".
    svc(`INSERT INTO public.permissions (code,name) VALUES ('${PERM}','Sonda ${RUN}')
         ON CONFLICT (code) DO NOTHING`);
    svc(`INSERT INTO public.app_role_permissions (role, permission_id)
         SELECT 'member'::public.app_role, id FROM public.permissions WHERE code = '${PERM}'
         ON CONFLICT DO NOTHING`);
    svc(`INSERT INTO public.twin_entities (id,entity_type,label) VALUES
           ('${TWIN}','driver','Novak ${RUN}'), ('${MISTO}','place','Sklad ${RUN}')
         ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.twin_events (event_type,twin_id,place_twin_id,occurred_at,source,attrs)
         VALUES ('vykladka-${RUN}','${TWIN}','${MISTO}',now(),'wd-${RUN}','{"km":123}'::jsonb)`);
    svc(`INSERT INTO public.twin_external_refs (twin_id,ref_kind,source,source_key,state,proposed_by,valid_from)
         VALUES ('${TWIN}','account','aisha_auth','${RIDIC}','proposed','sonda-${RUN}',now() - interval '1 day')
         ON CONFLICT DO NOTHING`);

    // Dva procesní běhy: MŮJ (krok přiřazený řidiči) a CIZÍ (krok admina).
    // Bez kroků zůstane sonda slepá — právě na tom minulá fixtura ztroskotala
    // a `get_workflow_progress_block` zůstal na račně jako nerozhodnutý.
    svc(`INSERT INTO public.partner_stories (id,title,status) VALUES
           ('${STORY_MUJ}','Story MŮJ ${RUN}','active'),
           ('${STORY_CIZI}','Story CIZÍ ${RUN}','active') ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.production_batches (id,story_id) VALUES
           ('${BATCH_MUJ}','${STORY_MUJ}'), ('${BATCH_CIZI}','${STORY_CIZI}') ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.production_workflow_steps (batch_id,step_name,step_order,step_code,status,assigned_user_id) VALUES
           ('${BATCH_MUJ}','Naložení',1,'load','completed','${RIDIC}'),
           ('${BATCH_CIZI}','Naložení',1,'load','completed','${ADMIN}')`);
    // Admin je partnerem CIZÍHO příběhu — to má řidič zjistit NEMOŽNÉ.
    svc(`INSERT INTO public.story_participants (story_id,user_id,role) VALUES
           ('${STORY_CIZI}','${ADMIN}','partner'), ('${STORY_MUJ}','${RIDIC}','partner')
         ON CONFLICT DO NOTHING`);
  });

  it("⛔ tabulka událostí: admin vidí jméno a místo, řidič bez rolí NIC", () => {
    const a = jako(ADMIN, `get_twin_events_table_block('${UDALOSTI_PARAMS}'::jsonb)`);
    // Kontrolní vzorek: bez tohohle tvrzení by test prošel nad prázdnou DB.
    expect(a, "admin nevidí ani vlastní fixturu — sonda je slepá, ne zelená").toContain(`Novak ${RUN}`);
    expect(a).toContain(`Sklad ${RUN}`);

    const r = jako(RIDIC, `get_twin_events_table_block('${UDALOSTI_PARAMS}'::jsonb)`);
    expect(r, "řidič bez rolí vidí jméno osoby").not.toContain(`Novak ${RUN}`);
    expect(r, "řidič bez rolí vidí místo").not.toContain(`Sklad ${RUN}`);
  });

  it("⛔ fronta návrhů identity: admin vidí počet, řidič ne", () => {
    const volani = `get_twin_ref_pending_block('{"source":"aisha_auth"}'::jsonb)`;
    const a = jako(ADMIN, volani);
    expect(a, "admin nevidí počet — sonda je slepá").toMatch(/"value":\s*[1-9]/);
    expect(jako(RIDIC, volani), "řidič se dozví, kolik lidí se onboarduje").not.toMatch(/"value":\s*[1-9]/);
  });

  it("⛔ admin pohled na běhy systému nepatří řidiči", () => {
    const a = jako(ADMIN, `get_answer_chain_runs('{}'::jsonb)`);
    expect(a, "admin nevidí žádný běh — sonda je slepá").toMatch(/"rows":\s*\[\s*\{/);
    expect(jako(RIDIC, `get_answer_chain_runs('{}'::jsonb)`)).toMatch(/"rows":\s*\[\s*\]/);
  });

  /**
   * ⛔ POSLEDNÍ DVA Z RAČNY (doměřeno 2026-09-12). Oba bloky mají vnější guard
   * tvaru „jsi přihlášen?", takže vypadají jako zbylých devět — ale nárok
   * vymáhají NÍŽ, per běh (`get_batch_workflow_progress` vrací `ok:false`)
   * a per krok (`workflow_step_visible_to`). Rozdíl je měřitelný jen s fixturou,
   * která má DVA běhy: svůj a cizí.
   */
  it("⛔ průběh procesů: admin vidí oba běhy, řidič jen svůj", () => {
    const a = jako(ADMIN, `get_workflow_progress_block('{}'::jsonb)`);
    expect(a, "admin nevidí ani jeden běh — sonda je slepá").toContain(`Story MŮJ ${RUN}`);
    expect(a, "kontrolní vzorek: admin musí vidět i cizí běh").toContain(`Story CIZÍ ${RUN}`);

    const r = jako(RIDIC, `get_workflow_progress_block('{}'::jsonb)`);
    expect(r, "řidič nevidí ani vlastní běh — to není nárok, to je slepota").toContain(`Story MŮJ ${RUN}`);
    expect(r, "řidič vidí CIZÍ běh").not.toContain(`Story CIZÍ ${RUN}`);
  });

  it("⛔ časomíra: admin vidí oba běhy, řidič jen svůj", () => {
    const a = jako(ADMIN, `get_timing_tower_block('{}'::jsonb)`);
    expect(a, "admin nevidí ani jeden běh — sonda je slepá").toContain(`Story MŮJ ${RUN}`);
    expect(a).toContain(`Story CIZÍ ${RUN}`);

    const r = jako(RIDIC, `get_timing_tower_block('{}'::jsonb)`);
    expect(r).toContain(`Story MŮJ ${RUN}`);
    expect(r, "řidič vidí CIZÍ běh").not.toContain(`Story CIZÍ ${RUN}`);
  });

  /**
   * ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM. `has_role`/`has_permission` braly
   * uuid subjektu a pravdivě odpovídaly komukoli — `has_role` dokonce i bez
   * účtu. S veřejným adresářem účtů z toho byl výčet administrátorů.
   */
  it("⛔ nárok cizího účtu se nesmí dát vyzvědět", () => {
    // Kontrolní vzorek: o SOBĚ se volající dozvědět musí, jinak měřím rozbité.
    expect(jako(RIDIC, `has_role('${RIDIC}'::uuid,'member')`), "řidič se nedozví ani o sobě").toBe("true");
    expect(jako(ADMIN, `has_role('${ADMIN}'::uuid,'admin')`)).toBe("true");
    // A o cizím ne.
    expect(jako(RIDIC, `has_role('${ADMIN}'::uuid,'admin')`), "člen zjistí, kdo je admin").toBe("false");
    expect(jako(RIDIC, `has_permission('${ADMIN}'::uuid,'cokoli')`), "člen zjistí admina přes oprávnění").toBe("false");
    // Správa se ptát smí — jinak by se opravou rozbila administrace.
    expect(jako(ADMIN, `has_role('${RIDIC}'::uuid,'member')`), "admin se nesmí ptát na nikoho").toBe("true");
  });

  /**
   * ⛔ TÁŽ TŘÍDA, SESTERSKÁ FUNKCE (2026-09-18). `is_story_partner(uid, story)`
   * má GRANT pro anon a odpovídala komukoli. Detektor ji neviděl, protože
   * `auth.uid()` měla jen v komentáři.
   */
  it("⛔ účast cizího účtu v příběhu se nesmí dát vyzvědět", () => {
    // Kontrolní vzorek: o sobě ano (a tím i RLS, která se ptá na auth.uid()).
    expect(jako(RIDIC, `is_story_partner('${RIDIC}'::uuid,'${STORY_MUJ}'::uuid)`), "řidič se nedozví ani o sobě").toBe("true");
    expect(jako(ADMIN, `is_story_partner('${ADMIN}'::uuid,'${STORY_CIZI}'::uuid)`)).toBe("true");
    // O cizím ne.
    expect(jako(RIDIC, `is_story_partner('${ADMIN}'::uuid,'${STORY_CIZI}'::uuid)`), "řidič zjistí cizí účast").toBe("false");
    // Správa a služba se ptát smí.
    expect(jako(ADMIN, `is_story_partner('${RIDIC}'::uuid,'${STORY_MUJ}'::uuid)`), "admin se nesmí ptát").toBe("true");
    expect(svc(`SELECT public.is_story_partner('${ADMIN}'::uuid,'${STORY_CIZI}'::uuid)::text`), "service_role neprojde").toBe("true");
  });


  /**
   * ⛔ STRÁŽ, KTERÁ SE NEPROVEDE (naměřeno 2026-09-19, tip kolegy z upstreamu).
   *
   * Oprava orákula výš zavedla stráž tvaru
   *
   *     IF NOT (p_user_id = auth.uid() OR is_service_role() OR is_admin_or_staff())
   *
   * a ta drží jen pro PŘIHLÁŠENÉHO. Když `auth.uid()` vrátí NULL, je
   * `NULL = uuid` → NULL, `NULL OR false OR false` → NULL, `NOT NULL` → NULL,
   * a `IF NULL THEN` se chová jako `IF false` — tedy `RETURN false` se
   * PŘESKOČÍ a funkce pravdivě odpoví o třetí osobě. Zavřená stráž se tak
   * otevřela právě tomu, kdo se neprokázal vůbec.
   *
   * ⭐ PROČ TO PŘEDCHOZÍ TEST NENAŠEL: všechny případy výš se ptají identitou,
   * která `sub` MÁ (řidič, admin). Vada žije v cestě, kterou žádná z nich
   * neprojde — měří ji teprve volající bez subjektu.
   *
   * ⛔ Kontrolní vzorek je povinný i tady: nejdřív se tvrdí, že se `sub`
   * odpověď PŘIJDE. Dvě `false` nad mrtvou cestou by jinak vypadala jako „drží".
   */
  it("⛔ přihlášený BEZ sub (auth.uid() NULL) nárok cizího účtu nevyzvídá", () => {
    // Kontrolní vzorek: se `sub` to odpovídá — měřím živou cestu, ne mrtvou.
    expect(jako(ADMIN, `has_permission('${ADMIN}'::uuid,'cokoli')`),
      "admin se nedozví ani o sobě — sonda je slepá, ne zelená").toBe("true");

    // Vada: bez `sub` stráž nepadla dovnitř a funkce odpověděla o adminovi.
    expect(bezSub(`has_permission('${ADMIN}'::uuid,'cokoli')`),
      "token bez sub vyzvěděl, kdo je admin — stráž se neprovedla").toBe("false");
    // Silný pár: TOTÉŽ volání vrací `true`, když se volající prokáže. Bez něj
    // by obě strany byly `false` jen proto, že to oprávnění nikdo nemá.
    expect(jako(RIDIC, `has_permission('${RIDIC}'::uuid,'${PERM}')`),
      "řidič se nedozví o SVÉM oprávnění — sonda neumí vrátit true").toBe("true");
    expect(bezSub(`has_permission('${RIDIC}'::uuid,'${PERM}')`),
      "token bez sub si přečetl cizí oprávnění").toBe("false");

    // Sesterská funkce se stejným tvarem stráže.
    expect(jako(ADMIN, `workflow_step_visible_to('${RIDIC}'::uuid,'${RIDIC}'::uuid,NULL,'{}'::jsonb)`),
      "admin nevidí ani krok přiřazený řidiči — sonda je slepá").toBe("true");
    expect(bezSub(`workflow_step_visible_to('${RIDIC}'::uuid,'${RIDIC}'::uuid,NULL,'{}'::jsonb)`),
      "token bez sub si přečetl viditelnost cizího kroku").toBe("false");

    // Druhá vrstva: nepřihlášený na tyhle funkce nemá ani EXECUTE.
    expect(() => jakoAnon(`has_permission('${ADMIN}'::uuid,'cokoli')`),
      "anon má EXECUTE — spadla druhá vrstva obrany").toThrow();
  });

  /**
   * ⭐ DRUHÝ SMĚR: `IS NOT TRUE` nesmí zavřít dveře tomu, kdo nárok MÁ.
   * Bez tohohle tvrzení by „oprava" mohla být prostě `RETURN false` pro všechny
   * a test výš by ji spokojeně odkýval.
   */
  it("⭐ oprava stráže nezavřela dveře nároku", () => {
    expect(jako(RIDIC, `has_permission('${RIDIC}'::uuid,'${PERM}')`), "řidič se nedozví o SOBĚ").toBe("true");
    expect(jako(ADMIN, `has_permission('${RIDIC}'::uuid,'${PERM}')`), "správa se nesmí ptát na nikoho").toBe("true");
    expect(svc(`SELECT public.has_permission('${RIDIC}'::uuid,'${PERM}')::text`), "service_role neprojde").toBe("true");
    expect(svc(`SELECT public.workflow_step_visible_to('${RIDIC}'::uuid,'${RIDIC}'::uuid,NULL,'{}'::jsonb)::text`),
      "service_role neprojde u viditelnosti kroku").toBe("true");
  });

  /**
   * ⭐ DRUHÝ SMĚR: oprava nesmí zavřít dveře službě. `service_role` je vnitřní
   * volající (ingest, broker) a musí projít — jinak by se „bezpečnostní" oprava
   * projevila jako tiše nefunkční pipeline.
   */
  it("⭐ service_role prochází dál", () => {
    const s = svc(`SELECT public.get_twin_events_table_block('${UDALOSTI_PARAMS}'::jsonb)::text`);
    expect(s).toContain(`Novak ${RUN}`);
  });
});
