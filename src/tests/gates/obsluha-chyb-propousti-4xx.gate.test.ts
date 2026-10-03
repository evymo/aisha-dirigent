/**
 * Vlastní obsluha chyb nesmí odmítnutí 4xx od našeho serveru sklopit na 500
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Služba, která v `applySecurity` vypne výchozí obsluhu (`skipErrorHandler: true`)
 * a nastaví vlastní `setErrorHandler`, musí v ní volat `pluginRejection` (nebo
 * `toPublicError`) z `@aisha/security`.
 *
 * ── PROČ (naměřeno 2026-09-25) ────────────────────────────────────────────────
 * 9 služeb s vlastní obsluhou znalo jen `AuthError` a vše ostatní vracelo jako
 * 500 — i 429 z limitu dotazů (s `retry-after`) a 400 z validace schématu.
 * 09-24 tak broker nepoznal „zpomal" od „Money leží" a stály živé dodáky
 * (svc-money, #391). Výchozí obsluha knihovny měla tutéž vadu (16 služeb).
 *
 * Gateway (bez `applySecurity`, jako proxy propouští `err.statusCode` celé)
 * pravidlu nepodléhá — nevypíná výchozí obsluhu, protože ji nemá.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();

/** Zdroje služby ze SOUBOROVÉHO SYSTÉMU (ne `git ls-files` — nevidí nový nestagovaný soubor). */
function zdroje(adresar: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(adresar, { withFileTypes: true })) {
    if (["node_modules", "__tests__", "dist"].includes(e.name)) continue;
    const p = path.join(adresar, e.name);
    if (e.isDirectory()) out.push(...zdroje(p));
    else if (/\.(ts|mts|js|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

function bezKomentaru(zdroj: string): string {
  return zdroj.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Porušuje soubor pravidlo? (vypnutá výchozí obsluha + vlastní obsluha bez pluginRejection) */
export function porusuje(zdroj: string): boolean {
  const s = bezKomentaru(zdroj);
  const vypnuta = /skipErrorHandler\s*:\s*true/.test(s);
  const vlastni = /\.setErrorHandler\s*\(/.test(s);
  const propousti = /\b(pluginRejection|toPublicError)\s*\(/.test(s);
  return vypnuta && vlastni && !propousti;
}

describe("vlastní obsluha chyb propouští 4xx od našeho serveru", () => {
  it("⭐ žádná služba s vlastní obsluhou nesklápí 4xx na 500", () => {
    const sluzby = path.join(ROOT, "services");
    const nalezy = readdirSync(sluzby, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => {
        const src = path.join(sluzby, d.name, "src");
        try { return zdroje(src); } catch { return []; }
      })
      .filter((f) => porusuje(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(
      nalezy,
      "Vlastní setErrorHandler musí hned po svých typech volat pluginRejection(err) z @aisha/security",
    ).toEqual([]);
  });

  it("kontrolní vzorek: pravidlu podléhá aspoň devět služeb (sonda není slepá)", () => {
    const sluzby = path.join(ROOT, "services");
    const podlehajici = readdirSync(sluzby, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => { try { return zdroje(path.join(sluzby, d.name, "src")); } catch { return []; } })
      .filter((f) => {
        const s = bezKomentaru(readFileSync(f, "utf8"));
        return /skipErrorHandler\s*:\s*true/.test(s) && /\.setErrorHandler\s*\(/.test(s);
      });
    expect(podlehajici.length).toBeGreaterThanOrEqual(9);
  });

  it("sonda umí říct NE — a nechá projít správný tvar i zmínku v komentáři", () => {
    const zaklad = "await applySecurity(app, { service: 'x', cors: { allowlist: '' }, skipErrorHandler: true });\n";
    const spatne = zaklad + "app.setErrorHandler((e, _r, reply) => reply.status(500).send({}));";
    expect(porusuje(spatne)).toBe(true);
    expect(porusuje(spatne + "\n// pluginRejection(err) tu chybí")).toBe(true);
    expect(porusuje(zaklad + "app.setErrorHandler((e, _r, reply) => { const o = pluginRejection(e); if (o) return reply.status(o.statusCode).send(o.body); });")).toBe(false);
    expect(porusuje("app.setErrorHandler(() => {}); // bez skipErrorHandler = výchozí obsluha se nevypnula")).toBe(false);
  });
});
