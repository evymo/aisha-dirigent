#!/usr/bin/env node
/**
 * gen-definer-search-path-baseline.mjs — snímek dluhu brány `definer-search-path`.
 *
 * Pouští se JEN po legitimním úbytku (funkce dostala `pg_temp` na konec cesty, odkazy
 * kvalifikaci nebo zmizela). Brána sama hlídá, že snímek neroste; kdo ho přegeneruje
 * kvůli nové funkci, obchází ji — novou funkci oprav, nepřidávej do dluhu.
 *
 *   node scripts/gen-definer-search-path-baseline.mjs
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zmerDefinery } from "./lib/definer-search-path.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CIL = path.join(ROOT, "src/tests/gates/definer-search-path.baseline.json");
const m = zmerDefinery(ROOT);
const snimek = {
  _note:
    "Dluh brány definer-search-path. Smí JEN klesat; nová funkce SECURITY DEFINER sem nepatří — má mít " +
    "search_path 'pg_catalog', 'public', 'pg_temp' a volání funkcí instance se schématem. " +
    "Po úbytku: node scripts/gen-definer-search-path-baseline.mjs",
  stinitelne: m.stinitelne,
  volani_bez_schematu: m.volaniBezSchematu,
  docasne_tabulky: m.docasne,
  nerozebrano: m.nerozebrano,
};
writeFileSync(CIL, `${JSON.stringify(snimek, null, 1)}\n`);
console.log(
  `definerů ${m.definery} · stínitelných ${m.stinitelne.length} · volání bez schématu ${m.volaniBezSchematu.length} · ` +
    `dočasných tabulek ${m.docasne.length} · nerozebráno ${m.nerozebrano.length} → ${path.relative(ROOT, CIL)}`,
);
