# preflight-compose-pocet.awk — jeden domov pravidla „kolik stacků preflight ověřil".
#
# Vstup:  výstup `scripts/preflight-compose.sh` (i s ANSI barvami, jak ho skript tiskne)
# Výstup: jeden řádek  `ok=<N> fail=<M> celkem=<K>`
#         celkem = počet souborů, který preflight SÁM ohlásil
#         („preflight-compose: K file(s) …"); prázdné, když ten řádek chybí.
#
# PROČ VLASTNÍ SOUBOR: pravidlo čte `scripts/cold-start-doctor.sh` (fáze D) a měří
# ho brána `cold-start-doctor`. Dva opisy téhož počítání by se rozešly a brána by
# potvrzovala svou kopii, ne to, co doktor dělá (týž důvod jako alias-collisions.awk).
#
# ⛔ NAMĚŘENO 2026-09-13 na nasazené instanci: doktor hlásil „Compose validuje proti ČERSTVĚ
# sestavenému envu (0 stacku)" nad během, ve kterém prošlo všech 34 souborů.
# Počítal `grep -cE "^   .*OK$"` — jenže preflight tiskne `echo -e "${G}OK${N}"`,
# řádek tedy končí `ESC[0m` a kotva `OK$` netrefí nikdy. Měřidlo, které nad zeleným
# výsledkem napočítá nulu, je slepé a nikdo si toho nevšimne, protože zelená zůstala.
#
# Barvy se proto stripují DŘÍV, než se cokoli porovnává, a vedle počtu se vydává
# i počet, který preflight ohlásil sám — nesoulad těch dvou je nález, ne nula.
#
# PORTABILITA: ESC se skládá přes sprintf("%c", 27), ne jako `\033` v regexu —
# oktalové escape v regex literálu se mezi awk implementacemi (BWK, mawk, busybox)
# chovají různě; dynamický regex ze stringu je chová stejně.

BEGIN { esc = sprintf("%c", 27); ok = 0; fail = 0; celkem = "" }

{
  radek = $0
  gsub(esc "\\[[0-9;]*m", "", radek)
  # Konec řádku bez CR (výstup přes docker na některých hostech nese \r).
  sub(/\r$/, "", radek)

  if (celkem == "" && radek ~ /preflight-compose: [0-9]+ file\(s\)/) {
    t = radek
    sub(/.*preflight-compose: /, "", t)
    sub(/ file\(s\).*/, "", t)
    celkem = t
  }
  # Řádek stacku: tři mezery, jméno souboru, mezera, verdikt na KONCI řádku.
  if (radek ~ /^   [^ ].* OK$/) ok++
  else if (radek ~ /^   [^ ].* FAIL$/) fail++
}

END { printf "ok=%d fail=%d celkem=%s\n", ok, fail, celkem }
