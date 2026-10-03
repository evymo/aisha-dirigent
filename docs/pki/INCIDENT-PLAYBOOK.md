# PKI Incident Playbook — AISHA Platform

> Tento playbook pokrývá nejčastější incidenty PKI infrastruktury.
> Vždy ověř stav CA kontejnerů před akcí: `docker ps --filter "name=evymo-pki"`

---

## Obsah

1. [Expirující certifikát (<30 dní)](#1-expirující-certifikát)
2. [Expirovaný certifikát (služba nefunguje)](#2-expirovaný-certifikát)
3. [OpenXPKI nedostupný](#3-openxpki-nedostupný)
4. [CA certifikát kompromitovaný](#4-ca-certifikát-kompromitovaný)
5. [CRL distribuce selhává](#5-crl-distribuce-selhává)
6. [Nový realm / nová služba](#6-nový-realm--nová-služba)
7. [CA databáze havárie](#7-ca-databáze-havárie)

---

## Logy a diagnostické příkazy

```bash
# Stav PKI kontejnerů
docker ps --filter "name=evymo-pki" --format "table {{.Names}}\t{{.Status}}"

# OpenXPKI logy
docker logs aisha-pki --tail=100 -f

# OpenXPKI DB
docker exec aisha-pki-db mariadb -u openxpki -p'aisha-pki-db-change-in-production' openxpki

# OpenXPKI CLI (RA operátor — enrollment a správa certifikátů)
docker exec aisha-pki openxpkicli get_cert_list --authstack Testing --authuser raop --authpass openxpki

# OpenXPKI CLI (CA operátor — generování CRL, správa CA)
docker exec aisha-pki openxpkicli generate_crl --authstack Testing --authuser caop --authpass openxpki --param pki_realm=identity-plane

# Výpis certifikátu ze souboru
openssl x509 -noout -text -in /cert.pem
openssl x509 -noout -dates -subject -issuer -in /cert.pem
```

---

## 1. Expirující certifikát

**Symptom:** Monitoring upozorní na certifikát expirující za <30 dní. n8n workflow
`WF_PKI_CERT_ROTATION` by měl detekovat automaticky (denní plán 06:00).

**Automatická rotace (preferovaná):**
```bash
# Trigger manuálně pokud n8n nespustil workflow
curl -X POST https://n8n.evymo.cz/webhook/pki-rotate-trigger \
  -H "Content-Type: application/json" \
  -d '{"realm": "identity-plane"}'
```

**Manuální rotace (nouzový fallback):**
```bash
./scripts/pki/rotate-cert.sh \
  --realm identity-plane \
  --hostname keycloak.evymo.internal \
  --services aisha-keycloak,evymo-studio-auth
```

Viz [rotate-cert.sh](../../scripts/pki/rotate-cert.sh) pro plný usage.

---

## 2. Expirovaný certifikát

**Symptom:** Služba odmítá TLS spojení, logy obsahují `certificate has expired` nebo
`SSL handshake failed`.

**Triage:**
```bash
# Zjisti expiraci live certifikátu
echo | openssl s_client -connect keycloak.evymo.internal:443 2>/dev/null | \
  openssl x509 -noout -dates

# Zkontroluj certifikát v souboru
openssl x509 -noout -enddate -in /etc/evymo/certs/keycloak.pem
```

**Nouzové vydání (bypass normálního workflow):**
```bash
# 1. Vydej certifikát přímo přes OpenXPKI UI nebo CLI
docker exec aisha-pki openxpkicli search_cert \
  --authstack Testing --authuser raop --authpass openxpki \
  --param subject=keycloak.evymo.internal

# 2. Obnov enrollment aplikaci certifikátu
./scripts/pki/rotate-cert.sh --realm identity-plane \
  --hostname keycloak.evymo.internal \
  --services aisha-keycloak

# 3. Restart postižené služby
docker restart aisha-keycloak
```

---

## 3. OpenXPKI nedostupný

**Symptom:** Enrollment workflow selže, cert rotation selže, OpenXPKI UI nedostupné.

**Triage:**
```bash
docker ps --filter "name=evymo-pki"
docker logs aisha-pki --tail=50
docker exec aisha-pki-db mariadb -u openxpki -p'aisha-pki-db-change-in-production' \
  openxpki -e "SELECT COUNT(*) FROM certificate;"
```

**Restart PKI stacku:**
```bash
# Coolify — trigger redeploy PKI stack
curl -X POST https://coolify.id3a.cz/api/v1/applications/<PKI_STACK_UUID>/restart \
  -H "Authorization: Bearer $COOLIFY_API_TOKEN"

# Nebo manuálně v docker-compose.coolify-pki.yml (pokud existuje)
docker compose -f docker-compose.coolify-pki.yml up -d
```

**Důležité:** CA soukromé klíče jsou v HSM tokenu (SoftHSM2 v kontejneru).
Po restartu kontejneru klíče zůstanou — jsou v persistentním volumu `aisha-pki-hsm`.

---

## 4. CA certifikát kompromitovaný

> ⚠️ **KRITICKÁ SITUACE — Volej eskalaci** (viz CONTRIBUTING.md)

**Postup revokace Intermediate CA:**

```bash
# 1. Revokuj CA certifikát v OpenXPKI
docker exec aisha-pki openxpkicli revoke_certificate \
  --authstack Testing --authuser caop --authpass openxpki \
  --param pki_realm=root \
  --param identifier=<CA_IDENTIFIER> \
  --param reason_code=caCompromise

# Root CA identifikátory:
# Root CA:             cwZreD-vxOy59iR7GED_FMrh8hA
# Identity Plane CA:  QIIR7BCwT-P7E4nWz258hiCReMM
# Data Plane CA:      cN5pU9uPJZW4bqOnnMmlGykaYys
# Orchestration CA:   4Nw8xX9Kb930Mt3gHJ5bkwuKeUE

# 2. Vygeneruj nové CRL pro root realm
docker exec aisha-pki openxpkicli generate_crl \
  --authstack Testing --authuser caop --authpass openxpki \
  --param pki_realm=root

# 3. Vydej novou Intermediate CA
# (Postup: viz docs/pki/CA-OPERATIONS.md — TODO)

# 4. Aktualizuj trust bundle ve všech kontejnerech
# (Vyžaduje redeploy všech stacků s novým CA certifikátem)
```

**Po kompromitaci Root CA:**
- Celá PKI hierarchie je nedůvěryhodná
- Nutná nová Root CA generace + distribuce nového trust bundle
- Kontaktuj Zdeněk Beneš (PKI owner) a IT Security

---

## 5. CRL distribuce selhává

**Symptom:** OCSP/CRL check odmítnutí, `unable to get certificate CRL`, services odmítají
certifikáty bez aktuálního CRL.

**Triage:**
```bash
# Zkontroluj CRL
curl -s https://pki.evymo.cz/crl/identity-plane.crl | \
  openssl crl -noout -text | grep -E "Last|Next"

# Manuální generace CRL
docker exec aisha-pki openxpkicli generate_crl \
  --authstack Testing --authuser caop --authpass openxpki \
  --param pki_realm=identity-plane

docker exec aisha-pki openxpkicli generate_crl \
  --authstack Testing --authuser caop --authpass openxpki \
  --param pki_realm=data-plane

docker exec aisha-pki openxpkicli generate_crl \
  --authstack Testing --authuser caop --authpass openxpki \
  --param pki_realm=orchestration-plane
```

**Konfigurace CRL distribution point (CDP):** viz openxpki-config/config.d/realm/*/ca.yaml

---

## 6. Nový realm / nová služba

**Workflow pro vydání certifikátu pro novou službu:**

1. **Příprava CSR:**
```bash
# ECC P-384 (standard pro Evymo)
openssl ecparam -name secp384r1 -genkey -noout -out service.key
openssl req -new -key service.key -out service.csr \
  -subj "/CN=service.evymo.internal/O=Evymo s.r.o./C=CZ"
```

2. **Enrollment přes OpenXPKI UI:**
   - URL: `https://pki.evymo.cz` → Enrollment → Certificate Request
   - Realm: `identity-plane` (Keycloak, OAuth2 Proxy), `data-plane` (backend services),
     `orchestration-plane` (internal, short-lived, ≤3 days)

3. **Schválení (RA Operator):**
   - Login: `raop` / `openxpki` (DEV) nebo produkční credentials
   - Pending Requests → Review → Approve

4. **Stažení certifikátu:**
```bash
docker exec aisha-pki openxpkicli get_cert \
  --authstack Testing --authuser raop --authpass openxpki \
  --param identifier=<CERT_ID> \
  --format PEM > service-cert.pem
```

5. **Nasazení:** Zkopíruj PEM do volume a restart kontejneru.

---

## 7. CA databáze havárie

**Záloha:** MariaDB volume `aisha-pki-db` + SoftHSM volume `aisha-pki-hsm`

```bash
# Záloha MariaDB
docker exec aisha-pki-db mysqldump \
  -u openxpki -p'aisha-pki-db-change-in-production' openxpki \
  > /backup/openxpki-$(date +%Y%m%d-%H%M%S).sql

# Obnovení
docker exec -i aisha-pki-db mysql \
  -u openxpki -p'aisha-pki-db-change-in-production' openxpki \
  < /backup/openxpki-backup.sql
```

**POZOR:** SoftHSM2 token (`aisha-pki-hsm` volume) musí být zachován — bez něj jsou
CA soukromé klíče ztraceny a celá PKI hierarchie musí být znovu vybudována.

---

## Kontakty a eskalace

| Situace           | Kontakt                          |
|-------------------|----------------------------------|
| PKI incident      | Zdeněk Beneš (PKI owner)          |
| Bezpečnostní incident | IT Security + CISO            |
| Produkční havárie | Dev-ops on-call                   |

---

*Generováno: 2026-04 | Verze: 1.0 | Viz také [CA-OPERATIONS.md](CA-OPERATIONS.md) (TODO)*
