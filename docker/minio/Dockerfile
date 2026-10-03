# =============================================================================
# docker/minio/Dockerfile — MinIO server a klient `mc`, postavené ZE ZDROJE
# =============================================================================
# PROČ (plán A schválený majitelem 2026-09-25): MinIO obrazy už nikdo nevydává.
#   · Docker Hub `minio/*` smazán 2026-09-11,
#   · quay.io/minio/{minio,mc} od 2026-09-24 vrací 401 (i s anonymním tokenem),
#   · repozitář MinIO CE je archivovaný (AGPLv3).
# Každý fork proto staví obraz VE SVÉ Coolify pipeline — bez přístupu k našemu
# repu i registru — z NEMĚNNÉHO veřejného zdroje: Go module proxy
# (proxy.golang.org), zip ověřený proti checksum DB (sum.golang.org).
#
# VERZE JSOU PŘESNĚ TY, KTERÉ BĚŽÍ (žádná změna dat ani chování):
#   minio RELEASE.2025-09-07T16-13-09Z = github.com/minio/minio@v0.0.0-20250907161309-07c3a429bfed
#   mc    RELEASE.2025-08-13T08-35-41Z = github.com/minio/mc@v0.0.0-20250813083541-7394ce0dd2a8
#
# JEDINÝ DOMOV PINŮ = tenhle soubor: moduly jako výchozí ARG níž, základní obrazy
# jako digest ve FROM. Obraz se tak postaví i holým `docker build docker/minio`
# (fork bez našeho env, CI, lokál) a nic mimo soubor ho nemůže tiše přepsat.
# Brána: src/tests/gates/minio-obraz-ze-zdroje.gate.test.ts.
#
# BUILD KONTEXT = TENHLE ADRESÁŘ, ŽÁDNÝ COPY Z REPA. Zdroje jdou jen přes Go
# proxy, takže BuildKit cache přežije jakoukoli změnu repa (kontext se nemění).
#
# CÍLE:
#   minio  server (+ `mc`, jako upstream obraz quay.io/minio/minio) — výchozí
#   mc     klient + `storage-init` (jednorázové založení úložiště, viz níž)
# =============================================================================
ARG REGISTRY_PROXY=

# Tři fakta na modul; build-from-proxy je navzájem ověří (nejde povýšit jen jedno).
ARG MINIO_MODULE_VERSION=v0.0.0-20250907161309-07c3a429bfed
ARG MINIO_RELEASE_TAG=RELEASE.2025-09-07T16-13-09Z
ARG MINIO_COMMIT=07c3a429bfed433e49018cb0f78a52145d4bedeb
ARG MC_MODULE_VERSION=v0.0.0-20250813083541-7394ce0dd2a8
ARG MC_RELEASE_TAG=RELEASE.2025-08-13T08-35-41Z
ARG MC_COMMIT=7394ce0dd2a80935aded936b09fa12cbb3cb8096

# Toolchain: go.mod minia `go 1.24.0` / `toolchain go1.24.2`, mc `go 1.23.0` →
# poslední patch řady 1.24 (upstream Dockerfile.release staví na plovoucím
# `golang:1.24-alpine`; tady je týž řádek připnutý digestem). Běží na platformě
# BUILDERU a křížově kompiluje (CGO_ENABLED=0), takže amd64 obraz na arm64 stroji
# (a naopak) nekompiluje v emulaci.
FROM --platform=$BUILDPLATFORM ${REGISTRY_PROXY}library/golang:1.24.13-alpine3.23@sha256:8bee1901f1e530bfb4a7850aa7a479d17ae3a18beb6e09064ed54cfd245b7191 AS go
# Jen proxy, bez `,direct` (zdroj nikdy z VCS). GOSUMDB zůstává výchozí
# (sum.golang.org) — žádné GONOSUMDB/GONOSUMCHECK/GOPRIVATE/GOINSECURE.
ENV CGO_ENABLED=0 \
    GOFLAGS=-mod=readonly \
    GOPROXY=https://proxy.golang.org \
    GOTOOLCHAIN=local
WORKDIR /tmp
COPY --chmod=0755 <<'EOF' /usr/local/bin/build-from-proxy
#!/bin/sh
# build-from-proxy <modul> <pseudo-verze> <release-tag> <commit> [extra ldflags]
# Postaví main balík modulu MinIO tak, jak ho staví upstream vydání
# (Makefile + buildscripts/gen-ldflags.go s MINIO_RELEASE/MC_RELEASE=RELEASE).
# Výstup: /out/bin/<jméno>, /out/licenses/, /out/docker-entrypoint.sh (má-li ho modul).
set -eu
mod=$1 ver=$2 tag=$3 commit=$4
extra=${5:-}
name=${mod##*/}
fail() { echo "build-from-proxy($name): $*" >&2; exit 1; }

# 1) Tři piny musí mluvit o TÉŽE revizi.
short=$(printf '%s' "$commit" | cut -c1-12)
case "$ver" in v0.0.0-[0-9]*-"$short") ;; *) fail "pseudo-verze $ver nenese commit $short" ;; esac
cas=${ver#v0.0.0-}; cas=${cas%-*}
cas_tagu=$(printf '%s' "$tag" | sed -n 's/^RELEASE\.\([0-9]\{4\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)T\([0-9]\{2\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)Z$/\1\2\3\4\5\6/p')
[ -n "$cas_tagu" ] && [ "$cas" = "$cas_tagu" ] || fail "vydání $tag neodpovídá času commitu v $ver"

# 2) Zdroj z Go proxy; zip ověří sum.golang.org, Origin.Hash musí být pinovaný commit.
go mod download -json "$mod@$ver" > /tmp/mod.json || { cat /tmp/mod.json >&2; fail "go mod download selhal"; }
grep -q "\"Hash\": \"$commit\"" /tmp/mod.json || fail "proxy vydala $mod@$ver z jiné revize než $commit"
dir=$(sed -n 's/^[[:space:]]*"Dir": "\(.*\)",*$/\1/p' /tmp/mod.json)
[ -d "$dir" ] || fail "modul se nerozbalil"

# 3) ldflags jako gen-ldflags.go pro vydání: Version = čas vydání (RFC3339),
#    ReleaseTag = RELEASE.<čas>, CommitID celý, ShortCommitID = 12 znaků,
#    CopyrightYear = rok vydání.
version=$(printf '%s' "$tag" | sed 's/^RELEASE\.\(.*\)T\(..\)-\(..\)-\(..\)Z$/\1T\2:\3:\4Z/')
year=$(printf '%s' "$tag" | cut -c9-12)
pkg="$mod/cmd"
ldflags="-s -w -X $pkg.Version=$version -X $pkg.CopyrightYear=$year -X $pkg.ReleaseTag=$tag -X $pkg.CommitID=$commit -X $pkg.ShortCommitID=$short $extra"

# 4) Jako upstream Makefile: CGO_ENABLED=0, -tags kqueue, -trimpath; -mod=readonly
#    (GOFLAGS) = závislosti jen podle go.mod/go.sum modulu, nic se nedopočítá.
#    `go install <modul>@<verze>` (ne build v rozbalené kopii): buildinfo binárky
#    nese modul, pseudo-verzi a h1: součet — SBOM/sken zranitelností obrazu tak
#    MinIO pozná (kopie by se hlásila jako `(devel)`).
goos=${TARGETOS:-linux} goarch=${TARGETARCH:-$(go env GOARCH)}
GOOS=$goos GOARCH=$goarch go install -tags kqueue -trimpath -ldflags "$ldflags" "$mod@$ver"
gobin="$(go env GOPATH)/bin"
if [ "$goos/$goarch" != "$(go env GOHOSTOS)/$(go env GOHOSTARCH)" ]; then gobin="$gobin/${goos}_$goarch"; fi
mkdir -p /out/bin /out/licenses
mv "$gobin/$name" "/out/bin/$name"
cp "$dir/LICENSE" "$dir/CREDITS" /out/licenses/
if [ -f "$dir/dockerscripts/docker-entrypoint.sh" ]; then
  cp "$dir/dockerscripts/docker-entrypoint.sh" /out/docker-entrypoint.sh
  chmod 0755 /out/docker-entrypoint.sh
fi
# Vrstva nese jen výstup — cache sestavení a modulů (stovky MB) pryč.
rm -f /tmp/mod.json && go clean -cache -modcache
EOF

FROM go AS minio-build
ARG TARGETOS
ARG TARGETARCH
ARG MINIO_MODULE_VERSION
ARG MINIO_RELEASE_TAG
ARG MINIO_COMMIT
# GOPATH/GOROOT: gen-ldflags je bere z prostředí builderu (jen ořez cest v logu).
RUN build-from-proxy github.com/minio/minio "$MINIO_MODULE_VERSION" "$MINIO_RELEASE_TAG" "$MINIO_COMMIT" \
      "-X github.com/minio/minio/cmd.GOPATH=${GOPATH} -X github.com/minio/minio/cmd.GOROOT=${GOROOT:-}"

FROM go AS mc-build
ARG TARGETOS
ARG TARGETARCH
ARG MC_MODULE_VERSION
ARG MC_RELEASE_TAG
ARG MC_COMMIT
RUN build-from-proxy github.com/minio/mc "$MC_MODULE_VERSION" "$MC_RELEASE_TAG" "$MC_COMMIT"

# Běhový základ: oficiální obraz projektu curl (Alpine + curl + CA bundle),
# připnutý digestem — žádný balíčkovač při buildu, obraz je z neměnných vstupů.
# curl potřebuje healthcheck serveru (`curl …/minio/health/live`), /bin/sh
# healthcheck i storage-init. Běží jako root jako upstream obraz: existující
# svazky minio-data vlastní root.
FROM ${REGISTRY_PROXY}curlimages/curl:8.22.0@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777 AS runtime
USER root
WORKDIR /

FROM runtime AS mc
COPY --from=mc-build /out/bin/mc /usr/bin/mc
COPY --from=mc-build /out/licenses/ /licenses/mc/
# storage-init — JEDINÝ vstupní bod správy úložiště. Compose deklaruje CO
# (buckety, veřejné čtení, omezený klíč s politikou), skript JAK. Náhrada MinIO
# jiným úložištěm vymění tenhle obraz a skript jako celek; deklarace zůstane.
COPY --chmod=0755 <<'EOF' /usr/local/bin/storage-init
#!/bin/sh
# Vstup (env):
#   STORAGE_ADMIN_URL           http://<root>:<heslo>@<host>:<port>
#   STORAGE_BUCKETS             buckety k založení (oddělené bílým znakem)
#   STORAGE_PUBLIC_READ         podmnožina s anonymním čtením (download)
#   STORAGE_SCOPED_POLICY       jméno politiky omezeného klíče (prázdné = žádný)
#   STORAGE_SCOPED_POLICY_JSON  dokument politiky (S3 IAM JSON)
#   STORAGE_SCOPED_USER / STORAGE_SCOPED_SECRET  klíč, ke kterému se politika váže
# Kódy: 64 = politika bez klíče/dokumentu, 65 = klíč politiku po nastavení NEMÁ.
set -eu
: "${STORAGE_ADMIN_URL:?[storage-init] chybí STORAGE_ADMIN_URL}"
: "${STORAGE_BUCKETS:?[storage-init] chybí STORAGE_BUCKETS}"
# MC_HOST_<alias>, ne `mc alias set`: heslo začínající `-` by mc četl jako přepínač.
export MC_HOST_local="$STORAGE_ADMIN_URL"

for b in $STORAGE_BUCKETS; do mc mb "local/$b" --ignore-existing; done

if [ -n "${STORAGE_SCOPED_POLICY:-}" ]; then
  if [ -z "${STORAGE_SCOPED_USER:-}" ] || [ -z "${STORAGE_SCOPED_SECRET:-}" ] || [ -z "${STORAGE_SCOPED_POLICY_JSON:-}" ]; then
    echo "[storage-init] FATAL: politika $STORAGE_SCOPED_POLICY bez klíče nebo dokumentu (STORAGE_SCOPED_USER/SECRET/POLICY_JSON) — bez omezeného klíče by doprava sáhla na root." >&2
    exit 64
  fi
  printf '%s' "$STORAGE_SCOPED_POLICY_JSON" > /tmp/scoped-policy.json
  # create/attach (mc ≥ 2023), add/set (starší); rozhoduje ČTENÍ ZPĚT níž.
  mc admin policy create local "$STORAGE_SCOPED_POLICY" /tmp/scoped-policy.json 2>/dev/null || \
    mc admin policy add local "$STORAGE_SCOPED_POLICY" /tmp/scoped-policy.json 2>/dev/null || true
  mc admin user add local "$STORAGE_SCOPED_USER" "$STORAGE_SCOPED_SECRET" 2>/dev/null || true
  mc admin policy attach local "$STORAGE_SCOPED_POLICY" --user "$STORAGE_SCOPED_USER" 2>/dev/null || \
    mc admin policy set local "$STORAGE_SCOPED_POLICY" user="$STORAGE_SCOPED_USER" 2>/dev/null || true
  INFO="$(mc admin user info local "$STORAGE_SCOPED_USER" 2>&1 || true)"
  case "$INFO" in
    *"$STORAGE_SCOPED_POLICY"*) ;;
    *) echo "[storage-init] FATAL: klíč nemá politiku $STORAGE_SCOPED_POLICY: $INFO" >&2; exit 65 ;;
  esac
fi

for b in ${STORAGE_PUBLIC_READ:-}; do mc anonymous set download "local/$b"; done
echo "[storage-init] buckety a politiky nastaveny"
EOF
ENTRYPOINT ["mc"]

# Výchozí cíl (poslední stage). Prostředí, entrypoint, VOLUME i EXPOSE jako
# upstream Dockerfile.release — chování kontejneru se nemění.
FROM runtime AS minio
ENV MINIO_ACCESS_KEY_FILE=access_key \
    MINIO_SECRET_KEY_FILE=secret_key \
    MINIO_ROOT_USER_FILE=access_key \
    MINIO_ROOT_PASSWORD_FILE=secret_key \
    MINIO_KMS_SECRET_KEY_FILE=kms_master_key \
    MINIO_UPDATE_MINISIGN_PUBKEY="RWTx5Zr1tiHQLwG9keckT0c45M3AGeHD6IvimQHpyRywVWGbP1aVSGav" \
    MINIO_CONFIG_ENV_FILE=config.env \
    MC_CONFIG_DIR=/tmp/.mc
COPY --from=mc-build /out/bin/mc /usr/bin/mc
COPY --from=minio-build /out/bin/minio /usr/bin/minio
COPY --from=minio-build /out/docker-entrypoint.sh /usr/bin/docker-entrypoint.sh
COPY --from=minio-build /out/licenses/ /licenses/
EXPOSE 9000
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["minio"]
