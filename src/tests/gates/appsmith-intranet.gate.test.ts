/**
 * Appsmith Intranet (Story Intra) Gate Tests
 *
 * Static analysis for Story Intra infrastructure — the user-facing
 * intranet workspace built on Appsmith CE with full AISHA backend
 * integration. Validates:
 *
 * 1. Template JSON files are valid + have required structure
 * 2. No hardcoded secrets in templates
 * 3. Mustache placeholders correctly used
 * 4. Intranet proxy routes — MCP allowlist has no admin tools
 * 5. Intranet proxy routes — RPC blocklist covers admin functions
 * 6. Domain zoning: INTRANET_DOMAIN is in config/domains.env
 * 7. Chat RPC functions GRANT to authenticated (not anon)
 * 8. Chat RPC get_user_id_by_email is service_role only
 * 9. Provision script exists and is executable
 * 10. n8n workflows are valid JSON with correct structure
 * 11. Docker compose has intranet-auth + intranet-gateway services
 * 12. Keycloak realm has appsmith-intranet-proxy client
 *
 * Spouští se přes: npm run test:gates -- appsmith-intranet
 */

// Iter 15: config/domains.env is template-only (empty SoT). The reference
// deploy contract that THIS gate verifies lives in config/domains.env.example.
// Operators forking the repo populate their domains via .env-prod-backup;
// this gate enforces structural integrity of the AISHA reference deploy.

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const TEMPLATES_DIR = join(ROOT, "appsmith/templates");
const INTRANET_ROUTES = join(ROOT, "services/gateway/src/routes/intranet.ts");
const PROVISION_SCRIPT = join(ROOT, "scripts/provision-intranet.sh");
const DOMAINS_ENV = join(ROOT, "config/domains.env.example");
const COMPOSE_FILE = join(ROOT, "docker-compose.coolify-admin.yml");
const KEYCLOAK_REALM = join(ROOT, "keycloak/aisha-realm.json");
// Canonical compiled schema. The intranet_chat objects (tables, RPCs, RLS,
// indexes, triggers) live in aisha/db/sql/** SoT files AND are emitted into
// this baseline. Migrations are baseline-only (registry = {migrations: []}),
// so there is no historical timestamped migration to read — the SoT files +
// baseline are the source of truth.
const BASELINE_SQL = join(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");
const SOT_FUNCTIONS_DIR = join(ROOT, "aisha/db/sql/functions");
const SOT_POLICIES_DIR = join(ROOT, "aisha/db/sql/policies");
const SOT_TABLES_DIR = join(ROOT, "aisha/db/sql/tables");
const SOT_INDEXES_DIR = join(ROOT, "aisha/db/sql/indexes");
const SOT_TRIGGERS_DIR = join(ROOT, "aisha/db/sql/triggers");
const WF_ONBOARD = join(ROOT, "n8n/workflows/WF_INTRANET_USER_ONBOARD.json");
const WF_TEMPLATE_SYNC = join(ROOT, "n8n/workflows/WF_INTRANET_TEMPLATE_SYNC.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJsonSafe(p: string): unknown | null {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function readText(p: string): string {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

function listTemplateFiles(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".template.json"));
}

// ─── 1. Template structure ──────────────────────────────────────────────────

describe("Story Intra — Template validity", () => {
  test("templates directory exists with at least one template", () => {
    expect(existsSync(TEMPLATES_DIR)).toBe(true);
    expect(listTemplateFiles().length).toBeGreaterThan(0);
  });

  for (const tplFile of listTemplateFiles()) {
    describe(`template: ${tplFile}`, () => {
      test("parses as valid JSON", () => {
        expect(readJsonSafe(join(TEMPLATES_DIR, tplFile))).not.toBeNull();
      });

      test("has required top-level fields (name, exportedApplication)", () => {
        const tpl = readJsonSafe(join(TEMPLATES_DIR, tplFile)) as Record<string, unknown> | null;
        expect(tpl).not.toBeNull();
        expect(tpl).toHaveProperty("name");
        expect(tpl).toHaveProperty("exportedApplication");
      });

      test("exportedApplication has pages array", () => {
        const tpl = readJsonSafe(join(TEMPLATES_DIR, tplFile)) as {
          exportedApplication?: { pages?: unknown[] };
        } | null;
        expect(Array.isArray(tpl?.exportedApplication?.pages)).toBe(true);
        expect((tpl?.exportedApplication?.pages ?? []).length).toBeGreaterThan(0);
      });

      test("exportedApplication has datasources array", () => {
        const tpl = readJsonSafe(join(TEMPLATES_DIR, tplFile)) as {
          exportedApplication?: { datasources?: unknown[] };
        } | null;
        expect(Array.isArray(tpl?.exportedApplication?.datasources)).toBe(true);
      });

      test("exportedApplication has queries array", () => {
        const tpl = readJsonSafe(join(TEMPLATES_DIR, tplFile)) as {
          exportedApplication?: { queries?: unknown[] };
        } | null;
        expect(Array.isArray(tpl?.exportedApplication?.queries)).toBe(true);
      });
    });
  }
});

// ─── 2. No hardcoded secrets ────────────────────────────────────────────────

describe("Story Intra — No secrets in templates", () => {
  for (const tplFile of listTemplateFiles()) {
    const text = readText(join(TEMPLATES_DIR, tplFile));

    test(`${tplFile}: no real bearer tokens`, () => {
      const realTokenPattern = /Bearer\s+[a-zA-Z0-9_.-]{40,}/;
      expect(text).not.toMatch(realTokenPattern);
    });

    test(`${tplFile}: no JWT-shaped strings`, () => {
      // JWT: header.payload.signature (each ≥20 base64 chars)
      const jwtPattern = /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/;
      expect(text).not.toMatch(jwtPattern);
    });

    test(`${tplFile}: no hardcoded password values`, () => {
      const passwordPattern = /password\s*[:=]\s*["'][a-zA-Z0-9!@#$%^&*]{6,}["']/i;
      expect(text).not.toMatch(passwordPattern);
    });

    test(`${tplFile}: no private key material`, () => {
      expect(text).not.toMatch(/-----BEGIN (RSA |EC )?PRIVATE KEY-----/);
    });

    test(`${tplFile}: no Stripe-like live keys`, () => {
      expect(text).not.toMatch(/sk_live_[a-zA-Z0-9_-]{20,}/);
    });
  }
});

// ─── 3. Mustache placeholders ───────────────────────────────────────────────

describe("Story Intra — Placeholder usage", () => {
  test("story-intra template uses Mustache placeholders for datasource config", () => {
    const text = readText(join(TEMPLATES_DIR, "story-intra.template.json"));
    if (!text) return; // skip if file missing

    // Datasource URLs should use placeholders, not hardcoded host:port
    expect(text).toMatch(/\{\{GATEWAY_URL\}\}/);
  });

  test("story-intra template does not hardcode localhost URLs in datasources", () => {
    const tpl = readJsonSafe(join(TEMPLATES_DIR, "story-intra.template.json")) as {
      exportedApplication?: {
        datasources?: { datasourceConfiguration?: { url?: string } }[];
      };
    } | null;

    const datasources = tpl?.exportedApplication?.datasources ?? [];
    for (const ds of datasources) {
      const url = ds?.datasourceConfiguration?.url ?? "";
      expect(url, `Datasource URL should use placeholder, not hardcoded: ${url}`).not.toMatch(
        /^https?:\/\/(localhost|127\.0\.0\.1)/,
      );
    }
  });

  test("intranet identity comes from the verified token, NOT appsmith.user.email (S2 R7)", () => {
    // S2 remediation: the /intranet/* endpoints derive the calling user ONLY
    // from a VERIFIED Keycloak access token injected by the intranet
    // oauth2-proxy (X-Auth-Request-Access-Token). The old contract — trusting
    // the browser-supplied X-Appsmith-User-Email / appsmith.user.email header as
    // identity — was the impersonation hole and is now removed. This assertion
    // replaces the obsoleted "queries use appsmith.user.email" check with its
    // S2 inverse.
    const tpl = readJsonSafe(join(TEMPLATES_DIR, "story-intra.template.json")) as {
      exportedApplication?: {
        datasources?: { name?: string; datasourceConfiguration?: { url?: string } }[];
        queries?: { name?: string; actionConfiguration?: { headers?: { key?: string }[] } }[];
      };
    } | null;
    if (!tpl) return;

    // The intranet API datasource must route through the intranet oauth2-proxy
    // (INTRANET_PROXY_URL) so the verified token is injected upstream.
    const intranetDs = (tpl.exportedApplication?.datasources ?? []).find(
      (d) => d.name === "AISHA Intranet API",
    );
    expect(
      intranetDs?.datasourceConfiguration?.url ?? "",
      "AISHA Intranet API datasource must route through {{INTRANET_PROXY_URL}} (S2 R7)",
    ).toMatch(/\{\{INTRANET_PROXY_URL\}\}/);

    // No query may forward X-Appsmith-User-Email as identity — the gateway
    // ignores it under S2, so shipping it is a spoofable footgun.
    const offenders: string[] = [];
    for (const q of tpl.exportedApplication?.queries ?? []) {
      for (const h of q.actionConfiguration?.headers ?? []) {
        if ((h.key ?? "").toLowerCase() === "x-appsmith-user-email") {
          offenders.push(q.name ?? "(unnamed)");
        }
      }
    }
    expect(
      offenders,
      `queries must NOT send X-Appsmith-User-Email as identity (S2 R7): ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});

// ─── 4. Intranet proxy — MCP tool allowlist ─────────────────────────────────

describe("Story Intra — MCP tool allowlist security", () => {
  const routeText = readText(INTRANET_ROUTES);

  test("intranet routes file exists", () => {
    expect(existsSync(INTRANET_ROUTES)).toBe(true);
  });

  test("MCP_TOOL_ALLOWLIST is defined", () => {
    expect(routeText).toMatch(/MCP_TOOL_ALLOWLIST/);
  });

  test("no admin tools in MCP allowlist", () => {
    // Extract allowlist entries (strings between quotes in the Set constructor)
    const allowlistSection = routeText.match(
      /MCP_TOOL_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(allowlistSection).not.toBeNull();
    const entries = allowlistSection?.[1] ?? "";

    // These patterns must NOT appear in the allowlist
    const adminPatterns = [
      /admin/i,
      /deploy/i,
      /delivery/i,
      /delete.*admin/i,
      /approve.*admin/i,
      /create.*admin/i,
      /reset.*password/i,
    ];
    for (const pattern of adminPatterns) {
      expect(entries, `Allowlist must not contain admin tool: ${pattern}`).not.toMatch(pattern);
    }
  });

  test("MCP allowlist contains only read-safe tools", () => {
    const allowlistSection = routeText.match(
      /MCP_TOOL_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    const entries = allowlistSection?.[1] ?? "";

    // Extract individual tool names
    const tools = [...entries.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(tools.length).toBeGreaterThan(0);

    // All allowlisted tools should be read/search operations
    const safePatterns = /^(search_|get_|list_|match_)/;
    for (const tool of tools) {
      expect(tool, `Tool '${tool}' does not look read-safe (prefix check)`).toMatch(safePatterns);
    }
  });
});

// ─── 5. Intranet proxy — RPC allowlist ──────────────────────────────────────

describe("Story Intra — RPC allowlist security", () => {
  const routeText = readText(INTRANET_ROUTES);

  test("RPC_ALLOWLIST is defined", () => {
    expect(routeText).toMatch(/RPC_ALLOWLIST/);
  });

  test("RPC allowlist covers the Story Intra template RPCs", () => {
    const allowlistSection = routeText.match(
      /RPC_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(allowlistSection).not.toBeNull();
    const entries = allowlistSection?.[1] ?? "";

    const mustAllow = [
      "get_my_stories",
      "get_intranet_channels",
      "get_intranet_messages",
      "send_intranet_message",
      "join_intranet_channel",
      "create_intranet_channel",
    ];
    for (const fn of mustAllow) {
      expect(entries, `RPC allowlist must include '${fn}'`).toContain(fn);
    }
  });

  test("RPC allowlist excludes admin/system functions", () => {
    const allowlistSection = routeText.match(
      /RPC_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    const entries = allowlistSection?.[1] ?? "";

    const forbiddenPatterns = [
      /admin/i,
      /deploy/i,
      /password/i,
      /secret/i,
      /get_app_secrets_batch/,
      /approve_improvement_proposal_admin/,
    ];
    for (const pattern of forbiddenPatterns) {
      expect(entries, `RPC allowlist must not expose ${pattern}`).not.toMatch(pattern);
    }
  });

  test("RPC proxy validates fn_name against allowlist before forwarding", () => {
    expect(routeText).toMatch(/!RPC_ALLOWLIST\.has\(fn_name\)/);
    expect(routeText).toMatch(/rpc_not_allowed/);
  });
});

// ─── 6. Domain zoning ──────────────────────────────────────────────────────

describe("Story Intra — Domain zoning", () => {
  test("INTRANET_DOMAIN is defined in config/domains.env", () => {
    const text = readText(DOMAINS_ENV);
    expect(text).toMatch(/^INTRANET_DOMAIN=/m);
  });

  test("INTRANET_DOMAIN is in *.backend.<INTERNAL_TLD> zone (internal)", () => {
    // Zone TLDs read DYNAMICALLY from the same SoT file — no hardcoded
    // deployment domains in the gate (the .example ships generic placeholders).
    const text = readText(DOMAINS_ENV);
    const internalTld = text.match(/^INTERNAL_TLD=([^\s#]+)/m)?.[1] ?? "";
    const publicTld = text.match(/^PUBLIC_TLD=([^\s#]+)/m)?.[1] ?? "";
    expect(internalTld, "INTERNAL_TLD must be declared in domains.env.example").toBeTruthy();
    expect(publicTld, "PUBLIC_TLD must be declared in domains.env.example").toBeTruthy();
    const match = text.match(/^INTRANET_DOMAIN=(.+)$/m);
    expect(match).not.toBeNull();
    const domain = (match?.[1] ?? "").trim();
    expect(
      domain.endsWith(`.backend.${internalTld}`),
      `INTRANET_DOMAIN=${domain} must be in *.backend.${internalTld} (INTERNAL zone)`,
    ).toBe(true);
    expect(
      domain.endsWith(`.${publicTld}`),
      `INTRANET_DOMAIN=${domain} must NOT be in *.${publicTld} (PUBLIC zone)`,
    ).toBe(false);
  });
});

// ─── 7. Chat RPC grants — authenticated only ────────────────────────────────

describe("Story Intra — Chat RPC security", () => {
  const chatFunctions = [
    "send_intranet_message",
    "get_intranet_channels",
    "get_intranet_messages",
    "join_intranet_channel",
    "create_intranet_channel",
  ];

  for (const fn of chatFunctions) {
    const filePath = join(SOT_FUNCTIONS_DIR, `${fn}.sql`);

    test(`${fn}.sql exists as SoT`, () => {
      expect(existsSync(filePath), `Missing SoT file: ${filePath}`).toBe(true);
    });

    test(`${fn} GRANTs to authenticated (not anon)`, () => {
      const text = readText(filePath);
      expect(text, `${fn} must REVOKE ALL FROM PUBLIC`).toMatch(
        /REVOKE ALL ON FUNCTION.*FROM PUBLIC/i,
      );
      expect(text, `${fn} must GRANT TO authenticated`).toMatch(
        /GRANT EXECUTE ON FUNCTION.*TO authenticated/i,
      );
      expect(text, `${fn} must NOT grant to anon`).not.toMatch(
        /GRANT.*TO\s+anon/i,
      );
    });

    test(`${fn} uses SECURITY DEFINER + SET search_path`, () => {
      const text = readText(filePath);
      expect(text).toMatch(/SECURITY DEFINER/i);
      expect(text).toMatch(/SET search_path TO 'public'/i);
    });
  }
});

// ─── 8. get_user_id_by_email is service_role only ───────────────────────────

describe("Story Intra — Token exchange helper security", () => {
  const filePath = join(SOT_FUNCTIONS_DIR, "get_user_id_by_email.sql");

  test("get_user_id_by_email.sql exists", () => {
    expect(existsSync(filePath)).toBe(true);
  });

  test("get_user_id_by_email GRANTs only to service_role", () => {
    const text = readText(filePath);
    expect(text).toMatch(/REVOKE ALL ON FUNCTION.*FROM PUBLIC/i);
    expect(text).toMatch(/GRANT EXECUTE ON FUNCTION.*TO service_role/i);
    // Must NOT be accessible to authenticated or anon
    expect(text).not.toMatch(/GRANT.*TO\s+authenticated/i);
    expect(text).not.toMatch(/GRANT.*TO\s+anon/i);
  });

  test("get_user_id_by_email uses SECURITY DEFINER", () => {
    const text = readText(filePath);
    expect(text).toMatch(/SECURITY DEFINER/i);
  });
});

// ─── 9. Provision script ────────────────────────────────────────────────────

describe("Story Intra — Provision script", () => {
  test("provision-intranet.sh exists", () => {
    expect(existsSync(PROVISION_SCRIPT)).toBe(true);
  });

  test("provision script is executable", () => {
    const stat = statSync(PROVISION_SCRIPT);
    // Check owner execute bit (0o100)
    expect(stat.mode & 0o100, "Script must be executable").toBeGreaterThan(0);
  });

  test("provision script has shebang", () => {
    const text = readText(PROVISION_SCRIPT);
    expect(text.startsWith("#!/")).toBe(true);
  });

  test("provision script supports --check and --dry-run flags", () => {
    const text = readText(PROVISION_SCRIPT);
    expect(text).toMatch(/--check/);
    expect(text).toMatch(/--dry-run/);
  });

  test("provision script does not hardcode secrets", () => {
    const text = readText(PROVISION_SCRIPT);
    // It should reference env vars, not inline secrets
    expect(text).toMatch(/INTRANET_API_KEY/);
    expect(text).not.toMatch(/sk_live_/);
    expect(text).not.toMatch(/eyJ[a-zA-Z0-9_-]{20,}\./);
  });

  test("provision script creates expected datasources", () => {
    const text = readText(PROVISION_SCRIPT);
    expect(text).toMatch(/AISHA Intranet API/);
    expect(text).toMatch(/AISHA Knowledge/);
    expect(text).toMatch(/AISHA Public Data/);
  });
});

// ─── 10. n8n workflows ──────────────────────────────────────────────────────

describe("Story Intra — n8n Workflows", () => {
  test("WF_INTRANET_USER_ONBOARD.json exists and is valid JSON", () => {
    expect(existsSync(WF_ONBOARD)).toBe(true);
    expect(readJsonSafe(WF_ONBOARD)).not.toBeNull();
  });

  test("WF_INTRANET_TEMPLATE_SYNC.json exists and is valid JSON", () => {
    expect(existsSync(WF_TEMPLATE_SYNC)).toBe(true);
    expect(readJsonSafe(WF_TEMPLATE_SYNC)).not.toBeNull();
  });

  test("onboard workflow has webhook trigger", () => {
    const wf = readJsonSafe(WF_ONBOARD) as { nodes?: { type: string }[] } | null;
    const types = (wf?.nodes ?? []).map((n) => n.type);
    expect(types).toContain("n8n-nodes-base.webhook");
  });

  test("onboard workflow uses aishaRpc nodes (not raw SQL)", () => {
    const wf = readJsonSafe(WF_ONBOARD) as { nodes?: { type: string }[] } | null;
    const types = (wf?.nodes ?? []).map((n) => n.type);
    expect(types).toContain("n8n-nodes-aisha.aishaRpc");
  });

  test("onboard workflow joins default channels", () => {
    const text = readText(WF_ONBOARD);
    expect(text).toMatch(/join_intranet_channel/);
    expect(text).toMatch(/general/);
  });

  test("template sync workflow has cron + webhook triggers", () => {
    const wf = readJsonSafe(WF_TEMPLATE_SYNC) as { nodes?: { type: string }[] } | null;
    const types = (wf?.nodes ?? []).map((n) => n.type);
    expect(types).toContain("n8n-nodes-base.scheduleTrigger");
    expect(types).toContain("n8n-nodes-base.webhook");
  });

  test("workflows have intranet tag", () => {
    for (const path of [WF_ONBOARD, WF_TEMPLATE_SYNC]) {
      const wf = readJsonSafe(path) as { tags?: { name: string }[] } | null;
      const tagNames = (wf?.tags ?? []).map((t) => t.name);
      expect(tagNames, `${path} should have 'intranet' tag`).toContain("intranet");
    }
  });

  test("workflows use __REMAP__ credential placeholder (no real credential IDs)", () => {
    for (const path of [WF_ONBOARD, WF_TEMPLATE_SYNC]) {
      const text = readText(path);
      // If workflow references credentials, they should use __REMAP__ placeholder
      if (text.includes("credentials")) {
        expect(text).toMatch(/__REMAP__/);
        // Must not contain real credential UUIDs
        expect(text).not.toMatch(/"id":\s*"[0-9a-f]{8}-[0-9a-f]{4}-/);
      }
    }
  });
});

// ─── 11. Docker compose integration ────────────────────────────────────────

describe("Story Intra — Docker Compose", () => {
  test("docker-compose has intranet-auth service", () => {
    const text = readText(COMPOSE_FILE);
    expect(text).toMatch(/intranet-auth:/);
  });

  test("docker-compose has intranet-gateway service", () => {
    const text = readText(COMPOSE_FILE);
    expect(text).toMatch(/intranet-gateway:/);
  });

  test("intranet-auth uses distinct cookie name from appsmith-auth", () => {
    const text = readText(COMPOSE_FILE);
    // Must have its own cookie name (not _aisha_appsmith_proxy)
    expect(text).toMatch(/_aisha_intranet_proxy/);
  });

  test("intranet-auth ALLOWED_GROUPS includes all app_role values", () => {
    const text = readText(COMPOSE_FILE);
    // Check for key roles that must be present
    const requiredRoles = ["admin", "staff", "practitioner", "member"];
    for (const role of requiredRoles) {
      expect(text, `ALLOWED_GROUPS must include '${role}'`).toMatch(
        new RegExp(`ALLOWED_GROUPS.*${role}`, "s"),
      );
    }
  });

  test("intranet-auth passes access token (PASS_ACCESS_TOKEN)", () => {
    const text = readText(COMPOSE_FILE);
    expect(text).toMatch(/PASS_ACCESS_TOKEN.*true/i);
  });
});

// ─── 12. Keycloak client ────────────────────────────────────────────────────

describe("Story Intra — Keycloak client", () => {
  test("aisha-realm.json has appsmith-intranet-proxy client", () => {
    const realm = readJsonSafe(KEYCLOAK_REALM) as {
      clients?: { clientId: string }[];
    } | null;
    const clientIds = (realm?.clients ?? []).map((c) => c.clientId);
    expect(clientIds).toContain("appsmith-intranet-proxy");
  });

  test("appsmith-intranet-proxy is confidential (not public)", () => {
    const realm = readJsonSafe(KEYCLOAK_REALM) as {
      clients?: { clientId: string; publicClient?: boolean }[];
    } | null;
    const client = (realm?.clients ?? []).find((c) => c.clientId === "appsmith-intranet-proxy");
    expect(client).toBeDefined();
    expect(client?.publicClient).toBe(false);
  });

  test("appsmith-intranet-proxy has INTRANET_DOMAIN redirect URI", () => {
    const realm = readJsonSafe(KEYCLOAK_REALM) as {
      clients?: { clientId: string; redirectUris?: string[] }[];
    } | null;
    const client = (realm?.clients ?? []).find((c) => c.clientId === "appsmith-intranet-proxy");
    const uris = client?.redirectUris ?? [];
    expect(uris.some((u) => u.includes("${INTRANET_DOMAIN}"))).toBe(true);
  });

  test("appsmith-intranet-proxy has groups scope for role mapping", () => {
    const realm = readJsonSafe(KEYCLOAK_REALM) as {
      clients?: { clientId: string; defaultClientScopes?: string[] }[];
    } | null;
    const client = (realm?.clients ?? []).find((c) => c.clientId === "appsmith-intranet-proxy");
    const scopes = client?.defaultClientScopes ?? [];
    expect(scopes).toContain("groups");
  });
});

// ─── 13. SoT file completeness ──────────────────────────────────────────────

describe("Story Intra — SoT file completeness", () => {
  test("all 3 intranet chat table SoT files exist", () => {
    const tables = [
      "intranet_chat_channels.sql",
      "intranet_chat_members.sql",
      "intranet_chat_messages.sql",
    ];
    for (const t of tables) {
      expect(existsSync(join(SOT_TABLES_DIR, t)), `Missing table SoT: ${t}`).toBe(true);
    }
  });

  test("all 5 intranet chat RPC function SoT files exist", () => {
    const fns = [
      "get_intranet_channels.sql",
      "get_intranet_messages.sql",
      "send_intranet_message.sql",
      "join_intranet_channel.sql",
      "create_intranet_channel.sql",
    ];
    for (const f of fns) {
      expect(existsSync(join(SOT_FUNCTIONS_DIR, f)), `Missing function SoT: ${f}`).toBe(true);
    }
  });

  test("all 5 intranet RLS policy SoT files exist", () => {
    const policies = [
      "intranet_chat_channels_select.sql",
      "intranet_chat_members_select.sql",
      "intranet_chat_members_manage.sql",
      "intranet_chat_messages_select.sql",
      "intranet_chat_messages_insert.sql",
    ];
    for (const p of policies) {
      expect(existsSync(join(SOT_POLICIES_DIR, p)), `Missing policy SoT: ${p}`).toBe(true);
    }
  });

  test("intranet chat index SoT files exist", () => {
    const indexes = [
      "idx_intranet_chat_channels_type.sql",
      "idx_intranet_chat_members_user.sql",
      "idx_intranet_chat_members_channel.sql",
      "idx_intranet_chat_messages_channel_created.sql",
      "idx_intranet_chat_messages_user.sql",
    ];
    for (const idx of indexes) {
      expect(existsSync(join(SOT_INDEXES_DIR, idx)), `Missing index SoT: ${idx}`).toBe(true);
    }
  });

  test("intranet chat updated_at trigger SoT files exist", () => {
    const triggers = [
      "trg_intranet_chat_channels_updated_at.sql",
      "trg_intranet_chat_messages_updated_at.sql",
    ];
    for (const trigger of triggers) {
      expect(existsSync(join(SOT_TRIGGERS_DIR, trigger)), `Missing trigger SoT: ${trigger}`).toBe(true);
    }
  });

  test("intranet chat schema is provisioned in canonical SoT (baseline)", () => {
    // Migrations are baseline-only; the intranet_chat schema lives in the
    // compiled baseline (and the per-object aisha/db/sql/** SoT files), not in
    // a historical timestamped migration. Assert the tables are emitted into
    // the baseline — the durable provisioning invariant.
    const baseline = readText(BASELINE_SQL);
    const tables = [
      "intranet_chat_channels",
      "intranet_chat_members",
      "intranet_chat_messages",
    ];
    for (const t of tables) {
      expect(
        baseline,
        `Baseline must declare public.${t} (intranet_chat schema not provisioned)`,
      ).toMatch(new RegExp(`TABLE\\s+(IF NOT EXISTS\\s+)?public\\.${t}\\b`, "i"));
    }
  });
});

// ─── 14. RLS policies — correctness ─────────────────────────────────────────

describe("Story Intra — RLS policies", () => {
  const userScopedPolicies = [
    "intranet_chat_channels_select.sql",
    "intranet_chat_members_select.sql",
    "intranet_chat_messages_select.sql",
    "intranet_chat_messages_insert.sql",
  ];

  for (const pf of userScopedPolicies) {
    test(`${pf} uses auth.uid() for user scoping`, () => {
      const filePath = join(SOT_POLICIES_DIR, pf);
      if (!existsSync(filePath)) return;
      const text = readText(filePath);
      expect(text, `${pf} must reference auth.uid() for RLS`).toMatch(/auth\.uid\(\)/);
    });
  }

  test("intranet_chat_members_manage uses user_roles for admin check", () => {
    const text = readText(join(SOT_POLICIES_DIR, "intranet_chat_members_manage.sql"));
    expect(text).toMatch(/user_roles/);
    expect(text).toMatch(/admin.*staff|staff.*admin/);
  });

  test("no RLS self-reference: policies must not query their own table directly", () => {
    // RLS self-reference causes infinite recursion in PostgreSQL.
    // Policies should use is_intranet_channel_member() helper instead.
    const selfRefChecks = [
      { file: "intranet_chat_members_select.sql", table: "intranet_chat_members" },
      { file: "intranet_chat_members_manage.sql", table: "intranet_chat_members" },
    ];
    for (const { file, table } of selfRefChecks) {
      const text = readText(join(SOT_POLICIES_DIR, file));
      // The policy must NOT contain a raw FROM/JOIN on its own table
      const selfRefPattern = new RegExp(`FROM\\s+${table}\\b`, "i");
      expect(text, `${file} must not self-reference ${table} (use helper fn instead)`).not.toMatch(
        selfRefPattern,
      );
    }
  });

  test("membership checks use is_intranet_channel_member() helper", () => {
    // Policies that check channel membership should use the SECURITY DEFINER
    // helper function to avoid RLS recursion.
    const files = [
      "intranet_chat_channels_select.sql",
      "intranet_chat_messages_select.sql",
      "intranet_chat_messages_insert.sql",
    ];
    for (const f of files) {
      const text = readText(join(SOT_POLICIES_DIR, f));
      expect(text, `${f} should use is_intranet_channel_member() helper`).toMatch(
        /is_intranet_channel_member/,
      );
    }
  });
});

// ─── 15. RLS helper function ────────────────────────────────────────────────

describe("Story Intra — RLS helper function", () => {
  const helperPath = join(SOT_FUNCTIONS_DIR, "is_intranet_channel_member.sql");

  test("is_intranet_channel_member.sql exists", () => {
    expect(existsSync(helperPath)).toBe(true);
  });

  test("is_intranet_channel_member uses SECURITY DEFINER", () => {
    const text = readText(helperPath);
    expect(text).toMatch(/SECURITY DEFINER/i);
  });

  test("is_intranet_channel_member GRANTs to authenticated", () => {
    const text = readText(helperPath);
    expect(text).toMatch(/GRANT EXECUTE.*TO authenticated/i);
  });
});

// ─── 16. MCP method allowlist ───────────────────────────────────────────────

describe("Story Intra — MCP method restriction", () => {
  const routeText = readText(INTRANET_ROUTES);

  test("MCP_METHOD_ALLOWLIST is defined", () => {
    expect(routeText).toMatch(/MCP_METHOD_ALLOWLIST/);
  });

  test("MCP proxy blocks non-allowlisted methods", () => {
    expect(routeText).toMatch(/MCP_METHOD_ALLOWLIST\.has\(body\.method\)/);
    expect(routeText).toMatch(/mcp_method_not_allowed/);
  });

  test("MCP method allowlist does not include resources/read or prompts/get", () => {
    const section = routeText.match(
      /MCP_METHOD_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    const entries = section?.[1] ?? "";
    expect(entries).not.toMatch(/resources\/read/);
    expect(entries).not.toMatch(/prompts\/get/);
  });
});

// ─── 17. Template ↔ query cross-reference ───────────────────────────────────

describe("Story Intra — Template query dependencies", () => {
  test("template queries reference RPCs that exist in canonical SoT", () => {
    const tpl = readJsonSafe(join(TEMPLATES_DIR, "story-intra.template.json")) as {
      exportedApplication?: {
        queries?: { name: string; actionConfiguration?: { path?: string } }[];
      };
    } | null;

    const queries = tpl?.exportedApplication?.queries ?? [];
    const rpcPaths = queries
      .map((q) => q.actionConfiguration?.path ?? "")
      .filter((p) => p.startsWith("/rpc/"))
      .map((p) => p.replace("/rpc/", ""));

    // Each RPC name must exist in canonical SoT: a dedicated function file under
    // aisha/db/sql/functions/ (preferred) or, failing that, declared in the
    // compiled baseline. Migrations are baseline-only — there is no historical
    // migration to consult.
    const existingFunctions = existsSync(SOT_FUNCTIONS_DIR) ? readdirSync(SOT_FUNCTIONS_DIR) : [];
    const sotFunctionNames = existingFunctions.map((f) => f.replace(".sql", ""));
    const baselineText = readText(BASELINE_SQL);

    for (const rpcName of rpcPaths) {
      const inSot = sotFunctionNames.includes(rpcName);
      const inBaseline = baselineText.includes(`FUNCTION public.${rpcName}`);
      expect(
        inSot || inBaseline,
        `Template query references /rpc/${rpcName} but no SoT function file or baseline function definition found`,
      ).toBe(true);
    }
  });
});
