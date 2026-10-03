/**
 * Běh hodnocení založí služba (SELF_IMPROVEMENT_LOOP.md §3, K-25).
 *
 * ⛔ NAMĚŘENO 2026-09-29 na main 9087ef3df: create_eval_run_admin pouštěla jen
 * is_admin_or_staff(), ale grant má jen service_role — tam je auth.uid() NULL, takže
 * stráž nikdy neprošla. Jediný volající (benchmarkRunner.ts:97) chybu spolkne, běh
 * hodnocení se nikdy nezaložil a eval_run_id benchmarku byl vždy NULL. Unit test
 * runneru RPC mockuje, proto byl zelený.
 *
 * Co se tu měří:
 *   1. služba (tak volá svc-ai-chat) běh založí a vrátí jeho id   ← kontrolní vzorek
 *   2. přihlášený bez role → bez grantu
 *   3. anonym → bez grantu
 *
 * Spouští se přes: npm run test:db:beh-hodnoceni (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const KDOSI = randomUUID();
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

function psql(claims: string, sql: string, role?: string): string {
  const setRole = role ? `SET ROLE ${role};\n` : "";
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n${setRole}\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

const svc = (sql: string) => psql('{"role":"service_role"}', sql);
const VOLANI = `SELECT public.create_eval_run_admin('k25-${RUN}', NULL, '{"source":"k25"}'::jsonb)`;

function zkus(claims: string, role: string): { ok: boolean; out: string } {
  try {
    return { ok: true, out: psql(claims, VOLANI, role) };
  } catch (e) {
    return { ok: false, out: String((e as { stderr?: string }).stderr ?? e) };
  }
}

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("běh hodnocení založí služba (K-25)", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES ('${KDOSI}', 'k25-${RUN}@test.local') ON CONFLICT (id) DO NOTHING`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.ai_eval_runs WHERE trigger_type = 'k25-${RUN}'`);
  });

  it("služba běh založí a vrátí jeho id (kontrolní vzorek)", () => {
    const id = psql('{"role":"service_role"}', VOLANI, "service_role");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(svc(`SELECT status FROM public.ai_eval_runs WHERE id = '${id}'`)).toBe("pending");
  });

  it("přihlášený bez role → bez grantu", () => {
    const r = zkus(`{"sub":"${KDOSI}","role":"authenticated"}`, "authenticated");
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/permission denied/);
  });

  it("anonym → bez grantu", () => {
    const r = zkus('{"role":"anon"}', "anon");
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/permission denied/);
  });
});
