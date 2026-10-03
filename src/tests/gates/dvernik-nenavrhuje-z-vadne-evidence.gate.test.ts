/**
 * Brána: nástroj dvorníka NENAVRHNE allowlist z evidence, které nelze věřit.
 *
 * `scripts/dvernik-evidence.mjs` je jediné místo, kde z evidence adres (dveře
 * v režimu observe) vzniká návrh do `SPA_STATIC_ALLOW` — tedy seznam adres, které
 * projdou i zavřenými dveřmi. Chybný návrh není kosmetika: adresa proxy v něm
 * otevře dveře každému, kdo za tou proxy stojí, a `enforce` přitom hlásí zavřeno.
 *
 * Měří se CHOVÁNÍ nad syntetickou evidencí, pět vad, každá musí návrh zastavit:
 *   1. nevíme, čí adresu čteme (bez GATEWAY_TRUSTED_PROXIES) — touž zásadu drží
 *      services/gateway/src/config.ts;
 *   2. kandidát leží v rozsahu důvěryhodné proxy = evidence zapsala skok;
 *   3. celá evidence kolabuje na jednu adresu = nepředaný x-forwarded-for;
 *   4. chybí okno a práh (`--dny`, `--min`) — „všechno, co kdy přišlo" nese skenery;
 *   5. evidence porušuje vlastní deklarovanou lhůtu (rozpětí > N+1 dní).
 * A dvě vlastnosti čtení: gzip zálohy Caddy se čtou (jinak by evidence tiše
 * přišla o vše kromě posledního dne) a nečitelná lhůta se nehádá.
 *
 * ⛔ Brána NEČTE `.env.coolify` z checkoutu — ukazuje nástroji `--env-soubor`
 * na neexistující cestu. Verdikt nesmí záviset na tom, co v checkoutu náhodou leží.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = process.cwd();
const NASTROJ = join(ROOT, "scripts/dvernik-evidence.mjs");
const DEN = 86400;
const PROXY = "10.0.0.0/8";

type Zaznam = { ip: string; stari: number };
const radek = ({ ip, stari }: Zaznam) =>
  JSON.stringify({ ts: Date.now() / 1000 - stari, request: { client_ip: ip, remote_ip: "10.9.9.9", host: "app.example.test" } });

function evidence(aktivni: Zaznam[], zaloha: Zaznam[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "dvernik-evidence-"));
  writeFileSync(join(dir, "pristupy.log"), aktivni.map(radek).join("\n") + "\n");
  if (zaloha.length) writeFileSync(join(dir, "pristupy-2026-01-01T00-00-00.000.log.gz"), gzipSync(zaloha.map(radek).join("\n") + "\n"));
  return join(dir, "pristupy.log");
}

function spust(log: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [NASTROJ, "--log", log, "--env-soubor", "/neexistuje/.env.coolify", ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const zdrava: Zaznam[] = [
  { ip: "203.0.113.5", stari: 3600 }, { ip: "203.0.113.5", stari: 2 * DEN }, { ip: "203.0.113.5", stari: 5 * DEN },
  { ip: "198.51.100.7", stari: 3600 },
];
const NAVRH = ["--dny", "14", "--min", "2", "--allow-list"];

describe("dvorník nenavrhne z evidence, které nelze věřit", () => {
  it("zdravá evidence → návrh obsahuje jen adresy nad prahem", () => {
    const r = spust(evidence(zdrava), NAVRH, { GATEWAY_TRUSTED_PROXIES: PROXY });
    expect(r.rc, r.err).toBe(0);
    const adresy = r.out.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(adresy).toEqual(["203.0.113.5"]);
  });

  it("1) bez GATEWAY_TRUSTED_PROXIES → odmítne (nevíme, čí adresu čteme)", () => {
    const r = spust(evidence(zdrava), NAVRH);
    expect(r.rc).toBe(2);
    expect(r.err).toMatch(/ODMÍTÁM NAVRHNOUT: GATEWAY_TRUSTED_PROXIES/);
  });

  it("2) kandidát v rozsahu proxy → odmítne (evidence zapsala skok)", () => {
    const r = spust(evidence([...zdrava, { ip: "10.1.2.3", stari: 60 }, { ip: "10.1.2.3", stari: 120 }]), NAVRH,
      { GATEWAY_TRUSTED_PROXIES: PROXY });
    expect(r.rc).toBe(2);
    expect(r.err).toMatch(/evidence neměří klienty/);
    expect(r.err).toMatch(/10\.1\.2\.3/);
  });

  it("3) celá evidence na jedné adrese → odmítne (nepředaný x-forwarded-for)", () => {
    const r = spust(evidence([{ ip: "192.0.2.1", stari: 60 }, { ip: "192.0.2.1", stari: 120 }]), NAVRH,
      { GATEWAY_TRUSTED_PROXIES: PROXY });
    expect(r.rc).toBe(2);
    expect(r.err).toMatch(/kolabuje na JEDNU adresu/);
  });

  it("4) bez --dny a --min → odmítne (okno a práh jsou rozhodnutí)", () => {
    const r = spust(evidence(zdrava), ["--allow-list"], { GATEWAY_TRUSTED_PROXIES: PROXY });
    expect(r.rc).toBe(2);
    expect(r.err).toMatch(/chybí --dny a --min/);
  });

  it("5) rozpětí záznamů nad N+1 dní → RETENCE PORUŠENA, nenulový kód, žádný návrh", () => {
    const log = evidence([...zdrava, { ip: "203.0.113.5", stari: 40 * DEN }]);
    const env = { GATEWAY_TRUSTED_PROXIES: PROXY, EDGE_ACCESS_RETENTION_DAYS: "30" };
    const j = spust(log, ["--json"], env);
    expect(j.rc).toBe(3);
    expect(JSON.parse(j.out).lhuta).toMatchObject({ dni: 30, porusena: true });
    const n = spust(log, NAVRH, env);
    expect(n.rc).toBe(2);
    expect(n.err).toMatch(/RETENCE PORUŠENA/);
  });

  it("5) hranice: rozpětí přesně v N+1 dnech je v mezích (úklid řeže 1× za 24 h)", () => {
    const j = spust(evidence([{ ip: "203.0.113.5", stari: 60 }, { ip: "198.51.100.7", stari: 31 * DEN }]), ["--json"],
      { GATEWAY_TRUSTED_PROXIES: PROXY, EDGE_ACCESS_RETENTION_DAYS: "30" });
    expect(j.rc, j.err).toBe(0);
    expect(JSON.parse(j.out).lhuta.porusena).toBe(false);
  });
});

describe("dvorník čte celou evidenci a lhůtu nehádá", () => {
  it("gzip záloha Caddy se čte — jinak evidence tiše přijde o vše kromě posledního dne", () => {
    const j = spust(evidence(zdrava, [{ ip: "192.0.2.44", stari: 6 * DEN }, { ip: "192.0.2.44", stari: 7 * DEN }]), ["--json"],
      { GATEWAY_TRUSTED_PROXIES: PROXY });
    const v = JSON.parse(j.out);
    expect(v.preskoceno, "řádky zálohy se nesmí počítat jako nečitelné").toBe(0);
    expect(v.nectene).toEqual([]);
    expect(v.adresy.map((a: { adresa: string }) => a.adresa)).toContain("192.0.2.44");
  });

  it("řádek za dírou z nul (po řezu úklidem) se čte — nuly nejsou data", () => {
    // Caddy po zkrácení píše na starý posun (lumberjack bez O_APPEND, naměřeno E2E).
    const log = evidence(zdrava);
    writeFileSync(log, Buffer.concat([Buffer.alloc(2048), readFileSync(log)]));
    const v = JSON.parse(spust(log, ["--json"], { GATEWAY_TRUSTED_PROXIES: PROXY }).out);
    expect(v.preskoceno, "první řádek za dírou zahozen jako nečitelný").toBe(0);
    expect(v.radku).toBe(zdrava.length);
  });

  it.each(["0", "30d", "030"])("nečitelná lhůta %j → odmítne (edge by touž hodnotu nespustil)", (lhuta) => {
    const r = spust(evidence(zdrava), ["--json"], { GATEWAY_TRUSTED_PROXIES: PROXY, EDGE_ACCESS_RETENTION_DAYS: lhuta });
    expect(r.rc).toBe(2);
    expect(r.err).toMatch(/není kladný počet dní/);
  });
});
