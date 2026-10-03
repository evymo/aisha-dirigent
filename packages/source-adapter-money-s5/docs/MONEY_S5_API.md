# Money S5 API — reálné chování (dodací listy přes GraphQL)

> Zdroj: přímé ověření proti zákaznické instanci `http://money-s5.example.com:81`
> (Money S4, modul **S5 API**, verze `1.15.2.7500`). Slouží jako spec pro tento
> balík (`src/money-s5-client.ts` + `src/mapping.ts`). Cesty a tvary se liší podle
> verze/konfigurace instance — čísla níže jsou z uvedené instance; adaptér nic
> instančně-specifického nekóduje (endpoint + creds přicházejí per-read ze story spine).

## TL;DR

Modul „S5 API" **není REST, ale GraphQL**. Jeden endpoint `POST /graphql`,
dotaz v těle, vlastní (ne-standardní) obálka odpovědi — proto tento balík
neparsuje přes `graphql-request` (ten čeká `{data,errors}`), ale obálku ručně
(`src/money-s5-client.ts`). Klíčová pole viz [Mapování](#mapování-na-deliverynote--a-záludnosti).

## Rozcestník instance

| Cesta | Co je |
|-------|-------|
| `/` | uvítací stránka (odkazy na Swagger a GraphQL doc) |
| `/connect/token` | OAuth2 token endpoint (OpenIddict) |
| `/graphql` | GraphQL endpoint — **vyžaduje `Authorization: Bearer`** |
| `/GraphQLDoc` | vygenerovaná dokumentace schématu (per-typ `*.doc.html`) |
| `/swaggerDoc/index.html` | Swagger UI (REST část modulu) |

## Autentizace — OAuth2 client_credentials

Money credentials (Client ID/Secret) žijí jen na backendu; tablet s Money
nikdy nemluví přímo.

```
POST /connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
client_id=<ID>
client_secret=<SECRET>
scope=S5Api
```

Ověřené chování token endpointu (OpenIddict):

- `grant_type=password` → **`unsupported_grant_type`** (ROPC není povolen).
- `grant_type=client_credentials` bez `client_id` → `invalid_client`.
- Platné registrované scope: **`S5Api`**, `openid`, `offline_access`
  (ostatní → `invalid_scope`). Pro přístup na `/graphql` je potřeba **`S5Api`**.
- Odpověď: standardní `{ "access_token": "<JWT>", "expires_in": …, … }`.
  JWT claims: `client_id` = `sub` = jméno klienta, `scope: "S5Api"`, `iss`
  = base URL. Žádný claim s firmou/agendou — data řídí konfigurace klienta.

`GET /graphql` bez tokenu → `401` s `WWW-Authenticate: Bearer`.

## Nestandardní obálka odpovědi

`/graphql` **nevrací** standardní `{ "data": …, "errors": [] }`. Vrací:

```json
{
  "PageCount": 10108,
  "RowCount": 20216,
  "Data": { "IssuedDeliveryNotes": [ … ] },
  "Status": 1,
  "Message": "",
  "StackTrace": ""
}
```

- Data jsou pod **`Data`** (velké D), a uvnitř pod názvem root pole
  (`Data.IssuedDeliveryNotes`) — ne přímo pole.
- Úspěch = `Status: 1`. Chyba → `Status != 1` a text v `Message` / `StackTrace`
  (žádné standardní pole `errors`).
- `RowCount` = celkový počet záznamů v evidenci (užitečné pro stránkování),
  `PageCount` je odvozené.

## Dotazy na dodací listy

Root typ `S5ApiQuery`. Pro dodací listy vydané (DLV) i přijaté:

| Pole | Význam |
|------|--------|
| `IssuedDeliveryNotes(Filter, From, Count, ChangeFrom): [IssuedDeliveryNote]` | vydané, seznam |
| `IssuedDeliveryNote(ID: ID!): IssuedDeliveryNote` | vydaný, jeden podle ID |
| `ReceivedDeliveryNotes(…)` / `ReceivedDeliveryNote(ID)` | přijaté (stejná struktura) |

Argumenty seznamu (společné pro všechny root seznamy v API):

- `From: Int`, `Count: Int` — stránkování (offset/limit).
- `ChangeFrom: DateTime` — jen záznamy změněné od data (**inkrementální ranní
  stažení do tabletu** = `listDeliveryNotes(since)`).
- `Filter: String` — serverový filtr (syntaxe S5, zatím neověřena; pro
  `getDeliveryNote(documentNumber)` je cílem filtr na `CisloDokladu`).

Příklad (seznam + položky), tak jak reálně funguje:

```graphql
{
  IssuedDeliveryNotes(From: 0, Count: 50, ChangeFrom: "2026-01-01") {
    ID
    CisloDokladu
    DatumVystaveni
    Nazev
    Stav
    SumaZaklad
    SumaDan
    SumaCelkem
    Mena { Nazev }
    AdresaNazev
    Polozky {
      Poradi
      Nazev
      Katalog
      Mnozstvi
      Jednotka
      JednCena
      CelkovaCena
    }
  }
}
```

## Mapování na `DocumentRecord` (`src/mapping.ts`) — a záludnosti

| `DocumentRecord` pole | Reálné pole S5 | Poznámka |
|-----------------------|----------------|----------|
| `externalId` | `ID` (GUID) | cíl pro budoucí write-back přílohy |
| `documentNumber` | `CisloDokladu` | např. `DLT23188` |
| `documentType` | — | konstanta `delivery_note` |
| `documentDate` | **`DatumVystaveni`** | ISO `…T00:00:00`, `.slice(0,10)` |
| `counterparty` | **`AdresaNazev`** | relace `Firma` je v datech **`null`** — jméno je v denormalizovaném `AdresaNazev` (snapshot adresy) |
| `lines[].description` | `Nazev` | |
| `lines[].quantity` | **`Mnozstvi`** | **ne** `IPMnozstvi` (to je intrastat, bývá 0) |
| `lines[].unit` | `Jednotka` | string, např. `m2`, `t`, `x` |
| `lines[].catalog` | `Katalog` | |

Hlavička má stovky dalších polí (`SumaCelkemCM`, `VariabilniSymbol`,
`MojeFirma*`, desítky `*_ID`). Konektor vyžádá jen výše uvedenou podmnožinu
(`DELIVERY_NOTE_FIELDS`) — GraphQL vrátí přesně vyžádané.

## Faktury vydané (`IssuedInvoices`) — druhý zdroj (`./invoices`)

Faktura je **jiná entita** téhož S5 API (stejný endpoint, auth i obálka), proto
vlastní broker zdroj: slug `money-s5-issued-invoices`, entry `./invoices`
(`src/invoices.ts` + `src/invoice-mapping.ts`), sdílí `money-s5-client.ts`.

Root pole (analogicky k dodákům — root typ `S5ApiQuery`):

| Pole | Význam |
|------|--------|
| `IssuedInvoices(Filter, From, Count, ChangeFrom): [IssuedInvoice]` | vydané faktury, seznam |
| `IssuedInvoice(ID: ID!): IssuedInvoice` | vydaná faktura, jedna podle ID |
| `ReceivedInvoices(…)` / `ReceivedInvoice(ID)` | přijaté (stejná struktura) |

Mapování na `DocumentRecord` (+ `financial` a `party`, `src/invoice-mapping.ts`):

| `DocumentRecord` pole | Reálné pole S5 | Poznámka |
|-----------------------|----------------|----------|
| `documentType` | — | konstanta `invoice` |
| `documentNumber` | `CisloDokladu` | např. `FV2026001` |
| `documentDate` | `DatumVystaveni` | ISO, `.slice(0,10)` |
| `counterparty` | `AdresaNazev` → `Firma.Nazev` | snapshot adresy |
| `party.ico` / `.dic` / `.email` | `Firma.ICO` / `.DIC` / `.Email` | pro spárování se zákazníkem |
| `financial.baseAmount` | `SumaZaklad` | základ bez DPH |
| `financial.vatAmount` | `SumaDan` | DPH |
| `financial.totalAmount` | `SumaCelkem` | celkem s DPH |
| `financial.currency` | `Mena.Nazev` | např. `CZK` |
| `financial.variableSymbol` | `VariabilniSymbol` | VS platby |
| `financial.status` | `Stav` | textový stav dokladu |
| `financial.dueDate` | **`DatumSplatnosti`** | ⚠️ **[ASSUMED]** — mimo ověřenou sadu dodáků; potvrď `money-s5-probe.py --doklad faktura` (GraphQL spadne Status≠1 na neznámé pole) |
| `references.variableSymbol` | `VariabilniSymbol` | join faktura↔bankovní výpis (VS) |
| `references.orderRef` | **`CisloObjednavky`** | ⚠️ **[ASSUMED]** — join faktura↔dodací list; stejná čtečka i pro dodáky (`mapping.ts`), aby párování běželo i nad strukturovaným pullem, ne jen OCR |

**Vyhledání podle čísla faktury** (`getEntity('document', CisloDokladu)`): Money
`Filter` syntaxe je neověřená, proto se stránkuje klientsky (`IssuedInvoices`
po 100) a matchuje `CisloDokladu`. Na rozdíl od dodáků (pevné okno 200) faktury
stránkují **do vyčerpání důkazů** (krátká stránka = opravdu nenalezeno → `null`)
a při dosažení stropu `5000` s plnými stránkami **selžou hlasitě** — tichý
částečný miss by mohl vést k **duplicitní faktuře** (ERP je autorita čísla). Až
bude `Filter` ověřen, nahradit za serverový filtr na `CisloDokladu`.

**Více účetních entit (agend) na jednom URL:** endpoint je sdílený, agendu určuje
konfigurace OAuth2 klienta → jedna agenda = jeden `authSecretRef` = jeden binding
na story spine. Adaptér je stateless, `SourceConnection` přichází per-request, tj.
tentýž adaptér obsluhuje N agend přes N bindingů (ne přes kód).

## Jak to implementuje tento balík

- **Auth:** `src/money-s5-client.ts` → `getToken()` (client_credentials + `scope=S5Api`,
  cache do expirace − 60 s), retry 1× na 401.
- **Transport:** `graphql()` posílá `POST /graphql` a parsuje obálku `{Data,Status,Message}`
  ručně (Status≠1 → `MoneyApiError`; data pod `Data.IssuedDeliveryNotes`, ne pole přímo).
- **Mapování:** `src/mapping.ts` → `mapDeliveryNote()` (tabulka výše).
- **Credentials:** nikdy v kódu/konfigu — konektor je čte z `SourceConnection.authSecretRef`
  (env-var-name scheme, `clientId:clientSecret`), který broker resolvuje ze story spine.

## Reference / ověřovací nástroj

`docs/money-s5-probe.py` — samostatný Python skript (bez závislostí) proti
reálné instanci: získá token, zavolá `/graphql`, vypíše dodací listy.
Slouží jako „spustitelná spec" a smoke test.

```bash
export S5_CLIENT_ID=…  S5_CLIENT_SECRET=…
python3 docs/money-s5-probe.py --typ vydane --count 5 --polozky
```

Credentials patří do prostředí / secret manageru, **nikdy do repa**
(viz CLAUDE.md → No Secrets in Code).
