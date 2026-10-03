import { beforeAll, describe, expect, it } from "vitest";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

type SupabaseTypesResult = {
  functions: Record<string, { args: string; returns: string }>;
  tables: Record<string, { columns: string[] }>;
};

type AnalyzerModule = {
  parseSupabaseTypesContent: (content: string) => SupabaseTypesResult;
  extractSupabaseTypes: () => Promise<SupabaseTypesResult>;
  detectUnusedTables: (
    dbTables: Array<{ name: string }>,
    rpcCalls: Array<{ function: string }>,
    directAccesses: Array<{ table: string }>,
    edgeFunctions: Array<{ rpcCalls: string[]; tableAccess: string[] }>,
    functionDeps?: Map<string, Set<string>>,
    functionTableDeps?: Map<string, Set<string>>,
    extraUsedFunctions?: string[],
    relationUsageMetadata?: Map<
      string,
      {
        relationKind: string;
        inboundFkCount: number;
        outboundFkCount: number;
        policyCount: number;
        triggerCount: number;
        referencedByViewsCount: number;
      }
    >,
  ) => Promise<Array<{ entity: string; type: string }>>;
};

let analyzer: AnalyzerModule;

beforeAll(async () => {
  analyzer = (await import(
    path.join(ROOT, "scripts/db/db-manager/lib/full-consistency-analyzer.mjs")
  )) as AnalyzerModule;
});

describe("full-consistency-analyzer parser", () => {
  it("parses Functions blocks and ignores alias references", () => {
    const sampleTypes = `
type PublicSchemaAlias = {
  Functions: Database["public"]["Functions"];
};

export type Database = {
  public: {
    Functions: {
      get_public_data: {
        Args: {
          p_id: string
          p_limit?: number | null
        }
        Returns: {
          id: string
          created_at: string
        }[]
      }
      health_ping: {
        Args: never
        Returns: string
      }
    }
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
        }
      }
    }
  }
}`;

    const parsed = analyzer.parseSupabaseTypesContent(sampleTypes);

    expect(Object.keys(parsed.functions)).toEqual(
      expect.arrayContaining(["get_public_data", "health_ping"]),
    );
    expect(parsed.functions.get_public_data.args).toContain("p_id: string");
    expect(parsed.functions.health_ping.args).toBe("never");
    expect(parsed.tables.profiles.columns).toContain("id");
  });

  it("extracts full function coverage from generated types.ts", async () => {
    const parsed = await analyzer.extractSupabaseTypes();

    expect(Object.keys(parsed.functions).length).toBeGreaterThan(500);
    expect(Object.keys(parsed.functions)).toContain("terminate_session_admin");
  });
});

describe("full-consistency-analyzer unused table detection", () => {
  it("treats tables used through transitive RPC call graph as used", async () => {
    const dbTables = [
      { name: "orders" },
      { name: "order_items" },
      { name: "orphan_table" },
      { name: "audit_journal" },
    ];

    const rpcCalls = [{ function: "get_orders" }];
    const directAccesses: Array<{ table: string }> = [];
    const edgeFunctions: Array<{ rpcCalls: string[]; tableAccess: string[] }> = [];

    const functionDeps = new Map<string, Set<string>>([
      ["get_orders", new Set(["get_order_items"])],
    ]);

    const functionTableDeps = new Map<string, Set<string>>([
      ["get_orders", new Set(["orders"])],
      ["get_order_items", new Set(["order_items"])],
    ]);

    const issues = await analyzer.detectUnusedTables(
      dbTables,
      rpcCalls,
      directAccesses,
      edgeFunctions,
      functionDeps,
      functionTableDeps,
    );

    const entities = issues.map((issue) => issue.entity);
    expect(entities).toContain("orphan_table");
    expect(entities).not.toContain("orders");
    expect(entities).not.toContain("order_items");
    expect(entities).not.toContain("audit_journal");
  });

  it("supports extra used functions for policy or trigger roots", async () => {
    const dbTables = [{ name: "policy_backed_table" }];
    const rpcCalls: Array<{ function: string }> = [];
    const directAccesses: Array<{ table: string }> = [];
    const edgeFunctions: Array<{ rpcCalls: string[]; tableAccess: string[] }> = [];
    const functionDeps = new Map<string, Set<string>>();
    const functionTableDeps = new Map<string, Set<string>>([
      ["policy_guard_fn", new Set(["policy_backed_table"])],
    ]);

    const issues = await analyzer.detectUnusedTables(
      dbTables,
      rpcCalls,
      directAccesses,
      edgeFunctions,
      functionDeps,
      functionTableDeps,
      ["policy_guard_fn"],
    );

    expect(issues).toHaveLength(0);
  });

  it("does not flag structurally integrated helper relations", async () => {
    const dbTables = [{ name: "helper_table" }];
    const rpcCalls: Array<{ function: string }> = [];
    const directAccesses: Array<{ table: string }> = [];
    const edgeFunctions: Array<{ rpcCalls: string[]; tableAccess: string[] }> = [];
    const relationUsageMetadata = new Map([
      [
        "helper_table",
        {
          relationKind: "r",
          inboundFkCount: 1,
          outboundFkCount: 0,
          policyCount: 1,
          triggerCount: 0,
          referencedByViewsCount: 0,
        },
      ],
    ]);

    const issues = await analyzer.detectUnusedTables(
      dbTables,
      rpcCalls,
      directAccesses,
      edgeFunctions,
      new Map(),
      new Map(),
      [],
      relationUsageMetadata,
    );

    expect(issues).toHaveLength(0);
  });
});
