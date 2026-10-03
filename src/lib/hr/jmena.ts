import type { OsobaBezUctu, UcetHr } from "@/hooks/useHrLideUcty";

/** Jméno účtu pro zobrazení: jméno, jinak e-mail, jinak id. */
export function jmenoUctu(u: Pick<UcetHr, "jmeno" | "email" | "user_id">): string {
  return u.jmeno || u.email || u.user_id;
}

/** Jméno osoby pro zobrazení: popisek twinu, jinak jeho id. */
export function jmenoOsoby(o: Pick<OsobaBezUctu, "twin_label" | "twin_id">): string {
  return o.twin_label || o.twin_id;
}

/** Výchozí hledání úlomků: nejdelší slovo jména (u „KOŽUŠNÍK Petr" příjmení, bez „p." a SPZ). */
export function vychoziHledani(jmeno: string): string {
  const slova = jmeno.split(/[^\p{L}]+/u).filter((s) => s.length >= 3);
  return slova.sort((a, b) => b.length - a.length)[0] ?? "";
}
