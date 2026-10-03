#!/usr/bin/env bash
# =============================================================================
# scripts/infra/create-netseg.sh — Phase 12 WP 3.4
# =============================================================================
#
# Idempotently create the 3 Docker networks for AISHA stack segmentation.
#
# Run on each Coolify host BEFORE deploying stacks that use
# docker-compose.coolify.netseg.yml as an overlay.
#
# Idempotency: `docker network create` errors when the network already
# exists. We swallow that one specific error and treat any other failure
# as fatal.
#
# Per-zone subnet plan — ODVOZENÝ Z IDENTITY, ne z tabulky v komentáři:
#   generate-secrets.mjs::deriveSubnets(deployPrefix) hashuje identitu instance
#   do vyhrazeného poolu 10.176.0.0/12 a vydá čtyři sousední /24 (frontend /
#   backend / data / mesh-dns) jako NETSEG_*_SUBNET a MESH_DNS_SUBNET.
#
# Proč odvozovat: do 2026-08-09 tu stála pevná trojice v 172.30-32/24. Dvě
# instance na jednom hostu tedy dostaly TÝŽ subnet (kolize), a třetí zóna
# navíc NENÍ RFC1918 — blok 172.16/12 končí ve 172.31, takže data-zóna
# sahala do veřejného rozsahu. Pool 10.176/12 je uvnitř RFC1918 a míjí
# Docker default bridge (172.17/16), Coolify síť (172.18-19), NetBird
# (100.64/10) i typickou LAN (192.168/16).
#
# Override: pool i konkrétní subnety patří do instančního manifestu, ne sem —
# tenhle skript je jen doručovatel. Kolizi s cizí sítí na hostu odhalí
# `docker network create` (fatálně), duplicitu/RFC1918 hlídá doctor.
#
# Per `feedback_no_workarounds_rewrite_dont_remove`: never delete or
# recreate an existing network — that would disconnect every running
# container attached to it. Subnet changes require a maintenance window.

set -euo pipefail

# Položka = `jméno:subnet:zóna`. Zóna je vlastní pole, ne useknuté jméno:
# štítek se dřív počítal jako `${name##aisha-}`, což u instančního jména
# (`<prefix>-frontend-net`) neusekne nic a do štítku uloží celé jméno.
#
# POŘADÍ POLÍ JE KONTRAKT, ne kosmetika: brána
# compose-external-network-exists čte tenhle skript jako důkaz, že externí síť
# někdo zakládá, a páruje ji podle PROMĚNNÉ na začátku položky
# (`/^\s*"\$\{([A-Za-z_]\w*)/`). Zóna proto patří na KONEC — s `zóna:` vepředu
# brána přestane vidět zakládaného tvůrce a 26 stacků spadne na „promise nobody
# keeps" (změřeno 2026-08-10).
#
# POZOR na `:?` hlášky — jsou to PROSA, ne hodnoty. Vnořené `${…}` se v nich
# rozvine až ve chvíli, kdy hláška padá, takže pod `set -u` operátor uvidí
# „deployPrefix: unbound variable" MÍSTO příčiny (změřeno 2026-08-10). Do
# hlášek proto jen literální text.
readonly NETWORKS=(
  # Jména I subnety mají JEDEN domov: generate-secrets (NETSEG_*_NET /
  # NETSEG_*_SUBNET, odvozené z identity instance). Žádný literální default:
  # dřívější `172.30-32.0.0/24` byla instanční kolizní past (dvě instance = týž
  # subnet) a 172.32.0.0/24 navíc NENÍ RFC1918 (veřejný rozsah). `:?` = chybějící
  # doručení musí být vidět, ne zalátané odhadem.
  "${NETSEG_FRONTEND_NET:?NETSEG_FRONTEND_NET musí dodat generate-secrets (odvozeno z identity instance)}:${NETSEG_FRONTEND_SUBNET:?NETSEG_FRONTEND_SUBNET musí dodat generate-secrets (deriveSubnets)}:frontend"
  "${NETSEG_BACKEND_NET:?NETSEG_BACKEND_NET musí dodat generate-secrets}:${NETSEG_BACKEND_SUBNET:?NETSEG_BACKEND_SUBNET musí dodat generate-secrets}:backend"
  "${NETSEG_DATA_NET:?NETSEG_DATA_NET musí dodat generate-secrets}:${NETSEG_DATA_SUBNET:?NETSEG_DATA_SUBNET musí dodat generate-secrets}:data"
  # mesh-DNS síť tu ZÁMĚRNĚ NENÍ (odstraněna 2026-08-10).
  #
  # Zakládá si ji COMPOSE (`networks.mesh-dns` v docker-compose.coolify-*.yml),
  # a proto ji tenhle skript vytvořit NESMÍ: síť z `docker network create` nemá
  # labely `com.docker.compose.*`, takže jakmile ji compose považuje za svou,
  # každý stack umře na `network ... has incorrect label ... set to ""`.
  # Naměřeno na živém hostu 2026-08-10 (compose v2.38) — týž pokus vedle sebe:
  # síť z compose jiného projektu projde s varováním, síť z CLI shodí deploy.
  #
  # Netseg zóny níže zůstávají: ty compose deklaruje jako `external: true`
  # (overlay se přikládá přes `-f`), takže u nich je předvytvoření správné.
)

log() {
  echo "[netseg] $*" >&2
}

create_one() {
  local zone="$1" name="$2" subnet="$3"
  # Check if network exists
  if docker network inspect "$name" >/dev/null 2>&1; then
    local existing_subnet
    existing_subnet=$(docker network inspect "$name" -f '{{ range .IPAM.Config }}{{ .Subnet }}{{ end }}')
    if [[ "$existing_subnet" == "$subnet" ]]; then
      log "ok: $name already exists with subnet $subnet"
    else
      log "WARN: $name exists with subnet '$existing_subnet' but expected '$subnet' (skip — recreating would disconnect running containers; coordinate manually)"
    fi
    return 0
  fi

  log "creating $name (zone $zone, subnet $subnet)"
  # ŽÁDNÝ `--opt com.docker.network.bridge.name`: jméno linuxového rozhraní je
  # omezeno na 15 znaků (IFNAMSIZ=16 včetně NUL). Změřeno 2026-08-10 —
  # `abcdefghijklmno` (15) projde, `abcdefghijklmnop` (16) padá na
  # „numerical result out of range". Dřívější `${name//-/_}` dávalo
  # `aisha_frontend_net` (18) → tenhle skript nemohl založit ANI PRVNÍ síť,
  # a s instančním prefixem by se limit vešel jen prefixu do 2 znaků.
  # Docker si bez opt zvolí vlastní `br-<12hex>` (přesně 15) a čitelnost
  # zůstává ve štítcích níž — ty délkou omezené nejsou.
  docker network create \
    --driver=bridge \
    --subnet="$subnet" \
    --label "aisha.netseg.zone=${zone}" \
    --label "aisha.netseg.created_by=create-netseg.sh" \
    "$name" >/dev/null
  log "ok: created $name"
}

main() {
  if ! command -v docker >/dev/null 2>&1; then
    log "ERROR: docker CLI not found on PATH"
    exit 1
  fi

  log "Phase 12 WP 3.4 — Docker network segmentation"
  for entry in "${NETWORKS[@]}"; do
    # `jméno:subnet:zóna` — ani jméno, ani subnet, ani zóna dvojtečku neobsahují.
    local name="${entry%%:*}"
    local zone="${entry##*:}"
    local rest="${entry#*:}"
    local subnet="${rest%:*}"
    create_one "$zone" "$name" "$subnet"
  done
  log "done — ${#NETWORKS[@]} sítí připraveno (3 zóny + mesh-dns resolver)"
  log ""
  log "next step: redeploy svc-plugin-system stack with"
  log "  -f docker-compose.coolify.yml -f docker-compose.coolify.netseg.yml"
}

main "$@"
