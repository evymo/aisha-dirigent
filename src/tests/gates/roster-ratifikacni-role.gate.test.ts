/**
 * `production_operator` je PODMÍNĚNÝ grant, ne obyčejná položka rosteru.
 *
 * ⛔ NAMĚŘENO 2026-09-28 na DB postavené z main + overlay dat instance: všech 63
 * `production_workflow_steps` („Odečet na místě") je psáno na roli
 * `production_operator`, kterou nemá NIKDO — roster deklaruje čtyři lidi a všem
 * dává jen admin+staff. Blok `wf_my_steps` na poradě proto vracel prázdno
 * KAŽDÉMU účtu, ačkoli práce existovala; po dočasném přidání té role členovi
 * vydal 20 položek. Adresa byla nedoručitelná, blok v pořádku.
 *
 * Rozhodnutí majitele: roli přiděluje roster, ale jako ZÁLOHU — jen admin/staff,
 * kdo je za odsouhlasování „pravdy" odpovědný, a jen když člověk nemá nárok už
 * z potvrzené vazby účet↔dvojče. Tahle brána drží tvar emitovaného SQL, protože
 * obě podmínky musí zůstat V DATABÁZI: deklarace v rosteru je vstup, o přidělení
 * rozhoduje DB při každém nasazení znovu. Chování na živé DB ověřuje
 * `src/tests/db/roster-ratifikacni-role-runtime.test.ts`.
 */
import { describe, test, expect, beforeAll } from "vitest";
import { join } from "path";
import { pathToFileURL } from "url";

const ROOT = process.cwd();
const SUB = "11111111-1111-4111-8111-111111111111";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  // KC/KC_REALM se v modulu čtou z env při importu (jako v sousední bráně).
  process.env.KEYCLOAK_URL = process.env.KEYCLOAK_URL || "http://kc.test";
  process.env.KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || "aisha";
  mod = await import(pathToFileURL(join(ROOT, "scripts/db/provision-operators.mjs")).href);
});

const operator = (roles: string[], sub: string = SUB) => ({
  email: `roster-${roles.join("-")}@test.invalid`,
  sub,
  displayName: "Roster Test",
  language: "cs",
  roles,
});

describe("roster × ratifikační role", () => {
  test("admin/staff: grant je podmíněný SELECTem na nárok, nikdy paušální VALUES", () => {
    const sql = mod.buildSql([operator(["admin", "staff", "production_operator"])]);
    expect(sql).toContain("'production_operator'::public.app_role");
    // nárok na roli: jen admin/staff
    expect(sql).toMatch(/ur\.role IN \('admin'::public\.app_role, 'staff'::public\.app_role\)/);
    // ⛔ a ŽÁDNÁ podmínka na vazbu účet↔dvojče: běžela tu a byla odstraněna,
    // protože vazba ukazuje jen kroky TVÉHO dvojčete a na ratifikaci nálezů nemá
    // vliv — uměla tedy jen odebrat adresu za nic. Zpátky jen s měřením.
    expect(sql).not.toMatch(/ref_kind = 'account'/);
    // paušální řádek v hromadném INSERTu té role NESMÍ vzniknout
    expect(sql).not.toMatch(/VALUES[^;]*'production_operator'::public\.app_role/);
  });

  test("bez admin/staff se role nepřidělí a v SQL to je vidět", () => {
    const sql = mod.buildSql([operator(["member", "production_operator"])]);
    expect(sql).toContain("⛔ production_operator NEPŘIDĚLENO");
    expect(sql).not.toContain("'production_operator'::public.app_role");
    expect(sql).toMatch(/'member'::public\.app_role/);
  });

  test("roster jen s ratifikační rolí nevyrobí INSERT s prázdným VALUES", () => {
    const jenRatifikace = mod.buildSql([operator(["production_operator"])]);
    expect(jenRatifikace).not.toMatch(/VALUES\s*\nON CONFLICT \(user_id, role\)/);
    const sAdminem = mod.buildSql([operator(["admin", "production_operator"])]);
    expect(sAdminem).toMatch(/VALUES\n {2}\('[^']+', 'admin'::public\.app_role/);
    expect(sAdminem).not.toMatch(/VALUES\s*\nON CONFLICT \(user_id, role\)/);
  });

  test("rozdelRole/planRatifikaci: dělení rolí a důvod odmítnutí na jednom místě", () => {
    expect(mod.rozdelRole(["admin", "production_operator"])).toEqual({ bezne: ["admin"], ratifikace: true });
    expect(mod.rozdelRole([])).toEqual({ bezne: [], ratifikace: false });
    expect(mod.planRatifikaci({ sub: SUB, roles: ["admin"] }).duvod).toMatch(/neuvádí/);
    expect(mod.planRatifikaci({ sub: SUB, roles: ["member", "production_operator"] }).duvod).toMatch(/admin\/staff/);
    expect(mod.planRatifikaci({ sub: SUB, roles: ["staff", "production_operator"] }).sql).toBeTruthy();
    // nikdy obojí: buď SQL, nebo důvod
    const plan = mod.planRatifikaci({ sub: SUB, roles: ["admin", "production_operator"] });
    expect(plan.sql && plan.duvod).toBeFalsy();
  });
});
