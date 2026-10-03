/**
 * hlasky-z-compose.mjs — hláška z `${KLIC:?zpráva}` NENÍ hodnota.
 *
 * ⛔ NAMĚŘENO 2026-09-16 v trezoru živé instance. Tři klíče nesly doslovně text
 * hlášky, kterou compose píše, když hodnota CHYBÍ:
 *   KC_ADMIN_CLIENT_ID     = "KC_ADMIN_CLIENT_ID must be delivered by cold-start env (…)"
 *   KC_ADMIN_CLIENT_SECRET = "generuje generate-secrets — prázdné znamená selhaný push env, …"
 *   EXTRANET_OIDC_SECRET   = totéž
 * Generátor je přitom `preservedValue`, takže jednou zapsaná hláška se
 * PŘENÁŠELA přes každý další běh včetně wipe. Nasazení pak mělo jako ID klienta
 * Keycloaku větu — konfigurace realmu, zakládání operátorů i JWKS sync selhaly,
 * a vypadalo to na výpadek Keycloaku.
 *
 * Měří se vlastnost, ne seznam: co compose u klíče píše jako hlášku, to u něj
 * v trezoru nesmí stát jako hodnota.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** `${KLIC:?hláška}` i `${KLIC?hláška}` napříč compose soubory. */
const POVINNE = /\$\{([A-Z_][A-Z0-9_]*):?\?([^}]*)\}/g;

/**
 * @param {string} root kořen repa
 * @returns {Map<string, Set<string>>} klíč → hlášky, které o něm compose píše
 */
export function hlaskyPovinnychKlicu(root) {
  const mapa = new Map();
  for (const soubor of readdirSync(root).filter((f) => /^docker-compose.*\.ya?ml$/.test(f))) {
    const text = readFileSync(join(root, soubor), "utf8");
    for (const m of text.matchAll(POVINNE)) {
      const [, klic, hlaska] = m;
      const h = hlaska.trim();
      if (!h) continue;
      if (!mapa.has(klic)) mapa.set(klic, new Set());
      mapa.get(klic).add(h);
    }
  }
  return mapa;
}

/** Je hodnota klíče ve skutečnosti hláška o jeho chybějící hodnotě? */
export function jeHlaskaMistoHodnoty(klic, hodnota, mapa) {
  const h = String(hodnota ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!h) return false;
  const hlasky = mapa.get(klic);
  if (!hlasky) return false;
  for (const hl of hlasky) {
    if (h === hl) return true;
    // Hláška bývá v compose zalomená; porovnává se i na začátek (prvních 40 znaků).
    if (h.length >= 20 && hl.startsWith(h.slice(0, 40))) return true;
    if (hl.length >= 20 && h.startsWith(hl.slice(0, 40))) return true;
  }
  return false;
}
