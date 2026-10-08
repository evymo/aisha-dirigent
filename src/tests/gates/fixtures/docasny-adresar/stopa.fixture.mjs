// Fixture brány testy-uklidi-docasne-adresare: test, který po sobě NEUKLIDÍ —
// založí dočasný adresář sám i přes podproces (skript v node, který dědí TMPDIR)
// a kam je založil, zapíše do souboru, který mu podá brána.
import { test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("nechá po sobě dočasné adresáře", () => {
  const vlastni = mkdtempSync(join(tmpdir(), "stopa-"));
  writeFileSync(join(vlastni, "soubor"), "x");
  const zPodprocesu = execFileSync(
    process.execPath,
    ["-e", "const{mkdtempSync}=require('node:fs');const{tmpdir}=require('node:os');const{join}=require('node:path');process.stdout.write(mkdtempSync(join(tmpdir(),'podproces-')))"],
    { encoding: "utf8" },
  );
  writeFileSync(process.env.STOPA_ZAPIS, JSON.stringify({ tmp: tmpdir(), vlastni, zPodprocesu }));
});
