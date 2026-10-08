/**
 * func-manager parser & rules gate tests
 *
 * Testuje čisté funkce z:
 * - scripts/db/func-manager/lib/parser.mjs  (extractMetadata, extractGrants, detectCategory, …)
 * - scripts/db/func-manager/lib/rules.mjs   (canHaveAnonAccess, FUNCTION_CATEGORIES, VALIDATION_RULES)
 *
 * Spouští se přes vitest.gates.config.ts (node env, 2 min timeout).
 */

import { describe, it, expect, beforeAll } from "vitest";
import path from "path";

/* ---------- dynamic ESM imports ---------- */

interface FuncMetadata {
  security: string;
  hasSearchPath: boolean;
  language: string;
  hasAuditInsert: boolean;
  category: string;
  hasConsentCheck: boolean;
  hasRoleCheck: boolean;
  dependencies: string[];
  tables: string[];
  returnType: {
    type: string;
    columns?: Array<{ name: string; type: string }>;
    baseType?: string;
  };
  parameters: Array<{
    name: string;
    type: string;
    hasDefault?: boolean;
    defaultValue?: string;
  }>;
}

interface GrantInfo {
  anon: boolean;
  authenticated: boolean;
  service_role: boolean;
  public: boolean;
}

interface CategoryConfig {
  expectedSecurity?: string;
  requiresAudit?: boolean;
  requiresRoleCheck?: boolean;
  requiresConsentCheck?: boolean;
  allowedGrants?: string[];
}

interface ParserModule {
  extractMetadata: (sql: string, name: string) => FuncMetadata;
  extractGrants: (sql: string) => GrantInfo;
  detectCategory: (name: string) => string;
  extractTables: (sql: string) => string[];
  extractDependencies: (sql: string, name: string) => string[];
}

interface RulesModule {
  canHaveAnonAccess: (name: string, sql: string) => { allowed: boolean; reason?: string };
  FUNCTION_CATEGORIES: Record<string, CategoryConfig>;
  VALIDATION_RULES: Record<string, { check: (sql: string, meta: Record<string, unknown>) => boolean }>;
}

let parser: ParserModule;
let rules: RulesModule;

beforeAll(async () => {
  const root = path.resolve(__dirname, "../../..");
  parser = await import(
    path.join(root, "scripts/db/func-manager/lib/parser.mjs")
  );
  rules = await import(
    path.join(root, "scripts/db/func-manager/lib/rules.mjs")
  );
});

/* ====================================================================
 * 1. extractMetadata
 * ==================================================================== */

describe("extractMetadata", () => {
  it("detekuje SECURITY DEFINER a search_path", () => {
    const sql = `
CREATE OR REPLACE FUNCTION get_my_data(p_user_id uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT id, name FROM profiles WHERE user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION get_my_data FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_data TO authenticated;
`;
    const meta = parser.extractMetadata(sql, "get_my_data");
    expect(meta.security).toBe("DEFINER");
    expect(meta.hasSearchPath).toBe(true);
    expect(meta.language).toBe("plpgsql");
  });

  it("detekuje SECURITY INVOKER (default)", () => {
    const sql = `
CREATE OR REPLACE FUNCTION get_my_data(p_user_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  SELECT 1;
$$;
`;
    const meta = parser.extractMetadata(sql, "get_my_data");
    expect(meta.security).toBe("INVOKER");
    expect(meta.hasSearchPath).toBe(false);
    expect(meta.language).toBe("sql");
  });

  it("detekuje audit insert", () => {
    const sql = `
CREATE OR REPLACE FUNCTION get_my_check_ins_audited(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_journal (user_id, action) VALUES (p_user_id, 'PHI_READ');
END;
$$;
`;
    const meta = parser.extractMetadata(sql, "get_my_check_ins_audited");
    expect(meta.hasAuditInsert).toBe(true);
    expect(meta.category).toBe("AUDITED");
  });

  it("detekuje write_audit_journal volání", () => {
    const sql = `
CREATE OR REPLACE FUNCTION get_stuff_audited()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM write_audit_journal('system', 'TEST', '{}'::jsonb);
END;
$$;
`;
    const meta = parser.extractMetadata(sql, "get_stuff_audited");
    expect(meta.hasAuditInsert).toBe(true);
  });

  it("detekuje role check patterny", () => {
    const sql = `
CREATE OR REPLACE FUNCTION admin_do_stuff()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
END;
$$;
`;
    const meta = parser.extractMetadata(sql, "admin_do_stuff");
    expect(meta.hasRoleCheck).toBe(true);
  });

  it("detekuje consent check", () => {
    const sql = `
CREATE OR REPLACE FUNCTION get_user_data(p_user_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT has_data_sharing_consent(p_user_id, p_user_id) THEN
    RAISE EXCEPTION 'No consent';
  END IF;
END;
$$;
`;
    const meta = parser.extractMetadata(sql, "get_user_data");
    expect(meta.hasConsentCheck).toBe(true);
    expect(meta.category).toBe("PATIENT");
  });

  it("detekuje consent check přes JOIN data_sharing_consents + revoked_at IS NULL", () => {
    const sql = `
CREATE OR REPLACE FUNCTION get_user_records(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    SELECT h.id FROM health_check_ins h
    JOIN data_sharing_consents c ON c.user_id = h.user_id
    WHERE c.revoked_at IS NULL;
END;
$$;
`;
    const meta = parser.extractMetadata(sql, "get_user_records");
    expect(meta.hasConsentCheck).toBe(true);
  });

  it("extrahuje závislosti (dependencies)", () => {
    const sql = `
CREATE OR REPLACE FUNCTION do_admin_stuff()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'denied';
  END IF;
  PERFORM write_audit_journal('admin', 'ACTION', '{}');
END;
$$;
`;
    const meta = parser.extractMetadata(sql, "do_admin_stuff");
    expect(meta.dependencies).toContain("is_admin_or_staff");
    expect(meta.dependencies).toContain("write_audit_journal");
  });

  it("nevkládá self-reference do dependencies", () => {
    const sql = `
CREATE OR REPLACE FUNCTION is_admin_or_staff()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN has_role(auth.uid(), 'admin');
END;
$$;
`;
    const meta = parser.extractMetadata(sql, "is_admin_or_staff");
    expect(meta.dependencies).not.toContain("is_admin_or_staff");
    expect(meta.dependencies).toContain("has_role");
  });

  it("extrahuje tabulky z SQL", () => {
    const sql = `
CREATE OR REPLACE FUNCTION get_stuff()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    SELECT h.id FROM health_check_ins h
    JOIN profiles p ON p.id = h.user_id
    LEFT JOIN data_sharing_consents dsc ON dsc.user_id = p.id;
END;
$$;
`;
    const meta = parser.extractMetadata(sql, "get_stuff");
    expect(meta.tables).toContain("health_check_ins");
    expect(meta.tables).toContain("profiles");
    expect(meta.tables).toContain("data_sharing_consents");
  });
});

/* ====================================================================
 * 2. extractGrants
 * ==================================================================== */

describe("extractGrants", () => {
  it("detekuje GRANT TO authenticated", () => {
    const sql = `
REVOKE ALL ON FUNCTION my_func FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_func TO authenticated;
`;
    const grants = parser.extractGrants(sql);
    expect(grants.authenticated).toBe(true);
    expect(grants.anon).toBe(false);
    expect(grants.service_role).toBe(false);
    expect(grants.public).toBe(false);
  });

  it("detekuje GRANT TO anon", () => {
    const sql = `
REVOKE ALL ON FUNCTION my_func FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_func TO anon;
GRANT EXECUTE ON FUNCTION my_func TO authenticated;
`;
    const grants = parser.extractGrants(sql);
    expect(grants.anon).toBe(true);
    expect(grants.authenticated).toBe(true);
  });

  it("detekuje multi-role GRANT", () => {
    const sql = `
GRANT EXECUTE ON FUNCTION my_func TO anon, authenticated;
`;
    const grants = parser.extractGrants(sql);
    expect(grants.anon).toBe(true);
    expect(grants.authenticated).toBe(true);
  });

  it("vrací false pro všechny role bez GRANTu", () => {
    const sql = `
CREATE OR REPLACE FUNCTION helper_func()
RETURNS void
LANGUAGE plpgsql
AS $$ BEGIN END; $$;
`;
    const grants = parser.extractGrants(sql);
    expect(grants.anon).toBe(false);
    expect(grants.authenticated).toBe(false);
    expect(grants.service_role).toBe(false);
  });

  // ⛔ NAMĚŘENO 2026-10-04: všechny případy výš jmenují funkci BEZ signatury. Vzor
  // `ON FUNCTION \S+ TO` proto testy prošel a přitom neviděl grant u 1005 funkcí SoT,
  // jejichž signatura nese mezeru. Tvary níž jsou opsané ze SoT.
  it.each([
    ["typy oddělené čárkou a mezerou", "GRANT EXECUTE ON FUNCTION public.f(uuid, uuid) TO service_role;"],
    ["pojmenované parametry", "GRANT EXECUTE ON FUNCTION public.f(p_product_id uuid, p_quantity integer) TO service_role;"],
    ["typ o dvou slovech", "GRANT EXECUTE ON FUNCTION f(vector,text,double precision) TO service_role;"],
    ["typ s rozměrem", "GRANT EXECUTE ON FUNCTION public.f(uuid, vector(1024), integer) TO service_role;"],
    ["příkaz přes víc řádků", "GRANT EXECUTE\n  ON FUNCTION public.f(\n    uuid,\n    text\n  )\n  TO service_role;"],
    ["parametr se jménem končícím na _to", "GRANT EXECUTE ON FUNCTION public.f(p_from date, p_to date) TO service_role;"],
    ["GRANT ALL", "GRANT ALL ON FUNCTION public.f(uuid, text) TO service_role;"],
  ])("vidí grant, když signatura nese mezeru: %s", (_nazev, sql) => {
    expect(parser.extractGrants(sql)).toEqual({ anon: false, authenticated: false, service_role: true, public: false });
  });

  it("zakomentovaný GRANT není grant", () => {
    const sql = `
-- GRANT EXECUTE ON FUNCTION public.f(uuid) TO anon;
/* GRANT EXECUTE ON FUNCTION public.f(uuid) TO authenticated; */
GRANT EXECUTE ON FUNCTION public.f(uuid) TO service_role;
`;
    expect(parser.extractGrants(sql)).toEqual({ anon: false, authenticated: false, service_role: true, public: false });
  });

  it("roli porovnává celým jménem, ne podřetězcem", () => {
    const sql = `GRANT EXECUTE ON FUNCTION public.f(uuid) TO anon_reader, "authenticated";`;
    expect(parser.extractGrants(sql)).toEqual({ anon: false, authenticated: true, service_role: false, public: false });
  });

  it("PUBLIC jako příjemce pozná, schéma public v signatuře za příjemce nebere", () => {
    expect(parser.extractGrants("GRANT EXECUTE ON FUNCTION public.f(uuid) TO PUBLIC;").public).toBe(true);
    expect(parser.extractGrants("GRANT EXECUTE ON FUNCTION public.f(uuid) TO service_role;").public).toBe(false);
  });
});

/* ====================================================================
 * 3. detectCategory
 * ==================================================================== */

describe("detectCategory", () => {
  const cases: Array<[string, string]> = [
    ["get_admin_users", "ADMIN"],
    ["update_admin_settings", "ADMIN"],
    ["get_my_check_ins_audited", "AUDITED"],
    ["get_my_health_check_ins", "MY_READ"],
    ["create_my_profile", "MY_WRITE"],
    ["update_my_settings", "MY_WRITE"],
    ["delete_my_record", "MY_WRITE"],
    ["get_user_records", "PATIENT"],
    ["get_partner_dashboard", "PARTNER"],
    ["get_consultant_users", "CONSULTANT"],
    ["get_public_studies", "PUBLIC"],
    ["is_admin_or_staff", "ADMIN"], // _admin$ matchne dříve než ^is_
    ["has_role", "HELPER"],
    ["check_permission", "HELPER"],
    ["log_action", "LOGGING"],
    ["write_audit_journal", "LOGGING"],
    ["handle_new_user", "TRIGGER"],
    ["trigger_updated_at", "TRIGGER"],
    ["update_updated_at_column", "SYSTEM"],
    ["set_claim", "SYSTEM"],
    ["some_random_function", "OTHER"],
  ];

  for (const [funcName, expectedCategory] of cases) {
    it(`${funcName} → ${expectedCategory}`, () => {
      const category = parser.detectCategory(funcName);
      expect(category).toBe(expectedCategory);
    });
  }
});

/* ====================================================================
 * 4. extractReturnType (via extractMetadata)
 * ==================================================================== */

describe("extractReturnType", () => {
  it("detekuje RETURNS TABLE", () => {
    const sql = `
CREATE OR REPLACE FUNCTION get_data()
RETURNS TABLE (id uuid, name text, created_at timestamptz)
LANGUAGE plpgsql AS $$ BEGIN END; $$;
`;
    const meta = parser.extractMetadata(sql, "get_data");
    expect(meta.returnType.type).toBe("table");
    expect(meta.returnType.columns).toHaveLength(3);
    expect(meta.returnType.columns?.[0].name).toBe("id");
    expect(meta.returnType.columns?.[0].type).toBe("uuid");
    expect(meta.returnType.columns?.[2].name).toBe("created_at");
  });

  it("detekuje RETURNS SETOF", () => {
    const sql = `
CREATE OR REPLACE FUNCTION get_users()
RETURNS SETOF profiles
LANGUAGE plpgsql AS $$ BEGIN END; $$;
`;
    const meta = parser.extractMetadata(sql, "get_users");
    expect(meta.returnType.type).toBe("setof");
    expect(meta.returnType.baseType).toBe("profiles");
  });

  it("detekuje scalar return type", () => {
    const sql = `
CREATE OR REPLACE FUNCTION count_users()
RETURNS bigint
LANGUAGE sql AS $$ SELECT count(*) FROM profiles; $$;
`;
    const meta = parser.extractMetadata(sql, "count_users");
    expect(meta.returnType.type).toBe("scalar");
    expect(meta.returnType.baseType).toBe("bigint");
  });

  it("detekuje void return", () => {
    const sql = `
CREATE FUNCTION do_nothing()
LANGUAGE plpgsql AS $$ BEGIN END; $$;
`;
    const meta = parser.extractMetadata(sql, "do_nothing");
    expect(meta.returnType.type).toBe("void");
  });
});

/* ====================================================================
 * 5. extractParameters (via extractMetadata)
 * ==================================================================== */

describe("extractParameters", () => {
  it("extrahuje jednoduché parametry", () => {
    const sql = `
CREATE OR REPLACE FUNCTION my_func(p_user_id uuid, p_limit integer)
RETURNS void
LANGUAGE plpgsql AS $$ BEGIN END; $$;
`;
    const meta = parser.extractMetadata(sql, "my_func");
    expect(meta.parameters).toHaveLength(2);
    expect(meta.parameters[0].name).toBe("p_user_id");
    expect(meta.parameters[0].type).toBe("uuid");
    expect(meta.parameters[1].name).toBe("p_limit");
    expect(meta.parameters[1].type).toBe("integer");
  });

  it("extrahuje parametry s DEFAULT", () => {
    const sql = `
CREATE OR REPLACE FUNCTION my_func(p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
RETURNS void
LANGUAGE plpgsql AS $$ BEGIN END; $$;
`;
    const meta = parser.extractMetadata(sql, "my_func");
    expect(meta.parameters).toHaveLength(2);
    expect(meta.parameters[0].hasDefault).toBe(true);
    expect(meta.parameters[0].defaultValue).toBe("30");
    expect(meta.parameters[1].hasDefault).toBe(true);
  });

  it("správně handluje funkci bez parametrů", () => {
    const sql = `
CREATE OR REPLACE FUNCTION my_func()
RETURNS void
LANGUAGE plpgsql AS $$ BEGIN END; $$;
`;
    const meta = parser.extractMetadata(sql, "my_func");
    expect(meta.parameters).toHaveLength(0);
  });

  it("handluje vnořené závorky v parametrech", () => {
    const sql = `
CREATE OR REPLACE FUNCTION my_func(p_data jsonb DEFAULT '{}'::jsonb, p_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$ BEGIN END; $$;
`;
    const meta = parser.extractMetadata(sql, "my_func");
    expect(meta.parameters).toHaveLength(2);
    expect(meta.parameters[0].name).toBe("p_data");
  });
});

/* ====================================================================
 * 6. extractTables (standalone)
 * ==================================================================== */

describe("extractTables", () => {
  it("extrahuje tabulky ze SELECT, JOIN, INSERT, UPDATE, DELETE", () => {
    const sql = `
  SELECT * FROM profiles p
  JOIN health_check_ins h ON h.user_id = p.id
  LEFT JOIN orders o ON o.user_id = p.id;

  INSERT INTO audit_journal (user_id, action) VALUES ('x', 'y');

  UPDATE profiles SET name = 'test';

  DELETE FROM old_records WHERE id = 'x';
`;
    const tables = parser.extractTables(sql);
    expect(tables).toContain("profiles");
    expect(tables).toContain("health_check_ins");
    expect(tables).toContain("orders");
    expect(tables).toContain("audit_journal");
    expect(tables).toContain("old_records");
  });

  it("ignoruje systémové tabulky", () => {
    const sql = `
  SELECT * FROM pg_class;
  SELECT * FROM information_schema.columns;
  SELECT * FROM auth.users;
`;
    const tables = parser.extractTables(sql);
    // pg_class and auth.* should be skipped by ignoreList
    expect(tables).not.toContain("pg_class");
  });

  it("handluje public. prefix", () => {
    const sql = `SELECT * FROM public.profiles JOIN public.orders ON true;`;
    const tables = parser.extractTables(sql);
    expect(tables).toContain("profiles");
    expect(tables).toContain("orders");
  });
});

/* ====================================================================
 * 7. extractDependencies
 * ==================================================================== */

describe("extractDependencies", () => {
  it("detekuje volání helper funkcí", () => {
    const sql = `
CREATE OR REPLACE FUNCTION admin_action()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN RAISE EXCEPTION 'no'; END IF;
  IF NOT has_permission(auth.uid(), 'manage_users') THEN RAISE EXCEPTION 'no'; END IF;
  PERFORM write_audit_journal('admin', 'ACTION', '{}');
END;
$$;
`;
    const deps = parser.extractDependencies(sql, "admin_action");
    expect(deps).toContain("is_admin_or_staff");
    expect(deps).toContain("has_permission");
    expect(deps).toContain("write_audit_journal");
  });

  it("neobsahuje self-reference", () => {
    const sql = `
CREATE OR REPLACE FUNCTION has_role(p_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  -- recursion check: NOT calling has_role itself
  RETURN EXISTS(SELECT 1 FROM user_roles WHERE user_id = p_user_id);
END;
$$;
`;
    const deps = parser.extractDependencies(sql, "has_role");
    expect(deps).not.toContain("has_role");
  });
});

/* ====================================================================
 * 8. canHaveAnonAccess (rules.mjs)
 * ==================================================================== */

describe("canHaveAnonAccess", () => {
  it("povoluje public patterny", () => {
    expect(rules.canHaveAnonAccess("get_public_studies", "").allowed).toBe(
      true
    );
    expect(rules.canHaveAnonAccess("get_products", "").allowed).toBe(true);
    expect(
      rules.canHaveAnonAccess("get_certified_partners", "").allowed
    ).toBe(true);
    expect(rules.canHaveAnonAccess("get_translations", "").allowed).toBe(true);
    expect(
      rules.canHaveAnonAccess("get_supported_languages", "").allowed
    ).toBe(true);
    expect(rules.canHaveAnonAccess("is_email_registered", "").allowed).toBe(
      true
    );
  });

  it("zakazuje citlivé patterny", () => {
    expect(
      rules.canHaveAnonAccess("get_admin_dashboard", "").allowed
    ).toBe(false);
    expect(
      rules.canHaveAnonAccess("get_user_data", "").allowed
    ).toBe(false);
    expect(
      rules.canHaveAnonAccess("get_health_check_ins", "").allowed
    ).toBe(false);
    expect(
      rules.canHaveAnonAccess("get_user_consent", "").allowed
    ).toBe(false);
    expect(rules.canHaveAnonAccess("my_profile_update", "").allowed).toBe(
      false
    );
  });

  it("povoluje funkce s auth.uid() IS NULL guardem", () => {
    const sql = `
      IF auth.uid() IS NULL THEN
        RETURN QUERY SELECT ... WHERE is_public = true;
      END IF;
    `;
    expect(
      rules.canHaveAnonAccess("some_private_func", sql).allowed
    ).toBe(true);
    expect(rules.canHaveAnonAccess("some_private_func", sql).reason).toBe(
      "HAS_ANON_GUARD"
    );
  });

  it("default deny pro neznámé funkce", () => {
    const result = rules.canHaveAnonAccess("some_unknown_func", "");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("DEFAULT_DENY");
  });
});

/* ====================================================================
 * 9. FUNCTION_CATEGORIES (rules.mjs)
 * ==================================================================== */

describe("FUNCTION_CATEGORIES", () => {
  it("má povinné klíče", () => {
    const requiredKeys = [
      "ADMIN",
      "AUDITED",
      "MY_READ",
      "MY_WRITE",
      "PATIENT",
      "PUBLIC",
      "HELPER",
      "TRIGGER",
      "SYSTEM",
      "OTHER",
    ];
    for (const key of requiredKeys) {
      expect(rules.FUNCTION_CATEGORIES).toHaveProperty(key);
    }
  });

  it("ADMIN vyžaduje DEFINER, audit, role check", () => {
    const admin = rules.FUNCTION_CATEGORIES.ADMIN;
    expect(admin.expectedSecurity).toBe("DEFINER");
    expect(admin.requiresAudit).toBe(true);
    expect(admin.requiresRoleCheck).toBe(true);
  });

  it("AUDITED vyžaduje DEFINER a audit", () => {
    const audited = rules.FUNCTION_CATEGORIES.AUDITED;
    expect(audited.expectedSecurity).toBe("DEFINER");
    expect(audited.requiresAudit).toBe(true);
  });

  it("PATIENT vyžaduje consent check", () => {
    const user = rules.FUNCTION_CATEGORIES.PATIENT;
    expect(user.requiresConsentCheck).toBe(true);
    expect(user.expectedSecurity).toBe("DEFINER");
  });

  it("PUBLIC má povolené anon i authenticated granty", () => {
    const pub = rules.FUNCTION_CATEGORIES.PUBLIC;
    expect(pub.allowedGrants).toContain("anon");
    expect(pub.allowedGrants).toContain("authenticated");
  });

  it("TRIGGER nemá žádné povolené granty", () => {
    const trigger = rules.FUNCTION_CATEGORIES.TRIGGER;
    expect(trigger.allowedGrants).toEqual([]);
  });
});

/* ====================================================================
 * 10. VALIDATION_RULES (rules.mjs)
 * ==================================================================== */

describe("VALIDATION_RULES", () => {
  it("DEFINER_SEARCH_PATH — vyžaduje search_path pro DEFINER", () => {
    const rule = rules.VALIDATION_RULES.DEFINER_SEARCH_PATH;
    // DEFINER bez search_path → fail
    expect(rule.check("some sql", { security: "DEFINER" })).toBe(false);
    // DEFINER se search_path → pass
    expect(
      rule.check("SET search_path = public", { security: "DEFINER" })
    ).toBe(true);
    // INVOKER → always pass
    expect(rule.check("some sql", { security: "INVOKER" })).toBe(true);
  });

  it("AUDIT_INSERT — vyžaduje audit pro AUDITED kategorii", () => {
    const rule = rules.VALIDATION_RULES.AUDIT_INSERT;
    // AUDITED bez audit insert → fail
    expect(rule.check("BEGIN END;", { category: "AUDITED" })).toBe(false);
    // AUDITED s audit insert → pass
    expect(
      rule.check("INSERT INTO audit_journal (x) VALUES (y);", {
        category: "AUDITED",
      })
    ).toBe(true);
    // Non-audited → pass
    expect(rule.check("BEGIN END;", { category: "MY_READ" })).toBe(true);
  });

  it("NO_SELECT_STAR_PHI — zakazuje SELECT * na sensitive data tabulkách", () => {
    const rule = rules.VALIDATION_RULES.NO_SELECT_STAR_PHI;
    // SELECT * FROM health_check_ins → fail
    expect(rule.check("SELECT * FROM health_check_ins", {})).toBe(false);
    // SELECT id, name FROM health_check_ins → pass
    expect(
      rule.check("SELECT id, name FROM health_check_ins", {})
    ).toBe(true);
    // SELECT * FROM non_secure_table → pass
    expect(rule.check("SELECT * FROM products", {})).toBe(true);
  });

  it("REVOKE_BEFORE_GRANT — doporučuje REVOKE ALL", () => {
    const rule = rules.VALIDATION_RULES.REVOKE_BEFORE_GRANT;
    // GRANT bez REVOKE → fail
    expect(
      rule.check("GRANT EXECUTE ON FUNCTION foo TO authenticated;", {})
    ).toBe(false);
    // GRANT s REVOKE → pass
    expect(
      rule.check(
        "REVOKE ALL ON FUNCTION foo FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION foo TO authenticated;",
        {}
      )
    ).toBe(true);
    // Bez GRANT → pass
    expect(rule.check("CREATE FUNCTION foo() ...", {})).toBe(true);
  });
});
