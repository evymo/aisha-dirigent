# AISHA shared antivirus sidecar — ClamAV (clamd) with a hardened, baked clamd.conf.
# Bake-not-bind: Coolify v4 clones the repo as the build context, so COPY works while
# the top-level `configs:` directive does not (PR #187). The image ships freshclam to
# keep signatures current.
#
# Base image arg is parametric (routed through the registry proxy at build time — no
# direct Docker Hub pull on the host).
ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}clamav/clamav:1.4

# Hardened clamd config (scan limits + fail-closed on encrypted archives).
COPY infra/clamav/clamd.conf /etc/clamav/clamd.conf

# clamd listens on TCP 3310 (sibling containers only — not published to the host).
EXPOSE 3310
