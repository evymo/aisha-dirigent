/**
 * Repair the one git-config invariant our own tooling breaks.
 *
 * MĚŘENO 2026-08-04, třikrát po sobě selhal push:
 *   `git submodule update --init --recursive`, který preflight pouští v čerstvém
 *   linked worktree, přepsal `.git/config` NADPROJEKTU a nastavil `bare = true`.
 *   Od té chvíle `git rev-parse --is-inside-work-tree` vrací `false` a `git grep`
 *   končí `fatal: this operation must be run in a work tree`.
 *
 *   Následek: brány, které si univerzum HLEDAJÍ přes git (legacy-domains,
 *   anthropic-body-builder, dockerignore-vs-dockerfile-copy a další), spadly —
 *   a `pre-push` odmítl push kvůli „regresi", kterou si sám právě vyrobil.
 *   Ruční `npm run test:gates` přitom hlásil 6303/6303 zeleně, protože se pouštěl
 *   BEZ toho kroku. Zelená a červená se střídaly podle toho, co běželo předtím.
 *
 * Poznávací znak té vady: `git status`, `commit` i `ls-files` fungují dál —
 * selže JEN `git grep`. Proto se to nepozná běžnou prací a vypadá to jako vada
 * v kódu, který se s bránami vůbec nepotkal.
 *
 * Tenhle modul tvrdí jediné: **repozitář, který má pracovní strom, nesmí být
 * označený jako bare.** Neptá se, kdo to rozbil — kontroluje vlastnost a
 * opravuje ji, hlasitě.
 *
 * @module
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Git's location variables, which every git HOOK exports.
 *
 * MĚŘENO 2026-08-05: pod `pre-push` je `GIT_DIR` nastavený, a protože se git
 * volal se zděděným prostředím, `rev-parse` odpovídal za NĚJ — ne za adresář v
 * argumentu. Nad linked worktree to znamenalo, že se `root` ignoroval: funkce
 * ohlásila „strom není pracovní" o cizím adresáři a `core.bare false` zapsala
 * do configu NADPROJEKTU. Push tak nešel odbavit z žádného worktree.
 *
 * Je to tatáž třída, proti které tenhle modul vznikl — okolní hodnota řídí běh —
 * jen o patro níž. Argument musí být autorita, takže se tyhle proměnné odstraní.
 */
const GIT_LOCATION_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
];

/** Prostředí bez git lokace — `cwd` je pak jediný zdroj pravdy o repozitáři. */
export function envWithoutGitLocation(env = process.env) {
  const clean = { ...env };
  for (const key of GIT_LOCATION_ENV) delete clean[key];
  return clean;
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: envWithoutGitLocation(),
  }).trim();
}

/**
 * Je tenhle adresář pracovním stromem? Ptáme se SOUBORŮ, ne konfigurace —
 * konfigurace je právě to, čemu nevěříme.
 */
function looksLikeWorkTree(dir) {
  return existsSync(join(dir, 'package.json')) || existsSync(join(dir, '.gitmodules'));
}

/**
 * Vrátí `{ repaired, before, after }`. `repaired: true` znamená, že config
 * tvrdil bare nad stromem, který bare není, a bylo to opraveno.
 *
 * Idempotentní: nad zdravým repozitářem nic nemění a nic nehlásí.
 */
export function ensureNotBare(root) {
  let insideWorkTree;
  try {
    insideWorkTree = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch (err) {
    // Není to git repo (nebo git chybí) — tenhle modul nemá co opravovat.
    // Důvod se VRACÍ, nepolyká se: volající si sám rozhodne, jestli je to
    // v jeho kontextu v pořádku, ale nikdy se to nedozví „nic".
    return {
      repaired: false,
      before: null,
      after: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (insideWorkTree) return { repaired: false, before: 'false', after: 'false' };
  if (!looksLikeWorkTree(root)) {
    // Skutečně bare repozitář. Opravit ho by byla škoda, ne oprava.
    return { repaired: false, before: 'true', after: 'true' };
  }

  git(root, ['config', 'core.bare', 'false']);
  const after = git(root, ['rev-parse', '--is-inside-work-tree']);
  return { repaired: true, before: 'true', after };
}
