#!/usr/bin/env bash
# deploy-vetev-odchylka.sh — JEDEN DOMOV měření „deploy větev mimo main nese důvod".
#
# Volá ho cold-start doktor (fáze E) a brána `deploy-vetev-odchylka-nese-duvod`
# ho spouští nad dočasnými repozitáři. Verdikty vydává přes funkce volajícího
# `ok` / `warn` / `fail` — doktor je má, brána si je podvrhne.
#
# Použití:  . scripts/lib/deploy-vetev-odchylka.sh
#           deploy_vetev_odchylka <git repozitář> <manifest>
deploy_vetev_odchylka() {
  local repo="$1" manifest="$2"
  local lib_dir; lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local _deploy_branch _deklarovany _mira _mira_remote _duvod _cil _rn _ru _rr _tip _pr _pr_text _navic
  local _vyklad _vyklad_rc=0 _nas _nas_rc=0 _nas_remote _tip_duvod _chyby
  local _klic _hodnota _manifest_upstream=""
  # ── DEPLOY VĚTEV: ODCHYLKA MUSÍ NÉST DŮVOD ────────────────────────────────
  #
  # Manifest smí deklarovat jinou deploy větev než `main` — krok 2b2 si ji z něj
  # bere a měří vlastnost „nasadím, co jsem validoval", ne konkrétní jméno. Je to
  # legitimní způsob, jak instance ponese dočasnou odchylku (třeba opravu čekající
  # na slití do upstreamu), aniž by se delta schovala do historie platformního forku.
  #
  # ⛔ JENŽE DOČASNOST JE TVRZENÍ, KTERÉ NIKDO NEMĚŘÍ. Až se odchylka slije, větev
  # nenese nic — a nasazovat z ní dál znamená stavět ze stavu, který nikdo
  # neaktualizuje, zatímco `main` se hýbe. Ta chvíle nastane TIŠE.
  #
  # Měří se proto VLASTNOST, ne stáří. Brána vázaná na „N dní" je nedeterministická
  # (dnes zelená, zítra červená bez jediné změny) a N je libovůle. Měřitelné je
  # „odchylka už nic nenese": tip deploy větve je PŘEDKEM upstreamu. Tehdy je
  # prokazatelně zbytečná → ČERVENÁ. Dokud něco navíc nese, je to deklarovaná
  # odchylka → hlasité VAROVÁNÍ s výčtem, ne tichá zelená.
  #
  # Bez měřítka (nefetchnutý upstream, fork bez remote) je to NEZMĚŘENO a
  # fail-closed: zelená bez měřidla je horší než červená, protože se jí věří.
  #
  # ⛔ VĚTEV VYKLÁDÁ JEDEN DOMOV (nedůvěřivé čtení 2026-10-03, nálezy 1d a 2). Vlastní
  # awk tady četl deklaraci třetím pravidlem (první výskyt, bez komentářů, bez
  # odsazení): nad týmž manifestem viděl jinou větev než story-init, který ji do
  # Coolify zapisuje. Větev proto dává lib/nasazovany-repozitar.mjs — týž výklad
  # jako krok 2b2 a story-init. Nevyložitelná deklarace je NEZMĚŘENO, ne `main`.
  # Totéž platí pro upstream a odkaz na PR, které odchylku ruší: i ty dva klíče
  # vykládá pomocník (týmiž pravidly), žádné čtení manifestu tu nezůstalo.
  #
  # Odpověď pomocníka je stdout; chybový výstup jde ZVLÁŠŤ (do souboru) a čte se jen
  # jako důvod selhání. Slitý dohromady by cizí řádek na stderr vyšel jako jméno větve.
  _chyby="$(mktemp)"
  _vyklad="$(node "$lib_dir/nasazovany-repozitar.mjs" --manifest "$manifest" --vyklad 2>"$_chyby")" || _vyklad_rc=$?
  if [[ "$_vyklad_rc" -ne 0 ]]; then
    fail "deploy větev NEZMĚŘENO — deklaraci manifestu nejde vyložit (kód ${_vyklad_rc}): $(tr '\n' ' ' < "$_chyby"). Bez větve se o odchylce nedá rozhodnout, a zelená bez měřidla by se četla jako 'je to v pořádku'."
    rm -f "$_chyby"
    return 0
  fi
  # První řádek výkladu: větev a repozitář. Další řádky: nepovinné klíče, které
  # manifest deklaruje (`<klíč>\t<hodnota>`); chybějící klíč není chyba.
  _pr=""
  {
    IFS=$'\t' read -r _deploy_branch _
    while IFS=$'\t' read -r _klic _hodnota; do
      case "$_klic" in
        upstream_repo) _manifest_upstream="$_hodnota" ;;
        upstream_pr)   _pr="$_hodnota" ;;
      esac
    done
  } <<< "$_vyklad"
  if [[ -z "$_deploy_branch" ]]; then
    fail "deploy větev NEZMĚŘENO — výklad deklarace vrátil prázdnou větev ('${_vyklad}')."
    rm -f "$_chyby"
    return 0
  fi
  if [[ "$_deploy_branch" == "main" ]]; then
    ok "deploy větev: main — bez odchylky"
  else
    # ⛔ MĚŘÍTKO SE VYBÍRÁ PODLE URL, NE PODLE JMÉNA REMOTE. `upstream`,
    # `upstream-forgejo` a spol. jsou ZVYKLOST, ne vlastnost: ve forku může
    # `upstream` ukazovat na mezifork a brána by pak měřila proti cizímu stromu —
    # a o větvi, která něco nese, řekla „už nic nenese". Identita repozitáře je
    # v URL (scripts/lib/git-origin.mjs::originRepo, tentýž normalizátor, ne druhý).
    #
    # Upstream repo se DEKLARUJE, nehádá: AISHA_UPSTREAM_REPO → `upstream_repo:`
    # v manifestu. Nic z toho = NEZMĚŘENO. Zapsat sem literál platformy by byl
    # týž omyl o úroveň výš: fork nad forkem má jiného rodiče.
    #
    # ⛔ FORGEJO_REPO SEM NEPATŘÍ (naměřeno 2026-09-25 na <fork>). Je to repo,
    # ZE KTERÉHO Coolify staví — u forku fork sám. Jako měřítko by porovnávalo
    # odchylku proti vlastnímu `main`, tedy ne proti tomu, kam se má slít.
    # Samostatný doktor ho v prostředí neměl a vyšel správně; uvnitř cold-startu,
    # který env načítá, by měřil proti forku. Týž vstup, dva verdikty.
    _deklarovany="${AISHA_UPSTREAM_REPO:-$_manifest_upstream}"
    _mira=""; _mira_remote=""; _duvod=""
    if [[ -z "$_deklarovany" ]]; then
      _duvod="upstream repo není deklarované (AISHA_UPSTREAM_REPO / upstream_repo: v manifestu)"
    else
      # Deklarace i URL všech remote se normalizují JEDNÍM voláním Nodu (řádek
      # na hodnotu, 1. řádek = deklarace). Bez `mapfile`: macOS má bash 3.2.
      local _jmena _urls _normy _i=0
      _jmena="$(git -C "$repo" remote 2>/dev/null || true)"
      _urls=""
      while IFS= read -r _rn; do
        [[ -z "$_rn" ]] && continue
        _urls+="$(git -C "$repo" remote get-url "$_rn" 2>/dev/null || true)"$'\n'
      done <<< "$_jmena"
      _normy="$(printf '%s' "$_urls" | { args=("$_deklarovany"); while IFS= read -r _u; do args+=("${_u:-neni-url}"); done; node "$lib_dir/git-origin.mjs" --repo "${args[@]}" "" 2>/dev/null; } || true)"
      _cil="$(printf '%s\n' "$_normy" | sed -n 1p)"
      [[ -z "$_cil" ]] && _cil="$(printf '%s' "$_deklarovany" | tr 'A-Z' 'a-z')"
      while IFS= read -r _rn; do
        [[ -z "$_rn" ]] && continue
        _i=$((_i+1))
        _rr="$(printf '%s\n' "$_normy" | sed -n "$((_i+1))p")"
        # shoda buď celá (host/org/repo), nebo na org/repo, když deklarace hostitele nenese
        if [[ -n "$_rr" && ( "$_rr" == "$_cil" || "$_rr" == */"$_cil" ) ]]; then
          git -C "$repo" rev-parse --verify -q "${_rn}/main" >/dev/null 2>&1 \
            && { _mira="${_rn}/main"; _mira_remote="$_rn"; break; }
        fi
      done <<< "$_jmena"
      [[ -z "$_mira" ]] && _duvod="žádný remote neodpovídá deklarovanému upstreamu '${_deklarovany}' (nebo nemá fetchnutý main); remoty: $(git -C "$repo" remote 2>/dev/null | tr '\n' ' ')"
    fi
    # ⛔ TIP DEPLOY VĚTVE SE BERE Z REPOZITÁŘE, ZE KTERÉHO COOLIFY STAVÍ — ne ze jména
    # remote a ne z místní větve téhož jména (nález 2). Ve fork checkoutu ukazuje
    # zvykové jméno remote na upstream a místní větev je jen to, co má operátor zrovna
    # u sebe: obojí odpovídá na jinou otázku než „co nese větev, ze které se staví".
    # Remote vybírá týž pomocník podle IDENTITY URL nasazovaného repozitáře (bez sítě)
    # a čte se jeho sledovací reference. Žádný odpovídající remote nebo chybějící
    # reference = NEZMĚŘENO, stejně jako chybějící měřítko výš.
    _tip=""; _tip_duvod=""
    _nas="$(node "$lib_dir/nasazovany-repozitar.mjs" --manifest "$manifest" --repo-root "$repo" --remote 2>"$_chyby")" || _nas_rc=$?
    if [[ "$_nas_rc" -ne 0 ]]; then
      _tip_duvod="tip větve '${_deploy_branch}' nemám odkud vzít — $(tr '\n' ' ' < "$_chyby")"
    else
      IFS=$'\t' read -r _nas_remote _ <<< "$_nas"
      _tip="$(git -C "$repo" rev-parse --verify -q "refs/remotes/${_nas_remote}/${_deploy_branch}^{commit}" 2>/dev/null || true)"
      [[ -z "$_tip" ]] && _tip_duvod="sledovací reference '${_nas_remote}/${_deploy_branch}' nasazovaného repozitáře neexistuje (git fetch ${_nas_remote}); místní větev téhož jména měřítkem není"
    fi
    # Volitelné pole manifestu (odkaz na PR, přečtený výš z výkladu): text do hlášky,
    # NE podmínka. Kdo ví, které PR odchylku ruší, ať to nemusí hledat v hlavě.
    _pr_text=""; [[ -n "$_pr" ]] && _pr_text=" Ruší ji: ${_pr}."
    if [[ -z "$_mira" || -z "$_tip" ]]; then
      fail "deploy větev '${_deploy_branch}' NEZMĚŘENO — $([[ -z "$_mira" ]] && echo "$_duvod" || echo "$_tip_duvod"). Bez měřítka se o odchylce nedá rozhodnout, a zelená bez měřidla by se četla jako 'je to v pořádku'."
    elif git -C "$repo" merge-base --is-ancestor "$_tip" "$_mira" 2>/dev/null; then
      fail "deploy větev '${_deploy_branch}' UŽ NIC NENESE — je předkem ${_mira}, odchylka je slitá a tím zbytečná. Přepni 'branch:' v manifestu zpět na main, jinak nasazuješ ze stavu, který se přestal hýbat.${_pr_text}"
    else
      _navic="$(git -C "$repo" rev-list --count "${_mira}..${_tip}" 2>/dev/null || echo "?")"
      warn "deploy větev '${_deploy_branch}' nese ${_navic} commit(ů) navíc proti ${_mira} — DEKLAROVANÁ ODCHYLKA, ne závada.${_pr_text}"
      # `--max-count`, ne `| head`: pod pipefail by `head` zavřel rouru dřív, než
      # git dopíše, a git by dostal SIGPIPE (ráčna roura-do-predcasneho-ctenare).
      # Omezit výstup má ten, kdo ho vyrábí.
      git -C "$repo" log --max-count=10 --oneline "${_mira}..${_tip}" 2>/dev/null | sed 's/^/      /'
    fi
  fi
  rm -f "$_chyby"
}
