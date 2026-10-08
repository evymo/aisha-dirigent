/**
 * git-origin.mjs — odkud tenhle strom pochází, bez přihlašovacích údajů.
 *
 * PROČ (naměřeno 2026-08-13): doctor čekal deklaraci `FORGEJO_URL`. Ta chyběla,
 * takže se kontrola dosažitelnosti Forgeja „přeskočila" s warningem — přestože
 * Coolify staví VŠECH 37 aplikací té instance právě z toho Forgeja. Přeskočená
 * kontrola nad povinnou závislostí je mlčení, ne úspěch.
 *
 * Původ je přitom po ruce: `git remote` ho drží vždycky a je to TÁŽ adresa,
 * ze které staví Coolify. Deklarace, kterou nikdo nevyplní, je ozdoba —
 * odvození je odpověď.
 *
 * ⛔ KTERÝ remote (nedůvěřivé čtení 2026-10-03, nález 3): „táž adresa“ platí jen
 * pro remote, který JE nasazovaný repozitář. Zvykové jméno to nezaručuje — ve fork
 * checkoutu ukazuje na upstream. Remote proto vybírá volající podle identity
 * (lib/nasazovany-repozitar.mjs --remote) a sem předává už jeho adresu; tenhle
 * modul URL jen rozebírá, o výběru remote nerozhoduje.
 *
 * BEZPEČNOST: Coolify má v `git_repository` uloženo `https://user:<token>@host/…`
 * a týž tvar se objevuje i v remote URL. Hostitel se proto vrací BEZ údajů —
 * tahle hodnota jde do logu cold-startu.
 */

/**
 * Vytáhne `scheme://host` z URL gitového remote. Podporuje oba tvary, kterými
 * git remote bývá zapsaný, a přihlašovací údaje zahazuje.
 *
 * @param {string} remoteUrl hodnota z `git remote get-url <jméno>`
 * @returns {string} `scheme://host` (u SSH tvaru `https://host`), nebo "" když to není URL
 */
/**
 * Normalizuje remote URL na `host/org/repo` — tvar, ve kterém se dvě adresy
 * téhož repozitáře POROVNAJÍ bez ohledu na to, jak je kdo zapsal.
 *
 * ⛔ PROČ NE PODLE JMÉNA REMOTE. `upstream`, `upstream-forgejo` a podobná jména
 * jsou ZVYKLOST, ne vlastnost: ve forku může `upstream` ukazovat na mezifork a
 * měření proti němu vydá nepravdivý výsledek (typicky „už nic nenese" o větvi,
 * která nese). Identita repozitáře je v URL, ne ve jméně.
 *
 * Zahazuje přihlašovací údaje, `.git`, koncové lomítko i velikost písmen, takže
 * `https://oauth2:TOKEN@host/Org/Repo.git` a `git@host:org/repo` vyjdou stejně.
 *
 * @param {string} remoteUrl hodnota z `git remote get-url <jméno>`
 * @returns {string} `host/org/repo`, nebo "" když to není rozpoznatelné URL
 */
export function originRepo(remoteUrl) {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return "";
  let host = "", cesta = "";
  const url = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(raw);
  if (url) { host = url[1]; cesta = url[2]; }
  else {
    const scp = /^(?:[^@/]+@)?([^@/:]+):(?!\/)(.+)$/.exec(raw);
    if (!scp) return "";
    host = scp[1]; cesta = scp[2];
  }
  // Pořadí ZÁLEŽÍ: lomítka první, jinak `…​.git/` projde kolem `\.git$`.
  cesta = cesta.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").replace(/\/+$/g, "");
  if (!cesta) return "";
  return `${host.toLowerCase()}/${cesta.toLowerCase()}`;
}

export function originHost(remoteUrl) {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return "";

  // scheme://[user[:token]@]host[:port]/cesta
  const url = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/@]*@)?([^/:]+)(:\d+)?(?:\/|$)/i.exec(raw);
  if (url) return `${url[1].toLowerCase()}://${url[2]}${url[3] || ""}`;

  // scp-like: [user@]host:cesta — git ho bere jako SSH, my se ptáme na HTTP tvář
  const scp = /^(?:[^@/]+@)?([^@/:]+):(?!\/)/.exec(raw);
  if (scp) return `https://${scp[1]}`;

  return "";
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Aby se shell ptal téhle jediné implementace místo vlastního sed výrazu.
import { isDirectRun } from "./cli-entry.mjs";
// „Spustili mě přímo?" má jeden domov: lib/cli-entry.mjs. Porovnává SKUTEČNÉ
// cesty (realpath), ne řetězce — jinak stačí symlink nebo git worktree, blok se
// TIŠE přeskočí a volající dostane prázdný výstup s kódem 0, který si vyloží
// jako měření. Přesně to se 2026-08-14 stalo doctoru u subnetů.
if (isDirectRun(import.meta.url)) {
  // `--repo <url>` vydá `host/org/repo` (identita repozitáře), bez něj `scheme://host`.
  // Víc hodnot = jeden řádek na hodnotu (nerozpoznaná = prázdný řádek), kód 0:
  // volající tak normalizuje deklaraci i všechny remoty JEDNÍM spuštěním Nodu.
  if (process.argv[2] === "--repo") {
    const vstupy = process.argv.slice(3);
    if (vstupy.length > 1) {
      process.stdout.write(vstupy.map((v) => originRepo(v)).join("\n") + "\n");
      process.exit(0);
    }
    const repo = originRepo(vstupy[0] ?? "");
    if (repo) { process.stdout.write(repo + "\n"); process.exit(0); }
    process.exit(1);
  }
  const host = originHost(process.argv[2] ?? "");
  if (!host) process.exit(1);
  process.stdout.write(host + "\n");
}
