#!/usr/bin/env node
/**
 * ingest-drop-seam-report.mjs — píše ingest tam, kam se broker dívá?
 *
 * PROČ (2026-07-30)
 * ----------------
 * Drop-replay lane stojí na JEDNOM sdíleném místě: `local-ingest` do něj zapisuje
 * hotový bundle, `svc-source-broker` ho odtud čte a přehraje přes li_* RPC.
 * Platný tvar je pevná hostitelská cesta, kterou bindují OBA compose:
 *
 *     local-ingest:   ${LOCAL_INGEST_DROP_HOST_DIR} → /data/out/export
 *     source-broker:  ${LOCAL_INGEST_DROP_HOST_DIR} → /data/ingest-drop:ro
 *
 * Změřeno na živé instalaci: ingest psal do svého svazku `<uuid>_ingest-out`,
 * broker četl hostitelskou cestu — dvě různá místa, protože nasazený kontejner
 * ingestu byl z doby PŘED zavedením toho bindu. Lane vypadala zapnutá a nic
 * neproteklo.
 *
 * Vada je TICHÁ: broker naběhne zdravý, `/sync/scheduler/trigger` odpoví ok,
 * jen `ingested: 0`. Proto tohle měřidlo — porovná, kam ingest PÍŠE, s tím,
 * odkud broker ČTE.
 *
 * POZOR na vlastní závěry: nejdřív jsem to označil za „Coolify nasazuje starou
 * kopii compose". Nebyla to pravda — git tu cestu skutečně obsahoval. Proto
 * sonda porovnává EFEKTIVNÍ zdroj, ne typ připojení, a rozdíl proti uložené
 * kopii hlásí zvlášť jako možnost, ne jako diagnózu.
 *
 * ČTE, NEMĚNÍ. Vyžaduje ssh na hostitele (docker inspect) + Coolify API.
 *
 * Použití:
 *   SSH_HOST=<ssh-alias> node scripts/ingest-drop-seam-report.mjs
 *   SSH_HOST=<ssh-alias> node scripts/ingest-drop-seam-report.mjs --json
 *
 * SSH_HOST je POVINNÝ a nemá default: jméno hostitele je identita INSTANCE,
 * a vestavěný default by tenhle diagnostický skript tiše mířil na cizí stack
 * (stejná třída vady jako APP_NAME_PREFIX natvrdo v deploy.yml).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveUuid } from "./lib/coolify-resolve-uuid.mjs";

const execFileP = promisify(execFile);
const JSON_OUT = process.argv.includes("--json");
const SSH_HOST = process.env.SSH_HOST;
if (!SSH_HOST) {
  console.error("FATAL: SSH_HOST není nastaven — řekni, na KTERÉHO hostitele se dívat (ssh alias). Default záměrně neexistuje: mířil by na cizí instanci.");
  process.exit(2);
}

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

async function ssh(cmd) {
  const { stdout } = await execFileP("ssh", ["-o", "BatchMode=yes", SSH_HOST, cmd], {
    timeout: 60_000,
    maxBuffer: 4 << 20,
  });
  return stdout.trim();
}

/**
 * Kam kontejner připojuje daný cíl — svazek NEBO bind.
 *
 * Rozlišení je nosné: bind nemá `.Name`, takže sonda, která hledá jen svazek,
 * vrátí prázdno a vypadá to jako „nenašel jsem" místo „je to bind".
 */
async function mountAt(containerGrep, destination) {
  const name = await ssh(
    `docker ps --format '{{.Names}}' | grep -E ${JSON.stringify(containerGrep)} | head -1`,
  );
  if (!name) return { container: null };
  const raw = await ssh(
    `docker inspect ${name} --format '{{range .Mounts}}{{if eq .Destination "${destination}"}}{{.Type}}|{{.Name}}|{{.Source}}|{{.RW}}{{end}}{{end}}'`,
  );
  if (!raw) return { container: name, mount: null };
  const [type, volume, source, rw] = raw.split("|");
  return { container: name, mount: { type, volume, source, rw: rw === "true" } };
}

/**
 * Souhlasí compose v GITU s tím, co má Coolify uložené?
 *
 * `docker_compose_raw` má být surová kopie souboru z gitu, ale Coolify ji plní
 * SÁM na pozadí a přes API je READ-ONLY (PATCH → 422 „This field is not
 * allowed", zdokumentováno v coolify-story-init.sh). Zastará-li, deploy z ní
 * renderuje dál — takže commit v gitu je správný, nasazený soubor jiný, a nikde
 * není chyba.
 *
 * Změřeno 2026-07-30: repo deklaruje svazek od 26. 7. (commit 5e05b347), Coolify
 * drží verzi s bindem. PATCH `docker_compose_location` na tutéž hodnotu nové
 * načtení NEVYVOLÁ.
 */
async function storedComposeDiffers(appUuid, localPath) {
  const url = process.env.COOLIFY_URL || process.env.COOLIFY_API;
  const token = process.env.COOLIFY_API_TOKEN;
  if (!url || !token || !appUuid) return null;
  const res = await fetch(`${url}/api/v1/applications/${appUuid}`, {
    headers: { Authorization: `Bearer ${token}` },
    // Bez timeoutu by měřidlo umělo viset na nedostupném API — a čekání bez
    // konce je horší než hlasité „nevím".
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => {
    // Hlásit, ne spolknout: nedostupné API znamená „nevím", ne „nesouhlasí".
    // Tichý null by z chybějícího měření udělal závěr.
    console.error(`  (Coolify API nedostupné, srovnání s uloženou kopií vynecháno: ${e.message})`);
    return null;
  });
  if (!res?.ok) return null;
  const stored = (await res.json())?.docker_compose_raw ?? "";
  const { readFileSync } = await import("node:fs");
  let local = "";
  try { local = readFileSync(localPath, "utf8"); } catch { return null; }
  const key = (s) => (s.match(/^\s*-\s*['"]?[^'"\n]*:\/data\/ingest-drop:ro/m) ?? [""])[0].trim();
  return { storedMount: key(stored), gitMount: key(local), differs: key(stored) !== key(local) };
}

async function main() {
  // Kam PÍŠE ingest: jeho výstupní svazek. Jméno je projektové (Coolify přidává
  // <uuid>_), takže se odvozuje z uuid apky — nehádá se z prefixu instance.
  // Identita instance se NEHÁDÁ. Fallback na konkrétní jméno by byl instanční
  // literál v generickém kanálu (split-rule-gate to chytil na mém vlastním
  // prvním pokusu) a hlavně: špatný odhad by hledal svazek CIZÍ instance —
  // přesně vada, kterou tenhle report měří.
  const prefix = (process.env.APP_NAME_PREFIX || "").trim();
  if (!prefix) {
    console.error(
      "ingest-drop-seam-report: APP_NAME_PREFIX není nastaven.\n" +
      "  Bez identity instance nelze určit, které apce local-ingest svazek patří.\n" +
      "  Deklaruj ho (env / .env.coolify) — odhad by mířil na cizí instanci.",
    );
    process.exit(2);
  }
  const ingestUuid = await resolveUuid(`${prefix}-local-ingest`).catch((e) => {
    console.error(`  (uuid apky ${prefix}-local-ingest se nepodařilo zjistit: ${e.message})`);
    return null;
  });
  // `-mesh-ingress` MUSÍ vypadnout: sidecar se jmenuje `local-ingest-mesh-ingress-<uuid>`
  // a regexu `^local-ingest-[a-z0-9]` odpovídá stejně dobře jako služba sama.
  // První pokus proto jako writer označil sidecar, který `/data/out` vůbec nemá —
  // sonda pak hlásila „bez mountu" místo skutečného svazku.
  // Sdílený bod je `/data/out/export` (tam ingest bundly ukládá), ne `/data/out`
  // — to je jeho vlastní pracovní svazek a s brokerem nemá nic společného.
  const writer = await mountAt("^local-ingest-[a-z0-9]+$|^local-ingest-[a-z0-9]{20,}-", "/data/out/export");
  const reader = await mountAt("source-broker", "/data/ingest-drop");

  const expected = ingestUuid ? `${ingestUuid}_ingest-out` : null;
  // Porovnává se EFEKTIVNÍ zdroj, ne typ připojení: platný tvar lane je jedna
  // sdílená hostitelská cesta, kterou bindují OBA (docs/compose-notes). Sonda,
  // která hledala jen shodu svazků, hlásila rozpor i u správného návrhu.
  const srcOf = (m) => (m ? m.volume || m.source || null : null);
  const writerSrc = srcOf(writer.mount);
  const readerSrc = srcOf(reader.mount);
  const agree = Boolean(writerSrc && readerSrc && writerSrc === readerSrc);

  if (JSON_OUT) {
    console.log(JSON.stringify({ ingestUuid, expected, writer, reader, agree }, null, 2));
    return;
  }

  console.log(C.bold("\nDrop lane — píše ingest tam, kam se broker dívá?\n"));
  console.log(`  ${C.bold("ingest PÍŠE")}   ${writer.container ?? C.red("kontejner nenalezen")}`);
  if (writer.mount) {
    console.log(`    ${writer.mount.type}  ${writer.mount.volume || writer.mount.source}`);
  }
  console.log(`  ${C.bold("broker ČTE")}    ${reader.container ?? C.red("kontejner nenalezen")}`);
  if (reader.mount) {
    console.log(`    ${reader.mount.type}  ${reader.mount.volume || reader.mount.source}` +
      (reader.mount.type === "bind" ? C.dim("   ← bind, ne svazek") : ""));
  }

  // Druhá strana téhož švu: i když env i git souhlasí, Coolify může nasazovat
  // ze své STARÉ kopie compose. Bez tohohle porovnání vypadá vada jako
  // „proměnná se nedoručila", a hledá se na špatném místě.
  const brokerUuid = reader.container?.match(/-([a-z0-9]{20,})-\d+$/)?.[1] ?? null;
  const drift = await storedComposeDiffers(
    brokerUuid,
    "docker-compose.coolify-source-broker.yml",
  );
  if (drift?.differs) {
    console.log(`\n  ${C.red("Coolify nasazuje ze STARÉ kopie compose")} ${C.dim("(docker_compose_raw je read-only, plní ho sám)")}`);
    console.log(`    git    : ${drift.gitMount || "(nenalezeno)"}`);
    console.log(`    Coolify: ${drift.storedMount || "(nenalezeno)"}`);
    console.log(C.dim(`    → dokud se nepřečte znovu z gitu, oprava v repu se NEPROJEVÍ`));
  }

  console.log();
  if (agree) {
    console.log(`  ${C.green("SOUHLASÍ")} — bundle z ingestu se brokeru objeví bez přenášení.`);
  } else {
    console.log(`  ${C.red("ROZCHÁZÍ SE")} — ingest píše jinam, než broker čte; lane neproteče.`);
    if (expected) {
      console.log(`\n  Zdroje se liší — zkontroluj, že OBA compose bindují touž cestu:`);
      console.log(`    ${C.bold("LOCAL_INGEST_DROP_HOST_DIR")} ${C.dim("(derive-domains ji odvozuje z identity instance)")}`);
      console.log(C.dim(`\n  Fallback v compose (aisha_local-ingest-out) je jméno CIZÍ instance`));
      console.log(C.dim(`  a na tomhle hostiteli neexistuje — proto Coolify připojil bind.`));
    } else {
      console.log(C.red(`\n  uuid apky local-ingest se nepodařilo zjistit — bez něj jméno svazku neurčím.`));
    }
  }
  console.log();
}

main().catch((e) => {
  console.error(`ingest-drop-seam-report: ${e.message}`);
  process.exit(1);
});
