/**
 * Brána: soulad dveří se měří NA APLIKACI a veřejný UDP port proti cizím projektům
 *
 * ⛔ NAMĚŘENO 2026-09-15 (rozbor dveří před cold-startem). Coolify drží profil
 * i režim dveří z dřívějška: `.env.coolify` může být v souladu s deklarací
 * a aplikace edge přesto nasadí starý stav — `knock` bez deklarace, nebo
 * deklarované dveře bez profilu. Vlnová rovina (sync před redeployem) profil
 * dveří nehlídala vůbec a doktor se na aplikaci neptal.
 *
 * A ruční UDP port instance se může srazit s aplikací JINÉHO projektu na témž
 * serveru — livekit tak 2026-08-12 prohrál závod o 3478/5349
 * (`driver failed programming external connectivity`). Nikdo to neměřil dřív,
 * než nasazení spadlo.
 *
 * CO SE MĚŘÍ (skutečná funkce nad atrapou Coolify API, jen čtení):
 *   1. deklarace ↔ profil `knock` na aplikaci, oběma směry;
 *   2. režim ↔ roster, port, adresa verdiktu na aplikaci (lib/dvere-soulad.mjs);
 *   3. kolize UDP portu s cizím projektem na TÉMŽE serveru — a jen tam;
 *   4. co změřit nejde (compose cizí aplikace Coolify nevydal), je NEMĚŘENO;
 *   5. doktor (fáze P + oddíl dveří), sync a verify se ptají TÉHOŽ domova.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { udpPortyCompose, zmerDvereNaAplikaci, interpoluj } from "../../../scripts/lib/dvere-soulad.mjs";

const ROOT = resolve(__dirname, "../../..");
const PROJEKT_ENV = 7;
const CIZI_ENV = 99;

type Env = { key: string; value: string; is_preview?: boolean };
type App = Record<string, unknown> & { uuid: string; name: string };

function atrapa(apps: App[], envy: Record<string, Env[]>) {
  const volani: string[] = [];
  const coolify = async (cesta: string) => {
    volani.push(cesta);
    if (cesta === "/applications") return apps;
    const m = /^\/applications\/([^/]+)\/envs$/.exec(cesta);
    if (m && envy[m[1]]) return envy[m[1]];
    throw new Error(`atrapa nezná ${cesta}`);
  };
  return { coolify, volani, inProject: (a: { environment_id?: number }) => a.environment_id === PROJEKT_ENV };
}

const e = (o: Record<string, string>): Env[] => Object.entries(o).map(([key, value]) => ({ key, value, is_preview: false }));
const sot = (o: Record<string, string>) => (k: string) => o[k];

const EDGE: App = {
  uuid: "edge-uuid", name: "zkusebni-edge", environment_id: PROJEKT_ENV,
  docker_compose_location: "/docker-compose.coolify-prebuilt.yml", build_pack: "dockercompose",
  destination: { server_id: 1 },
};
const ZIVE = {
  SPA_DIAGNOSE: "0", SPA_OPERATORS_B64: "e30=", SPA_KNOCK_PUBLIC_PORT: "18199",
  APP_NAME_PREFIX: "zkusebni", KNOCK_UPSTREAM: "http://zkusebni-svc-knock:3017",
  MESH_ENABLED: "false", NETBIRD_PEER_CIDR: "100.64.0.0/10", NETBIRD_DNS_IP: "192.0.2.250", MESH_TLD: "mesh.test",
};
const DEKLAROVANO = { EDGE_COMPOSE_PROFILES: "knock" };

describe("dveře na aplikaci — deklarace ↔ profil", () => {
  test("deklarované dveře, aplikace profil nemá → vada", async () => {
    const a = atrapa([EDGE], { "edge-uuid": e({ ...ZIVE, COMPOSE_PROFILES: "" }) });
    const r = await zmerDvereNaAplikaci({ coolify: a.coolify, inProject: a.inProject, prefix: "zkusebni", sot: sot(DEKLAROVANO) });
    expect(r.vady.join(" ")).toMatch(/nemá — nasazení je nespustí/);
  });

  test("nedeklarované dveře, aplikace drží knock z dřívějška → vada", async () => {
    const a = atrapa([EDGE], { "edge-uuid": e({ COMPOSE_PROFILES: "knock,extranet-gate" }) });
    const r = await zmerDvereNaAplikaci({ coolify: a.coolify, inProject: a.inProject, prefix: "zkusebni", sot: sot({}) });
    expect(r.vady.join(" ")).toMatch(/NEDEKLARUJE — starý profil/);
  });

  test("měřicí režim + roster NA APLIKACI → vada, i když soubor je v pořádku", async () => {
    const a = atrapa([EDGE], { "edge-uuid": e({ ...ZIVE, SPA_DIAGNOSE: "1", COMPOSE_PROFILES: "knock" }) });
    const r = await zmerDvereNaAplikaci({ coolify: a.coolify, inProject: a.inProject, prefix: "zkusebni", sot: sot(DEKLAROVANO) });
    expect(r.vady.join(" ")).toMatch(/ODMÍTNE/);
  });

  test("v souladu → bez vad a bez kolizí", async () => {
    const a = atrapa([EDGE], { "edge-uuid": e({ ...ZIVE, COMPOSE_PROFILES: "knock" }) });
    const r = await zmerDvereNaAplikaci({ coolify: a.coolify, inProject: a.inProject, prefix: "zkusebni", sot: sot(DEKLAROVANO) });
    expect(r).toMatchObject({ deklarovano: true, edge: "zkusebni-edge", vady: [], kolize: [] });
  });
});

describe("veřejný UDP port proti cizím projektům (jen čtení API)", () => {
  const cizi = (server: number, raw?: string): App => ({
    uuid: `cizi-${server}`, name: `jiny-tenant-voip-${server}`, environment_id: CIZI_ENV,
    build_pack: "dockercompose", destination: { server_id: server },
    ...(raw === undefined ? {} : { docker_compose_raw: raw }),
  });
  const RAW = 'services:\n  voip:\n    image: x\n    ports:\n      - "${VOIP_PORT:-5060}:18181/udp"\n';

  test("cizí projekt na TÉMŽE serveru se stejným portem → kolize", async () => {
    const a = atrapa([EDGE, cizi(1, RAW)], {
      "edge-uuid": e({ ...ZIVE, COMPOSE_PROFILES: "knock" }),
      "cizi-1": e({ VOIP_PORT: "18199" }),
    });
    const r = await zmerDvereNaAplikaci({ coolify: a.coolify, inProject: a.inProject, prefix: "zkusebni", sot: sot(DEKLAROVANO) });
    expect(r.kolize).toHaveLength(1);
    expect(r.kolize[0]).toMatch(/UDP 18199 \(zkusebni-edge\/svc-knock-netns\) × jiny-tenant-voip-1/);
    expect(r.kolize[0], "hodnota cizího envu kromě portu se nevypisuje").not.toMatch(/VOIP_PORT/);
  });

  test("stejný port na JINÉM serveru není kolize", async () => {
    const a = atrapa([EDGE, cizi(2, RAW)], {
      "edge-uuid": e({ ...ZIVE, COMPOSE_PROFILES: "knock" }),
      "cizi-2": e({ VOIP_PORT: "18199" }),
    });
    const r = await zmerDvereNaAplikaci({ coolify: a.coolify, inProject: a.inProject, prefix: "zkusebni", sot: sot(DEKLAROVANO) });
    expect(r.kolize).toEqual([]);
    expect(a.volani, "cizí aplikaci na jiném serveru se envy nečtou").not.toContain("/applications/cizi-2/envs");
  });

  test("compose cizí aplikace Coolify nevydal → NEMĚŘENO, ne zelená", async () => {
    const a = atrapa([EDGE, cizi(1)], { "edge-uuid": e({ ...ZIVE, COMPOSE_PROFILES: "knock" }) });
    const r = await zmerDvereNaAplikaci({ coolify: a.coolify, inProject: a.inProject, prefix: "zkusebni", sot: sot(DEKLAROVANO) });
    expect(r.nezmereno.join(" ")).toMatch(/compose aplikace Coolify nevydal/);
  });

  test("dveře bez profilu na aplikaci UDP port nepublikují — není co srážet", () => {
    const text = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf8");
    const cti = (o: Record<string, string>) => (k: string) => o[k];
    expect(udpPortyCompose(text, cti({ ...ZIVE, COMPOSE_PROFILES: "" }))).toEqual([]);
    expect(udpPortyCompose(text, cti({ ...ZIVE, COMPOSE_PROFILES: "knock" }))).toEqual([
      { sluzba: "svc-knock-netns", od: 18199, do: 18199 },
    ]);
  });

  test("TCP mapování s nedoručenou povinnou proměnnou měření UDP neshodí", () => {
    const raw = 'services:\n  a:\n    image: x\n    ports:\n      - "${TCP_ONLY:?x}:80"\n      - "${U:-5000}:5000/udp"\n';
    expect(udpPortyCompose(raw, () => undefined)).toEqual([{ sluzba: "a", od: 5000, do: 5000 }]);
  });

  test("interpolace jako compose: $$, default, povinná", () => {
    const cti = (o: Record<string, string>) => (k: string) => o[k];
    expect(interpoluj("$${X} ${A:-7} ${B-8} ${C?m}", cti({ B: "", C: "" }))).toBe("${X} 7  ");
    expect(() => interpoluj("${P:?chybí}", cti({ P: "" }))).toThrow(/povinná P/);
  });
});

describe("doktor, sync a verify se ptají téhož domova", () => {
  const cti = (f: string) => readFileSync(join(ROOT, f), "utf8");
  const kod = (t: string) => t.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

  test("doktor: oddíl dveří měří soulad knihovnou, ne grepem compose", () => {
    const d = kod(cti("scripts/cold-start-doctor.sh"));
    expect(d).toMatch(/dvere-soulad\.mjs" --soulad --env-file/);
    expect(d, "„používá instance dveře?“ z compose je vždy ano — větev nedosažitelná").not.toMatch(/grep -c 'profiles:\.\*"knock"'/);
    // FATAL zavřeného edge se rozhoduje KÓDEM měření, ne textem výpisu —
    // chování měří doktor-dvere-verdikt-z-kodu.gate.test.ts.
    expect(d).toMatch(/DVERE_FATAL_ZAVRENY_EDGE="EDGE_DOOR_MODE=enforce bez deklarovaných dveří/);
    expect(d).toMatch(/dvere_soulad_verdikt "\$__dvere_out" "\$__dvere_rc"/);
  });

  test("doktor fáze P: aplikace + kolize UDP, kolize je FAIL", () => {
    const d = kod(cti("scripts/cold-start-doctor.sh"));
    const i = d.indexOf("phase P ");
    const j = d.indexOf("Phase G", i);
    const faze = d.slice(i, j > i ? j : undefined);
    expect(faze).toMatch(/dvere-soulad\.mjs" --coolify --prefix/);
    expect(faze).toMatch(/dvere_na_aplikaci_verdikt "\$_p_out" "\$_p_rc"/);
    const verdikt = /^dvere_na_aplikaci_verdikt\(\) \{\n[\s\S]*?\n\}/m.exec(d)?.[0] ?? "";
    expect(verdikt).toMatch(/"✗ kolize: "\*\) fail/);
  });

  test("sync: profil dveří srovnává v OBOU větvích (s klíči i bez)", () => {
    const s = cti("scripts/coolify-sync-envs.sh");
    expect(s.match(/zajisti_profil_dveri "\$UUID" "\$ROOT\/\$_compose" \|\| FAILED\+=\("\$NAME"\)/g) ?? []).toHaveLength(2);
  });

  test("verify: dveře jsou součást verdiktu a klepání je pojmenované NEZMĚŘENO", () => {
    const v = cti("scripts/cold-start-verify.mjs");
    expect(v).toMatch(/zmerDvereNaAplikaci\(/);
    expect(v).toMatch(/!dvereFailed/);
    expect(v).toMatch(/klepani: `NEZMĚŘENO/);
  });
});
