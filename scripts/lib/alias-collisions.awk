# alias-collisions.awk — jeden domov pravidla „co je kolize aliasu".
#
# Vstup:  <kontejner>\t<alias>   (jeden řádek za každý alias každého kontejneru)
# Výstup: <alias>\t<kontejner,kontejner,…>   jen pro aliasy s VÍC KONTEJNERY
#
# PROČ VLASTNÍ SOUBOR: pravidlo čte `scripts/cold-start-doctor.sh` a měří ho
# brána `alias-kolize-je-po-kontejnerech`. Dva opisy téhož awk by se rozešly
# a brána by pak potvrzovala svou vlastní kopii, ne to, co doktor dělá.
#
# ⛔ NAMĚŘENO 2026-08-15 na talosu: Docker vypíše týž kontejner pro jeden alias
# OPAKOVANĚ — alias se rovná jeho jménu i hostname. Počítání ŘÁDKŮ proto
# hlásilo kolizi kontejneru sama se sebou (`ok404sgo4kswk…` třikrát). Kolize je
# víc RŮZNÝCH kontejnerů na jednom jméně, nic jiného.

BEGIN { FS = "\t"; OFS = "\t" }

# Prázdné řádky nejsou měření.
$1 == "" || $2 == "" { next }

# Dvojice (alias, kontejner) se započítá jen jednou.
#
# ⛔ PORTABILITA, naměřeno 2026-08-15 v CI: dřív tu stálo
#     drzitel[$2] = ($2 in drzitel ? drzitel[$2] "," $1 : $1)
# a to je NEPŘENOSNÉ. V mawk i busybox awk (tedy na Linuxu, kde tenhle skript
# běží) reference `drzitel[$2]` uvnitř výrazu prvek VYTVOŘÍ, takže test
# `$2 in drzitel` je pravdivý UŽ U PRVNÍHO záznamu a výsledek začne prázdným
# držitelem:  `X→,a,b`  místo  `X→a,b`. Na macOS awk to vyšlo správně, takže
# lokálně bylo zeleno a spadlo to až v CI.
#
# Rozhoduje proto POČÍTADLO, ne dotaz na pole, které se právě plní.
# `pocet[$2]++` vrátí u prvního výskytu 0 (nenastavené == 0) ve všech awk.
!((($2 SUBSEP $1) in videno)) {
  videno[$2 SUBSEP $1] = 1
  if (pocet[$2]++ == 0) drzitel[$2] = $1
  else drzitel[$2] = drzitel[$2] "," $1
}

END {
  for (alias in pocet)
    if (pocet[alias] > 1)
      print alias, drzitel[alias]
}
