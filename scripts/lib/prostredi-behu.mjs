/**
 * prostredi-behu.mjs — JEDEN DOMOV odpovědi „na které prostředí tenhle běh míří"
 * (táž tabulka jako scripts/lib/prostredi-behu.sh; proč a naměřené vady tam).
 * Brána `prostredi-behu-jeden-domov` hlídá, že se obě implementace shodují.
 */
import { resolve } from "node:path";

/** Produkční běh? Prázdné AISHA_ENV = přímý běh bez obalu = produkce. */
export function pbJeProd(env = "") {
  return env === "" || env === "production" || env === "prod" || /-(prod|production)$/.test(env);
}

/** Prefix proměnných Coolify; neznámý tvar → null. */
export function pbPrefix(env = "") {
  if (env === "" || env === "production" || env === "prod") return "COOLIFY_PROD_";
  if (env === "staging" || env === "stg") return "COOLIFY_STAGING_";
  if (/-(staging|stg|prod|production)$/.test(env)) return `COOLIFY_${env.toUpperCase().replace(/-/g, "_")}_`;
  return null;
}

/**
 * Výchozí env soubor běhu: produkce <repo>/.env.coolify, jinak <repo>/.env.<env>
 * (holý staging/stg → .env.staging, jako config/coolify-environments.env); neznámý tvar → null.
 */
export function pbEnvSoubor(repo, env = "") {
  if (pbJeProd(env)) return resolve(repo, ".env.coolify");
  if (pbPrefix(env) === null) return null;
  return resolve(repo, env === "staging" || env === "stg" ? ".env.staging" : `.env.${env}`);
}

/**
 * Zdroj doplnění externích hodnot. Produkce: <repo>/.env-prod-backup jako dosud (záloha
 * se nebere). Ne-produkce: záloha povinná a nesmí být produkční záloha ani produkční
 * env soubor → null.
 */
export function pbZdrojDoplneni(repo, env = "", zaloha = "") {
  if (pbJeProd(env)) return resolve(repo, ".env-prod-backup");
  if (!zaloha) return null;
  const z = resolve(repo, zaloha);
  if (z === resolve(repo, ".env-prod-backup") || z === resolve(repo, ".env.coolify")) return null;
  return z;
}
