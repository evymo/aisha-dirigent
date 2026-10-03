/**
 * sql-comments.mjs — SQL bez komentářů. JEDEN domov pro pravidlo „rozhoduj o KÓDU".
 *
 * ⛔ NAMĚŘENO 2026-09-16: TŘI nezávislé detektory (`scripts/db/db-manager/access.mjs`,
 * brána `idor-prevention`, test `src/tests/security/auth-security.test.ts`) hledaly
 * `SECURITY DEFINER` a stráže v SUROVÉM textu souboru — tedy i v komentářích.
 * Funkce, která PŘESTALA být definer a v hlavičce to vysvětlovala větou
 * „ZÁMĚRNĚ BEZ SECURITY DEFINER", byla nahlášena jako definer bez stráže.
 *
 * ⭐ OPAČNÝ SMĚR JE HORŠÍ A TIŠŠÍ: stráž zmíněná jen v komentáři
 * (`-- ověřuje is_admin_or_staff`) prošla všemi třemi jako stráž v KÓDU, takže
 * skutečná díra zůstala nenalezená. Proto se to opravuje v detektoru, ne
 * přeformulováním komentáře — a na jednom místě, ne třikrát.
 *
 * Řetězce zůstávají: `--` uvnitř apostrofů komentář nezačíná (a `''` je escape).
 */
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < sql.length) {
    const c = sql[i];
    if (inString) {
      out += c;
      if (c === "'") {
        if (sql[i + 1] === "'") { out += sql[i + 1]; i += 2; continue; }
        inString = false;
      }
      i++;
      continue;
    }
    if (c === "'") { inString = true; out += c; i++; continue; }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
