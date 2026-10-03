#!/usr/bin/env python3
"""mint-apple-secret.py — vyrobí Apple „client secret" (ES256 JWT) z materiálu klíče.

PROČ TENHLE SOUBOR EXISTUJE
    Apple stropuje client secret pro Sign in with Apple na ES256 JWT s platností
    6 měsíců. Statická hodnota v prostředí tedy VŽDYCKY jednou vyprší a Apple
    login tiše umře — nikde se neobjeví chyba, tlačítko prostě přestane fungovat.
    Secret se proto neDEKLARUJE, ale ODVOZUJE: razí se znovu při každém startu
    Keycloaku i při každém rolloutu.

JEDNO MÍSTO PRAVDY
    Volají to DVA konzumenti a oba musejí dostat bit po bitu totéž:
      * keycloak/configure-realms.sh — uvnitř kontejneru při startu
      * scripts/instance-rollout.sh  — zvenčí proti admin API
    Převod DER → raw JOSE podpisu je dost jemný na to, aby se dvě kopie časem
    rozešly. Proto je tady jednou.

VSTUP (prostředí)
    APPLE_TEAM_ID          iss — Team ID (10 znaků)
    APPLE_KEY_ID           kid — Key ID klíče (10 znaků)
    APPLE_AUTH_KEY_B64     base64 obsahu AuthKey_<KEYID>.p8 (PEM), jeden řádek
    OAUTH_APPLE_CLIENT_ID  sub — Services ID (např. cz.<neco>.signin)

VÝSTUP
    JWT na stdout, exit 0. Při jakékoli chybě: hlášku na stderr a exit 1 —
    NIKDY prázdný stdout s exit 0, aby se z nezdaru nedal udělat tichý fallback.

ZÁVISLOSTI: jen stdlib + binárka `openssl` (obojí je i v obrazu Keycloaku).
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time

# Apple strop je 6 měsíců; 15 500 000 s ≈ 179,4 dne — pod stropem i po přepočtu
# přes přestupný rok, ale dost dlouho, aby restart nebyl podmínkou provozu.
PLATNOST_S = 15_500_000

# ⭐ Raznice si své potřeby DEKLARUJE. Volající (instance-rollout.sh) si je
# vyzvedne přes `--required-env` místo aby si je opisoval — ruční seznam je
# přesně to, co už jednou spolklo celé federované přihlášení: co seznam
# nejmenuje, to se z .env.coolify nenačte a nic se neozve.
POTREBUJE = ("APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_AUTH_KEY_B64",
             "OAUTH_APPLE_CLIENT_ID")


def chyba(zprava):
    sys.stderr.write("[mint-apple-secret] %s\n" % zprava)
    sys.exit(1)


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def der_na_jose(der):
    """DER ECDSA-Sig-Value (SEQUENCE dvou INTEGERů) → raw 64 B r||s."""
    if not der or der[0] != 0x30:
        raise ValueError("podpis není DER SEQUENCE")
    i = 2 + (1 if der[1] & 0x80 else 0)  # přeskoč hlavičku SEQUENCE (i dlouhou délku)
    if der[i] != 0x02:
        raise ValueError("chybí INTEGER r")
    rl = der[i + 1]
    r = der[i + 2 : i + 2 + rl]
    i += 2 + rl
    if der[i] != 0x02:
        raise ValueError("chybí INTEGER s")
    sl = der[i + 1]
    s = der[i + 2 : i + 2 + sl]
    r = r.lstrip(b"\x00").rjust(32, b"\x00")
    s = s.lstrip(b"\x00").rjust(32, b"\x00")
    if len(r) != 32 or len(s) != 32:
        raise ValueError("r/s nemá 32 B — jiná křivka než P-256?")
    return r + s


def main():
    if "--required-env" in sys.argv:
        sys.stdout.write("\n".join(POTREBUJE) + "\n")
        return

    chybi = [k for k in POTREBUJE if not os.environ.get(k)]
    if chybi:
        chyba("chybí materiál klíče: %s" % ", ".join(chybi))

    try:
        pem = base64.b64decode(os.environ["APPLE_AUTH_KEY_B64"], validate=True)
    except Exception as e:
        chyba("APPLE_AUTH_KEY_B64 není platný base64 (%s)" % e)
    if b"PRIVATE KEY" not in pem:
        chyba("APPLE_AUTH_KEY_B64 se nedekóduje na PEM s privátním klíčem")

    ted = int(time.time())
    header = {"alg": "ES256", "kid": os.environ["APPLE_KEY_ID"], "typ": "JWT"}
    payload = {"iss": os.environ["APPLE_TEAM_ID"], "iat": ted, "exp": ted + PLATNOST_S,
               "aud": "https://appleid.apple.com", "sub": os.environ["OAUTH_APPLE_CLIENT_ID"]}
    podepisovane = (b64url(json.dumps(header, separators=(",", ":")).encode()) + "." +
                    b64url(json.dumps(payload, separators=(",", ":")).encode()))

    with tempfile.NamedTemporaryFile("wb", suffix=".p8", delete=False) as f:
        keyfile = f.name
        os.chmod(keyfile, 0o600)
        f.write(pem)
    try:
        hotovo = subprocess.run(["openssl", "dgst", "-sha256", "-sign", keyfile],
                                input=podepisovane.encode(), capture_output=True)
        if hotovo.returncode != 0:
            chyba("openssl nepodepsal: %s" % hotovo.stderr.decode(errors="replace").strip())
        der = hotovo.stdout
    finally:
        os.unlink(keyfile)

    try:
        jose = der_na_jose(der)
    except Exception as e:
        chyba("převod podpisu DER → JOSE selhal: %s" % e)

    sys.stdout.write(podepisovane + "." + b64url(jose) + "\n")


if __name__ == "__main__":
    main()
