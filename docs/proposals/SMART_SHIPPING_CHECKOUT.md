# Smart Shipping Checkout — Implementační plán

> **Stav:** Schváleno k implementaci | **Datum:** 20. února 2026 | **Revize:** v2.0  
> **Rozhodnutí:** Kompletní vlastní UI, žádný Packeta Widget iframe  
> **Cíl:** Dynamické zobrazení VŠECH dostupných dopravních metod (výdejní místa, Z-BOXy, doručení na adresu s volbou dopravce) a cen podle zadané adresy uživatele — vše v nativním UI

---

## 1. Současný stav

### Co máme
- **3 fixní metody dopravy** zobrazené vždy: `packeta_pickup`, `packeta_home`, `personal_pickup`
- **Ceny z DB** (`shipment_settings.shipping_rates`) — statické ceny per metoda/country
- **Packeta Edge Function** (`packeta-api`) — 3 akce: `create-packet`, `track`, `pickup-points`
- **Pickup points** — načítají se z Packeta branch feed v4 (`/api/v4/{key}/branch.json`), omezeno na 100 bodů
- **Checkout flow:** uživatel vybere metodu → vyplní adresu → platba (Stripe/bankovní převod)

### Problémy
1. **Žádná validace dostupnosti** — všechny 3 metody se zobrazí vždy, bez ohledu na adresu
2. **Statické ceny** — neodpovídají reálným cenám Zásilkovny pro konkrétní destinaci
3. **Žádné Z-BOX/Z-POINT filtrování** — pickup points se nerozlišují na typ (box vs. výdejní místo)
4. **Limitovaný výběr** — max 100 bodů, bez vyhledávání/filtr podle PSČ nebo lokality
5. **Uživatel nemá porovnání** — nevidí ceny všech variant najednou pro svou adresu
6. **Chybí „nedostupná doprava"** — nikde neříkáme, že do dané lokality nelze doručit
7. **Používáme zastaralý feed v4** — Packeta má v5 s oddělenými endpointy pro branches/boxes/carriers
8. **Žádná volba dopravce** — uživatel nemůže vybrat specifického dopravce pro home delivery
9. **Chybí carrier PUDOs** — nezobrazujeme výdejní místa externích dopravců (DPD, Hermes, …)

---

## 2. Cílový UX flow

```
┌─────────────────────────────────────────────────────┐
│  1. Uživatel vyplní doručovací adresu               │
│     (PSČ + město + country — ideálně autocomplete)  │
│                                                     │
│  2. Systém na pozadí zjistí:                        │
│     a) Dostupné Packeta pickup points v okolí       │
│     b) Dostupné Z-BOXy v okolí                      │
│     c) Zda je home delivery dostupná                │
│     d) Ceny pro každou variantu                     │
│                                                     │
│  3. Zobrazí se POUZE dostupné metody s cenami:      │
│     ┌──────────────────────────────────────────┐    │
│     │ ✅ Z-BOX Brno Královo Pole    59 Kč     │    │
│     │ ✅ Packeta výdejní místo      65 Kč     │    │
│     │ ✅ Doručení na adresu         99 Kč     │    │
│     │ ✅ Osobní vyzvednutí          ZDARMA    │    │
│     └──────────────────────────────────────────┘    │
│                                                     │
│  4. Pokud nic není dostupné:                        │
│     "Do vaší lokality bohužel nedoručujeme.         │
│      Můžete si objednávku vyzvednout osobně."       │
│                                                     │
│  5. Po výběru metody → pokračování na platbu        │
└─────────────────────────────────────────────────────┘
```

---

## 3. Packeta API — Kompletní průzkum

### 3.1 Rozhodnutí: Vlastní UI, ne Packeta Widget

**Packeta Widget v6** je izolovaný **iframe** komunikující přes `window.postMessage()`:
- Nelze stylovat Tailwind/shadcn uvnitř iframe
- Nelze zobrazit ceny přímo v checkout flow (widget nezná naše ceny)
- Omezená kontrola nad UX (Packeta řídí layout, barvy, interakce)
- Dependency na Packeta CDN

**→ Rozhodnutí: Budujeme kompletní vlastní UI** používající data z Packeta Feed API v5.
Widget nepoužíváme. Všechna data (výdejní místa, Z-BOXy, dopravce, GPS, fotky, otevírací doby) dostaneme z feed endpointů.

### 3.2 Packeta Feed API v5 — Kompletní přehled

| Feed | Endpoint | Data | Aktualizace |
|------|----------|------|-------------|
| **Výdejní místa** | `GET pickup-point.api.packeta.com/v5/{KEY}/branch/json?lang={LANG}` | Všechny Packeta PUDO branches | 4×/den, v sezóně 1×/hod |
| **Z-BOXy** | `GET pickup-point.api.packeta.com/v5/{KEY}/box/json?lang={LANG}` | Všechny Z-BOXy (24/7 boxy) | 4×/den, v sezóně 1×/hod |
| **Dopravci (HD)** | `GET pickup-point.api.packeta.com/v5/{KEY}/carrier/json?lang={LANG}` | Všichni home delivery dopravci | 1×/den |
| **Carrier PUDOs** | `GET pickup-point.api.packeta.com/v5/{KEY}/carrier_point/json?ids[]={ID}` | Výdejní místa externích dopravců | 1×/den, po 6:00 |
| **SOAP API** | `POST soap.api.packeta.com/api/soap-php-bugfix.wsdl` | Vytvoření zásilky, tracking, štítky | On-demand |

> ⚠️ **Migrace z v4 na v5:** URL se změnila z `/api/v4/{key}/branch.json` na `/v5/{key}/branch/json`. Nutno aktualizovat edge function.

### 3.3 Data z jednotlivých feedů

#### A) Branch Feed (výdejní místa) — atributy
```json
{
  "id": "13789",
  "name": "Praha 15, Hostivař, Švehlova 32 (ZÁSILKOVNA, VIVO Hostivař)",
  "place": "ZÁSILKOVNA",
  "street": "Švehlova 32",
  "city": "Praha",
  "zip": "102 00",
  "country": "cz",
  "currency": "CZK",
  "status": { "statusId": "1", "description": "In operation" },
  "displayFrontend": "1",
  "directions": "<p>HTML navigace...</p>",
  "directionsCar": "<p>Parkování přímo u OC</p>",
  "directionsPublic": "<p>Zastávka MHD...</p>",
  "wheelchairAccessible": "yes",
  "creditCardPayment": "yes",
  "dressingRoom": "0",
  "claimAssistant": "1",
  "packetConsignment": "1",
  "latitude": "50.05341",
  "longitude": "14.51784",
  "url": "https://www.zasilkovna.cz/pobocky/...",
  "maxWeight": "15",
  "labelRouting": "C10-252-13789",
  "photos": [
    { "thumbnail": "https://files.packeta.com/points/thumb/...", "normal": "https://files.packeta.com/points/normal/..." }
  ],
  "openingHours": {
    "regular": { "monday": "09:00–21:00", "tuesday": "09:00–21:00", ... },
    "upcoming": { "monday": "08:30-18:30", ..., "startDate": "2025-08-23" },
    "exceptions": [{ "date": "2025-12-30", "hours": "08:00-12:00, 12:45-16:30" }]
  },
  "extendedDelivery": { "saturday": "true" }
}
```

**Klíčové atributy pro naše UI:**
- `status.statusId` — 1=funkční, 2=plný, 3=dovolená, 4=technické problémy, 5=ukončený
- `displayFrontend` — filtrovat `"0"` (jen admin účely)
- `latitude`/`longitude` — proximity sorting podle adresy uživatele
- `maxWeight` — filtrovat body nepřijímající naši hmotnost
- `photos` — thumbnail 160×120px, normal 720×540px
- `openingHours` — regular + upcoming + exceptions → zobrazit v UI
- `creditCardPayment`, `wheelchairAccessible` — ikony v detailu

#### B) Z-BOX Feed — stejné atributy PLUS:
```json
{
  "type": "zbox",
  "codAllowed": "1",        // dobírka povolena?
  "hasKeypad": "1",         // má klávesnici (ne jen app)
  "openingHours": {
    "regular": { "monday": "00:00–23:59", ... }  // 24/7
  }
}
```

**Klíčový benefit pro UX:** Z-BOXy jsou 24/7, uživatel nemusí řešit otevírací doby.

#### C) Carrier Feed — dopravci pro home delivery
```json
{
  "id": "106",
  "name": "CZ Zásilkovna domů HD",
  "available": "true",
  "pickupPoints": "false",
  "apiAllowed": "true",
  "separateHouseNumber": "false",
  "customsDeclarations": "false",
  "requiresEmail": "true",
  "requiresPhone": "true",
  "requiresSize": "false",
  "disallowsCod": "false",
  "country": "cz",
  "currency": "CZK",
  "maxWeight": "30",
  "labelRouting": "C41-***-106",
  "labelName": "CZ Zásilkovna domů HD"
}
```

**Naming convention:** `{2-letter ISO country} {carrier name} {HD|PP|Box}`
- **HD** = Home Delivery
- **PP** = Pick-up Point Delivery
- **Box** = Box/Locker Delivery

**Klíčoví HD dopravci pro naše trhy:**
| Carrier | ID | Country | Poznámka |
|---------|----|---------|----------|
| CZ Zásilkovna domů HD | 106 | CZ | Requires phone + email |
| SK Packeta HD | ??? | SK | Requires phone + email |
| DE Hermes HD | ??? | DE | Max 30 kg |
| AT Austrian Post HD | 80 | AT | Max 30 kg |
| PL BDS | ??? | PL | Best Delivery Solution (auto-volba dopravce) |

> 📌 **Carrier IDs zjistíme z live carrier feed** při implementaci — feed obsahuje kompletní seznam.

#### D) Carrier PUDOs Feed — výdejní místa externích dopravců
```json
{
  "carriers": [
    {
      "id": 123,
      "name": "Carrier Name",
      "points": [
        {
          "code": "ABC321",
          "coordinates": { "latitude": "52.00000", "longitude": "18.00000" },
          "street": "Example street",
          "streetNumber": "12",
          "city": "Example city",
          "zip": "11-111",
          "country": "PL",
          "payment": "Card only",
          "displayFrontend": 1
        }
      ]
    }
  ]
}
```

### 3.4 Cenotvorba

Packeta **neposkytuje veřejné Pricing API** pro real-time výpočet ceny.  
Ceny se řídí **smluvním ceníkem** (stažitelný z klientské zóny).

**Náš přístup: Smluvní ceník v DB**
| Přístup | Popis | Status |
|---------|-------|--------|
| **Smluvní ceník v DB** | Admin spravuje ceny v `shipment_settings` per country/method/weight/carrier | ✅ **Implementujeme** |
| **Packeta CSV import** | Stáhnout ceník z klientské zóny, importovat do DB | 🔄 Fáze 2 (automatizace) |
| **packetPriceCalculation SOAP** | Dostupné jen s nadstandardní smlouvou | ❌ Nepoužíváme |

### 3.5 SOAP API — pro vytvoření zásilky (existující)

Při vytvoření zásilky přes `createPacket()` se carrier ID (= `addressId`) použije stejně jako branch ID:
```xml
<createPacket>
  <packetAttributes>
    <addressId>106</addressId>  <!-- carrier ID pro HD, nebo branch ID pro PUDO -->
    <name>John</name>
    <surname>Doe</surname>
    <email>john@example.com</email>
    <weight>2</weight>
    <!-- pro HD navíc: street, city, zip -->
  </packetAttributes>
</createPacket>
```

Pro HD s volbou dopravce tedy stačí nastavit `addressId` na carrier ID.  
Pro PUDO stačí nastavit `addressId` na branch/box ID.

---

## 4. Architektura řešení

### 4.1 Nový flow: Address → Available Methods → Selection → Payment

```
┌──────────────┐    ┌─────────────────────────────┐    ┌──────────────────────┐
│   Frontend   │───▶│  Edge Function              │───▶│  Packeta Feed v5     │
│              │    │  packeta-api                │    │  • branch/json       │
│  PSČ + City  │    │  action: "available-methods"│    │  • box/json          │
│  + Country   │    │                             │    │  • carrier/json      │
│              │◀───│  Returns:                   │    │  • carrier_point/json│
│ Smart Cards: │    │  • pickupPoints[]           │    └──────────────────────┘
│  - Z-BOXy    │    │  • zboxes[]                 │
│  - Výdejní   │    │  • carriers[] (HD)          │───▶│  shipment_settings   │
│  - Dopravci  │    │  • carrierPudos[]           │    │  (DB ceník)          │
│  - Osobní    │    │  • prices{}                 │    └──────────────────────┘
│              │    │  • personalPickup{}         │
└──────────────┘    └─────────────────────────────┘
```

### 4.2 Shipping Methods — Kompletní taxonomie

```typescript
/**
 * Shipping method taxonomy.
 * Ordered by user priority (cheapest → most convenient).
 */
export type ShippingMethod =
  | "personal_pickup"      // osobní vyzvednutí (ZDARMA)
  | "packeta_zbox"         // Z-BOX 24/7 samoobslužný box
  | "packeta_pickup"       // výdejní místo Zásilkovna
  | "carrier_pickup"       // výdejní místo externího dopravce (DPD, Hermes PP, ...)
  | "packeta_home"         // doručení na adresu přes Zásilkovnu
  | "carrier_home";        // doručení na adresu přes specifického dopravce

/**
 * Granular carrier selection for home delivery.
 * User can pick a specific carrier or use "auto" (BDS - Best Delivery Solution).
 */
export interface CarrierSelection {
  carrierId: number;       // Packeta carrier ID (addressId)
  carrierName: string;     // "CZ Zásilkovna domů HD"
  country: string;         // "cz"
  maxWeight: number;       // kg
  requiresPhone: boolean;
  requiresEmail: boolean;
  separateHouseNumber: boolean;
}
```

### 4.3 Datový model — rozšíření `shipping_rates`

```jsonc
{
  "base_currency": "CZK",
  "methods": {
    "packeta_pickup": {
      "default": 65,
      "by_country": { "SK": 79, "DE": 99, "AT": 99, "PL": 89 },
      "enabled": true
    },
    "packeta_zbox": {
      "default": 59,
      "by_country": { "SK": 69, "DE": 89, "AT": 89, "PL": 79 },
      "enabled": true
    },
    "packeta_home": {
      "default": 99,
      "by_country": { "SK": 119, "DE": 149, "AT": 149, "PL": 129 },
      "enabled": true,
      "excluded_countries": []
    },
    "carrier_home": {
      // per-carrier pricing (carrier_id → price)
      "by_carrier": {
        "106": { "default": 99, "label": "CZ Zásilkovna domů HD" },
        "80":  { "default": 119, "label": "AT Austrian Post HD" }
      },
      "enabled": true
    },
    "carrier_pickup": {
      "by_carrier": {},
      "enabled": true
    },
    "personal_pickup": {
      "default": 0,
      "enabled": true,
      "allowed_countries": ["CZ"]
    }
  },
  "weight_surcharges": {
    "thresholds": [
      { "max_kg": 5, "surcharge": 0 },
      { "max_kg": 10, "surcharge": 20 },
      { "max_kg": 15, "surcharge": 40 },
      { "max_kg": 20, "surcharge": 60 },
      { "max_kg": 30, "surcharge": 100 }
    ]
  },
  "free_shipping_threshold": {
    "CZK": 2000,
    "EUR": 80
  }
}
```

### 4.4 Edge Function: `available-methods` — detailní logika

```
Input:  { country, postalCode, city?, latitude?, longitude?, weightGrams?, currency }
Output: AvailableMethodsResponse

1. PARALELNĚ načíst:
   a) Packeta branch feed (v5) pro country → cache 15 min
   b) Packeta box feed (v5) pro country → cache 15 min
   c) Packeta carrier feed (v5) → cache 1 hod
   d) shipment_settings z DB → cache 5 min

2. Filtrovat branches a boxes:
   a) Status = 1 (in operation) && displayFrontend = "1"
   b) PSČ prefix match (první 2-3 čísla = region)
   c) Pokud GPS souřadnice k dispozici → seřadit podle vzdálenosti
   d) Filtrovat maxWeight >= zásilka hmotnost
   e) Limit: top 20 branches + top 10 zboxů

3. Filtrovat carriers:
   a) available = "true"
   b) country = input country
   c) maxWeight >= zásilka hmotnost
   d) Rozdělit na HD carriers a PP carriers

4. Pro carrier PP: načíst carrier_point feed pro relevantní carrier IDs
   a) Filtrovat body podle PSČ/GPS proximity
   b) Limit: top 10 per carrier

5. Spočítat ceny:
   a) Base cena z shipment_settings per method
   b) + weight surcharge
   c) - free shipping threshold check
   d) Převod měny dle currency

6. Sestavit response se VŠEMI dostupnými metodami + cenami + body
```

### 4.5 Response interface

```typescript
interface AvailableMethodsResponse {
  /** Výdejní místa Zásilkovna, seřazené podle vzdálenosti */
  pickupPoints: PacketaPoint[];
  /** Z-BOXy, seřazené podle vzdálenosti */
  zboxes: PacketaPoint[];
  /** Dostupní HD dopravci pro danou zemi */
  homeDeliveryCarriers: CarrierOption[];
  /** Výdejní místa externích dopravců */
  carrierPickupPoints: CarrierPickupGroup[];
  /** Osobní vyzvednutí */
  personalPickup: {
    available: boolean;
    address: string;        // adresa pobočky
    openingHours?: string;  // otevírací doba
  };
  /** Ceník pro všechny metody */
  pricing: {
    packeta_pickup: PriceInfo | null;
    packeta_zbox: PriceInfo | null;
    packeta_home: PriceInfo | null;
    carrier_home: Record<string, PriceInfo>;  // carrier_id → price
    carrier_pickup: Record<string, PriceInfo>;
    personal_pickup: PriceInfo;
  };
  /** Free shipping info */
  freeShipping: {
    threshold: number;
    currency: string;
    currentTotal: number;
    remaining: number;
    qualifies: boolean;
  } | null;
}

interface PacketaPoint {
  id: number;
  name: string;
  place: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  latitude: number;
  longitude: number;
  distance?: number;        // km od zadané adresy
  status: { statusId: string; description: string };
  maxWeight: number;        // kg
  openingHours: OpeningHours;
  photos: { thumbnail: string; normal: string }[];
  wheelchairAccessible: boolean;
  creditCardPayment: boolean;
  saturdayDelivery: boolean;
  // Z-BOX specific:
  type?: "zbox";
  codAllowed?: boolean;
  hasKeypad?: boolean;
}

interface CarrierOption {
  carrierId: number;
  carrierName: string;      // "CZ Zásilkovna domů HD"
  displayName: string;      // "Zásilkovna domů" (vyčištěný název)
  country: string;
  maxWeight: number;
  requiresPhone: boolean;
  requiresEmail: boolean;
  price: PriceInfo;
}

interface CarrierPickupGroup {
  carrierId: number;
  carrierName: string;
  points: CarrierPickupPoint[];
}

interface CarrierPickupPoint {
  code: string;
  street: string;
  streetNumber: string;
  city: string;
  zip: string;
  country: string;
  latitude: number;
  longitude: number;
  distance?: number;
  payment: string;          // "Card only" | "Cash only" | "Card and cash" | "None available"
}

interface PriceInfo {
  amount: number;
  currency: string;
  originalAmount?: number;  // před slevou
  isFree: boolean;          // free shipping applied?
}
```

### 4.6 Frontend UI — Nový checkout flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Doručovací adresa                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐                      │
│  │ PSČ          │ │ Město        │ │ Země ▾         │                      │
│  │ [612 00    ] │ │ [Brno      ] │ │ [CZ 🇨🇿      ] │                      │
│  └──────────────┘ └──────────────┘ └────────────────┘                      │
│                                                                             │
│  ⏳ Zjišťuji dostupné dopravy... (skeleton loading)                        │
│                                                                             │
│  STEP 2: Vyberte způsob dopravy                                            │
│                                                                             │
│  ┌─ 📦 Z-BOX (24/7) ──────────────────────────── 59 Kč ──────────────┐    │
│  │  Z-BOX Brno - Královo Pole, Palackého 15          0.8 km          │    │
│  │  ✅ 24/7  ✅ Klávesnice  ✅ Dobírka                               │    │
│  │  [📸 Zobrazit fotky]  [📍 Navigovat]                              │    │
│  │  ──────────────────────────────────────────────                    │    │
│  │  Z-BOX Brno - Žabovřesky, Minská 2               1.2 km          │    │
│  │  ✅ 24/7  ❌ Klávesnice  ✅ Dobírka                               │    │
│  │  [📸]  [📍]                                                       │    │
│  │  [Zobrazit další Z-BOXy ▸]                                        │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─ 📍 Výdejní místo Zásilkovna ────────────────── 65 Kč ─────────────┐   │
│  │  5 výdejních míst v okolí                                           │   │
│  │  ┌──────────────────────────────────────────────────┐               │   │
│  │  │ ◉ ZÁSILKOVNA, VIVO Hostivař                      │ 0.3 km      │   │
│  │  │   Švehlova 32, Po-Ne 09:00-21:00                 │              │   │
│  │  │   ♿ 💳 📦 So-doručení                           │              │   │
│  │  ├──────────────────────────────────────────────────┤               │   │
│  │  │ ○ Albert, Brněnská 23                            │ 0.7 km      │   │
│  │  │   Po-Pá 08:00-20:00, So 09:00-14:00             │              │   │
│  │  └──────────────────────────────────────────────────┘               │   │
│  │  [Zobrazit všechna výdejní místa ▸]                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─ 🚚 Doručení na adresu ────────────── od 99 Kč ────────────────────┐   │
│  │  Vyplňte doručovací adresu:                                         │   │
│  │  ┌─────────────────────┐ ┌───────────┐ ┌──────────────┐            │   │
│  │  │ Ulice + číslo       │ │ Město     │ │ PSČ          │            │   │
│  │  └─────────────────────┘ └───────────┘ └──────────────┘            │   │
│  │                                                                     │   │
│  │  Dopravce:                                                          │   │
│  │  ┌──────────────────────────────────────────────┐                   │   │
│  │  │ ◉ Zásilkovna domů (1-3 dny)       99 Kč    │                   │   │
│  │  │ ○ Česká pošta (2-5 dní)          109 Kč    │                   │   │
│  │  │ ○ DPD Express (1-2 dny)          129 Kč    │                   │   │
│  │  └──────────────────────────────────────────────┘                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─ 🏢 Osobní vyzvednutí ────────────────── ZDARMA ───────────────────┐   │
│  │  Brno, Botanická 68a                                                │   │
│  │  Po-Pá 09:00-17:00                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─ 🎉 Doprava ZDARMA ──── chybí vám ještě 450 Kč ───── ████████░░ ──┐   │
│  │  Přidejte do košíku za 450 Kč a doprava je zdarma!                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  STEP 3: Pokračovat k platbě                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Implementační fáze

### Fáze 1: Backend — Feeds + Edge Function (3-4 dny)

| # | Úkol | Detail |
|---|------|--------|
| 1.1 | **Migrace: rozšíření `shipment_settings`** | `packeta_zbox`, `carrier_home`, `carrier_pickup`, weight_surcharges, free_shipping_threshold, per-carrier pricing |
| 1.2 | **Migrace: rozšíření `orders.shipping_method`** | Podpora nových typů: `packeta_zbox`, `carrier_home`, `carrier_pickup` + nový sloupec `carrier_id` |
| 1.3 | **DB funkce: refaktor `get_shipping_cost`** | Podpora všech 6 metod, weight surcharges, free shipping threshold, per-carrier pricing |
| 1.4 | **Edge Function: migrace feedů na v5** | Nové endpointy: `branch/json`, `box/json`, `carrier/json`, `carrier_point/json` |
| 1.5 | **Edge Function: nová akce `available-methods`** | Paralelní fetch všech feedů, filtrování, GPS proximity, cenotvorba |
| 1.6 | **Edge Function: intelligent caching** | Per-country cache s TTL (branches: 15 min, carriers: 1 hod, carrier_points: 4 hod) |
| 1.7 | **GPS proximity utility** | Haversine distance calculation, PSČ prefix matching |

### Fáze 2: Nové komponenty (3-4 dny)

| # | Úkol | Detail |
|---|------|--------|
| 2.1 | **Hook: `useAvailableShippingMethods`** | Debounced fetch s React Query, Zod validace response |
| 2.2 | **Komponenta: `ShippingCategoryCard`** | Expandovatelná karta per kategorie (Z-BOX, výdejní místo, HD, osobní) |
| 2.3 | **Komponenta: `PickupPointSelector`** | Seznam výdejních míst s fotkami, otevírací dobou, GPS vzdáleností, ikony features |
| 2.4 | **Komponenta: `ZBoxSelector`** | Speciální UI pro Z-BOXy (24/7 badge, klávesnice/app badge, dobírka badge) |
| 2.5 | **Komponenta: `CarrierSelector`** | RadioGroup dopravců s cenou, odhadovaným doručením, požadavky (telefon/email) |
| 2.6 | **Komponenta: `HomeDeliveryForm`** | Formulář adresy + volba dopravce (vnořeno do HD karty) |
| 2.7 | **Komponenta: `FreeShippingProgress`** | Progress bar s animací, práh free shipping |
| 2.8 | **Komponenta: `NoShippingAvailable`** | Hlášení nedostupnosti s fallbackem na osobní vyzvednutí |

### Fáze 3: Checkout refaktor (2-3 dny)

| # | Úkol | Detail |
|---|------|--------|
| 3.1 | **Refaktor `CheckoutShippingSection`** | Address-first → debounce PSČ → zobrazit dostupné metody dynamicky |
| 3.2 | **Refaktor `Checkout.tsx`** | Nový state management: `shippingMethod` + `selectedPointId` + `selectedCarrierId` |
| 3.3 | **Refaktor `CheckoutOrderSummary`** | Dynamická cena dopravy, free shipping progress |
| 3.4 | **Refaktor `useCheckoutData.ts`** | Rozšíření typů, nové helper funkce |
| 3.5 | **Refaktor `create_order_with_items_audited`** | Podpora `carrier_id`, nových shipping method typů |
| 3.6 | **Loading states** | Skeleton UI při načítání metod po změně PSČ |

### Fáze 4: i18n + Admin + testy (2-3 dny)

| # | Úkol | Detail |
|---|------|--------|
| 4.1 | **i18n klíče** | EN + CS pro všechny nové texty (Z-BOX, carrier names, free shipping, …) |
| 4.2 | **Admin panel: rozšíření distribuce** | Správa cen per method/country/carrier, weight thresholds, free shipping |
| 4.3 | **Testy hooků** | `useAvailableShippingMethods` — mock edge function, Zod validace |
| 4.4 | **Testy komponent** | `ShippingCategoryCard`, `PickupPointSelector`, `CarrierSelector`, `ZBoxSelector` |
| 4.5 | **Testy edge function** | `available-methods` action — mock feed responses, cenotvorba |
| 4.6 | **E2E test update** | Aktualizace checkout E2E testů pro nový flow |

### Fáze 5: Polish + Optimalizace (ongoing)

| # | Úkol | Detail |
|---|------|--------|
| 5.1 | **PSČ autocomplete** | Napojení na Google Places / Mapy.cz pro autocomplete adresy |
| 5.2 | **Mapa s body** | Leaflet/Mapbox mapa s výdejními místy a Z-BOXy (volitelná) |
| 5.3 | **Carrier logo/ikony** | Vizuální rozlišení dopravců (Zásilkovna, DPD, Hermes, …) |
| 5.4 | **Analytics** | Tracking konverzí per shipping method, drop-off rate at checkout |
| 5.5 | **Packeta CSV import** | Admin tool pro import ceníku z Packeta klientské zóny |
| 5.6 | **Weight z product katalogu** | Hmotnost per produkt místo default 500g |

---

## 6. Technické detaily

### 6.1 Packeta Feed v5 — endpointy a struktura

```typescript
const PACKETA_FEED_BASE = "https://pickup-point.api.packeta.com/v5";

// Výdejní místa (branches)
const branchUrl = `${PACKETA_FEED_BASE}/${apiKey}/branch/json?lang=${lang}`;

// Z-BOXy (separátní feed!)
const boxUrl = `${PACKETA_FEED_BASE}/${apiKey}/box/json?lang=${lang}`;

// Home delivery dopravci
const carrierUrl = `${PACKETA_FEED_BASE}/${apiKey}/carrier/json?lang=${lang}`;

// Výdejní místa externích dopravců (s carrier filtrem)
const carrierPointUrl = `${PACKETA_FEED_BASE}/${apiKey}/carrier_point/json?ids[]=${carrierId1}&ids[]=${carrierId2}`;
```

### 6.2 GPS proximity — Haversine formula

```typescript
/**
 * Calculate distance between two GPS coordinates in km.
 * Used for sorting pickup points by proximity to user's address.
 */
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
```

### 6.3 PSČ → GPS geocoding strategy

Packeta feedy nemají PSČ-based filtrování. Naše strategie:

1. **PSČ prefix match** (hrubý filtr) — první 2-3 číslice PSČ definují region
2. **GPS geocoding** (přesný filtr) — pokud máme GPS z adresy uživatele
3. **Kombinace** — prefix match pro rychlý filtr, GPS distance pro sorting

```typescript
// PSČ region map pro ČR (první 1-2 čísla)
// 1xx = Praha, 2xx = Středočeský, 3xx = Jihočeský/Plzeňský,
// 4xx = Karlovarský/Ústecký/Liberecký, 5xx = Královéhradecký/Pardubický,
// 6xx = Jihomoravský/Vysočina/Zlínský/Olomoucký, 7xx = Moravskoslezský

function filterByPostalCode(
  points: PacketaPoint[],
  postalCode: string
): PacketaPoint[] {
  const prefix = postalCode.replace(/\s/g, "").substring(0, 3);
  
  // Hrubý filtr — body se shodným PSČ prefix
  const regional = points.filter(p => {
    const pointZip = p.zip.replace(/\s/g, "");
    return pointZip.startsWith(prefix.substring(0, 2)); // region match
  });
  
  return regional;
}
```

### 6.4 Caching v Edge Function

```typescript
// In-memory cache (per Deno isolate)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry<unknown>>();

const CACHE_TTL = {
  branches: 15 * 60 * 1000,      // 15 min
  boxes: 15 * 60 * 1000,          // 15 min
  carriers: 60 * 60 * 1000,       // 1 hod
  carrierPoints: 4 * 60 * 60 * 1000, // 4 hod
  shippingRates: 5 * 60 * 1000,   // 5 min
} as const;

async function getCached<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  const data = await fetchFn();
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}
```

### 6.5 Debounce na frontendu

```typescript
// V checkout komponentě — debounce PSČ/město změny
const debouncedPostalCode = useDebounce(formData.postalCode, 500);
const debouncedCity = useDebounce(formData.city, 500);

const { data: shippingData, isLoading } = useAvailableShippingMethods({
  country: formData.country,
  currency: preferredCurrency,
  postalCode: debouncedPostalCode,
  city: debouncedCity,
  weightGrams: totalWeightGrams,
});
```

### 6.6 Carrier name parsing

```typescript
/**
 * Parse carrier name from Packeta format: "{CC} {Name} {Type}"
 * e.g. "CZ Zásilkovna domů HD" → { country: "CZ", displayName: "Zásilkovna domů", type: "HD" }
 */
function parseCarrierName(name: string): {
  country: string;
  displayName: string;
  deliveryType: "HD" | "PP" | "Box";
} {
  const parts = name.split(" ");
  const country = parts[0];
  const type = parts[parts.length - 1] as "HD" | "PP" | "Box";
  const displayName = parts.slice(1, -1).join(" ");
  return { country, displayName, deliveryType: type };
}
```

### 6.7 Order creation — rozšíření pro carrier selection

```typescript
// Při vytvoření objednávky ukládáme:
interface OrderShippingData {
  shipping_method: ShippingMethod;    // "packeta_zbox" | "carrier_home" | ...
  carrier_id?: number;                // Packeta carrier ID (= addressId pro SOAP)
  carrier_name?: string;              // Display name
  packeta_branch_id?: number;         // Pro PUDO/Z-BOX
  // existující:
  packeta_packet_id?: string;
  packeta_barcode?: string;
  shipping: number;                   // cena dopravy
}

// createPacket SOAP volání pak používá:
// - Pro PUDO/Z-BOX: addressId = packeta_branch_id
// - Pro HD: addressId = carrier_id
```

---

## 7. Rozhodnutí (uzavřená)

| # | Otázka | Rozhodnutí | Důvod |
|---|--------|------------|-------|
| 1 | **Výběr pickup bodů** | Vlastní UI (ne Widget) | Widget = iframe, nelze stylovat, omezená kontrola UX |
| 2 | **Ceny dopravy** | Smluvní ceník v DB | Packeta pricing API není veřejné |
| 3 | **Z-BOX jako separátní metoda** | Ano, odděleně | Jiná cena, jiný UX (24/7), odlišné featury |
| 4 | **Carrier selection** | Uživatel vybere dopravce | Plná transparentnost, srovnání cen |
| 5 | **Kdy zjišťovat metody** | Po PSČ (3+ znaky) | Rychlý feedback, debounced |
| 6 | **Feed verze** | v5 (nová) | Oddělené endpointy pro branches/boxes/carriers |
| 7 | **Free shipping threshold** | Per country | Různé prahy dle trhu |

---

## 8. Impact na existující kód

### Soubory k vytvoření
| Soubor | Popis |
|--------|-------|
| `supabase/migrations/YYYYMMDD_smart_shipping.sql` | DB migrace — rozšíření shipment_settings, orders |
| `src/hooks/useAvailableShippingMethods.ts` | Hook pro dynamické metody z edge function |
| `src/components/checkout/ShippingCategoryCard.tsx` | Expandovatelná karta per shipping kategorie |
| `src/components/checkout/PickupPointSelector.tsx` | Seznam výdejních míst s detaily |
| `src/components/checkout/ZBoxSelector.tsx` | Z-BOX specifický selektor |
| `src/components/checkout/CarrierSelector.tsx` | Výběr HD dopravce |
| `src/components/checkout/HomeDeliveryForm.tsx` | Formulář adresy pro HD |
| `src/components/checkout/FreeShippingProgress.tsx` | Progress bar k free shipping |
| `src/components/checkout/NoShippingAvailable.tsx` | Hlášení nedostupnosti |
| `src/lib/schemas/shippingSchemas.ts` | Zod schémata pro shipping data |
| `src/tests/hooks/useAvailableShippingMethods.test.ts` | Testy hooku |
| `src/tests/components/checkout/*.test.ts` | Testy nových komponent |

### Soubory k refaktorování
| Soubor | Změna |
|--------|-------|
| `src/pages/checkout/CheckoutShippingSection.tsx` | Kompletní přepsání — address-first → dynamické metody |
| `src/pages/checkout/checkoutTypes.ts` | Nové typy: `ShippingMethod` (6 variant), `PacketaPoint`, `CarrierOption` |
| `src/pages/Checkout.tsx` | Nový state: metoda + bod + dopravce, debounce PSČ |
| `src/pages/checkout/CheckoutOrderSummary.tsx` | Dynamická cena, free shipping progress |
| `src/hooks/useCheckout.ts` | Přidání `useAvailableShippingMethods`, refaktor `useShippingCosts` |
| `src/hooks/useCheckoutData.ts` | Rozšíření `ShippingMethod` + `SHIPPING_COSTS` obsolete |
| `supabase/functions/packeta-api/index.ts` | Nová `available-methods` akce, migrace na feed v5, caching |
| `supabase/sql/functions/get_shipping_cost.sql` | 6 metod, weight surcharges, free shipping, per-carrier pricing |

### i18n klíče k přidání (EN + CS)
```json
{
  "checkout.shipping.enterAddress": "Enter delivery address to see available shipping options",
  "checkout.shipping.loadingMethods": "Finding shipping options...",
  "checkout.shipping.zbox": "Z-BOX (24/7)",
  "checkout.shipping.zboxDesc": "Self-service locker, available 24/7",
  "checkout.shipping.zboxKeypad": "Has keypad",
  "checkout.shipping.zboxAppOnly": "App only",
  "checkout.shipping.zboxCod": "Cash on delivery",
  "checkout.shipping.pickupPoint": "Packeta pick-up point",
  "checkout.shipping.pickupPointDesc": "{{count}} locations found nearby",
  "checkout.shipping.homeDelivery": "Home delivery",
  "checkout.shipping.homeDeliveryDesc": "Delivered to your address",
  "checkout.shipping.selectCarrier": "Select carrier",
  "checkout.shipping.carrierPickup": "Carrier pick-up point",
  "checkout.shipping.personalPickup": "Personal pick-up",
  "checkout.shipping.personalPickupDesc": "Pick up at our location",
  "checkout.shipping.free": "FREE",
  "checkout.shipping.notAvailable": "Delivery not available for this location",
  "checkout.shipping.notAvailableDesc": "You can use personal pick-up instead",
  "checkout.shipping.freeShipping": "Free shipping from {{threshold}}",
  "checkout.shipping.freeShippingProgress": "{{remaining}} more for free shipping",
  "checkout.shipping.freeShippingUnlocked": "Free shipping applied!",
  "checkout.shipping.estimatedDays": "{{days}} business days",
  "checkout.shipping.distance": "{{distance}} km",
  "checkout.shipping.selectPoint": "Select pick-up point",
  "checkout.shipping.selectedPoint": "Selected: {{name}}",
  "checkout.shipping.showMore": "Show more",
  "checkout.shipping.showPhotos": "Show photos",
  "checkout.shipping.navigate": "Navigate",
  "checkout.shipping.openingHours": "Opening hours",
  "checkout.shipping.open247": "Open 24/7",
  "checkout.shipping.wheelchair": "Wheelchair accessible",
  "checkout.shipping.cardPayment": "Card payment",
  "checkout.shipping.saturdayDelivery": "Saturday delivery",
  "checkout.shipping.maxWeight": "Max weight: {{weight}} kg"
}
```

---

## 9. Bezpečnost & Compliance

- **Žádné sensitive-data** — shipping data (adresa) nejsou privátní údaje, ale GDPR stále platí
- **API key ochrana** — Packeta API key v `app_secrets`, nikdy v frontend kódu (edge function proxy)
- **Rate limiting** — stávající 30 req/min na packeta-api zůstává
- **Audit** — objednávka je auditovaná přes `create_order_with_items_audited`
- **RLS** — `shipment_settings` — admin-only write, public read pro ceny
- **Input validace** — Zod schéma pro PSČ, country, currency v edge function
- **Feed data sanitizace** — HTML z `directions` pole escapovat (DOMPurify) před zobrazením
- **Carrier validation** — per-carrier validace dle Packeta pravidel (telefon, email, hmotnost, PSČ)

---

## 10. Časový odhad

| Fáze | Odhad | Riziko |
|------|-------|--------|
| Fáze 1: Backend + Edge Function | 3-4 dny | Střední — 4 feed endpointy, caching |
| Fáze 2: Nové komponenty | 3-4 dny | Nízké-střední — čistý UI |
| Fáze 3: Checkout refaktor | 2-3 dny | Střední — komplexní state management |
| Fáze 4: i18n + Admin + testy | 2-3 dny | Nízké |
| **Celkem MVP** | **10-14 dní** | |
| Fáze 5: Polish + optimalizace | ongoing | Nízké |

---

## 11. Další kroky

1. **✅ Rozhodnuto:** Vlastní UI, ne Packeta Widget iframe
2. **✅ Prozkoumáno:** Všechny Packeta Feed v5 endpointy a datové struktury
3. **Implementovat:** Začít Fází 1 (backend + edge function) — základ pro vše ostatní
4. **Zjistit live data:** Zavolat carrier feed s naším API key → zjistit přesné carrier IDs pro naše trhy
5. **Zjistit ceník:** Stáhnout smluvní ceník z Packeta klientské zóny pro per-carrier pricing
6. **Testovat:** S reálnými Packeta feed daty na staging prostředí
