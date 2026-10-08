/**
 * Katalogová služba, jejíž compose ještě neexistuje, smí stát JEN za opt-in lane.
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Deklarace služby smí do katalogu přijít dřív než její compose (vrstva `accel`:
 * katalog + slot napřed, compose v dalším kroku). Takový mezistav je bezpečný
 * jen tehdy, když bez VÝSLOVNÉHO zapnutí nic nezaloží a nic neodvodí:
 *   1. služba má `provision_when_env` — bez příznaku ji story-init nezakládá,
 *      topologie ji nevydá a její slot není v provozu,
 *   2. služba ještě na nic NEUKAZUJE (`internal_url`, `internal_endpoints`,
 *      `internal_tcp_endpoints`, `public_face`) — odkaz do souboru, který
 *      neexistuje, je odkaz do prázdna (brána katalog-ukazuje-na-jmeno-neopisuje).
 *
 * Povinná služba bez compose by naopak padla až při zakládání aplikace v Coolify
 * — tedy v provozu, ne na PR.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

type Sluzba = {
  compose?: string;
  provision_when_env?: string | string[];
  internal_url?: unknown;
  internal_endpoints?: unknown[];
  internal_tcp_endpoints?: unknown[];
  public_face?: unknown;
};

/** Nálezy nad katalogem; `existuje` je vstřik kvůli mutačnímu testu. */
export function nalezyBezCompose(
  sluzby: Record<string, Sluzba>,
  existuje: (soubor: string) => boolean = (s) => existsSync(join(ROOT, s)),
): string[] {
  const out: string[] = [];
  for (const [id, s] of Object.entries(sluzby)) {
    if (!s?.compose || existuje(s.compose)) continue;
    const lane = Array.isArray(s.provision_when_env) ? s.provision_when_env.filter(Boolean) : [s.provision_when_env].filter(Boolean);
    if (lane.length === 0) out.push(`${id}: ${s.compose} neexistuje a služba NENÍ opt-in (chybí provision_when_env)`);
    const odkazy = [
      s.internal_url ? "internal_url" : null,
      (s.internal_endpoints ?? []).length ? "internal_endpoints" : null,
      (s.internal_tcp_endpoints ?? []).length ? "internal_tcp_endpoints" : null,
      s.public_face ? "public_face" : null,
    ].filter(Boolean);
    if (odkazy.length) out.push(`${id}: ${s.compose} neexistuje, a přesto na něj ukazuje ${odkazy.join(", ")}`);
  }
  return out;
}

const katalog = (): Record<string, Sluzba> =>
  JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf8")).services;

describe("katalog: služba bez compose jen za zavřenou lane", () => {
  test("univerzum se našlo a většina služeb compose má (jinak měřidlo čte špatně)", () => {
    const s = katalog();
    const sCompose = Object.values(s).filter((x) => x.compose && existsSync(join(ROOT, x.compose)));
    expect(Object.keys(s).length).toBeGreaterThan(20);
    expect(sCompose.length).toBeGreaterThan(20);
  });

  test("žádná služba bez compose není povinná ani na nic neukazuje", () => {
    expect(nalezyBezCompose(katalog())).toEqual([]);
  });

  test("mutace: povinná služba bez compose a s odkazem se chytí", () => {
    const n = nalezyBezCompose(
      { zkusebni: { compose: "docker-compose.coolify-zkusebni.yml", internal_url: { service: "x", port: 1 } } },
      () => false,
    );
    expect(n).toHaveLength(2);
  });
});
