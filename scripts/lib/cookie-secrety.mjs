/**
 * cookie-secrety.mjs — KTERÉ proměnné končí jako cookie secret oauth2-proxy.
 *
 * ⛔ NAMĚŘENO 2026-09-16 na studeném startu instance. Doktor měl seznam klíčů
 * NAPSANÝ RUČNĚ (`PKI_`, `STUDIO_`, `N8N_`, `OAUTH2_PROXY_`). `EXTRANET_COOKIE_SECRET`
 * v něm nebyl, takže do nasazení odešla zkamenělá hodnota o 69 bajtech —
 * oauth2-proxy přijímá jen 16, 24 nebo 32. `extranet-auth` spadl při startu
 * („cookie_secret must be 16, 24, or 32 bytes… but is 75 bytes"), s ním celý
 * edge stack, a veřejné adresy instance vracely 404.
 *
 * Výčet se proto neudržuje: měří se z compose, kdo tu hodnotu oauth2-proxy
 * SKUTEČNĚ podává. Nová brána s vlastním klíčem je tím hlídaná v den, kdy vznikne.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** `OAUTH2_PROXY_COOKIE_SECRET: ${KLIC…}` v compose → jméno KLIC. */
const ODKAZ = /^\s*(?:-\s*)?OAUTH2_PROXY_COOKIE_SECRET[:=]\s*["']?\$\{([A-Z_][A-Z0-9_]*)/gm;

/**
 * @param {string} root kořen repa
 * @returns {string[]} jména proměnných, které nesou cookie secret (setříděná, bez duplicit)
 */
export function kliceCookieSecretu(root) {
  const klice = new Set();
  for (const soubor of readdirSync(root).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f))) {
    const text = readFileSync(join(root, soubor), "utf8");
    for (const m of text.matchAll(ODKAZ)) klice.add(m[1]);
  }
  return [...klice].sort();
}
