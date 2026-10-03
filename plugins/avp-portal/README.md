# AVP portal (Kupson) — konektor výdejních stojanů PHM

REST/JSON API výdejních stojanů PHM (Kupson AVP portal). Plugin čte číselník karet
a nádrží, výdej paliva, návozy a denní uzávěrky nádrží a zapisuje je na **obecnou
surovou dráhu stacku** — `source_catalog_rows` přes `audience_sync_source_catalog`,
zdroj `avp-portal`. Jádro stacku o AVP nic neví (žádné tabulky ani funkce):
instalace je data, ne DDL; typované pohledy dělá instance.

| `kind` | režim | co | `occurred_at` |
|---|---|---|---|
| `card` | snapshot | karty řidičů a vozidel/strojů | — |
| `chip` | snapshot | RFID čipy → karta (`chip_code`, `card_id`) | — |
| `tank` | snapshot | nádrže | — |
| `fueling` | series | výdej, všechny verze i skryté | čas čerpání |
| `tank_refill` | series | návozy do nádrží | čas návozu |
| `tank_register` | series | denní uzávěrky nádrží | čas uzávěrky |

`snapshot` = celá množina v jedné dávce (co v portálu zmizí, zmizí i tady; prázdnou
dávku katalog odmítne, dobrá data nesmaže). `series` = přírůstek, historie zůstává.
Zapisovat smí plugin jen pod jménem svého zdroje — broker jiný `p_source_slug` odmítne.

## Co plugin NEdělá (a proč)

- **Nezakládá dvojčata.** Karta řidiče nebo čip vozidla není nová osoba ani nový
  stroj: je to identifikátor, který se na existující dvojče váže POTVRZENOU
  vazbou (rozhodnutí majitele 2026-09-24). Projekce na dvojčata jde o vrstvu výš,
  přes `twin_identity_resolve`; neznámý identifikátor je návrh vazby, ne dvojče.
- **Neodvozuje.** Ukládají se všechny verze výdeje i skryté a odstraněné, se
  svými příznaky. Co je platné tankování, rozhoduje čtenář (viz níže).

## Konfigurace (administrace zdroje `avp-portal`)

| klíč | tajné | co |
|---|---|---|
| `baseUrl` | ne | `https://<instance>.avp-portal.cz` |
| `database` | ne | jméno instance v cestě (subdoména) — viz odchylka 1 |
| `username`, `password` | **ano** | API uživatel pro `POST /api/signin` |
| `fleetSyncCron` | ne | číselník karet a nádrží (výchozí denně 3:00) |
| `fuelingSyncCron` | ne | výdej (výchozí každých 15 min) |
| `tankSyncCron` | ne | návozy a uzávěrky nádrží (výchozí denně 3:20) |

Pověření se ukládají šifrovaně (`set_data_source_secrets`) a pluginu je vydá
broker na token běhu. V repozitáři ani v env kontejneru nejsou.

## Odchylky od dodaného návodu (AvpPortal-API.pdf)

Ověřeno naživo 18. 8. 2026 proti produkční instanci:

1. **Jméno databáze v cestě je subdoména instance, ne `ownership` ze signin.**
   S `ownership` vrátí server `403 Forbidden: Database is disabled` — stejně jako
   pro vymyšlené jméno. Nesprávná databáze se tváří jako chybějící oprávnění.
2. **Databáze se resolvuje před autorizací** — stejné 403 padá i bez tokenu.
   403 nejdřív ověřit proti jménu databáze, ne proti účtu.
3. **Odpovědi mají UTF-8 BOM.** `res.json()` na nich spadne; klient parsuje text
   s odstraněným BOM.
4. **Neznámý endpoint nevrací 404, ale HTTP 200 a HTML** (SPA fallback portálu).
   Klient to hlásí jako chybu tvaru, ne jako prázdný seznam.
5. **Bez `limit` vrací server celou tabulku.** Všechny dotazy pluginu stránkují.
6. **Výčet hodnot ve filtru neexistuje.** Funguje jedna hodnota nebo rozsah
   `A...B` (i otevřený). `$tankId=1,5` vrátí tiše prázdný seznam, `1|5` HTTP 500.
7. **Stránkování: `offset` funguje, `skip` je tiše ignorován, `page` je jiná
   sémantika.** Řadit podle `id` — u `sort=time` se shodné časy prohazují.
8. **Inkrementálně přes `$serverSyncTime`** (čas zápisu). `time` je čas čerpání;
   zápis na server zaostává (naměřeno ~10 min). Kurzor výdeje je nejpozdější
   VIDĚNÝ `serverSyncTime`; kurzor nádrží (filtr podle času události) má překryv 48 h.
9. **Token platí ~26 dní.** Plugin se přesto přihlašuje v každém běhu — token je
   tajemství a do kv úložiště pluginu nepatří.

## Jak číst výdej (pro projekci o vrstvu výš)

- **Platný výdej = list řetězu `parent_id` ∧ ¬`hidden` ∧ ¬`removed`** (pole v `fields`). `parent_id`
  ukazuje na STARŠÍ verzi transakce; platná je poslední. Naivní filtr jen na
  `hidden`/`removed` nafoukne počet transakcí (naměřeno ~19 %). Řetěz jde vyhodnotit
  jen nad úplnou množinou — proto surová dráha drží všechny verze.
- `unit_price` může být v instanci všude 0 — cena pak musí přijít odjinud.
- Část výdejů nemá `vehicle_id` / `driver_id`; nelze počítat s tím, že každý jde
  přiřadit ke stroji.
- `calculated_tank_amount` v uzávěrce je dopočtený, ne měřený.

## Vztahy entit (měřeno na ostré instanci 19. 8. 2026)

- `fueling.driverId` / `vehicleId` odkazují na `cards.id` (karta řidiče / vozidla,
  `cardType` Driver/Vehicle). `vehicleId` chybí u ~30 % výdejů, `driverId` u ~2 %.
- `/chips`: RFID čip (`chipCode`, 16 hex) → `cardId`, karta může mít víc čipů. API
  dává jen AKTUÁLNÍ přiřazení, historii přesunů ne.
- `fueling.vehicleChip` / `driverChip` jsou vyplněné vždy, takže jsou cestou
  k vozidlu tam, kde `vehicleId` chybí.
- Čipy AVP jsou jiná technologie než tachografové karty (průnik nulový) a jako klíč
  mezi systémy nefungují.
- Karta nese `name`, `inventoryNumber` (~22 %) a `vehicleType` (~7 %, SPZ nebo VIN),
  tedy signály pro návrh vazby.
- Ceny (`unitPrice`) mohou být všude 0 a stav nádrže je dopočet, ne měření.

Úplný soupis s hodnotami je v datech instance.

## Na dvojčata (o vrstvu výš, v jádře stacku)

Plugin sám dvojčata nezakládá ani needituje; po zápisu zavolá dvě funkce jádra:

- po číselníku `avp_propose_identity` — **návrhy** vazeb: karta (`karta:<id>`) ↔
  vozidlo/řidič podle RZ/VIN, RZ ve jménu karty, inventárního čísla a jména; čip
  (`cip:<kód>`) na totéž dvojče jako jeho karta, jakmile je vazba karty potvrzená.
  Potvrzuje člověk.
- po výdeji `avp_project_fuelings` — výdej → událost `fueling` na dvojčeti vozidla
  (řidič = druhá strana), dráha `avp-portal:fueling`. Subjekt je karta vozidla,
  kde chybí, čip (k času výdeje). Posílají se všechny verze, **litry nese jen
  platná**; nahrazená/skrytá/odstraněná má `stav` a litry ne, takže pozdější
  oprava předchozí verzi v součtu vynuluje.

Selže-li některý z těch kroků, co je uložené (katalog, kurzor), zůstane — běh
ale skončí **chybou** se srozumitelnou zprávou, aby ji blok stavu zdrojů
v administraci ukázal místo tiše „zdravého“ běhu.

Než se zdroj zapne, má projít
[SOURCE_ONBOARDING_CONTRACT](../../docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md).
