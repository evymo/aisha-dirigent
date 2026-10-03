/**
 * Brána: CHECK `surface_blocks_block_type_check` má v heals.sql JEDINÉHO
 * zapisovatele a heals je znovu spustitelný nad databází, ve které už leží
 * řádek NEJNOVĚJŠÍHO typu masky.
 *
 * ⛔ NAMĚŘENO V PROD 2026-09-06 01:03Z (<fork>-core, commit 4cd67cdcb):
 * K4 přidal masku `action_form` DRUHÝM blokem v heals (vlastní ALTER s novým
 * výčtem). První nasazení prošlo — instanční hook vložil řádek `action_form`
 * až PO heals. Druhé nasazení spadlo na STARŠÍM zapisovateli (výčet bez
 * action_form) → „check constraint … is violated by some row" → migrate exit 1
 * → gateway/web se nespustily → API 502. Throwaway testy to nechytily, protože
 * heals běží jednou a před seedem instance.
 *
 * CO SE MĚŘÍ:
 *   1. staticky: v heals.sql je právě JEDEN `add constraint
 *      surface_blocks_block_type_check` a jeho výčet == BLOCK_TYPES (types.ts);
 *   2. dynamicky (throwaway DB): vložím řádek každého typu z BLOCK_TYPES a
 *      spustím heals ZNOVU — musí projít bez chyby a řádky přežít.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { BLOCK_TYPES } from "../../../packages/surface-blocks/src/types";

const ROOT = path.resolve(__dirname, "../../..");
const HEALS = path.join(ROOT, "aisha/db/heals.sql");
const dbAvailable = isPgReachable();

function writersInHeals(): string[] {
  const sql = fs.readFileSync(HEALS, "utf8");
  const re = /add constraint surface_blocks_block_type_check\s*check \(block_type in \(([^)]*)\)\)/g;
  const out: string[] = [];
  for (const m of sql.matchAll(re)) out.push(m[1]);
  return out;
}

describe("heals: CHECK masek má jediného zapisovatele a je znovu spustitelný", () => {
  beforeAll(() => reportTestCapabilities("heals jediný zapisovatel masek"));

  it("v heals.sql je právě jeden zapisovatel a jeho výčet == BLOCK_TYPES", () => {
    const writers = writersInHeals();
    expect(writers, "dva bloky nad týmž constraintem = incident 2026-07-28 a 2026-09-06").toHaveLength(1);
    const listed = writers[0].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean).sort();
    expect(listed).toEqual([...BLOCK_TYPES].sort());
  });

  it.skipIf(!dbAvailable)("heals projde znovu nad řádky všech typů masek (řádky přežijí)", () => {
    // Allowlist RPC je instanční seed — na holé throwaway DB chybí, source_rpc je NOT NULL FK.
    const rows = [...BLOCK_TYPES]
      .map((t, i) => `('heals_rerun_${t}', '${t}', 'k.${t}', 'heals_rerun_rpc', '{}'::jsonb, 'heals_rerun', 'public', ${i === 0 ? "true" : "false"})`)
      .join(",\n  ");
    psqlMultiline(`
\\set ON_ERROR_STOP on
INSERT INTO public.surface_data_rpcs (rpc_name, description, is_active) VALUES ('heals_rerun_rpc', 'test', true) ON CONFLICT (rpc_name) DO NOTHING;
INSERT INTO public.surface_blocks (block_slug, block_type, title_key, source_rpc, source_params, namespace, sensitivity, is_active) VALUES
  ${rows}
ON CONFLICT (block_slug) DO NOTHING;
`);
    // Heals znovu — celý soubor, \ir uvnitř se řeší relativně k jeho adresáři.
    // Vlastní volání kvůli delšímu timeoutu (heals má ~9 000 řádků).
    const url = process.env.AISHA_DB_URL || `postgresql://${process.env.AISHA_DB_USER || "postgres"}:${process.env.AISHA_DB_PASSWORD || "postgres"}@${process.env.AISHA_DB_HOST || "127.0.0.1"}:${process.env.AISHA_DB_PORT || "5432"}/${process.env.AISHA_DB_NAME || "postgres"}`;
    execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", HEALS], {
      encoding: "utf-8",
      cwd: path.dirname(HEALS),
      timeout: 600000,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = psqlMultiline(`
SELECT 'prezilo=' || count(*) AS out FROM public.surface_blocks WHERE namespace = 'heals_rerun';
SELECT 'check_ok=' || (pg_get_constraintdef(oid) LIKE '%action_form%')::text AS out FROM pg_constraint WHERE conname = 'surface_blocks_block_type_check';
DELETE FROM public.surface_blocks WHERE namespace = 'heals_rerun';
DELETE FROM public.surface_data_rpcs WHERE rpc_name = 'heals_rerun_rpc';
`);
    expect(out).toContain(`prezilo=${BLOCK_TYPES.length}`);
    expect(out).toContain("check_ok=true");
  });
});
