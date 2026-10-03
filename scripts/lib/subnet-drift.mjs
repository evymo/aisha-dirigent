/**
 * subnet-drift.mjs — je rozdíl mezi zapsaným a odvozeným rozsahem DEKLARACE, nebo SETRVAČNOST?
 *
 * PROČ (naměřeno 2026-08-13 na riqu): doctor tenhle rozdíl hlásil jako
 * „buď vědomý override, nebo zděděná hodnota" — tedy přiznával, že to nezměřil.
 * A nemohl: četl JEN `.env.coolify`, což je náš VLASTNÍ výstup z minulého běhu.
 * Varoval tak před stavem, který týž běh o dvě fáze později sám přepíše.
 * Warning, který operátor nemá jak vyhodnotit, ho jen učí nedívat se.
 *
 * Rozhodovací pravidlo má domov v generate-secrets (`declaredOverride`, #897)
 * a tady se opakuje: vyhrává jen DEKLARACE — hodnota v prostředí, která se
 * NEROVNÁ vaultu. Hodnota shodná s vaultem je ozvěna (vault plníme my sami),
 * hodnota jen v `.env.coolify` je setrvačnost. V obou případech vyhraje
 * odvození z identity instance, takže rozdíl NENÍ riziko — je to plán.
 *
 * Riziko, kvůli kterému kontrola vznikla (2026-08-11: zděděný 10.99.0.0/24 na
 * varře držel jiný nájemník a mesh-dns tam nevznikla), řeší `create-netseg.sh`
 * na hostiteli — jediné místo, které vidí ŽIVÉ sítě.
 */

import { deriveSubnets } from "./derive-subnets.mjs";

/** Klíč v env → které pole derivace mu odpovídá. */
export const SUBNET_KEYS = {
  NETSEG_FRONTEND_SUBNET: "frontend",
  NETSEG_BACKEND_SUBNET: "backend",
  NETSEG_DATA_SUBNET: "data",
  MESH_DNS_SUBNET: "meshDns",
};

/**
 * @param {{
 *   identity: string,
 *   written?: Record<string,string>,
 *   vault?: Record<string,string>,
 *   env?: Record<string,string|undefined>,
 * }} vstup
 * @returns {{ verdikt: "OK"|"PREPISE"|"OVERRIDE"|"NEZMERENO", polozky: string[] }}
 */
export function classifySubnetDrift({ identity, written = {}, vault = {}, env = {} }) {
  const id = String(identity || "").trim();
  if (!id) return { verdikt: "NEZMERENO", polozky: [] };

  const odvozene = deriveSubnets(id);
  const deklarace = [];
  const setrvacnost = [];

  for (const [key, pole] of Object.entries(SUBNET_KEYS)) {
    const chteno = odvozene[pole];
    const je = (written[key] || "").trim();
    if (!je || je === chteno) continue;

    const zProstredi = (env[key] || "").trim();
    const zVaultu = (vault[key] || "").trim();
    // Deklarace = operátor to řekl TEĎ a je to něco jiného, než co drží vault.
    // Shoda s vaultem je ozvěna našeho vlastního výstupu, ne volba.
    if (zProstredi && zProstredi !== zVaultu) deklarace.push(`${key}=${zProstredi}`);
    else setrvacnost.push(`${key}: ${je} → ${chteno}`);
  }

  if (deklarace.length) return { verdikt: "OVERRIDE", polozky: deklarace };
  if (setrvacnost.length) return { verdikt: "PREPISE", polozky: setrvacnost };
  return { verdikt: "OK", polozky: [] };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// `subnet-drift.mjs <.env.coolify> <.env-prod-backup>` → `<VERDIKT>\t<položky>`
import { readFileSync } from "node:fs";
import { isDirectRun } from "./cli-entry.mjs";

/** Naivní env parser — tytéž soubory, jaké čte zbytek shellové cesty. */
export function parseEnvFile(path) {
  /** @type {Record<string,string>} */
  const out = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// „Spustili mě přímo?" má jeden domov: lib/cli-entry.mjs. Porovnává SKUTEČNÉ
// cesty (realpath), ne řetězce — jinak stačí symlink nebo git worktree, blok se
// TIŠE přeskočí a volající dostane prázdný výstup s kódem 0, který si vyloží
// jako měření. Přesně to se 2026-08-14 stalo doctoru u subnetů.
if (isDirectRun(import.meta.url)) {
  const written = parseEnvFile(process.argv[2] ?? "");
  const vault = parseEnvFile(process.argv[3] ?? "");
  const identity = written.APP_NAME_PREFIX || process.env.APP_NAME_PREFIX || "";
  const { verdikt, polozky } = classifySubnetDrift({ identity, written, vault, env: process.env });
  process.stdout.write(`${verdikt}\t${polozky.join(verdikt === "OVERRIDE" ? ", " : " | ")}\n`);
}
