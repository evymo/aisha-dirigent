#!/usr/bin/env node
/**
 * refresh-baseline-from-main — VŽDY na začátku: vzít odvozené artefakty
 * z aktuálního mainu a přegenerovat ze sloučených zdrojů.
 *
 * PROČ TO NENÍ ŘEŠENÍ KONFLIKTU
 * ------------------------------
 * `00000000000000_baseline.sql` a `baseline-meta.json` jsou ODVOZENÉ z
 * `aisha/db/sql/**`. PR, který čeká, zatímco přistane jiný, tím pádem
 * ZÁKONITĚ stojí na starší baseline — ne omylem, ale z definice. Konflikt
 * není vada, kterou je třeba vyřešit; je to symptom toho, že v PR vezeme
 * artefakt proti pohyblivému cíli.
 *
 * Proto se to neřeší, až když se ozve. Řeší se VŽDY a NA ZAČÁTKU:
 *
 *     1. odvozené soubory = verze z mainu   (nikdy je needitovat ani merge-ovat)
 *     2. přegenerovat ze ZDROJŮ             (ty git slučuje normálně, nesou význam)
 *
 * Měřeno 2026-07-30, proč nestačí reagovat na konflikt: když baseline změní
 * jen JEDNA strana, git ji vezme beze změny a merge projde ZELENĚ — s baseline
 * zastaralou vůči právě sloučeným zdrojům. Tichá varianta téhož rozporu je
 * horší než hlučná; procedura pokrývá obě, reakce na konflikt jen jednu.
 *
 * Použití (na začátku aktualizace PR, PŘED řešením čehokoli jiného):
 *   node scripts/db/refresh-baseline-from-main.mjs            # výchozí: upstream větve, jinak origin/main
 *   node scripts/db/refresh-baseline-from-main.mjs --ref X    # jiný cíl
 *   node scripts/db/refresh-baseline-from-main.mjs --check    # jen ověř, nezapisuj
 */
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
// Referenční větev je INSTANČNÍ údaj — jméno remote se liší instalaci od
// instalace (fork se jmenuje jinak u každé instance). Generický kanál ho
// nesmí znát: bere se z --ref, z AISHA_BASELINE_REF, jinak z upstreamu
// sledovaného aktuální větví, a teprve nakonec z neutrálního origin/main.
const trackedUpstream = () => {
  try {
    return execFileSync("git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd: ROOT, encoding: "utf8" }).trim() || "";
  } catch { return ""; }
};
const REF = argv.includes("--ref")
  ? argv[argv.indexOf("--ref") + 1]
  : (process.env.AISHA_BASELINE_REF || trackedUpstream() || "origin/main");

/** Odvozené artefakty — nikdy se needitují ani neslučují textově. */
const DERIVED = [
  "aisha/db/migrations/00000000000000_baseline.sql",
  "aisha/db/baseline-meta.json",
];

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf-8" }).trim();

// 1) Odvozené soubory vzít z mainu. Ne proto, že je main „správnější", ale
//    protože obsah stejně vznikne znovu z kroku 2 — jde jen o to, aby výchozí
//    bod nebyl starší strom.
if (!CHECK) {
  try {
    git("checkout", REF, "--", ...DERIVED);
    console.log(`1/2  odvozené artefakty ← ${REF}`);
  } catch (err) {
    console.error(`! nelze vzít ${DERIVED.join(", ")} z ${REF}: ${err.message}`);
    console.error(`  (je ${REF} stažený? zkus: git fetch ${REF.split("/")[0]} ${REF.split("/").slice(1).join("/")})`);
    process.exit(1);
  }
}

// 2) Přegenerovat ze ZDROJŮ, které git normálně sloučil.
try {
  execFileSync(process.execPath, [resolve(ROOT, "scripts/db/generate-init-migration-from-sources.mjs")], {
    cwd: ROOT,
    stdio: CHECK ? "pipe" : "inherit",
  });
} catch (err) {
  console.error("! regenerace selhala — oprav ZDROJE v aisha/db/sql/, ne artefakt");
  console.error(String(err?.stderr || err?.message || err));
  process.exit(1);
}

// 3) Ověřit vlastnost, ne krok: sedí artefakt se zdroji?
//    `refreshed_at` v meta je razítko, ne obsah — na rozpor se neptáme jím.
const dirty = git("status", "--porcelain", "--", DERIVED[0]);
if (CHECK) {
  if (dirty) {
    console.error("⛔ baseline NEODPOVÍDÁ zdrojům — spusť bez --check");
    process.exit(1);
  }
  console.log("✅ baseline odpovídá aisha/db/sql/**");
} else {
  console.log(dirty ? "2/2  baseline přegenerována (změnila se)" : "2/2  baseline beze změny");
}
