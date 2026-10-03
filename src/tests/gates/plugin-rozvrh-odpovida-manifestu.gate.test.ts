/**
 * Rozvrhy, které plugin deklaruje v init(), odpovídají cron capabilities manifestu.
 *
 * ⛔ NAMĚŘENO 2026-09-16:
 * - `ctx.schedule(cron, fn)` — callback se nikdy nevolal (kontejner je jednorázový)
 *   a host nevěděl, KTEROU capability má v cronu spustit. Mapovat podle pořadí
 *   nešlo: eurowag-telematics má capabilities [sync_fleet, poll_vehicle_states,
 *   sync_trips], ale plánuje v pořadí [poll, fleet, trips].
 * - partner-metrics plánoval rollup, ale `handle` capability `cron.daily_rollup`
 *   neznal — spuštění by vrátilo „Unknown capability".
 *
 * ⭐ Brána SPOUŠTÍ skutečné `init()` každého pluginu v plugins/ s náhradním ctx
 * (konfigurace = výchozí hodnoty z manifestu) a měří, co deklaroval.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PLUGINY = readdirSync(join(ROOT, "plugins")).filter(
  (d) => existsSync(join(ROOT, "plugins", d, "manifest.json")) && existsSync(join(ROOT, "plugins", d, "src", "index.ts")),
);
const CRON_5_POLI = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

type Manifest = {
  capabilities: string[];
  config_schema?: { properties?: Record<string, { default?: unknown }> };
  source_spec?: { default_config?: Record<string, unknown> };
};

async function deklarace(plugin: string): Promise<Array<{ cron: unknown; capability: unknown }>> {
  const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", plugin, "manifest.json"), "utf8")) as Manifest;
  const config: Record<string, unknown> = { ...(manifest.source_spec?.default_config ?? {}) };
  for (const [k, pole] of Object.entries(manifest.config_schema?.properties ?? {})) {
    if (pole.default !== undefined && config[k] === undefined) config[k] = pole.default;
  }
  const zaznam: Array<{ cron: unknown; capability: unknown }> = [];
  const nesmi = (co: string) => () => {
    throw new Error(`init() pluginu ${plugin} volá ${co} — deklarace rozvrhu nesmí záviset na síti ani úložišti`);
  };
  const ctx = {
    plugin: { version: "0.0.0-brana" },
    tenant: { id: "00000000-0000-4000-8000-000000000000" },
    config,
    log: () => undefined,
    schedule: (cron: unknown, capability: unknown) => void zaznam.push({ cron, capability }),
    rpc: nesmi("ctx.rpc"),
    fetch: nesmi("ctx.fetch"),
    kv: { get: nesmi("ctx.kv.get"), set: nesmi("ctx.kv.set"), delete: nesmi("ctx.kv.delete") },
    notify: nesmi("ctx.notify"),
    llm: nesmi("ctx.llm"),
  };
  const modul = (await import(join(ROOT, "plugins", plugin, "src", "index.ts"))) as { init?: (c: unknown) => Promise<void> };
  if (typeof modul.init === "function") await modul.init(ctx);
  return zaznam;
}

describe("rozvrhy pluginů odpovídají manifestu (brána)", () => {
  test("univerzum: v plugins/ jsou pluginy se zdrojem", () => {
    expect(PLUGINY.length).toBeGreaterThan(0);
  });

  test.each(PLUGINY)("%s: každá cron capability má právě jeden rozvrh a nic navíc", async (plugin) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", plugin, "manifest.json"), "utf8")) as Manifest;
    const cronCaps = manifest.capabilities.filter((c) => c.startsWith("cron.")).sort();
    const dekl = await deklarace(plugin);

    const bezCapability = dekl.filter((d) => typeof d.capability !== "string");
    expect(bezCapability, "schedule() bez jména capability — host by nevěděl, co spustit").toEqual([]);
    const spatnyCron = dekl.filter((d) => typeof d.cron !== "string" || !CRON_5_POLI.test(d.cron));
    expect(spatnyCron, "cron musí mít pět polí").toEqual([]);

    const deklarovane = dekl.map((d) => String(d.capability)).sort();
    expect(deklarovane, "rozvrhy ≠ cron capabilities manifestu (chybí, přebývá, nebo dvakrát)").toEqual(cronCaps);
  });

  test.each(PLUGINY)("%s: handle zná každou cron capability (plánovač ji jménem spustí)", async (plugin) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", plugin, "manifest.json"), "utf8")) as Manifest;
    const zdroj = readFileSync(join(ROOT, "plugins", plugin, "src", "index.ts"), "utf8");
    const handle = zdroj.slice(zdroj.indexOf("export async function handle"));
    const neznama = manifest.capabilities
      .filter((c) => c.startsWith("cron."))
      .filter((c) => !handle.includes(`"${c}"`) && !handle.includes(`'${c}'`));
    expect(neznama, "handle tuhle cron capability nedispečuje — spuštění by vrátilo „unknown capability“").toEqual([]);
  });
});
