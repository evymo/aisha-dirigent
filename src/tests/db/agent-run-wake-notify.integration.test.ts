// Real-DB integration test for the agent-runner wake-on-event source.
// Proves the EXPECTED RESULTS of fn_notify_queued_agent_run + trg_agent_runs_notify_queued:
//   • a claude_cli_task inserted `queued` (claimable) → NOTIFY 'agent_run_queued' with the run payload
//   • a run HELD for approval (approval_required, no approved_at) → NO notify
//   • granting approval (the transition INTO claimable) → NOTIFY fires
// Uses a raw pg LISTEN session (the psql-based db harness can't observe async NOTIFY).
// Gated on AISHA_DB_URL (set by `npm run test:db` → with-throwaway-db.mjs container).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DB_URL = process.env.AISHA_DB_URL ?? process.env.DATABASE_URL;
const d = DB_URL ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < timeoutMs) await sleep(25);
}
const insertRun = (source: string, approvalRequired: boolean) =>
  `INSERT INTO public.agent_runs (kind, profile, image, source, status, approval_required)
   VALUES ('claude_cli_task','docker','img',$$${source}$$,'queued',${approvalRequired}) RETURNING id`;

d("agent_run wake NOTIFY (event-driven executor wake)", () => {
  let client: pg.Client;
  const received: string[] = [];

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    client.on("notification", (msg) => { if (msg.payload) received.push(msg.payload); });
    await client.query("LISTEN agent_run_queued");
  });
  afterAll(async () => { await client?.end().catch(() => undefined); });

  it("fires agent_run_queued with the run payload when a claude_cli_task is inserted queued", async () => {
    received.length = 0;
    const r = await client.query(insertRun("wake-test-claimable", false));
    const id = r.rows[0].id as string;
    await waitFor(() => received.length > 0, 2500);
    expect(received.length).toBeGreaterThan(0);
    const payload = JSON.parse(received[received.length - 1]);
    expect(payload.table).toBe("agent_runs");
    expect(payload.event).toBe("agent_run_queued");
    expect(payload.run_id).toBe(id);
    expect(payload.kind).toBe("claude_cli_task");
  });

  it("does NOT fire for a run held for approval (approval_required + no approved_at)", async () => {
    received.length = 0;
    await client.query(insertRun("wake-test-held", true));
    await sleep(700);
    expect(received.length).toBe(0);
  });

  it("fires when a held run is approved (transition into claimable)", async () => {
    const r = await client.query(insertRun("wake-test-approve", true));
    const id = r.rows[0].id as string;
    await sleep(300);
    received.length = 0;                       // ignore the (suppressed) insert
    await client.query("UPDATE public.agent_runs SET approved_at = now() WHERE id = $1", [id]);
    await waitFor(() => received.length > 0, 2500);
    expect(received.length).toBeGreaterThan(0);
    expect(JSON.parse(received[received.length - 1]).run_id).toBe(id);
  });

  it("does NOT fire on an unrelated update (status stays running)", async () => {
    const r = await client.query(insertRun("wake-test-noise", false));
    const id = r.rows[0].id as string;
    await client.query("UPDATE public.agent_runs SET status='running', started_at=now() WHERE id=$1", [id]);
    await sleep(300);
    received.length = 0;
    await client.query("UPDATE public.agent_runs SET source_ref='x' WHERE id=$1", [id]);
    await sleep(600);
    expect(received.length).toBe(0);
  });
});
