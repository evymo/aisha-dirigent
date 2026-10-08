/**
 * Brána: smlouva sandboxu pluginů — `ctx.fetch` a konec běhu (Guru 2026-10-04, body 1 a 4).
 *
 * PROČ
 * ----
 * (1) Shim brokeru `init.signal` dřív PŘIJAL A NEUPLATNIL a každý jiný klíč `init` tiše zahodil —
 *     plugin s `AbortSignal.timeout(2000)` čekal klidně 15 s a plugin, který spoléhal na `cache`
 *     nebo `credentials`, se o tom nedozvěděl nikdy. „Přijmout a neuplatnit“ je tiché přeskočení.
 * (4) Běh končí výsledkem pluginu. Časovač, který po návratu ještě čeká, nesmí běh držet
 *     (kontejner by visel do stropu a výsledek by přišel pozdě, nebo vůbec).
 *
 * Testy shimu v images/plugin-exec/shim/src/__tests__ CI nespouští (žádná konfigurace vitestu je
 * nezahrnuje) — proto je smlouva tady, v sadě bran, kterou CI pouští.
 *
 * CO SE MĚŘÍ
 * ----------
 * - signál pluginu ZKRÁTÍ lhůtu: zruší-li ho plugin, volání skončí AbortError hned, ne po 15 s;
 * - delší signál strop brokeru NEPRODLOUŽÍ (strop = STROP_BROKERU_MS, zruší volání i s živým signálem);
 * - neznámý klíč `init` = chyba a broker se nevolá; předem zrušený signál = AbortError bez volání;
 * - skutečný shim (main.ts přes tsx, proti falešnému brokeru) skončí hned po výsledku, přestože
 *   plugin nechal běžet časovač na 60 s.
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSandboxContext,
  FETCH_INIT_KLICE,
  STROP_BROKERU_MS,
} from "../../../images/plugin-exec/shim/src/broker";

const ROOT = join(__dirname, "../../..");
const SHIM_MAIN = join(ROOT, "images/plugin-exec/shim/src/main.ts");
const TSX = join(ROOT, "node_modules/.bin/tsx");
const IDENTITA = { plugin: { version: "0.0.0-brana" }, tenant: { id: "00000000-0000-0000-0000-000000000000" }, config: {} };

/** Falešný broker, který odpoví až po zrušení signálu (= „pomalý cíl“). Počítá volání. */
function pomalyBroker() {
  const volani: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      volani.push(String(url));
      return new Promise<Response>((_, reject) => {
        const s = init?.signal;
        if (!s) return; // bez signálu by čekal navždy — test by spadl na stropu vitestu
        s.addEventListener("abort", () => reject(s.reason), { once: true });
      });
    }),
  );
  return volani;
}

describe("smlouva sandboxu — ctx.fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("kontrolní vzorek: strop brokeru je 15 s a povolené klíče init jsou přesně ty, které broker uplatní", () => {
    expect(STROP_BROKERU_MS).toBe(15_000);
    expect([...FETCH_INIT_KLICE].sort()).toEqual(["body", "headers", "method", "redirect", "signal"]);
  });

  it("signál pluginu ZKRÁTÍ lhůtu: zrušení po 50 ms = AbortError hned, ne po stropu", async () => {
    const volani = pomalyBroker();
    const ctx = createSandboxContext([], IDENTITA, []);
    const ovladac = new AbortController();
    setTimeout(() => ovladac.abort(), 50);
    const start = Date.now();
    await expect(ctx.fetch("https://api.example.com/pomaly", { signal: ovladac.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(Date.now() - start, "odmítnuto až po zrušení signálu, ne po stropu").toBeLessThan(1_000);
    expect(volani).toHaveLength(1);
  });

  it("delší signál strop brokeru NEPRODLOUŽÍ — strop zruší volání i s živým signálem pluginu", async () => {
    pomalyBroker();
    // Strop brokeru nahradíme ovladatelným signálem — měří se, že platí i když signál pluginu žije.
    const strop = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => strop.signal);
    const ctx = createSandboxContext([], IDENTITA, []);
    const zivy = new AbortController(); // plugin: „klidně 60 s“ — nikdy nezruší
    const slib = ctx.fetch("https://api.example.com/pomaly", { signal: zivy.signal });
    strop.abort(new DOMException("strop brokeru", "TimeoutError"));
    await expect(slib).rejects.toMatchObject({ name: "TimeoutError" });
    expect(timeout).toHaveBeenCalledWith(STROP_BROKERU_MS);
    expect(zivy.signal.aborted).toBe(false);
  });

  it("⛔ neznámý klíč init = chyba a broker se nevolá (žádné tiché zahození)", async () => {
    const volani = pomalyBroker();
    const ctx = createSandboxContext([], IDENTITA, []);
    await expect(ctx.fetch("https://api.example.com/x", { cache: "no-store" } as RequestInit)).rejects.toThrow(
      /init\.cache broker neuplatní/,
    );
    await expect(
      ctx.fetch("https://api.example.com/x", { method: "GET", keepalive: true, credentials: "include" } as RequestInit),
    ).rejects.toThrow(/init\.keepalive, init\.credentials/);
    expect(volani).toHaveLength(0);
  });

  it("předem zrušený signál = AbortError bez volání brokeru; signál, který není AbortSignal = chyba", async () => {
    const volani = pomalyBroker();
    const ctx = createSandboxContext([], IDENTITA, []);
    await expect(ctx.fetch("https://api.example.com/x", { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(
      ctx.fetch("https://api.example.com/x", { signal: { aborted: false } as unknown as AbortSignal }),
    ).rejects.toThrow(/není AbortSignal/);
    expect(volani).toHaveLength(0);
  });
});

describe("smlouva sandboxu — konec běhu", () => {
  let broker: Server | undefined;
  afterEach(() => {
    broker?.close();
    broker = undefined;
  });

  it("⛔ skutečný shim skončí hned po výsledku, i když plugin nechal běžet časovač na 60 s", async () => {
    broker = createServer((req, res) => {
      // Shim při startu vyzvedne konfiguraci běhu (nactiKonfiguraci → POST /sandbox/config).
      res.writeHead(req.url === "/sandbox/config" ? 200 : 404, { "content-type": "application/json" });
      res.end(req.url === "/sandbox/config" ? "{}" : '{"error":"neznámý endpoint"}');
    });
    await new Promise<void>((ok) => broker!.listen(0, "127.0.0.1", ok));
    const port = (broker.address() as AddressInfo).port;
    const payload = JSON.stringify({
      plugin_code: "setTimeout(() => {}, 60000); return 'hotovo';",
      action: "zkouska",
      params: {},
      tenant_id: IDENTITA.tenant.id,
      plugin_version: "0.0.0-brana",
    });
    const start = Date.now();
    const vysledek = await new Promise<{ kod: number | null; stdout: string; stderr: string }>((ok) => {
      const p = spawn(TSX, [SHIM_MAIN], {
        env: {
          PATH: process.env.PATH ?? "",
          BROKER_URL: `http://127.0.0.1:${port}`,
          BROKER_TOKEN: "token-brany",
          RUN_ID: "beh-brany",
          PLUGIN_PAYLOAD: payload,
          EXEC_TIMEOUT_MS: "30000",
        },
      });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += String(d)));
      p.stderr.on("data", (d) => (stderr += String(d)));
      p.on("close", (kod) => ok({ kod, stdout, stderr }));
    });
    const trvani = Date.now() - start;
    expect(vysledek.kod, `shim skončil chybou: ${vysledek.stderr.slice(0, 400)}`).toBe(0);
    const posledni = vysledek.stdout.trim().split("\n").pop() ?? "";
    expect(JSON.parse(posledni)).toMatchObject({ __result: true, value: "hotovo" });
    // Start tsx + import + běh trvá jednotky sekund; čekání na časovač by trvalo 60 s.
    expect(trvani, "běh čekal na nevyřízený časovač pluginu").toBeLessThan(20_000);
  }, 45_000);
});
