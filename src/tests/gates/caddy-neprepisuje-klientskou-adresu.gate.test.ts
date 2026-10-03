/**
 * BRÁNA: každý náš Caddy, který proxuje, deklaruje `trusted_proxies`.
 *
 * ⛔ NAMĚŘENO 2026-08-31/09-01: brána viděla `x-forwarded-for` s JEDINÝM prvkem
 * — adresou svého souseda. Caddy bez `trusted_proxies` příchozí hlavičce
 * nedůvěřuje a PŘEPÍŠE ji tím, kdo se právě připojil. HAProxy na pfSense
 * přitom hlavičku nastavuje autoritativně (`del-header` + `set-header
 * X-Forwarded-For %[src]`), takže klientská adresa k nám DORAZÍ — a každý náš
 * skok ji zahodil. `enforce` by zamkl i majitele.
 *
 * Univerzum se HLEDÁ, nepíše: bere se každý compose, který v příkazu staví
 * Caddyfile s `reverse_proxy`. Ruční seznam by minul přesně ten soubor, na
 * který se zapomnělo — a zapomnělo se na `edge`, tedy na PRVNÍ skok.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const composes = readdirSync(ROOT).filter((n) => /^docker-compose\.coolify.*\.yml$/.test(n));

/** Staví tenhle compose Caddyfile s proxy? (ne katalog, ne seznam — obsah.) */
const proxuje = (t: string) => /reverse_proxy/.test(t) && /\/etc\/caddy\/Caddyfile/.test(t);

/**
 * ⛔ Komentáře se z měření VYŘADÍ. Dvakrát po sobě zůstala mutace ZELENÁ,
 * protože `trusted_proxies static` stojí i ve vysvětlivce, která tu vadu
 * popisuje — brána matchovala vlastní text. Měří se KÓD, ne próza o něm.
 */
const bezKomentaru = (t: string) =>
  t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

describe('brána: Caddy nesmí přepsat klientskou adresu', () => {
  it('sonda má co měřit — aspoň jeden compose staví Caddyfile s proxy', () => {
    const kandidati = composes.filter((f) => proxuje(readFileSync(join(ROOT, f), 'utf-8')));
    expect(kandidati.length).toBeGreaterThan(0);
  });

  it('každý takový compose deklaruje trusted_proxies', () => {
    const viníci: string[] = [];
    for (const f of composes) {
      const t = readFileSync(join(ROOT, f), 'utf-8');
      if (!proxuje(t)) continue;
      // ⛔ Nesmí stačit SLOVO: `trusted_proxies` je i v komentáři, který tu
      // vadu vysvětluje — brána by matchovala vlastní vysvětlivku a mutace by
      // neprošla (naměřeno: mutace zůstala ZELENÁ). Vyžaduje se DIREKTIVA.
      if (!/trusted_proxies\s+static/.test(bezKomentaru(t))) viníci.push(f);
    }
    expect(viníci).toEqual([]);
  });

  it('hodnota se NEOPISUJE — bere se doručený seznam, ne literál', () => {
    const viníci: string[] = [];
    for (const f of composes) {
      const t = readFileSync(join(ROOT, f), 'utf-8');
      if (!/trusted_proxies\s+static/.test(bezKomentaru(t))) continue;
      // Literál rozsahu vedle `trusted_proxies` = druhý domov téže hodnoty.
      const radky = bezKomentaru(t).split('\n').filter((l) => /trusted_proxies\s+static/.test(l));
      if (radky.some((l) => /\d+\.\d+\.\d+\.\d+\/\d+/.test(l))) viníci.push(`${f}: literál rozsahu`);
      if (!t.includes('GATEWAY_TRUSTED_PROXIES')) viníci.push(`${f}: nebere doručený seznam`);
    }
    expect(viníci).toEqual([]);
  });
});
