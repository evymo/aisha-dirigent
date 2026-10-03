/**
 * Gate — runtime trace read-side contract (acceptance, written BEFORE the fix, TDD).
 *
 * ai_trace_events STORES the runtime/executor identity (decision_id, model_id,
 * backend_kind), but the read path drops it: get_ai_trace_events_admin's RETURNS
 * TABLE omits those columns, the row schema omits them, and the dashboard card never
 * renders which runtime executed. So operators (web + workbench) see the provider
 * (cloud axis) but never the co-equal runtime axis. This gate locks the read
 * contract to the table SoT.
 *
 * RED until #3/#4 align the RPC + schema + card to the table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const TABLE_SQL = read("aisha/db/sql/tables/ai_trace_events.sql");
const RPC_SQL = read("aisha/db/sql/functions/get_ai_trace_events_admin.sql");
const SCHEMA_TS = read("src/lib/schemas/expertOverlaySchemas.ts");
const CARD_TSX = read("src/pages/admin/AdminAiRunDetail.tsx");

const RUNTIME_COLS = ["decision_id", "model_id", "backend_kind"];

describe("runtime trace read-side contract (read path = table SoT)", () => {
  it("the ai_trace_events table stores the runtime/executor columns (sanity)", () => {
    for (const col of RUNTIME_COLS) {
      expect(TABLE_SQL, `ai_trace_events SoT missing ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  describe("get_ai_trace_events_admin surfaces what the table stores", () => {
    for (const col of RUNTIME_COLS) {
      it(`RETURNS + selects '${col}' (operators must see the runtime axis, not just provider)`, () => {
        expect(
          RPC_SQL,
          `get_ai_trace_events_admin drops '${col}' — the runtime/executor axis is invisible to dashboards`,
        ).toMatch(new RegExp(`\\b${col}\\b`));
      });
    }
  });

  it("the trace-event row schema includes the runtime columns", () => {
    for (const col of RUNTIME_COLS) {
      expect(SCHEMA_TS, `aiTraceEventRowSchema (expertOverlaySchemas.ts) omits ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("the run-detail dashboard renders the executor runtime (not only provider)", () => {
    expect(
      CARD_TSX,
      "AdminAiRunDetail trace card shows provider but never the runtime/executor — surface-agnostic visibility gap",
    ).toMatch(/backend_kind|runtime/);
  });
});
