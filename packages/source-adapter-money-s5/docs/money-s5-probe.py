#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Čtení dodacích listů ze Seyfor S5 API přes GraphQL.

API běží na http://money-s5.example.com:81/ (Seyfor S5Api, ASP.NET/Kestrel + OpenIddict).
 - GraphQL endpoint: POST /graphql  (vyžaduje Bearer token)
 - Token endpoint:   POST /connect/token  (OAuth2 client_credentials, scope=S5Api)

Přihlášení ("uživatel"):
  API nepoužívá jméno+heslo, ale OAuth2 klienta (client_id + client_secret),
  kterého je potřeba mít zaregistrovaného v S5. Grant "password" tu NENÍ povolen,
  funguje jen "client_credentials". Vyplň přihlašovací údaje přes proměnné
  prostředí nebo argumenty:

      export S5_CLIENT_ID=...
      export S5_CLIENT_SECRET=...
      python3 s5_dodaci_listy.py

Příklady:
  # posledních 20 vydaných dodacích listů
  python3 s5_dodaci_listy.py --typ vydane --count 20

  # přijaté dodací listy + jejich položky
  python3 s5_dodaci_listy.py --typ prijate --polozky

  # posledních 5 vydaných FAKTUR s položkami (potvrdí i pole DatumSplatnosti)
  python3 money-s5-probe.py --doklad faktura --typ vydane --count 5 --polozky

  # jeden konkrétní dodací list podle ID
  python3 s5_dodaci_listy.py --id 12345

  # jen změněné od data (inkrementální čtení)
  python3 s5_dodaci_listy.py --zmeneno-od 2026-01-01

  # syrový JSON pro další zpracování
  python3 s5_dodaci_listy.py --json
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE_URL = "http://money-s5.example.com:81"
SCOPE = "S5Api"          # ověřeno proti /connect/token (jediný platný API scope)
TIMEOUT = 30


def load_dotenv():
    """Načte .env (vedle skriptu i v aktuálním adresáři) do os.environ.
    Bez závislostí; existující proměnné prostředí nepřepisuje."""
    seen = set()
    for path in (os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
                 os.path.join(os.getcwd(), ".env")):
        if path in seen or not os.path.isfile(path):
            continue
        seen.add(path)
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                os.environ.setdefault(key, val)


def get_token(base_url, client_id, client_secret):
    """Získá access_token přes OAuth2 client_credentials."""
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": SCOPE,
    }).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/connect/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            err = json.loads(body)
            msg = "{}: {}".format(err.get("error"), err.get("error_description"))
        except ValueError:
            msg = body
        sys.exit("Chyba přihlášení ({}). {}".format(e.code, msg))
    except urllib.error.URLError as e:
        sys.exit("Nedostupné API na {} ({}).".format(base_url, e.reason))

    token = payload.get("access_token")
    if not token:
        sys.exit("Token endpoint nevrátil access_token: {}".format(payload))
    return token


def graphql(base_url, token, query, variables=None):
    """Zavolá GraphQL endpoint a vrátí data (nebo skončí s chybou)."""
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/graphql",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": "Bearer " + token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        sys.exit("GraphQL HTTP {}: {}".format(e.code, e.read().decode("utf-8", "replace")))
    except urllib.error.URLError as e:
        sys.exit("Nedostupný GraphQL endpoint ({}).".format(e.reason))

    # S5 API vrací vlastní obálku, ne standardní GraphQL:
    #   {"PageCount":..,"RowCount":..,"Data":{..},"Status":1,"Message":"","StackTrace":""}
    if payload.get("Status", 1) != 1 or payload.get("Message"):
        sys.exit("GraphQL chyba (Status {}): {}\n{}".format(
            payload.get("Status"), payload.get("Message"), payload.get("StackTrace", "")))
    # fallback na standardní "data" pro jistotu
    return {
        "Data": payload.get("Data", payload.get("data", {})) or {},
        "RowCount": payload.get("RowCount"),
        "PageCount": payload.get("PageCount"),
    }


# --- GraphQL dotazy (názvy polí ověřeny proti /GraphQLDoc) ---------------------

HLAVICKA = """
    ID
    CisloDokladu
    Nazev
    DatumVystaveni
    Stav
    VariabilniSymbol
    SumaZaklad
    SumaDan
    SumaCelkem
    Mena { Nazev }
    AdresaNazev
    Firma { Nazev ICO DIC Email }
"""

POLOZKY = """
    Polozky {
      Poradi
      CisloPolozky
      Nazev
      Katalog
      Mnozstvi
      Jednotka
      JednCena
      CelkovaCena
    }
"""


def build_query(root_field, single, with_items, extra_head=""):
    fields = HLAVICKA + extra_head + (POLOZKY if with_items else "")
    if single:
        return "query ($id: ID!) { %s(ID: $id) { %s } }" % (root_field, fields)
    return ("query ($filter: String, $from: Int, $count: Int, $changeFrom: DateTime) {"
            " %s(Filter: $filter, From: $from, Count: $count, ChangeFrom: $changeFrom) { %s } }"
            % (root_field, fields))


def fmt(v):
    return "" if v is None else v


def print_note(n):
    firma = n.get("Firma") or {}
    # Odběratel: relace Firma bývá prázdná, jméno je v denormalizovaném AdresaNazev.
    odberatel = n.get("AdresaNazev") or firma.get("Nazev") or ""
    mena = (n.get("Mena") or {}).get("Nazev") or ""
    print("─" * 72)
    print("Doklad: {}   Datum: {}   Stav: {}".format(
        fmt(n.get("CisloDokladu")), fmt(n.get("DatumVystaveni")), fmt(n.get("Stav"))))
    if n.get("DatumSplatnosti"):
        print("Splatnost: {}".format(fmt(n.get("DatumSplatnosti"))))
    ico_dic = ""
    if firma.get("ICO") or firma.get("DIC"):
        ico_dic = "  (IČO {} / DIČ {})".format(fmt(firma.get("ICO")), fmt(firma.get("DIC")))
    print("Odběratel: {}{}".format(fmt(odberatel), ico_dic))
    print("Popis:  {}".format(fmt(n.get("Nazev"))))
    print("Celkem: {} {} (základ {}, DPH {})   VS: {}".format(
        fmt(n.get("SumaCelkem")), mena, fmt(n.get("SumaZaklad")),
        fmt(n.get("SumaDan")), fmt(n.get("VariabilniSymbol"))))
    for p in n.get("Polozky") or []:
        print("   {:>3}. {}  [{}]  {} {} × {} = {}".format(
            fmt(p.get("Poradi")), fmt(p.get("Nazev")), fmt(p.get("Katalog")),
            fmt(p.get("Mnozstvi")), fmt(p.get("Jednotka")),
            fmt(p.get("JednCena")), fmt(p.get("CelkovaCena"))))


# --- Introspekce schématu: umí S5 vůbec ZÁPIS? -------------------------------
#
# Dokumentace i tento skript popisují jen čtení (root typ S5ApiQuery). Jestli API
# umí i zapisovat (a přijmout přílohu — podpis/foto k dokladu), z dokumentace
# NEPLYNE: /GraphQLDoc nikdo neprošel. Write-back adaptéru (IDataSource.writeBack)
# na té odpovědi stojí, tak ať ji dá jeden příkaz proti živé instanci a nemusí se
# hádat: `python3 money-s5-probe.py --introspect`.

INTROSPECT_QUERY = """
query {
  __schema {
    queryType { name }
    mutationType {
      name
      fields { name description args { name } }
    }
  }
}
"""

# Čeho si u mutací všímat: cokoli, co mění stav dokladu nebo bere přílohu.
ZAJIMAVE = ("delivery", "dodac", "invoice", "faktur", "attach", "priloh", "příloh",
            "upload", "file", "soubor", "document", "doklad", "state", "stav", "sign", "podpis")


def introspect(base_url, token, as_json=False):
    """Zjistí, zda schéma nabízí mutace (a které) — tj. jestli lze zapisovat."""
    body = json.dumps({"query": INTROSPECT_QUERY}).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/graphql",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json",
                 "Authorization": "Bearer " + token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        # Server smí introspekci vypnout — to je odpověď taky, jen ne ta hledaná.
        sys.exit("Introspekce selhala (HTTP {}): {}\n"
                 "Pokud je introspekce zakázaná, projdi /GraphQLDoc ručně a hledej "
                 "mutation root.".format(e.code, detail))
    except urllib.error.URLError as e:
        sys.exit("Nedostupný GraphQL endpoint ({}).".format(e.reason))

    schema = ((payload.get("Data") or payload.get("data") or {}).get("__schema")) or {}
    if as_json:
        print(json.dumps(schema, ensure_ascii=False, indent=2))
        return

    q = (schema.get("queryType") or {}).get("name")
    mt = schema.get("mutationType")
    print("Query root:    {}".format(q or "?"))

    if not mt:
        print("Mutation root: ŽÁDNÝ")
        print()
        print("→ S5 API je přes GraphQL POUZE PRO ČTENÍ.")
        print("  Zápis stavu ani přílohy tudy nepůjdou; write-back musí jinou cestou")
        print("  (jiné API, import balíčku, nebo přes účetní službu) — nebo stav")
        print("  zůstane u nás a do Money se dostane až při fakturaci.")
        return

    fields = mt.get("fields") or []
    print("Mutation root: {} ({} mutací)".format(mt.get("name"), len(fields)))
    print()
    hits = [f for f in fields
            if any(k in (f.get("name", "") + " " + (f.get("description") or "")).lower()
                   for k in ZAJIMAVE)]
    if hits:
        print("Kandidáti pro write-back (doklad / stav / příloha):")
        for f in hits:
            args_ = ", ".join(a.get("name", "") for a in (f.get("args") or []))
            print("  · {}({})".format(f.get("name"), args_))
            if f.get("description"):
                print("      {}".format(f["description"]))
    else:
        print("Mutace existují, ale žádná nevypadá na doklad/stav/přílohu.")
        print("Vypiš všechny: --introspect --json")
    print()
    print("→ Zápis je možný. Další krok: ověřit idempotenci (jak poznat, že doklad")
    print("  už byl zapsaný) — bez toho hrozí při retry dvojí zápis.")


def main():
    load_dotenv()
    ap = argparse.ArgumentParser(description="Čtení dodacích listů ze Seyfor S5 API (GraphQL).")
    ap.add_argument("--base-url", default=os.environ.get("S5_BASE_URL", DEFAULT_BASE_URL),
                    help="Adresa API (default: %(default)s)")
    ap.add_argument("--client-id", default=os.environ.get("S5_CLIENT_ID"),
                    help="OAuth2 client_id (nebo env S5_CLIENT_ID)")
    ap.add_argument("--client-secret", default=os.environ.get("S5_CLIENT_SECRET"),
                    help="OAuth2 client_secret (nebo env S5_CLIENT_SECRET)")
    ap.add_argument("--typ", choices=["vydane", "prijate"], default="vydane",
                    help="vydané (Issued*) nebo přijaté (Received*)")
    ap.add_argument("--doklad", choices=["dodaci-list", "faktura"], default="dodaci-list",
                    help="druh dokladu: dodací list (DeliveryNote) nebo faktura (Invoice)")
    ap.add_argument("--id", help="Načíst jeden doklad podle ID")
    ap.add_argument("--filter", help="Filtr (S5 filtr výraz), předá se do argumentu Filter")
    ap.add_argument("--from", dest="offset", type=int, default=0, help="Offset (From)")
    ap.add_argument("--count", type=int, default=20, help="Počet záznamů (Count)")
    ap.add_argument("--zmeneno-od", dest="change_from", help="ChangeFrom, např. 2026-01-01")
    ap.add_argument("--polozky", action="store_true", help="Načíst i položky dokladu")
    ap.add_argument("--introspect", action="store_true",
                    help="Vypsat schéma: umí API zápis (mutace) a přílohy? Nečte doklady.")
    ap.add_argument("--json", action="store_true", help="Vypsat syrový JSON")
    args = ap.parse_args()

    if not args.client_id or not args.client_secret:
        sys.exit("Chybí přihlašovací údaje. Nastav S5_CLIENT_ID a S5_CLIENT_SECRET "
                 "(env nebo --client-id/--client-secret). Jde o OAuth2 klienta "
                 "registrovaného v S5, ne o uživatelské jméno/heslo.")

    if args.introspect:
        introspect(args.base_url, get_token(args.base_url, args.client_id, args.client_secret),
                   as_json=args.json)
        return

    smer = "Issued" if args.typ == "vydane" else "Received"
    zaklad = "Invoice" if args.doklad == "faktura" else "DeliveryNote"
    root_field = smer + zaklad          # IssuedInvoice / ReceivedDeliveryNote / ...
    if not args.id:
        root_field += "s"               # -> *s (seznam)

    # Faktura má navíc splatnost + číslo objednávky. DatumSplatnosti a
    # CisloObjednavky jsou konvenční S5 pole, ale NEJSOU v ověřené sadě dodacích
    # listů — spuštění téhle sondy je právě způsob, jak je proti /GraphQLDoc
    # potvrdit. Když GraphQL vrátí Status≠1 na neznámé pole, odeber odpovídající
    # řádek níže (a v src/invoice-mapping.ts / mapping.ts pole [ASSUMED]).
    extra_head = "\n    DatumSplatnosti\n    CisloObjednavky" if args.doklad == "faktura" else ""

    token = get_token(args.base_url, args.client_id, args.client_secret)
    query = build_query(root_field, single=bool(args.id), with_items=args.polozky, extra_head=extra_head)

    if args.id:
        variables = {"id": args.id}
    else:
        variables = {"filter": args.filter, "from": args.offset,
                     "count": args.count, "changeFrom": args.change_from}

    envelope = graphql(args.base_url, token, query, variables)
    result = envelope["Data"].get(root_field)
    notes = [result] if args.id else (result or [])

    if args.json:
        print(json.dumps(notes, ensure_ascii=False, indent=2))
        return

    if not notes or notes == [None]:
        print("Žádné doklady nenalezeny.")
        return
    for n in notes:
        if n:
            print_note(n)
    print("─" * 72)
    total = envelope.get("RowCount")
    print("Zobrazeno {} záznamů{}".format(
        len([n for n in notes if n]),
        " (celkem v evidenci: {})".format(total) if total is not None else ""))


if __name__ == "__main__":
    main()
