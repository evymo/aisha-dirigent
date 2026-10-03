/**
 * Skutečná hodnota proměnné z odpovědi Coolify API (`/applications/<uuid>/envs`).
 *
 * ⛔ `real_value` NENÍ hodnota, ale její TVAR PRO SOUBOR .env. Naměřeno ve zdroji
 * Coolify 4.3.16 (app/Models/EnvironmentVariable.php, realValue) 2026-09-18:
 *   1. JSON objekt/pole            → beze změny;
 *   2. is_literal || is_multiline  → obalí JEDNÍM párem apostrofů `'…'`;
 *   3. jinak escapeEnvVariables()  → `\`→`\\`, CR→`\r`, TAB→`\t`, NUL→`\0`,
 *                                     `"`→`\"`, `'`→`\'`.
 *
 * Kdo `real_value` bral jako hodnotu, dostal u literálu apostrofy navíc.
 * pki-renewer tak base64 certifikátu NetBirdu nedekódoval, usoudil „konzument
 * nemá certifikát" a restartoval řídicí rovinu meshe každých 6 h a při každém
 * startu PKI (guru, od 2026-09-16 nejméně 25×). Tahle funkce je proto JEDINÉ
 * místo, kde se `real_value` čte (brána coolify-real-value-jen-pres-dekoder);
 * shellové zrcadlo pro obraz bez node je `coolify_env_hodnota` v
 * infra/pki/pki-renewer.sh a obě prochází týmiž vektory
 * (scripts/lib/coolify-env-hodnota.test.mjs).
 *
 * `value` zůstává záložní zdroj jen pro prázdné `real_value` — tak to repo
 * dělalo vždy (Coolify dřív vracel maskované `value`).
 */

/** Je řetězec JSON objekt nebo pole (Coolify: json_validate + `{`/`[` na začátku)? */
function jeJsonKontejner(s) {
  if (!s.startsWith("{") && !s.startsWith("[")) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** Inverze escapeEnvVariables: čte zleva doprava, `\X` → znak X (r/t/0 → CR/TAB/NUL). */
export function odescapuj(s) {
  return s.replace(/\\(.)/gs, (_, c) => (c === "r" ? "\r" : c === "t" ? "\t" : c === "0" ? "\0" : c));
}

/**
 * Skutečná hodnota jednoho záznamu proměnné z Coolify API.
 * @param {{ real_value?: string|null, value?: string|null, is_literal?: boolean, is_multiline?: boolean }} e
 * @returns {string}
 */
export function hodnotaZCoolify(e) {
  const r = e?.real_value;
  if (r === undefined || r === null || r === "") return e?.value ?? "";
  if (jeJsonKontejner(r)) return r;
  if (e.is_literal === true || e.is_multiline === true) {
    return r.length >= 2 && r.startsWith("'") && r.endsWith("'") ? r.slice(1, -1) : r;
  }
  return odescapuj(r);
}
