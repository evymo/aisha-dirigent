/**
 * Podmíněný grant `production_operator` NA ŽIVÉ DB — měří se SQL, které roster
 * opravdu emituje, ne jeho ruční kopie.
 *
 * Proč vůbec: všech 63 `production_workflow_steps` („Odečet na místě") je psáno
 * na roli `production_operator`; roster deklaruje čtyři lidi a všem dává jen
 * admin+staff, takže `wf_my_steps` na poradě vracelo prázdno KAŽDÉMU účtu
 * (naměřeno 2026-09-28; po přidání té role členovi blok vydal 20 položek).
 * Rozhodnutí majitele: roli přiděluje roster jako ZÁLOHU — jen admin/staff, kdo
 * je za odsouhlasování „pravdy" odpovědný, a jen když člověk nemá nárok už
 * z potvrzené vazby účet↔dvojče (`ref_kind='account'`), protože tu kroky svého
 * dvojčete dostane přes `workflow_step_visible_to`.
 *
 * Tvar SQL hlídá `src/tests/gates/roster-ratifikacni-role.gate.test.ts`; tady se
 * ověřuje, že DB podle něj skutečně rozhodne. Fixtury jsou náhodná UUID a na
 * konci se mažou; když test spadne uprostřed, zůstanou v throwaway DB ležet.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  PG_HOST,
  PG_PORT,
  PG_USER,
  PG_PASSWORD,
  PG_DATABASE,
  isPgReachable,
  reportTestCapabilities,
} from "./test-env-probe";

const dbAvailable = isPgReachable();
const ROOT = process.cwd();

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { encoding: "utf8", input: sql, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

/** Má daný účet ratifikační roli? */
function maRoli(sub: string): boolean {
  return psql(`SELECT count(*) FROM public.user_roles WHERE user_id = '${sub}'::uuid AND role = 'production_operator';`) === "1";
}

const operator = (sub: string, roles: string[]) => ({
  email: `roster-${sub.slice(0, 8)}@test.invalid`,
  sub,
  displayName: "Roster Runtime",
  language: "cs",
  roles,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  await reportTestCapabilities("Roster × ratifikační role");
  process.env.KEYCLOAK_URL = process.env.KEYCLOAK_URL || "http://kc.test";
  process.env.KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || "aisha";
  mod = await import(pathToFileURL(join(ROOT, "scripts/db/provision-operators.mjs")).href);
});

describe("roster × ratifikační role (živá DB)", () => {
  it.skipIf(!dbAvailable)("admin bez vazby roli DOSTANE", () => {
    const sub = randomUUID();
    try {
      psql(mod.buildSql([operator(sub, ["admin", "production_operator"])]));
      expect(maRoli(sub)).toBe(true);
    } finally {
      psql(`DELETE FROM aisha_auth.users WHERE id = '${sub}'::uuid;`);
    }
  });

  it.skipIf(!dbAvailable)("admin S potvrzenou vazbou účet↔dvojče roli dostane TAKÉ — vazba frontu adresovanou roli nenese", () => {
    const sub = randomUUID();
    const twin = randomUUID();
    try {
      psql(
        `INSERT INTO public.twin_entities (id, entity_type, label) VALUES ('${twin}'::uuid, 'driver', 'Roster runtime fixture');
         INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, valid_from, confirmed_at)
         VALUES ('${twin}'::uuid, 'aisha_auth', '${sub}', 'account', 'confirmed', 'test', NOW(), NOW());`,
      );
      psql(mod.buildSql([operator(sub, ["admin", "production_operator"])]));
      // ⭐ ZÁMĚRNĚ true: původně tu vazba grant potlačovala, ale vazba ukazuje jen
      // kroky, kde `input_data.authorized_twin_id` je jeho dvojče — kroky adresované
      // ROLI nikoli, a na ratifikaci nálezů nemá vliv vůbec. Potlačení by tedy
      // odebralo adresu za nic. Tenhle test drží to rozhodnutí.
      expect(maRoli(sub)).toBe(true);
    } finally {
      psql(
        `DELETE FROM public.twin_external_refs WHERE source_key = '${sub}';
         DELETE FROM public.twin_entities WHERE id = '${twin}'::uuid;
         DELETE FROM aisha_auth.users WHERE id = '${sub}'::uuid;`,
      );
    }
  });

  it.skipIf(!dbAvailable)("bez admin/staff roli NEDOSTANE, ani když ji roster žádá", () => {
    const sub = randomUUID();
    try {
      const sql = mod.buildSql([operator(sub, ["member", "production_operator"])]);
      expect(sql).toContain("⛔ production_operator NEPŘIDĚLENO");
      psql(sql);
      expect(maRoli(sub)).toBe(false);
      // ⭐ a i kdyby emitor obešel, DB si nárok kontroluje sama: tenhle INSERT
      // je tvarem TEN, který roster posílá adminovi — na členovi neprojde.
      psql(
        `INSERT INTO public.user_roles (user_id, role, granted_by, granted_at)
         SELECT '${sub}'::uuid, 'production_operator'::public.app_role, NULL, NOW()
         WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = '${sub}'::uuid
                         AND ur.role IN ('admin'::public.app_role, 'staff'::public.app_role))
         ON CONFLICT (user_id, role) DO NOTHING;`,
      );
      expect(maRoli(sub)).toBe(false);
    } finally {
      psql(`DELETE FROM aisha_auth.users WHERE id = '${sub}'::uuid;`);
    }
  });
});
