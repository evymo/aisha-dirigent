#!/usr/bin/env bash
# kc-modelovy-mesh.sh — klienti Keycloaku pro MODELOVÝ mesh forku (varianta C,
# aisha.decision 2026-10-05 03:17:54Z). Zdrojuje ho scripts/provision-sso.sh.
#
# PROČ NE ŠABLONA REALMU: `keycloak/aisha-realm.json` se importuje na KAŽDÝ nový realm,
# takže by privilegovaný servisní účet `netbird-model-backend` vznikl i forkům bez
# modelového meshe; reconcile-realm-clients klienty záměrně nezakládá. Klienti proto
# vznikají TADY a jen s lane MODEL_MESH (model forku na GPU slotu).
#
# NEJMENŠÍ OPRÁVNĚNÍ A ODDĚLENÉ MESHE (bezpečnostní revize 2026-10-05, tři kola):
#   · klienti modelového meshe (`netbird-model`, `netbird-model-backend`,
#     `netbird-model-bootstrap`) patří JEN této knihovně — jejich BEZPEČNOSTNÍ vlastnosti
#     se proto SROVNÁVAJÍ (i u klienta, který vznikl dřív nebo ho někdo upravil): device
#     grant vypnutý, fullScopeAllowed false, žádné nepovolené audience, servisní účet jen
#     čte uživatele. Srovnává se jen směrem k MENŠÍMU oprávnění a výsledek ověří zpětné čtení;
#   · token pro modelový mesh razí VLASTNÍ klient `netbird-model-bootstrap` (týž bootstrap
#     uživatel = týž vlastník účtu) a nese JEN audienci `netbird-model` — nikdy `netbird`,
#     takže ho hlavní mesh nepřijme; a naopak `aisha-bootstrap` (hlavní mesh) audienci
#     `netbird-model` nenese: pozůstatky dřívějších verzí (přímý mapper, scope) se odeberou;
#   · servisní účet `netbird-model-backend` (IdP manager) audienci modelového meshe nenese
#     vůbec — jeho tokenem se do API managementu nepřihlásí (nárok na vlastnictví účtu).
#
# Závislosti od volajícího (provision-sso.sh): kc_api, kc_code, set_client_secret,
# ok/info/warn/fail, REALM. Funkce tu nic z prostředí nedosazují — co chybí, je chyba.

KC_MODEL_AUDIENCE="netbird-model"
KC_MODEL_AUDIENCE_SCOPE_STARY="netbird-model-audience"   # jen k odstranění (verze 0d38a1939)

# uuid klienta podle clientId (prázdné = neexistuje; selhaný dotaz = návrat 1)
kc_uuid_klienta() {
  local client_id="$1" listing
  if ! listing=$(kc_api GET "/admin/realms/${REALM}/clients?clientId=${client_id}"); then
    fail "Klient '${client_id}': na Keycloak se nepodařilo zeptat (HTTP $(kc_code)) — o realmu nevíme nic"
    return 1
  fi
  printf '%s' "$listing" | jq -e 'type == "array"' >/dev/null 2>&1 || { fail "Klient '${client_id}': odpověď není seznam — NEOVĚŘENO"; return 1; }
  printf '%s' "$listing" | jq -r '.[0].id // empty' 2>/dev/null
}

# Reprezentace klienta podle uuid (objekt; jinak návrat 1)
kc_klient() {
  local uuid="$1" rep
  rep=$(kc_api GET "/admin/realms/${REALM}/clients/${uuid}") || { fail "Klient ${uuid}: reprezentaci nejde načíst (HTTP $(kc_code))"; return 1; }
  printf '%s' "$rep" | jq -e 'type == "object" and has("clientId")' >/dev/null 2>&1 || { fail "Klient ${uuid}: odpověď není klient — NEOVĚŘENO"; return 1; }
  printf '%s' "$rep"
}

# Klient modelového meshe: založit, když chybí (existující se v BEZPEČNOSTNÍCH vlastnostech
# srovná funkcemi níž, jinak se nepřepisuje).
kc_zajisti_klienta() {
  local client_id="$1" reprezentace="$2" uuid
  uuid=$(kc_uuid_klienta "$client_id") || return 1
  if [[ -n "$uuid" ]]; then
    ok "Klient '${client_id}' existuje — srovnají se jen bezpečnostní vlastnosti"
    return 0
  fi
  if kc_api POST "/admin/realms/${REALM}/clients" "$reprezentace" >/dev/null || [[ "$(kc_code)" == "409" ]]; then
    uuid=$(kc_uuid_klienta "$client_id") || return 1
    [[ -n "$uuid" ]] || { fail "Klient '${client_id}': založení ohlášeno, ale v realmu NENÍ"; return 1; }
    ok "Klient '${client_id}' založen"
    return 0
  fi
  fail "Klient '${client_id}' se nepodařilo založit (HTTP $(kc_code))"
  return 1
}

# Bezpečnostní vlastnosti klienta modelového meshe: device grant vypnutý, fullScopeAllowed
# false. Srovná (PUT celé reprezentace — částečnou KC ignoruje) a ověří zpětným čtením.
kc_srovnej_klienta() {
  local client_id="$1" uuid rep nova
  uuid=$(kc_uuid_klienta "$client_id") || return 1
  [[ -n "$uuid" ]] || { fail "Klient '${client_id}' neexistuje"; return 1; }
  rep=$(kc_klient "$uuid") || return 1
  if printf '%s' "$rep" | jq -e '.fullScopeAllowed == true or (.attributes["oauth2.device.authorization.grant.enabled"] // "false") == "true"' >/dev/null 2>&1; then
    nova=$(printf '%s' "$rep" | jq -c '.fullScopeAllowed = false | .attributes["oauth2.device.authorization.grant.enabled"] = "false"')
    warn "Klient '${client_id}': srovnávám bezpečnostní vlastnosti (device grant vypnout, fullScopeAllowed false)"
    kc_api PUT "/admin/realms/${REALM}/clients/${uuid}" "$nova" >/dev/null || true
    rep=$(kc_klient "$uuid") || return 1
  fi
  if printf '%s' "$rep" | jq -e '.fullScopeAllowed == true or (.attributes["oauth2.device.authorization.grant.enabled"] // "false") == "true"' >/dev/null 2>&1; then
    fail "Klient '${client_id}': device grant nebo fullScopeAllowed zůstaly ZAPNUTÉ i po srovnání — NEPOKRAČUJI"
    return 1
  fi
  ok "Klient '${client_id}': device grant vypnutý, fullScopeAllowed false (C1, nejmenší oprávnění)"
}

# Audience mappery klienta = PŘESNĚ povolená množina (prázdná = žádný). Nepovolené se odeberou,
# chybějící povolená se přidá; ověří se zpětným čtením.
kc_srovnej_audience() {
  local client_id="$1" povolena="$2" uuid mappers id telo
  uuid=$(kc_uuid_klienta "$client_id") || return 1
  [[ -n "$uuid" ]] || { fail "Klient '${client_id}' neexistuje"; return 1; }
  mappers=$(kc_api GET "/admin/realms/${REALM}/clients/${uuid}/protocol-mappers/models") || { fail "Klient '${client_id}': mappery nejde načíst (HTTP $(kc_code))"; return 1; }
  printf '%s' "$mappers" | jq -e 'type == "array"' >/dev/null 2>&1 || { fail "Klient '${client_id}': mappery nejsou seznam — NEOVĚŘENO"; return 1; }
  for id in $(printf '%s' "$mappers" | jq -r --arg a "$povolena" '.[] | select(.protocolMapper == "oidc-audience-mapper"
             and ((.config["included.custom.audience"] // .config["included.client.audience"] // "") != $a or $a == "")) | .id'); do
    warn "Klient '${client_id}': odebírám nepovolený audience mapper ${id}"
    kc_api DELETE "/admin/realms/${REALM}/clients/${uuid}/protocol-mappers/models/${id}" >/dev/null || true
  done
  if [[ -n "$povolena" ]] && ! printf '%s' "$mappers" | jq -e --arg a "$povolena" \
       'any(.[]; .protocolMapper == "oidc-audience-mapper" and .config["included.custom.audience"] == $a)' >/dev/null 2>&1; then
    telo=$(jq -nc --arg a "$povolena" '{name: ($a + "-audience"), protocol: "openid-connect", protocolMapper: "oidc-audience-mapper",
      config: {"included.custom.audience": $a, "id.token.claim": "false", "access.token.claim": "true"}}')
    kc_api POST "/admin/realms/${REALM}/clients/${uuid}/protocol-mappers/models" "$telo" >/dev/null || [[ "$(kc_code)" == "409" ]] || true
  fi
  mappers=$(kc_api GET "/admin/realms/${REALM}/clients/${uuid}/protocol-mappers/models") || { fail "Klient '${client_id}': mappery po srovnání nejde načíst"; return 1; }
  if ! printf '%s' "$mappers" | jq -e --arg a "$povolena" '
       type == "array"
       and ([.[] | select(.protocolMapper == "oidc-audience-mapper") | (.config["included.custom.audience"] // .config["included.client.audience"] // "")]
            == (if $a == "" then [] else [$a] end))' >/dev/null 2>&1; then
    fail "Klient '${client_id}': audience po srovnání NESEDÍ (povolena: '${povolena:-žádná}') — token by mohl platit jinde, než smí"
    return 1
  fi
  ok "Klient '${client_id}': audience = ${povolena:-žádná}"
}

# Pozůstatek dřívější verze: scope s audiencí modelového meshe na cizím klientovi → odebrat.
kc_odeber_stary_scope() {
  local client_id="$1" scope="$2" uuid scopes scope_id druh seznam
  uuid=$(kc_uuid_klienta "$client_id") || return 1
  [[ -n "$uuid" ]] || return 0
  scopes=$(kc_api GET "/admin/realms/${REALM}/client-scopes") || { fail "Client scopes nejde načíst (HTTP $(kc_code))"; return 1; }
  scope_id=$(printf '%s' "$scopes" | jq -r --arg n "$scope" 'if type == "array" then ([.[] | select(.name == $n)][0].id // empty) else empty end')
  [[ -n "$scope_id" ]] || return 0
  for druh in optional default; do
    kc_api DELETE "/admin/realms/${REALM}/clients/${uuid}/${druh}-client-scopes/${scope_id}" >/dev/null || true
    seznam=$(kc_api GET "/admin/realms/${REALM}/clients/${uuid}/${druh}-client-scopes") || { fail "Klient '${client_id}': ${druh} scopes nejde načíst"; return 1; }
    if printf '%s' "$seznam" | jq -e --arg i "$scope_id" 'type != "array" or any(.[]; .id == $i)' >/dev/null 2>&1; then
      fail "Klient '${client_id}': scope '${scope}' je pořád mezi ${druh} — audience by se dala vyžádat mimo modelový bootstrap"
      return 1
    fi
  done
  ok "Klient '${client_id}': pozůstatek scope '${scope}' odebrán"
}

# Servisní účet JEN pro čtení uživatelů: chybějící view-users/query-users přidá, jakoukoli
# další roli realm-management ODEBERE (i z dřívější verze); ověří zpětným čtením.
kc_srovnej_sa_jen_cteni() {
  local client_id="$1" uuid sa rm dostupne pridat prirazene navic
  uuid=$(kc_uuid_klienta "$client_id") || return 1
  [[ -n "$uuid" ]] || { fail "Klient '${client_id}' neexistuje — role nemá komu dát"; return 1; }
  sa=$(kc_api GET "/admin/realms/${REALM}/clients/${uuid}/service-account-user" | jq -r 'if type == "object" then (.id // empty) else empty end' 2>/dev/null)
  [[ -n "$sa" ]] || { fail "Klient '${client_id}': servisní účet nenalezen (HTTP $(kc_code))"; return 1; }
  rm=$(kc_uuid_klienta realm-management) || return 1
  [[ -n "$rm" ]] || { fail "realm-management nenalezen — role nejde ověřit"; return 1; }
  prirazene=$(kc_api GET "/admin/realms/${REALM}/users/${sa}/role-mappings/clients/${rm}") || { fail "Klient '${client_id}': role nejde přečíst"; return 1; }
  navic=$(printf '%s' "$prirazene" | jq -c '[.[]? | select(.name != "view-users" and .name != "query-users") | {id, name}]' 2>/dev/null)
  if [[ -n "$navic" && "$navic" != "[]" ]]; then
    warn "Klient '${client_id}': odebírám nadbytečné role realm-management: $(printf '%s' "$navic" | jq -r '[.[].name] | join(", ")')"
    kc_api DELETE "/admin/realms/${REALM}/users/${sa}/role-mappings/clients/${rm}" "$navic" >/dev/null || true
  fi
  dostupne=$(kc_api GET "/admin/realms/${REALM}/users/${sa}/role-mappings/clients/${rm}/available") || { fail "Klient '${client_id}': dostupné role nejde načíst"; return 1; }
  pridat=$(printf '%s' "$dostupne" | jq -c '[.[]? | select(.name == "view-users" or .name == "query-users") | {id, name}]' 2>/dev/null)
  if [[ -n "$pridat" && "$pridat" != "[]" ]]; then
    kc_api POST "/admin/realms/${REALM}/users/${sa}/role-mappings/clients/${rm}" "$pridat" >/dev/null || true
  fi
  prirazene=$(kc_api GET "/admin/realms/${REALM}/users/${sa}/role-mappings/clients/${rm}") || { fail "Klient '${client_id}': role po srovnání nejde přečíst — NEOVĚŘENO"; return 1; }
  if ! printf '%s' "$prirazene" | jq -e 'type == "array" and ([.[].name] | sort) == ["query-users", "view-users"]' >/dev/null 2>&1; then
    fail "Klient '${client_id}': role po srovnání NESEDÍ (smí jen view-users + query-users): $(printf '%s' "$prirazene" | jq -r '[.[]?.name] | join(", ")' 2>/dev/null)"
    return 1
  fi
  ok "Klient '${client_id}': servisní účet jen čte uživatele (view-users, query-users)"
}

# Všichni klienti modelového meshe. Volat JEN s lane MODEL_MESH.
#   $1 veřejné jméno řídicí roviny (NETBIRD_MODEL_DOMAIN), $2 tajemství klienta správy,
#   $3 tajemství servisního účtu IdP manageru, $4 tajemství bootstrap klienta modelového meshe.
kc_zajisti_klienty_modeloveho_meshe() {
  local domena="$1" tajemstvi_spravy="$2" tajemstvi_sa="$3" tajemstvi_bootstrap="$4"
  [[ -n "$domena" && -n "$tajemstvi_spravy" && -n "$tajemstvi_sa" && -n "$tajemstvi_bootstrap" ]] || {
    fail "Modelový mesh: chybí NETBIRD_MODEL_DOMAIN nebo tajemství klientů — nic se nezakládá"
    return 1
  }
  # Správa (dashboard): jako hlavní `netbird`, ale BEZ device grantu a bez localhost.
  kc_zajisti_klienta netbird-model "$(jq -nc --arg d "$domena" '{
    clientId: "netbird-model", name: "NetBird — modelový mesh (správa)", enabled: true,
    publicClient: false, standardFlowEnabled: true, directAccessGrantsEnabled: false,
    implicitFlowEnabled: false, serviceAccountsEnabled: false, fullScopeAllowed: false,
    redirectUris: ["https://\($d)/*"], webOrigins: ["https://\($d)"],
    attributes: {"post.logout.redirect.uris": "https://\($d)/*", "oauth2.device.authorization.grant.enabled": "false"},
    defaultClientScopes: ["openid", "email", "profile", "groups"],
    protocolMappers: [{name: "realm-role-mapper", protocol: "openid-connect", protocolMapper: "oidc-usermodel-realm-role-mapper",
      config: {multivalued: "true", "claim.name": "roles", "jsonType.label": "String",
               "id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true"}}]}')" || return 1
  kc_srovnej_klienta netbird-model || return 1
  kc_srovnej_audience netbird-model "$KC_MODEL_AUDIENCE" || return 1
  set_client_secret netbird-model "$tajemstvi_spravy" || return 1
  # IdP manager managementu: servisní účet BEZ audience, jen čte uživatele.
  kc_zajisti_klienta netbird-model-backend "$(jq -nc '{
    clientId: "netbird-model-backend", name: "NetBird — modelový mesh (IdP manager, jen čtení)", enabled: true,
    publicClient: false, standardFlowEnabled: false, directAccessGrantsEnabled: false,
    implicitFlowEnabled: false, serviceAccountsEnabled: true, fullScopeAllowed: false,
    defaultClientScopes: ["openid", "profile"]}')" || return 1
  kc_srovnej_klienta netbird-model-backend || return 1
  kc_srovnej_audience netbird-model-backend "" || return 1
  set_client_secret netbird-model-backend "$tajemstvi_sa" || return 1
  kc_srovnej_sa_jen_cteni netbird-model-backend || return 1
  # Bootstrap modelové instance: VLASTNÍ klient (ROPC bootstrap uživatele), token nese JEN
  # audienci netbird-model — hlavní mesh ho nepřijme, a naopak.
  kc_zajisti_klienta netbird-model-bootstrap "$(jq -nc '{
    clientId: "netbird-model-bootstrap", name: "NetBird — modelový mesh (bootstrap, jen audience netbird-model)", enabled: true,
    publicClient: false, standardFlowEnabled: false, directAccessGrantsEnabled: true,
    implicitFlowEnabled: false, serviceAccountsEnabled: false, fullScopeAllowed: false,
    defaultClientScopes: ["openid"]}')" || return 1
  kc_srovnej_klienta netbird-model-bootstrap || return 1
  kc_srovnej_audience netbird-model-bootstrap "$KC_MODEL_AUDIENCE" || return 1
  set_client_secret netbird-model-bootstrap "$tajemstvi_bootstrap" || return 1
  # Hlavní bootstrap klient (`aisha-bootstrap`) NESMÍ nést audienci modelového meshe:
  # odebrat pozůstatky dřívějších verzí (scope i přímý mapper) a ověřit.
  kc_odeber_stary_scope aisha-bootstrap "$KC_MODEL_AUDIENCE_SCOPE_STARY" || return 1
  kc_odeber_audienci aisha-bootstrap "$KC_MODEL_AUDIENCE" || return 1
}

# Odebere z klienta (cizího — např. aisha-bootstrap) audience mapper JEDNÉ dané audience
# a ověří; ostatní mappery klienta nechá být.
kc_odeber_audienci() {
  local client_id="$1" audience="$2" uuid mappers id
  uuid=$(kc_uuid_klienta "$client_id") || return 1
  [[ -n "$uuid" ]] || return 0
  mappers=$(kc_api GET "/admin/realms/${REALM}/clients/${uuid}/protocol-mappers/models") || { fail "Klient '${client_id}': mappery nejde načíst"; return 1; }
  for id in $(printf '%s' "$mappers" | jq -r --arg a "$audience" '.[]? | select(.protocolMapper == "oidc-audience-mapper"
             and (.config["included.custom.audience"] // .config["included.client.audience"] // "") == $a) | .id'); do
    warn "Klient '${client_id}': odebírám audience '${audience}' (pozůstatek — token by platil i v modelovém meshi)"
    kc_api DELETE "/admin/realms/${REALM}/clients/${uuid}/protocol-mappers/models/${id}" >/dev/null || true
  done
  mappers=$(kc_api GET "/admin/realms/${REALM}/clients/${uuid}/protocol-mappers/models") || { fail "Klient '${client_id}': mappery po odebrání nejde načíst"; return 1; }
  if printf '%s' "$mappers" | jq -e --arg a "$audience" 'type != "array" or any(.[]; .protocolMapper == "oidc-audience-mapper"
       and (.config["included.custom.audience"] // .config["included.client.audience"] // "") == $a)' >/dev/null 2>&1; then
    fail "Klient '${client_id}': audience '${audience}' se nepodařilo odebrat — token by platil v obou meshích"
    return 1
  fi
  ok "Klient '${client_id}': audience '${audience}' nenese"
}
