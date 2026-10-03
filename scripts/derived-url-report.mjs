#!/usr/bin/env node
/**
 * derived-url-report.mjs — kde chybí plné FQDN a co s tím.
 *
 * PROČ (2026-07-29)
 * ----------------
 * Zdroj je plný tvarů
 *
 *     upstream: process.env.STRIPE_SERVICE_URL ?? "http://svc-stripe:3010"
 *
 * což je napsané správně — proměnná je primární, alias jen záchrana. Jenže když
 * tu proměnnou nikdo neemituje, sáhne se VŽDYCKY po fallbacku: po holém
 * container aliasu na sdílené ploché síti. Ten platí jen na jednom stroji a je
 * to zároveň cesta, kterou má segmentace zavřít.
 *
 * Vada je tichá dvojnásob: kód vypadá korektně a na jednom uzlu i funguje.
 * Projeví se teprve na rozprostřené instalaci — nebo vůbec, jen zůstane díra.
 *
 * Skript proto neříká jen „chybí", ale i CO a KAM doplnit.
 *
 * DVA SMĚRY, oba se měří
 * ----------------------
 *   volání jiné služby  — `process.env.X ?? "http://alias:port"` ve zdroji
 *   vlastní identita    — služba, která nemá v katalogu `internal_url`, takže
 *                         o ní derivace nemůže vydat žádné jméno
 *
 * ČTE, NEMĚNÍ.
 *
 * Použití:
 *   node scripts/derived-url-report.mjs
 *   node scripts/derived-url-report.mjs --json
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopology, formatShellExports } from "./lib/derive-domains.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function sourceFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|mjs|js)$/.test(entry) && !/\.(test|spec)\./.test(entry)) acc.push(full);
  }
  return acc;
}

/** Jména rozlišitelná napříč instalací: container_name + network aliasy. */
function globalNames() {
  const names = new Map(); // jméno → compose soubor
  for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
    const t = readFileSync(resolve(ROOT, f), "utf8");
    for (const m of t.matchAll(/^\s*container_name:\s*([^\s#]+)/gm)) names.set(m[1], f);
    for (const m of t.matchAll(/aliases:\s*\n((?:\s+-\s+[^\n]+\n)+)/g)) {
      for (const l of m[1].trim().split("\n")) {
        names.set(l.trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, ""), f);
      }
    }
    for (const m of t.matchAll(/aliases:\s*\[([^\]]+)\]/g)) {
      for (const a of m[1].split(",")) names.set(a.trim().replace(/^["']|["']$/g, ""), f);
    }
  }
  return names;
}

/** Porty, které daný alias/kontejner skutečně vystavuje. */
function exposedPortsFor(host, names) {
  const file = names.get(host);
  if (!file) return [];
  const t = readFileSync(resolve(ROOT, file), "utf8");
  const ports = new Set();
  // blok služby, který ten alias/container_name nese
  let inBlock = false;
  for (const line of t.split("\n")) {
    if (/^  [a-z0-9][a-z0-9._-]*:\s*$/.test(line)) inBlock = false;
    if (line.includes(host)) inBlock = true;
    if (inBlock) {
      const p = line.match(/^\s+-\s+["']?(\d{2,5})["']?\s*$/);
      if (p) ports.add(Number(p[1]));
    }
  }
  return [...ports];
}

/**
 * Klíče, které doručí env-doctor ze svého CONTRACT.
 *
 * Do .env vedou DVĚ cesty a obě jsou legitimní: derivace (jména odvozená z
 * topologie) a CONTRACT (hodnoty statické či generované — hesla, veřejné
 * domény, klíče). Ptát se jen derivace znamenalo hlásit `KEYCLOAK_URL` jako
 * nedodávaný, přestože dorazí — a je to VEŘEJNÝ issuer, který se odvodit
 * nemá, protože se z něj stává `iss` claim v JWT.
 *
 * Čte se ZDROJ: doktor se při importu sám spustí, takže ho nelze načíst jako
 * modul, a opsaný seznam by se rozešel.
 */
function contractKeys() {
  const src = readFileSync(resolve(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
  const block = src.match(/const CONTRACT\s*=\s*\[([\s\S]*?)\n\];/);
  if (!block) {
    // Bez hlasitého selhání by report tvrdil, že nic nechybí — a byl by to
    // závěr z vadného měřidla, ne měření.
    throw new Error("CONTRACT v scripts/aisha-env-doctor.mjs nenalezen — report ztratil vstup");
  }
  return [...block[1].matchAll(/\[\s*"([A-Z_][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

function main() {
  const emitted = new Set(contractKeys());
  for (const line of formatShellExports(buildTopology({ profileId: "cloud-multi", meshEnabled: true })).split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m) emitted.add(m[1]);
  }
  const names = globalNames();
  const catalog = JSON.parse(readFileSync(resolve(ROOT, "config/services.json"), "utf8")).services;

  // ── směr 1: volání jiné služby ────────────────────────────────────────────
  const byVar = new Map();
  for (const file of sourceFiles(resolve(ROOT, "services"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(
      /process\.env\.([A-Z_][A-Z0-9_]*)\s*(?:\?\?|\|\|)\s*["'`](https?:\/\/([a-zA-Z0-9._-]+)(?::(\d+))?[^"'`]*)["'`]/g,
    )) {
      const [, variable, fallback, host, port] = m;
      if (host.includes(".") || host === "localhost" || host === "127.0.0.1") continue;
      if (emitted.has(variable)) continue;
      if (!byVar.has(variable)) byVar.set(variable, { fallbacks: new Map(), files: new Set() });
      const e = byVar.get(variable);
      e.fallbacks.set(fallback, { host, port: port ? Number(port) : null });
      e.files.add(file.replace(`${ROOT}/`, ""));
    }
  }

  // ── směr 2: vlastní identita ──────────────────────────────────────────────
  //
  // `internal_url` je JEDNOTNÉ číslo, ale jedna katalogová služba jich vystavuje
  // víc — core má postgrest, gateway, minio, imgproxy, mcp-knowledge i
  // web-artifact. Od zavedení `internal_endpoints` je tedy „nemá internal_url"
  // špatná otázka: služba má identitu, vydává-li derivace jméno KTERÝMKOLI
  // z obou polí. Původní počet 17 byl proto z velké části artefakt měřidla.
  const noIdentity = Object.entries(catalog)
    .filter(([, s]) => !s.internal_url?.service && !(s.internal_endpoints ?? []).length)
    .map(([id]) => id);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      missingVars: [...byVar].map(([v, e]) => ({ variable: v, fallbacks: [...e.fallbacks.keys()], files: [...e.files] })),
      servicesWithoutInternalUrl: noIdentity,
    }, null, 2));
    return;
  }

  console.log(C.bold("\nChybějící odvozená URL — co doplnit a kam\n"));
  console.log(C.dim("  Proměnná se čte s aliasovým fallbackem, ale derivace ji NEVYDÁVÁ,"));
  console.log(C.dim("  takže se vždy skončí na holém aliasu (jeden stroj, plochá síť).\n"));

  const rows = [...byVar].sort((a, b) => b[1].files.size - a[1].files.size);
  for (const [variable, e] of rows) {
    console.log(`  ${C.bold(variable)}  ${C.dim(`(${e.files.size} konzumentů)`)}`);
    for (const [fb, { host, port }] of e.fallbacks) {
      const owner = names.get(host);
      const ports = exposedPortsFor(host, names);
      let verdict;
      if (!owner) verdict = C.red("jméno nikdo nedeklaruje — fallback nefunguje nikde");
      else if (port && ports.length && !ports.includes(port)) {
        verdict = C.red(`ŠPATNÝ PORT — ${host} vystavuje ${ports.join("/")}`);
      } else verdict = C.yellow(`alias z ${owner.replace("docker-compose.coolify", "").replace(".yml", "") || "-core"}`);
      console.log(`     ${fb}  ${verdict}`);
    }
    console.log(C.dim(`     → doplnit: internal_url { service, port, env_aliases: ["${variable}"] } do config/services.json`));
  }

  console.log(`\n  ${C.bold("Celkem")}: ${C.red(String(rows.length))} proměnných bez derivace.`);

  if (noIdentity.length) {
    console.log(`\n  ${C.bold("Bez vlastní identity")} ${C.dim("(katalog nemá internal_url → derivace o nich nevydá nic)")}:`);
    console.log(`    ${noIdentity.join(", ")}`);
  }
  console.log();
}

main();
