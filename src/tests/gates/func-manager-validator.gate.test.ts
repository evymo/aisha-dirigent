/**
 * func-manager validator gate tests
 *
 * Testuje validateFunction z scripts/db/func-manager/lib/validator.mjs
 * proti různým kombinacím SQL funkcí a kategorií.
 *
 * Spouští se přes vitest.gates.config.ts (node env, 2 min timeout).
 */

import { describe, it, expect, beforeAll } from "vitest";
import path from "path";

/* ---------- dynamic ESM imports ---------- */

interface ValidatorIssue {
  rule: string;
  severity: string;
  message?: string;
  fix?: { type: string; sql: string };
}

interface ValidatorResult {
  valid: boolean;
  issues: ValidatorIssue[];
}

let validateFunction: (fn: ReturnType<typeof makeFn>) => ValidatorResult;
let validateAllFunctions: (fns: ReturnType<typeof makeFn>[]) => {
  total: number;
  valid: number;
  errors: number;
  byCategory: Record<string, unknown>;
};
let generateFixScript: (results: Record<string, unknown>) => string | null;

beforeAll(async () => {
  const root = path.resolve(__dirname, "../../..");
  const validator = await import(
    path.join(root, "scripts/db/func-manager/lib/validator.mjs")
  );
  validateFunction = validator.validateFunction;
  validateAllFunctions = validator.validateAllFunctions;
  generateFixScript = validator.generateFixScript;
});

/* ---------- helper: build minimal func metadata ---------- */

interface FuncInput {
  name: string;
  sql: string;
  security?: string;
  hasSearchPath?: boolean;
  hasAuditInsert?: boolean;
  hasRoleCheck?: boolean;
  hasConsentCheck?: boolean;
  category?: string;
  grants?: {
    anon: boolean;
    authenticated: boolean;
    service_role: boolean;
    public: boolean;
  };
}

function makeFn(input: FuncInput) {
  return {
    name: input.name,
    sql: input.sql,
    security: input.security ?? "INVOKER",
    hasSearchPath: input.hasSearchPath ?? false,
    hasAuditInsert: input.hasAuditInsert ?? false,
    hasRoleCheck: input.hasRoleCheck ?? false,
    hasConsentCheck: input.hasConsentCheck ?? false,
    category: input.category ?? "OTHER",
    grants: input.grants ?? {
      anon: false,
      authenticated: true,
      service_role: false,
      public: false,
    },
  };
}

/* ====================================================================
 * 1. SECURITY DEFINER validace
 * ==================================================================== */

describe("validateFunction — SECURITY DEFINER", () => {
  it("ADMIN bez DEFINER → SECURITY_MISMATCH error", () => {
    const result = validateFunction(
      makeFn({
        name: "do_admin_stuff",
        sql: "BEGIN END;",
        security: "INVOKER",
        category: "ADMIN",
      })
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i: { rule: string }) => i.rule === "SECURITY_MISMATCH")).toBe(true);
  });

  it("ADMIN s DEFINER → neprodukuje SECURITY_MISMATCH", () => {
    const result = validateFunction(
      makeFn({
        name: "do_admin_stuff",
        sql: "SET search_path = public\nREVOKE ALL ON FUNCTION do_admin_stuff FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION do_admin_stuff TO authenticated;",
        security: "DEFINER",
        hasSearchPath: true,
        hasAuditInsert: true,
        hasRoleCheck: true,
        category: "ADMIN",
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "SECURITY_MISMATCH")
    ).toBe(false);
  });

  it("DEFINER bez search_path → MISSING_SEARCH_PATH", () => {
    const result = validateFunction(
      makeFn({
        name: "my_func",
        sql: "REVOKE ALL ON FUNCTION my_func FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION my_func TO authenticated;",
        security: "DEFINER",
        hasSearchPath: false,
        category: "OTHER",
      })
    );
    const searchPathIssue = result.issues.find(
      (i: { rule: string }) => i.rule === "MISSING_SEARCH_PATH"
    );
    expect(searchPathIssue).toBeDefined();
    expect(searchPathIssue?.severity).toBe("error");
  });

  it("DEFINER se search_path → žádný MISSING_SEARCH_PATH", () => {
    const result = validateFunction(
      makeFn({
        name: "my_func",
        sql: "SET search_path = public\nREVOKE ALL ON FUNCTION my_func FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION my_func TO authenticated;",
        security: "DEFINER",
        hasSearchPath: true,
        category: "OTHER",
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "MISSING_SEARCH_PATH")
    ).toBe(false);
  });
});

/* ====================================================================
 * 2. GRANT validace
 * ==================================================================== */

describe("validateFunction — GRANTs", () => {
  it("ANON GRANT na citlivou funkci → ANON_ACCESS_FORBIDDEN", () => {
    const result = validateFunction(
      makeFn({
        name: "get_admin_users",
        sql: "SELECT * FROM users;",
        security: "DEFINER",
        hasSearchPath: true,
        hasRoleCheck: true,
        hasAuditInsert: true,
        category: "ADMIN",
        grants: {
          anon: true,
          authenticated: true,
          service_role: false,
          public: false,
        },
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "ANON_ACCESS_FORBIDDEN")
    ).toBe(true);
  });

  it("ANON GRANT na public funkci → žádný error", () => {
    const result = validateFunction(
      makeFn({
        name: "get_public_studies",
        sql: "SET search_path = public\nRETURN QUERY SELECT * FROM studies WHERE is_public;",
        security: "INVOKER",
        category: "PUBLIC",
        grants: {
          anon: true,
          authenticated: true,
          service_role: false,
          public: false,
        },
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "ANON_ACCESS_FORBIDDEN")
    ).toBe(false);
  });

  it("TRIGGER s granty → TRIGGER_HAS_GRANTS warning", () => {
    const result = validateFunction(
      makeFn({
        name: "handle_new_user",
        sql: "SET search_path = public\nGRANT EXECUTE ON FUNCTION handle_new_user TO authenticated;",
        security: "DEFINER",
        hasSearchPath: true,
        category: "TRIGGER",
        grants: {
          anon: false,
          authenticated: true,
          service_role: false,
          public: false,
        },
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "TRIGGER_HAS_GRANTS")
    ).toBe(true);
  });
});

/* ====================================================================
 * 3. Audit a Role validace
 * ==================================================================== */

describe("validateFunction — Audit & Role checks", () => {
  it("AUDITED bez audit insertu → MISSING_AUDIT warning", () => {
    const result = validateFunction(
      makeFn({
        name: "get_data_audited",
        sql: "SET search_path = public\nREVOKE ALL ON FUNCTION get_data_audited FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION get_data_audited TO authenticated;",
        security: "DEFINER",
        hasSearchPath: true,
        hasAuditInsert: false,
        category: "AUDITED",
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "MISSING_AUDIT")
    ).toBe(true);
  });

  it("AUDITED s audit insertem → žádný MISSING_AUDIT", () => {
    const result = validateFunction(
      makeFn({
        name: "get_data_audited",
        sql: "INSERT INTO audit_journal (...)\nSET search_path = public\nREVOKE ALL ON FUNCTION get_data_audited FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION get_data_audited TO authenticated;",
        security: "DEFINER",
        hasSearchPath: true,
        hasAuditInsert: true,
        category: "AUDITED",
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "MISSING_AUDIT")
    ).toBe(false);
  });

  it("ADMIN bez role checku → MISSING_ROLE_CHECK warning", () => {
    const result = validateFunction(
      makeFn({
        name: "do_admin_operation",
        sql: "SET search_path = public\nREVOKE ALL ON FUNCTION do_admin_operation FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION do_admin_operation TO authenticated;",
        security: "DEFINER",
        hasSearchPath: true,
        hasAuditInsert: true,
        hasRoleCheck: false,
        category: "ADMIN",
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "MISSING_ROLE_CHECK")
    ).toBe(true);
  });

  it("PATIENT bez consent checku → MISSING_CONSENT_CHECK warning", () => {
    const result = validateFunction(
      makeFn({
        name: "get_user_records",
        sql: "SET search_path = public\nREVOKE ALL ON FUNCTION get_user_records FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION get_user_records TO authenticated;",
        security: "DEFINER",
        hasSearchPath: true,
        hasConsentCheck: false,
        category: "PATIENT",
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "MISSING_CONSENT_CHECK")
    ).toBe(true);
  });

  it("helper funkce (is_*/has_*) nepotřebují role check", () => {
    const result = validateFunction(
      makeFn({
        name: "has_role",
        sql: "SET search_path = public\nREVOKE ALL ON FUNCTION has_role FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION has_role TO authenticated;",
        security: "DEFINER",
        hasSearchPath: true,
        hasRoleCheck: false,
        category: "HELPER",
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "MISSING_ROLE_CHECK")
    ).toBe(false);
  });
});

/* ====================================================================
 * 4. VALIDATION_RULES integrace
 * ==================================================================== */

describe("validateFunction — VALIDATION_RULES průchod", () => {
  it("SELECT * na sensitive data tabulce → NO_SELECT_STAR_PHI error", () => {
    const result = validateFunction(
      makeFn({
        name: "get_data",
        sql: "SELECT * FROM health_check_ins\nREVOKE ALL ON FUNCTION get_data FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION get_data TO authenticated;",
        security: "INVOKER",
        category: "OTHER",
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "NO_SELECT_STAR_PHI")
    ).toBe(true);
  });

  it("GRANT bez REVOKE → REVOKE_BEFORE_GRANT warning", () => {
    const result = validateFunction(
      makeFn({
        name: "get_data",
        sql: "GRANT EXECUTE ON FUNCTION get_data TO authenticated;",
        security: "INVOKER",
        category: "OTHER",
      })
    );
    expect(
      result.issues.some((i: { rule: string }) => i.rule === "REVOKE_BEFORE_GRANT")
    ).toBe(true);
  });
});

/* ====================================================================
 * 5. validateAllFunctions
 * ==================================================================== */

describe("validateAllFunctions", () => {
  it("vrací správné počty a strukturu", () => {
    const funcs = [
      makeFn({
        name: "good_func",
        sql: "REVOKE ALL ON FUNCTION good_func FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION good_func TO authenticated;",
        security: "INVOKER",
        category: "OTHER",
      }),
      makeFn({
        name: "bad_admin",
        sql: "GRANT EXECUTE ON FUNCTION bad_admin TO authenticated;",
        security: "INVOKER",
        category: "ADMIN", // wrong security
      }),
    ];

    const results = validateAllFunctions(funcs);
    expect(results.total).toBe(2);
    expect(results.valid + results.errors).toBe(2);
    expect(results.byCategory).toBeDefined();
  });
});

/* ====================================================================
 * 6. generateFixScript
 * ==================================================================== */

describe("generateFixScript", () => {
  it("generuje SQL fix script pro fixovatelné issues", () => {
    const validationResults = {
      issues: [
        {
          name: "bad_func",
          category: "ADMIN",
          issues: [
            {
              severity: "error",
              rule: "ANON_ACCESS_FORBIDDEN",
              message: "test",
              fix: {
                type: "revoke_anon",
                sql: "REVOKE EXECUTE ON FUNCTION bad_func FROM anon;",
              },
            },
          ],
        },
      ],
    };
    const script = generateFixScript(validationResults);
    expect(script).toBeTruthy();
    expect(script).toContain("REVOKE EXECUTE ON FUNCTION bad_func FROM anon");
  });

  it("vrací null když nejsou žádné fixy", () => {
    const validationResults = {
      issues: [
        {
          name: "warn_func",
          category: "OTHER",
          issues: [
            {
              severity: "warning",
              rule: "MISSING_AUDIT",
              message: "no fix",
            },
          ],
        },
      ],
    };
    const script = generateFixScript(validationResults);
    expect(script).toBeNull();
  });
});
