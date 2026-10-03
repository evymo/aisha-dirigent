/**
 * `create_story_entry_audited` — kdo je ve story, ten smí pořizovat; a kdo pořídil,
 * ten je podepsán.
 *
 * Nárok plyne z VAZBY, ne z vlastnictví ani z role. Platforma to už říká sama:
 * `partner_stories` nemá žádnou čtecí politiku pro `user_id`, jen pro účastníka
 *
 *   EXISTS (SELECT 1 FROM story_participants sp
 *           WHERE sp.story_id = partner_stories.id AND sp.user_id = auth.uid())
 *
 * a pro stack-default story. Vlastnictví je provenience, členství je klíč.
 *
 * Proto tahle sonda neměří „vlastník ano, cizí ne" — to by vyloučilo řidiče, který
 * story nevlastní, ale je v ní. Měří tři vlastnosti:
 *
 *   1. Účastník, jehož role zápis dovoluje, entry ZALOŽÍ a `created_by` nese JEHO id.
 *   2. Účastník rolí `viewer` nezapíše — čtení a zápis nejsou totéž a slovník
 *      `story_participant_role` ten rozdíl už nese („read-only; no mutation").
 *   3. Kdo ve story není, ten nezapíše.
 *
 * Druhá půlka první vlastnosti není kosmetika. Fotka předání i odečet měřiče jsou
 * story entry s dokumentem a smysl důkazu stojí na tom, KDO ho pořídil. Zápis, který
 * podepíše někoho jiného, je nespolehlivý i tam, kde nárok projde právem.
 *
 * Zapisovatel je SECURITY DEFINER a `GRANT EXECUTE … TO authenticated`, takže RLS ho
 * neomezuje ([[definer-nad-invokerem-rusi-rls]]) — celá autorizace je v jeho těle a
 * staticky ji změřit nejde. Měří se pod `authenticated` a DVĚMA identitami; pod
 * service_role by predikát mlčel ([[mereni-pod-service-role-obchazi-rls]]).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);

/** Story patří tomuhle člověku — ale vlastnictví samo nárok nedává. */
const OWNER = randomUUID();
/** Je ve story přes `story_participants`, nevlastní ji. Tohle je řidič. */
const PARTICIPANT = randomUUID();
/** Je ve story, ale rolí `viewer` — čte a nezapisuje. Tohle je recenzent. */
const VIEWER = randomUUID();
/** Přihlášený, ale ke story bez jediné vazby. */
const OUTSIDER = randomUUID();

let storyId = "";

function psql(claims: string, sql: string): string {
  return execFileSync(
    "psql",
    // `-q` je nutné: bez něj psql k výsledku přisype příkazovou značku (`INSERT 0 1`)
    // a návratová hodnota má dva řádky. Vzor, ze kterého je tenhle harness opsaný,
    // dělal jen SELECTy, takže na to nenarazil — a projevilo se to jako pád v
    // beforeAll, tedy jako červená, která ve skutečnosti NIC nezměřila.
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-q"],
    {
      encoding: "utf8",
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n${sql};`,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
}

const svc = (sql: string) => psql('{"role":"service_role"}', sql);

/**
 * Volání pod identitou uživatele. Role se přepíná SPOLU s claims — samotné claims
 * by nechaly měření běžet jako superuser a grant by se nikdy neuplatnil
 * ([[meridlo-naroku-ma-ctyri-pasti]]).
 */
function asUser(uid: string, sql: string): string {
  return execFileSync(
    "psql",
    // `-q` je nutné: bez něj psql k výsledku přisype příkazovou značku (`INSERT 0 1`)
    // a návratová hodnota má dva řádky. Vzor, ze kterého je tenhle harness opsaný,
    // dělal jen SELECTy, takže na to nenarazil — a projevilo se to jako pád v
    // beforeAll, tedy jako červená, která ve skutečnosti NIC nezměřila.
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-q"],
    {
      encoding: "utf8",
      input:
        `\\o /dev/null\nBEGIN;\n` +
        `SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"${uid}"}';\n` +
        `SET LOCAL ROLE authenticated;\n\\o\n${sql};\n\\o /dev/null\nCOMMIT;\n\\o`,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
}

beforeAll(() => {
  if (!dbAvailable) return;
  svc(
    `INSERT INTO aisha_auth.users (id, email) VALUES
       ('${OWNER}','story-owner-${RUN}@test.local'),
       ('${PARTICIPANT}','story-participant-${RUN}@test.local'),
       ('${VIEWER}','story-viewer-${RUN}@test.local'),
       ('${OUTSIDER}','story-outsider-${RUN}@test.local')
     ON CONFLICT (id) DO NOTHING`,
  );
  // Story MUSÍ mít partnera. Ne kvůli scénáři — ten je členský — ale aby se sonda
  // vůbec dostala ke spornému místu: dřívější znění hlásilo „Story not found“ na
  // KAŽDOU story s partner_id IS NULL, takže by všechna tři tvrzení skončila stejně
  // a dvě z nich by prošla ze špatného důvodu. Partner je cizí, volající k němu
  // nemají kontext, takže partnerská větev nezabere a rozhoduje se podle vazby.
  const partnerId = svc(
    `WITH ins AS (
       INSERT INTO public.partner_profiles (user_id, display_name, city)
       VALUES ('${OWNER}', 'Fixtura ${RUN}', 'Praha') RETURNING id
     ) SELECT id FROM ins`,
  );
  storyId = svc(
    `WITH ins AS (
       INSERT INTO public.partner_stories (user_id, partner_id, title)
       VALUES ('${OWNER}', '${partnerId}', 'Autorstvi entry ${RUN}') RETURNING id
     ) SELECT id FROM ins`,
  );
  // Sebekontrola fixtury. Když se do návratové hodnoty připlete cokoli jiného než
  // uuid, ať to spadne TADY a s vysvětlením — ne o dva dotazy dál jako záhadná
  // syntaktická chyba, ze které vypadne „červená“, co ve skutečnosti nic neměřila.
  if (!/^[0-9a-f-]{36}$/.test(storyId)) {
    throw new Error(`fixtura nevrátila uuid story, ale ${JSON.stringify(storyId)}`);
  }
  // Vazby, ze kterých nárok plyne — tytéž, jaké čte RLS politika partner_stories.
  // Role je slovník `story_participant_role`: collaborator zapisuje, viewer ne.
  svc(
    `INSERT INTO public.story_participants (story_id, user_id, role) VALUES
       ('${storyId}', '${PARTICIPANT}', 'collaborator'),
       ('${storyId}', '${VIEWER}', 'viewer')
     ON CONFLICT DO NOTHING`,
  );
});

afterAll(() => {
  if (!dbAvailable || !storyId) return;
  svc(`DELETE FROM public.story_entries WHERE story_id = '${storyId}'`);
  svc(`DELETE FROM public.story_participants WHERE story_id = '${storyId}'`);
  svc(`DELETE FROM public.partner_stories WHERE id = '${storyId}'`);
  svc(`DELETE FROM public.partner_profiles WHERE display_name = 'Fixtura ${RUN}'`);
  svc(
    `DELETE FROM aisha_auth.users
     WHERE id IN ('${OWNER}','${PARTICIPANT}','${VIEWER}','${OUTSIDER}')`,
  );
});

describe.skipIf(!dbAvailable)("create_story_entry_audited — nárok z vazby, podpis autora", () => {
  it("účastník story záznam pořídí a created_by nese JEHO id", () => {
    asUser(
      PARTICIPANT,
      `SELECT public.create_story_entry_audited('${storyId}', 'note', 'zaznam ucastnika')`,
    );

    const author = svc(
      `SELECT created_by FROM public.story_entries
       WHERE story_id = '${storyId}' AND content = 'zaznam ucastnika'`,
    );

    // Dnes tady sedí OWNER: `SELECT … INTO v_user_id` přepíše volajícího vlastníkem
    // story, takže zápis podepíše někoho, kdo u toho nebyl.
    expect(author, "created_by není autor záznamu").toBe(PARTICIPANT);
  });

  it("účastník rolí `viewer` čte, ale nezapisuje", () => {
    let refused = false;
    try {
      asUser(VIEWER, `SELECT public.create_story_entry_audited('${storyId}', 'note', 'zaznam viewera')`);
    } catch {
      refused = true;
    }

    expect(
      refused,
      "viewer je definován jako read-only; zápis od něj znamená, že se nárok ptá jen na členství a ne na roli",
    ).toBe(true);
  });

  it("kdo ve story není, ten do ní nezapíše", () => {
    let refused = false;
    try {
      asUser(OUTSIDER, `SELECT public.create_story_entry_audited('${storyId}', 'note', 'zaznam zvenci')`);
    } catch {
      refused = true;
    }

    // Když to projde, ať je z hlášky vidět i následek — ne jen že brána nezabrala.
    const leaked = refused
      ? "0"
      : svc(
          `SELECT count(*) FROM public.story_entries
           WHERE story_id = '${storyId}' AND content = 'zaznam zvenci'`,
        );

    expect(refused, `člověk bez vazby na story založil ${leaked} entry`).toBe(true);
  });
});
