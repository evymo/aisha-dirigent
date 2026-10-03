/**
 * BRÁNA: přesyn compose bloku NESMÍ srazit `$$` na `$`.
 *
 * ⛔ NAMĚŘENO 2026-08-31: `mesh-conformance-apply --resync` zapisoval blok přes
 * `String.replace(stary, novy)` s ŘETĚZCOVOU náhradou. Ta vykládá `$$` jako
 * escape pro jeden `$` — a compose má `$$` všude (escape na literální `$` pro
 * shell uvnitř kontejneru). Tiše se tak z BĚHOVÝCH proměnných staly
 * compose-time dosazenia a ingress by se rozbil v 16 stackách naráz.
 *
 * `preflight-compose.sh` to NECHYTÍ: `${VAR}` i `$${VAR}` jsou syntakticky
 * platné, liší se AŽ VÝZNAM. Proto tahle brána měří přímo tu vlastnost.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

describe('brána: přesyn nesmí srazit escapování', () => {
  it('náhrada v zapisPresyn je FUNKCE, ne řetězec', () => {
    const src = readFileSync(join(ROOT, 'scripts/mesh-conformance-apply.mjs'), 'utf-8');
    // Vlastnost, ne zápis: řetězcová náhrada je ta vada. Funkce `$` nevykládá.
    expect(src).toMatch(/text\.replace\(\s*plan\.resync\.stary\s*,\s*\(\)\s*=>/);
    expect(src).not.toMatch(/text\.replace\(\s*plan\.resync\.stary\s*,\s*plan\.resync\.novy\s*\)/);
  });

  it('žádný compose nemá v shellu sražené $(...) tam, kde patří $$(...)', () => {
    const viníci: string[] = [];
    for (const f of readdirSync(ROOT).filter((n) => /^docker-compose\.coolify.*\.yml$/.test(n))) {
      const t = readFileSync(join(ROOT, f), 'utf-8');
      // Univerzum se HLEDÁ: ne seznam souborů, ale ta jediná konstrukce, která
      // v běhovém shellu MUSÍ být escapovaná.
      if (/\n\s+PORTS=\$\((?!\$)/.test(t)) viníci.push(`${f}: PORTS=$( místo $$(`);
      if (/\n\s+if \[ -z "\$\{[A-Z_]+_MESH_INGRESS_ROUTES/.test(t)) viníci.push(`${f}: \${ROUTES} místo $\${ROUTES}`);
    }
    expect(viníci).toEqual([]);
  });
});
