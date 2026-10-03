/**
 * Tajemství pro první start ZAHAZOVACÍ DB — jeden domov pro with-throwaway-db.mjs
 * i types-refresh-throwaway.mjs.
 *
 * První start obrazu (002_set_passwords.sh) VYŽADUJE skutečná tajemství:
 * VAULT_ENCRYPTION_KEY a COLUMN_ENCRYPTION_KEY mají tvrdou stráž `:?` a brána
 * bezpečnosti zakazuje výchozí hodnoty V OBRAZU.
 *  - Lokálně se předá vývojový env soubor `.env.local.dev` (`docker --env-file`
 *    ho čte doslova, zvládne i neuvozené hodnoty, které shell `source` rozbije).
 *  - Bez něj (CI, čerstvý worktree) se vyrobí EFEMÉRNÍ klíče. Zahazovací DB na konci
 *    zanikne, klíče nikde nezůstanou a nechrání žádná skutečná data — náhodná hodnota
 *    na běh není commitnuté tajemství. Výslovná hodnota z prostředí má přednost.
 *
 * ⛔ PROČ JEDEN DOMOV: 2026-09-25 byly dvě kopie a rozešly se. Náhradní klíče měla jen
 * with-throwaway-db.mjs; types-refresh-throwaway.mjs („mirrors with-throwaway-db.mjs")
 * v čerstvém worktree bez `.env.local.dev` padal na „VAULT_ENCRYPTION_KEY must be set"
 * a DB nikdy nenaběhla (sync kola 6 na riq). Hlídá throwaway-db-tajemstvi.test.mjs.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

/** Klíče se stráží `:?` v prvním startu obrazu, které se bez env souboru vyrobí na běh. */
export const EFEMERNI_KLICE = ["VAULT_ENCRYPTION_KEY", "COLUMN_ENCRYPTION_KEY", "JWT_SECRET"];

/**
 * Argumenty `docker run` s tajemstvími pro první start. Patří PŘED výslovné
 * `-e POSTGRES_*` volajícího, aby jeho známé hodnoty vyhrály.
 *
 * @param {string} root kořen repa (hledá se `<root>/.env.local.dev`)
 * @param {Record<string, string | undefined>} [env] prostředí (výslovná hodnota vyhrává)
 * @param {() => string} [nahodne] zdroj efemérní hodnoty (test ho podvrhne)
 * @returns {string[]}
 */
export function argumentyTajemstvi(root, env = process.env, nahodne = () => randomBytes(24).toString("hex")) {
  const envSoubor = path.join(root, ".env.local.dev");
  if (existsSync(envSoubor)) return ["--env-file", envSoubor];
  return EFEMERNI_KLICE.flatMap((k) => ["-e", `${k}=${env[k] && env[k].trim() ? env[k] : nahodne()}`]);
}
