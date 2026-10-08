#!/usr/bin/env node
/**
 * Generate the Coolify story manifest for THIS instance.
 *
 * The manifest maps each app to the compose file that defines it; coolify-sync-envs.sh
 * uses it to decide which env keys an app may receive, and refuses to run without it
 * (it will not fall back to another instance's manifest — a guard that exists because
 * a fallback once wrote one instance's env into another's apps).
 *
 * It is a per-instance artifact, gitignored in this repo, and therefore easy to lose
 * when a working copy moves — which is exactly how a full redeploy came to trigger
 * nothing at all. Generating it from the repo's own compose files makes it
 * reproducible instead of hand-kept.
 *
 *   node scripts/gen-instance-manifest.mjs                 # writes <prefix>.manifest
 *   node scripts/gen-instance-manifest.mjs --check         # verify only
 *   node scripts/gen-instance-manifest.mjs --print         # stdout
 *
 * Instance identity comes from APP_NAME_PREFIX (env, .env.coolify, .env-prod-backup) —
 * never guessed. Apps deployed from OTHER repositories are intentionally absent:
 * this repo cannot build an env payload for a compose file it does not have.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { porovnej } from "./lib/razeni.mjs";
import { variantyCompose } from "./lib/compose-varianty.mjs";
import { composeProUmisteni } from "./lib/umisteni-sluzeb.mjs";
import { loadProfile } from "./lib/derive-domains.mjs";
import { isDirectRun } from "./lib/cli-entry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const PRINT = args.includes("--print");

function fromConfigChain(key) {
  for (const f of [".env.coolify", ".env-prod-backup", ".env.local", ".env"]) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

// The app -> compose mapping is NOT derivable from filenames: several apps share one
// compose (edge, core and orchestration all come out of the prebuilt compose), so a
// name-based guess silently drops them. Sibling manifests carry the curated mapping and
// it is instance-agnostic — app names there are short, the <instance>- prefix is applied
// by the tooling — so this inherits it and only then fills in composes nobody declared.
//
// Exportováno: brána manifest-nezaklada-sirotky měří TUHLE funkci, ne vlastní napodobeninu
// pravidla (napodobenina se rozešla, jakmile přibyla varianta compose — 2026-10-05).
//
// `profil` = profil instance (TÝMIŽ dveřmi jako derivace: loadProfile, overlay má přednost).
// Jeho přepis umístění (`service_overrides.<id>.placement`) dostane řádek služby katalogu
// i s compose pro ten slot — na slotu has_gpu varianta `compose_gpu` (composeProUmisteni).
export function aplikaceManifestu({ koren = ROOT, prefix = "", profil = null } = {}) {
  const declared = new Map(); // name -> {placement, compose}
  const manifestDir = join(koren, "coolify/manifests");
  for (const f of readdirSync(manifestDir).filter((f) => f.endsWith(".manifest") && f !== `${prefix}.manifest`)) {
    for (const line of readFileSync(join(manifestDir, f), "utf8").split(/\r?\n/)) {
      const m = /^app:\s*([a-z0-9-]+):([a-z]+):(\S+)/.exec(line.trim());
      if (m && !declared.has(m[1]) && existsSync(join(koren, m[3]))) {
        declared.set(m[1], { placement: m[2], compose: m[3] });
      }
    }
  }
  // Compose, který žádný sourozenecký manifest nedeklaruje, dostane umístění z KATALOGU
  // (`config/services.json`: služby s tímhle `compose` → jejich `placement`).
  //
  // ⛔ Do 2026-10-03 tu bylo pro každý nedeklarovaný compose natvrdo `frontend`. Na
  // instanci, jejíž vlastní manifest je zdrojem mapování (sourozenecký manifest se
  // vynechává), by tak firewall hostitele GPU uzlu (`accel-hostfw`, placement `gpu`)
  // přistál na veřejném frontendu — umístění, které katalog výslovně říká jinak; totéž
  // warmup sítí (netinit), který katalog vede po jedné službě na umístění.
  //   • katalog compose nezná            → `frontend` jako dosud (vypíše se níž),
  //   • jedno umístění                   → to umístění,
  //   • víc umístění (služba po strojích) → řádek za každou službu katalogu (id:umístění).
  const katalog = JSON.parse(readFileSync(join(koren, "config/services.json"), "utf8")).services ?? {};
  const aplikaceZKatalogu = (compose) => {
    const nase = Object.entries(katalog).filter(([, s]) => s?.compose === compose && s.placement);
    const mista = [...new Set(nase.map(([, s]) => s.placement))];
    if (mista.length === 0) return null;
    if (mista.length === 1) return [{ name: null, placement: mista[0] }];
    return nase.map(([id, s]) => ({ name: id, placement: s.placement }));
  };
  const apps = [...declared.entries()].map(([name, v]) => ({ name, ...v }));
  const covered = new Set(apps.map((a) => a.compose));
  // Varianta compose podle slotu (`compose_gpu`) není samostatná aplikace — patří službě, která ji
  // v katalogu nese; manifest instance ji volí řádkem té služby. Jeden domov: lib/compose-varianty.mjs.
  for (const varianta of variantyCompose(katalog).keys()) covered.add(varianta);
  const extra = [];
  for (const f of readdirSync(koren).filter((f) => /^docker-compose\.coolify-[a-z0-9-]+\.yml$/.test(f))) {
    if (covered.has(f)) continue;
    const name = /^docker-compose\.coolify-([a-z0-9-]+)\.yml$/.exec(f)[1];
    if (declared.has(name)) continue;
    const zKatalogu = aplikaceZKatalogu(f);
    if (!zKatalogu) {
      apps.push({ name, placement: "frontend", compose: f });
      extra.push(name);
      continue;
    }
    for (const a of zKatalogu) {
      if (a.name && declared.has(a.name)) continue;
      apps.push({ name: a.name ?? name, placement: a.placement, compose: f });
    }
  }
  // ⛔ 2026-10-06: řádek služby nesl umístění a compose z katalogu i tam, kde profil instance
  // službu přesunul (model forku na GPU slot). Nasazení bere slot a compose z řádku manifestu,
  // takže fork po přesunu modelu zastavila kontrola umístění (umisteni-souhlasi.sh).
  const prepisy = profil?.service_overrides ?? {};
  if (Object.values(prepisy).some((o) => o?.placement)) {
    const servers = JSON.parse(readFileSync(join(koren, "coolify/servers.json"), "utf8")).servers ?? {};
    for (const a of apps) {
      const s = katalog[a.name];
      const misto = prepisy[a.name]?.placement;
      if (!s || !misto || ![s.compose, s.compose_gpu].includes(a.compose)) continue;
      a.placement = misto;
      a.compose = composeProUmisteni(s, misto, servers);
    }
  }
  apps.sort((a, b) => porovnej(a.name, b.name));
  return { apps, unknown: extra };
}

if (isDirectRun(import.meta.url)) {
  const PREFIX = process.env.APP_NAME_PREFIX || fromConfigChain("APP_NAME_PREFIX");
  if (!PREFIX) {
    console.error("FATAL: APP_NAME_PREFIX is not set and not present in the config chain.");
    console.error("       The instance identity must be explicit — refusing to guess it.");
    process.exit(2);
  }
  // Profil instance: deklarovaný a nečitelný = chyba nahlas (loadProfile vyjmenuje, kde hledal).
  const PROFIL = process.env.AISHA_PROFILE || fromConfigChain("AISHA_PROFILE");
  const { apps, unknown } = aplikaceManifestu({ prefix: PREFIX, profil: PROFIL ? loadProfile(PROFIL) : null });
  const body = [
    "# ==============================================================================",
    `# Coolify Story Manifest — ${PREFIX}`,
    "# GENERATED by scripts/gen-instance-manifest.mjs — do not hand-edit.",
    "# Regenerate with: node scripts/gen-instance-manifest.mjs",
    "#",
    "# One line per app this repository can deploy: <app>:<placement>:<compose>.",
    "# Apps deployed from other repositories are absent on purpose — an env payload",
    "# cannot be built for a compose file this repo does not contain.",
    "# ==============================================================================",
    "",
    `story: ${PREFIX}`,
    `repo: aisha/${PREFIX}-orchestrator`,
    "branch: main",
    "",
    ...apps.map((a) => `app: ${a.name}:${a.placement}:${a.compose}`),
    "",
  ].join("\n");

  const OUT = join(ROOT, "coolify/manifests", `${PREFIX}.manifest`);

  if (PRINT) { process.stdout.write(body); process.exit(0); }

  if (CHECK) {
    if (!existsSync(OUT)) { console.error(`MISSING: ${OUT}\n  Fix: node scripts/gen-instance-manifest.mjs`); process.exit(1); }
    if (readFileSync(OUT, "utf8") !== body) { console.error(`STALE: ${OUT}\n  Fix: node scripts/gen-instance-manifest.mjs`); process.exit(1); }
    console.log(`${OUT} is in sync (${apps.length} apps).`);
    process.exit(0);
  }

  writeFileSync(OUT, body);
  console.log(`Wrote ${OUT} — ${apps.length} apps for instance '${PREFIX}'.`);
  if (unknown.length) console.log(`  placement defaulted to 'frontend' (katalog compose nezná) for: ${unknown.join(", ")}`);
}
