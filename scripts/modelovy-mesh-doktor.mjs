#!/usr/bin/env node
/**
 * modelovy-mesh-doktor — ověří modelový mesh forku (varianta C, krok C5) JEN ČTENÍM.
 *
 * Ptá se API managementu MODELOVÉHO meshe (peery, politiky, skupiny) tokenem bootstrap
 * uživatele přes klienta `netbird-model-bootstrap` — token s audiencí jen modelového meshe,
 * pověření hlavního meshe se sem neposílají. Posudek je čistá funkce
 * (lib/modelovy-mesh-posudek.mjs). Nic nezapisuje: nápravu dělá bootstrap modelového meshe.
 *
 * Prostředí čte z procesu (cold-start doktor načítá env soubory s `set -a`).
 *
 * Exit: 0 v pořádku (nebo instance modelový mesh nemá) · 1 vada · 2 NEZMĚŘENO.
 */
import { meshAuthFromEnv, meshUserToken, tvarKteraObsluhuje } from "./lib/netbird-auth.mjs";
import { posudekModelovehoMeshe } from "./lib/modelovy-mesh-posudek.mjs";

const env = process.env;

async function main() {
  if (!(env.MODEL_MESH ?? "").trim()) {
    console.log("modelový mesh: instance ho nemá (MODEL_MESH prázdná) — nic k ověření");
    return 0;
  }
  if (!env.NETBIRD_MODEL_DOMAIN || !env.NETBIRD_MODEL_DOMAIN_DIRECT) {
    console.error("NEZMĚŘENO: adresa řídicí roviny modelového meshe (NETBIRD_MODEL_DOMAIN[_DIRECT]) nedoručena");
    return 2;
  }
  let api;
  let token;
  try {
    api = await tvarKteraObsluhuje(
      `https://${env.NETBIRD_MODEL_DOMAIN}`, env.NETBIRD_MODEL_DOMAIN_DIRECT, "/api/peers", "netbird-model", "modelovy-mesh-doktor",
    );
    token = await meshUserToken({
      ...meshAuthFromEnv(env),
      clientId: "netbird-model-bootstrap",
      clientSecret: env.NETBIRD_MODEL_BOOTSTRAP_SECRET,
    });
  } catch (e) {
    console.error(`NEZMĚŘENO: ${String(e?.message ?? e).split("\n")[0]}`);
    return 2;
  }
  const cti = async (cesta) => {
    const r = await fetch(`${api.replace(/\/+$/, "")}${cesta}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`GET ${cesta} → HTTP ${r.status}`);
    return r.json();
  };
  let peery;
  let politiky;
  let skupiny;
  try {
    [peery, politiky, skupiny] = await Promise.all(["/api/peers", "/api/policies", "/api/groups"].map(cti));
  } catch (e) {
    console.error(`NEZMĚŘENO: ${String(e?.message ?? e)}`);
    return 2;
  }
  const { rc, verdikty } = posudekModelovehoMeshe({ peery, politiky, skupiny, env });
  for (const v of verdikty) {
    const znak = v.stav === "ok" ? "✓" : v.stav === "vada" ? "✗" : "?";
    console.log(`${znak} ${v.co}: ${v.detail}`);
    if (v.stav === "nezmereno") console.error(`NEZMĚŘENO: ${v.detail}`);
  }
  return rc;
}

main().then(
  (rc) => process.exit(rc),
  (e) => {
    console.error(`NEZMĚŘENO: ${String(e?.message ?? e)}`);
    process.exit(2);
  },
);
