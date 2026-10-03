/**
 * RabbitMQ trigger v n8n frontu ZAKLÁDÁ (assertQueue, durable) — nečeká, že ji
 * někdo založil dřív.
 *
 * ⛔ NAMĚŘENO 2026-09-19 (guru): WF_BLOCKCHAIN_SYNC a WF_PIPELINE_EXECUTOR
 * padaly při aktivaci „QueueDeclare; 404 NOT_FOUND - no queue 'aisha.blockchain.sync'".
 * n8n 1.79 (RabbitMQ/GenericFunctions.js) bez options.assertQueue volá jen
 * checkQueue; producent svc-blockchain frontu zakládá (durable) až při PRVNÍ
 * zprávě. Spotřebitel ji proto musí založit sám, se stejnou trvanlivostí jako
 * producent (jinak PRECONDITION_FAILED).
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const ADRESAR = join(ROOT, "n8n/workflows");
const TRIGGERY = readdirSync(ADRESAR)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => {
    const w = JSON.parse(readFileSync(join(ADRESAR, f), "utf8")) as {
      name: string;
      nodes: Array<{ name: string; type: string; parameters?: { options?: Record<string, unknown> } }>;
    };
    return w.nodes.filter((n) => n.type.endsWith(".rabbitmqTrigger")).map((n) => ({ kde: `${w.name} / ${n.name}`, n }));
  });

describe("RabbitMQ trigger zakládá frontu (brána)", () => {
  test("univerzum: měřidlo vidí RabbitMQ triggery", () => {
    expect(TRIGGERY.length).toBeGreaterThanOrEqual(2);
  });

  test("⛔ každý RabbitMQ trigger má assertQueue a durable (jako producent)", () => {
    const vady = TRIGGERY.filter(({ n }) => n.parameters?.options?.assertQueue !== true || n.parameters?.options?.durable !== true).map(
      ({ kde }) => kde,
    );
    expect(vady, `trigger jen kontroluje frontu (404, když producent ještě neposlal):\n${vady.join("\n")}`).toEqual([]);
  });
});
