# Apple Wallet integrace pro členy PLATFORM

> **Verze:** 1.0 | **Datum:** 20. února 2026  
> **Stav:** Návrh / Analýza  
> **Autor:** AI Agent

---

## 0) Executive Summary

Integrovat Apple Wallet (PassKit) do platformy PLATFORM tak, aby členové měli:

1. **Členskou kartičku (Membership Pass)** — digitální průkaz člena s QR kódem, tierem, expirací, automatickým updatem
2. **Boarding passy pro objednávky (Order Pass)** — informace o objednávce s live trackingem zásilky
3. **Kupóny / Vouchery (Coupon Pass)** — slevové kódy jako wallet passy

Vše napojené na existující systém: `memberships`, `orders`, `shipment_records`, `product_vouchers`, Stripe, Zásilkovna.

---

## 1) Kontext a motivace

### Proč Apple Wallet?

| Benefit | Popis |
|---------|-------|
| **Engagement** | Členská kartička v peněžence = stálá přítomnost značky |
| **Tracking bez instalace** | Zákazník sleduje zásilku přímo v peněžence, bez potřeby mobilní app |
| **Push notifikace** | Změny passu (stav objednávky, blížící se expirace členství) = push notifikace zdarma |
| **Konverze** | Vouchery v peněžence mají vyšší redemption rate než emailové kódy |
| **Profesionalita** | Production brand s Wallet integrace = důvěryhodnost |

### Co už existuje v systému

| Oblast | Stav | Klíčové tabulky/hooky |
|--------|------|-----------------------|
| Členství (tiers, stavy, expirace) | ✅ Plně funkční | `memberships`, `useMembership` |
| Objednávky + tracking | ✅ Plně funkční | `orders`, `shipment_records`, tracking_url |
| Zásilkovna (Packeta) | ✅ Integrovaná | packeta_packet_id, packeta_barcode |
| Vouchery | ✅ Plně funkční | `product_vouchers`, `useVoucher` |
| Stripe platby | ✅ Integrovaný | stripe_session_id, stripe_payment_intent_id |
| Mobilní app (Expo) | ✅ Existuje | Zatím bez shop/wallet passů |
| Apple Wallet / PassKit | ❌ Neexistuje | — |

---

## 2) Apple Wallet / PassKit — Technický přehled

### 2.1 Typy passů

| Typ | Apple název | Naše využití |
|-----|-------------|--------------|
| **Generic** | `generic` | Členská kartička (od iOS 16+, dříve `storeCard`) |
| **Boarding Pass** | `boardingPass` | ❌ Nepoužíváme |
| **Event Ticket** | `eventTicket` | Potenciálně pro eventy/workshopy |
| **Store Card** | `storeCard` | Alternativa pro členskou kartičku (loyalty card) |
| **Coupon** | `coupon` | Vouchery / slevové kupóny |
| **Order** | Order Tracking (iOS 16+) | Sledování objednávky a zásilky |

### 2.2 PassKit architektura

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLE WALLET FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Generování passu (server-side)                         │
│     ├── pass.json (metadata, pole, barcode)                │
│     ├── icon.png, logo.png, strip.png (assets)             │
│     ├── WWDR certificate + Pass Signing Certificate        │
│     └── → .pkpass soubor (ZIP + podpis)                    │
│                                                             │
│  2. Distribuce                                              │
│     ├── Web: Content-Type: application/vnd.apple.pkpass    │
│     ├── Email: příloha .pkpass                              │
│     ├── App: PassKit framework (Expo module)               │
│     └── QR kód: odkaz na download endpoint                 │
│                                                             │
│  3. Aktualizace (push updates)                             │
│     ├── Registrace: Apple volá náš webServiceURL           │
│     │   POST /v1/devices/{deviceLibraryIdentifier}         │
│     │        /registrations/{passTypeIdentifier}/{serial}  │
│     ├── Check for updates:                                  │
│     │   GET /v1/devices/{deviceLibraryIdentifier}          │
│     │       /registrations/{passTypeIdentifier}            │
│     ├── Fetch updated pass:                                 │
│     │   GET /v1/passes/{passTypeIdentifier}/{serial}       │
│     ├── Push notification (APNs typ 2):                    │
│     │   → Apple probudí zařízení                            │
│     │   → Zařízení zavolá GET na naše API                  │
│     │   → Stáhne aktualizovaný .pkpass                     │
│     └── Odregistrace:                                       │
│         DELETE /v1/devices/{...}/registrations/{...}/{...}  │
│                                                             │
│  4. Order Tracking (iOS 16+)                               │
│     ├── OrderTypeIdentifier (registrace u Apple)           │
│     ├── order.json + podpis                                 │
│     ├── Aktualizace stavu: pending→shipped→delivered       │
│     └── Push updates přes APNs                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Požadavky na Apple Developer Account

| Položka | Potřeba | Cena |
|---------|---------|------|
| Apple Developer Program | Povinné | $99/rok (již máme pro mobilní app) |
| Pass Type ID | Povinné | Zdarma (registrace v dev portálu) |
| Pass Signing Certificate | Povinné | Zdarma (generuje se v dev portálu) |
| Order Type ID | Povinné pro Order Tracking | Zdarma (iOS 16+) |
| WWDR Intermediate Certificate | Povinné | Zdarma (Apple ho poskytuje) |
| APNs Push Certificate | Povinné pro updaty | Zdarma |

---

## 3) Architektura řešení

### 3.1 Celkový design

```
┌──────────────────────────────────────────────────────────┐
│                     PLATFORM BACKEND                        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────┐    ┌──────────────────────────┐    │
│  │  Supabase Edge   │    │  PassKit Service          │    │
│  │  Functions       │    │  (Cloudflare Worker /     │    │
│  │                  │───▶│   nebo Supabase Edge Fn)  │    │
│  │  • membership    │    │                           │    │
│  │    webhooks      │    │  • generateMemberPass()   │    │
│  │  • order status  │    │  • generateOrderPass()    │    │
│  │    webhooks      │    │  • generateVoucherPass()  │    │
│  │  • shipment      │    │  • updatePass()           │    │
│  │    events        │    │  • revokePass()           │    │
│  └─────────────────┘    │                           │    │
│                          │  Pass Update API:         │    │
│  ┌─────────────────┐    │  • POST register device   │    │
│  │  DB Tables       │    │  • GET serial numbers     │    │
│  │                  │    │  • GET latest pass        │    │
│  │  • wallet_passes │    │  • DELETE unregister      │    │
│  │  • wallet_device │    │  • POST log              │    │
│  │    _registrations│    └──────────────────────────┘    │
│  │  • wallet_pass   │              │                     │
│  │    _updates      │              │                     │
│  └─────────────────┘              │                     │
│                                    ▼                     │
│                          ┌──────────────────────────┐    │
│                          │  APNs Push Service        │    │
│                          │  (push update trigger)    │    │
│                          └──────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌──────────────────────┐
│  Web (React)     │          │  Mobile (Expo)        │
│  • "Přidat do    │          │  • PassKit module      │
│    Wallet" btn   │          │  • "Přidat do          │
│  • Download      │          │    Wallet" nativně    │
│    .pkpass        │          │  • Order tracking     │
└─────────────────┘          │    v peněžence        │
                              └──────────────────────┘
```

### 3.2 Proč vlastní PassKit Service (ne 3rd-party SaaS)

| Kritérium | Vlastní řešení | SaaS (Passkit.com, Airship) |
|-----------|----------------|-----------------------------|
| Cena | ~0 (edge functions) | $100–500/měsíc |
| sensitive data compliance | Plná kontrola | ⚠️ Třetí strana = GDPR risk |
| Customizace | Plná | Omezená |
| Latence | Nízká (edge) | Variabilní |
| Závislost | Žádná | Vendor lock-in |
| Složitost implementace | Střední (2-3 týdny) | Nízká (1 týden) |

**Doporučení:** Vlastní řešení — máme Edge Functions, máme certifikáty, sensitive data compliance vyžaduje kontrolu nad daty.

---

## 4) Data model — nové tabulky

### 4.1 `wallet_passes`

Hlavní tabulka pro všechny typy wallet passů.

```sql
CREATE TABLE public.wallet_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Vazby
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Typ a reference
  pass_type text NOT NULL CHECK (pass_type IN ('membership', 'order', 'voucher', 'event')),
  reference_id uuid,                    -- FK na memberships.id / orders.id / product_vouchers.id
  
  -- Apple PassKit identifikátory
  pass_type_identifier text NOT NULL,   -- com.app.example.membership / .order / .voucher
  serial_number text NOT NULL,          -- Unikátní serial pro Apple
  authentication_token text NOT NULL,   -- Token pro API autentizaci (min 16 znaků)
  
  -- Stav
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'voided')),
  
  -- Verze (pro update detection)
  version integer NOT NULL DEFAULT 1,
  last_modified_at timestamptz NOT NULL DEFAULT now(),
  
  -- Metadata
  pass_data_json jsonb NOT NULL DEFAULT '{}',  -- Snapshot dat v passu (pro audit)
  
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Constraints
  UNIQUE (pass_type_identifier, serial_number)
);

ALTER TABLE public.wallet_passes ENABLE ROW LEVEL SECURITY;

-- Indexy
CREATE INDEX idx_wallet_passes_user_id ON public.wallet_passes(user_id);
CREATE INDEX idx_wallet_passes_reference ON public.wallet_passes(pass_type, reference_id);
CREATE INDEX idx_wallet_passes_serial ON public.wallet_passes(pass_type_identifier, serial_number);
CREATE INDEX idx_wallet_passes_status ON public.wallet_passes(status);
```

### 4.2 `wallet_device_registrations`

Apple Wallet registrace zařízení pro push updaty.

```sql
CREATE TABLE public.wallet_device_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Apple identifikátory
  device_library_identifier text NOT NULL,  -- Unikátní ID zařízení od Apple
  push_token text NOT NULL,                  -- APNs push token
  
  -- Vazba na pass
  pass_id uuid NOT NULL REFERENCES public.wallet_passes(id) ON DELETE CASCADE,
  pass_type_identifier text NOT NULL,
  serial_number text NOT NULL,
  
  -- Timestamps
  registered_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  
  -- Constraints
  UNIQUE (device_library_identifier, pass_type_identifier, serial_number)
);

ALTER TABLE public.wallet_device_registrations ENABLE ROW LEVEL SECURITY;

-- Indexy
CREATE INDEX idx_wallet_device_reg_pass ON public.wallet_device_registrations(pass_id);
CREATE INDEX idx_wallet_device_reg_device ON public.wallet_device_registrations(device_library_identifier);
CREATE INDEX idx_wallet_device_reg_lookup 
  ON public.wallet_device_registrations(pass_type_identifier, serial_number);
```

### 4.3 `wallet_pass_events` (audit log)

```sql
CREATE TABLE public.wallet_pass_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  pass_id uuid NOT NULL REFERENCES public.wallet_passes(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'created', 'downloaded', 'registered', 'unregistered', 
    'updated', 'push_sent', 'push_failed', 'revoked', 'expired',
    'device_registered', 'device_unregistered'
  )),
  
  -- Kontext
  device_library_identifier text,
  metadata jsonb DEFAULT '{}',
  
  -- Timestamps
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.wallet_pass_events ENABLE ROW LEVEL SECURITY;

-- Index
CREATE INDEX idx_wallet_pass_events_pass ON public.wallet_pass_events(pass_id);
CREATE INDEX idx_wallet_pass_events_type ON public.wallet_pass_events(event_type);
```

---

## 5) Pass #1 — Členská kartička (Membership Pass)

### 5.1 Účel

Digitální průkaz člena PLATFORM v Apple Wallet s:
- Jméno člena, tier, QR kód
- Expirace členství, stav
- Automatické updaty při změně tieru/stavu/expirace
- Push notifikace: "Vaše členství vyprší za 7 dní"

### 5.2 Vizuální design (pass.json struktura)

```
┌─────────────────────────────────────────────┐
│  ┌──────┐                                   │
│  │ LOGO │  PLATFORM by RTN                    │
│  └──────┘                          MEMBER   │
│─────────────────────────────────────────────│
│                                             │
│  ███████████████████████████████████████    │
│  ███████████ STRIP IMAGE ███████████████    │
│  ███████████████████████████████████████    │
│                                             │
│  JMÉNO              TIER                    │
│  Jan Novák          Upgraded ★★            │
│                                             │
│  PLATNÉ DO          TOKENY                  │
│  15.03.2027         1 250 PLATFORM            │
│                                             │
│         ┌─────────────────┐                 │
│         │   ██  ██  ██    │                 │
│         │  █  ██  ██  █   │  QR KÓD        │
│         │   ██  ██  ██    │  (member_id)    │
│         └─────────────────┘                 │
│                                             │
│  BACK FIELDS:                               │
│  • Member ID: abc-123-def                   │
│  • Registrace: 01.01.2025                   │
│  • Subscription: Premium Quarterly          │
│  • Web: members.app.example                  │
│  • Podpora: support@app.example              │
│─────────────────────────────────────────────│
└─────────────────────────────────────────────┘
```

### 5.3 pass.json template

```json
{
  "formatVersion": 1,
  "passTypeIdentifier": "pass.com.platform.membership",
  "teamIdentifier": "XXXXXXXXXX",
  "organizationName": "PLATFORM by RTN",
  "description": "PLATFORM Membership Card",
  "serialNumber": "{{serial_number}}",
  "authenticationToken": "{{auth_token}}",
  "webServiceURL": "https://api.app.example/wallet",
  
  "generic": {
    "primaryFields": [
      {
        "key": "member_name",
        "label": "ČLEN",
        "value": "{{full_name}}"
      }
    ],
    "secondaryFields": [
      {
        "key": "tier",
        "label": "TIER",
        "value": "{{tier_display}}",
        "textAlignment": "PKTextAlignmentLeft"
      },
      {
        "key": "expires",
        "label": "PLATNÉ DO",
        "value": "{{expires_at}}",
        "dateStyle": "PKDateStyleMedium",
        "textAlignment": "PKTextAlignmentRight"
      }
    ],
    "auxiliaryFields": [
      {
        "key": "tokens",
        "label": "PLATFORM TOKENY",
        "value": "{{tokens_platform}}",
        "textAlignment": "PKTextAlignmentLeft"
      },
      {
        "key": "status",
        "label": "STAV",
        "value": "{{status_display}}",
        "textAlignment": "PKTextAlignmentRight"
      }
    ],
    "backFields": [
      {
        "key": "member_id",
        "label": "Member ID",
        "value": "{{membership_id}}"
      },
      {
        "key": "registered",
        "label": "Člen od",
        "value": "{{created_at}}"
      },
      {
        "key": "subscription",
        "label": "Předplatné",
        "value": "{{subscription_name}}"
      },
      {
        "key": "website",
        "label": "Web",
        "value": "https://members.app.example",
        "attributedValue": "<a href='https://members.app.example'>members.app.example</a>"
      },
      {
        "key": "support",
        "label": "Podpora",
        "value": "support@app.example"
      }
    ]
  },
  
  "barcode": {
    "format": "PKBarcodeFormatQR",
    "message": "platform://member/{{membership_id}}",
    "messageEncoding": "iso-8859-1"
  },
  "barcodes": [
    {
      "format": "PKBarcodeFormatQR",
      "message": "platform://member/{{membership_id}}",
      "messageEncoding": "iso-8859-1"
    }
  ],
  
  "backgroundColor": "rgb(26, 26, 46)",
  "foregroundColor": "rgb(255, 255, 255)",
  "labelColor": "rgb(180, 180, 200)",
  
  "relevantDate": "{{expires_at}}",
  "expirationDate": "{{expires_at_iso}}",
  
  "sharingProhibited": true
}
```

### 5.4 Triggery pro update membership passu

| Událost | Zdroj | Akce |
|---------|-------|------|
| Tier upgrade/downgrade | `memberships.tier` UPDATE | Regenerovat pass, push update |
| Status change (active→expired) | `memberships.status` UPDATE | Update pass + push notifikace |
| Expirace blížící se (7d/1d) | Cron job / scheduled function | Push update s `relevantDate` |
| Token balance change | `user_wallets` UPDATE | Update auxiliary field "tokeny" |
| Prodloužení členství | `memberships.expires_at` UPDATE | Update expiration field + push |
| Zrušení členství | `memberships.status` = 'cancelled' | Revoke pass |

### 5.5 Distribuce membership passu

| Kanál | Implementace |
|-------|-------------|
| Web (po přihlášení) | Tlačítko "Přidat do Apple Wallet" na profilu člena |
| Web (po nákupu) | Automatická nabídka na checkout stránce po dokončení |
| Email (welcome) | Příloha .pkpass v welcome emailu |
| Mobile app (Expo) | Nativní PassKit API přes expo module |
| QR kód (karta) | QR na fyzické kartičce → download endpoint |

---

## 6) Pass #2 — Objednávky a Tracking (Order Pass)

### 6.1 Účel

Při vytvoření objednávky se vygeneruje Order pass, který žije v Wallet a automaticky aktualizuje stav:

```
pending → awaiting_payment → paid → processing → shipped → in_transit → delivered
```

Každá změna stavu = push notifikace v peněžence.

### 6.2 Dvě varianty implementace

#### Varianta A: Generic Pass (kompatibilní iOS 6+)

Klasický `.pkpass` soubor typu `generic` se všemi informacemi o objednávce.

**Výhody:** Široká kompatibilita (všechny iPhony s Wallet)  
**Nevýhody:** Méně nativní look, žádná mapa pro tracking

#### Varianta B: Order Tracking (iOS 16+ / Wallet Orders)

Apple native Order Tracking API — objednávka se objeví přímo v sekci "Orders" ve Wallet.

**Výhody:** Nativní UX, automatická mapa, timeline, line items  
**Nevýhody:** Pouze iOS 16+, složitější implementace (Order Type ID, `.order` bundle)

**Doporučení:** Implementovat **obě varianty** — iOS 16+ dostane native Order Tracking, starší iOS dostane Generic pass. Detekce na straně serveru dle User-Agent nebo nabídnout obě možnosti.

### 6.3 Order Pass — Generic varianta

```
┌─────────────────────────────────────────────┐
│  ┌──────┐                                   │
│  │ LOGO │  PLATFORM by RTN           OBJEDNÁ  │
│  └──────┘                          VKA      │
│─────────────────────────────────────────────│
│                                             │
│  OBJEDNÁVKA          STAV                   │
│  #2026-0234          📦 Odesláno            │
│                                             │
│  DATUM               DOPRAVA                │
│  18.02.2026          Zásilkovna             │
│                                             │
│  CELKEM              SLEDOVÁNÍ              │
│  1 290 Kč            zásilkovna.cz/xxx      │
│                                             │
│         ┌─────────────────┐                 │
│         │   BARCODE       │                 │
│         │  (packeta id)   │                 │
│         └─────────────────┘                 │
│                                             │
│  BACK FIELDS:                               │
│  • Položky: Product A ×2, Product B ×1      │
│  • Doprava: Zásilkovna – Outlet Centrum     │
│  • Platba: Stripe (visa •••• 4242)          │
│  • Faktura: FV-2026-0234                    │
│  • Sledování: https://tracking.packeta...   │
│─────────────────────────────────────────────│
└─────────────────────────────────────────────┘
```

### 6.4 Order Tracking — iOS 16+ varianta (order.json)

```json
{
  "orderTypeIdentifier": "order.com.platform",
  "orderIdentifier": "{{order_id}}",
  "orderManagementURL": "https://app.example/orders/{{order_id}}",
  "orderType": "ecommerce",
  "status": {
    "value": "{{status}}",
    "lastUpdated": "{{updated_at}}"
  },
  "merchant": {
    "merchantIdentifier": "merchant.com.platform",
    "displayName": "PLATFORM by RTN",
    "url": "https://app.example",
    "logo": "merchant_logo.png"
  },
  "payment": {
    "total": {
      "amount": "{{total}}",
      "currency": "{{currency}}"
    },
    "paymentMethods": [
      {
        "type": "{{payment_method_type}}",
        "displayName": "{{payment_display}}"
      }
    ]
  },
  "lineItems": [
    {
      "title": "{{product_name}}",
      "subtitle": "{{product_sku}}",
      "quantity": {{quantity}},
      "price": {
        "amount": "{{price}}",
        "currency": "{{currency}}"
      },
      "image": "{{product_image}}"
    }
  ],
  "fulfillments": [
    {
      "fulfillmentIdentifier": "{{shipment_id}}",
      "status": "{{fulfillment_status}}",
      "carrier": "Zásilkovna",
      "trackingNumber": "{{packeta_packet_id}}",
      "trackingURL": "{{tracking_url}}",
      "estimatedDeliveryDate": "{{estimated_delivery}}",
      "shippingAddress": {
        "name": "{{recipient_name}}",
        "city": "{{city}}",
        "postalCode": "{{postal_code}}",
        "country": "{{country}}"
      }
    }
  ],
  "createdAt": "{{created_at}}",
  "updatedAt": "{{updated_at}}"
}
```

### 6.5 Mapování order_status → Wallet status

| `order_status` (DB) | Wallet Pass zobrazení | Wallet Order status | Barva |
|---------|------|------|-------|
| `pending` | ⏳ Čeká na zpracování | `open` | Šedá |
| `awaiting_payment` | 💳 Čeká na platbu | `open` | Žlutá |
| `paid` | ✅ Zaplaceno | `processing` | Zelená |
| `processing` | 📋 Zpracovává se | `processing` | Modrá |
| `shipped` | 📦 Odesláno | `shipped` | Modrá |
| `in_transit` | 🚚 Na cestě | `shipped` | Modrá |
| `delivered` | ✅ Doručeno | `complete` | Zelená |
| `cancelled` | ❌ Zrušeno | `cancelled` | Červená |
| `refunded` | 💰 Vráceno | `issue` | Oranžová |

### 6.6 Triggery pro update order passu

| Událost | Zdroj | Akce |
|---------|-------|------|
| Stav objednávky se změní | `orders.status` UPDATE trigger | Update pass fields + push |
| Tracking URL přidáno | `orders.tracking_url` UPDATE | Přidat tracking info + push |
| Packeta barcode přiřazen | `orders.packeta_barcode` UPDATE | Update barcode na passu |
| Zásilka odeslána | `orders.shipped_at` SET | "📦 Vaše objednávka byla odeslána" |
| Zásilka doručena | `orders.delivered_at` SET | "✅ Objednávka doručena" + voiding po 30d |
| Faktura vygenerována | `orders.invoice_number` SET | Přidat do back fields |

### 6.7 Integrace se Zásilkovnou (Packeta)

Stávající data, která máme k dispozici pro tracking pass:

| Pole v DB | Využití v passu |
|-----------|----------------|
| `packeta_branch_id` | Název a adresa výdejního místa (back field) |
| `packeta_packet_id` | Číslo zásilky (auxiliary field) |
| `packeta_barcode` | Barcode na passu (pro vyzvednutí na pobočce) |
| `tracking_url` | Odkaz na sledování (back field + tap action) |
| `shipping_method` | Typ dopravy (packeta_pickup / packeta_home / personal_pickup) |
| `shipping_address` (JSON) | Doručovací adresa (back field) |

**Packeta pickup specifika:**
- Pass může obsahovat `locations[]` s GPS souřadnicemi výdejního místa
- Zákazník dostane notifikaci, když je poblíž výdejního místa
- Barcode na passu = přímo použitelný pro vyzvednutí

```json
{
  "locations": [
    {
      "latitude": 50.0755,
      "longitude": 14.4378,
      "relevantText": "Vaše zásilka čeká na pobočce Zásilkovny"
    }
  ]
}
```

---

## 7) Pass #3 — Vouchery / Kupóny (Coupon Pass)

### 7.1 Účel

Členové, kteří nakoupí voucher za tokeny (`purchase_product_voucher`), dostanou voucher pass do peněženky.

### 7.2 Vizuální design

```
┌─────────────────────────────────────────────┐
│  ┌──────┐                                   │
│  │ LOGO │  PLATFORM by RTN           KUPÓN    │
│  └──────┘                                   │
│─────────────────────────────────────────────│
│                                             │
│  ███████████████████████████████████████    │
│  █████   -20% NA PRVNÍ OBJEDNÁVKU  ████    │
│  ███████████████████████████████████████    │
│                                             │
│  KÓD                 PLATNÝ DO              │
│  PLATFORM-ABC123       28.02.2026             │
│                                             │
│         ┌─────────────────┐                 │
│         │   ██  ██  ██    │                 │
│         │  BARCODE/QR     │                 │
│         │   ██  ██  ██    │                 │
│         └─────────────────┘                 │
│                                             │
│  BACK FIELDS:                               │
│  • Sleva: 20% na celou objednávku           │
│  • Min. objednávka: 500 Kč                  │
│  • Nelze kombinovat s jinými slevami        │
│  • Web: shop.app.example                     │
│─────────────────────────────────────────────│
└─────────────────────────────────────────────┘
```

### 7.3 Lifecycle

| Událost | Akce |
|---------|------|
| Voucher zakoupen (tokeny) | Generovat coupon pass |
| Voucher uplatněn | Voiding pass (přeškrtnutí) + push "Kupón uplatněn" |
| Voucher expiroval | Expire pass + push "Kupón vypršel" |

---

## 8) API Endpointy — PassKit Web Service

Apple Wallet vyžaduje standardní REST API pro registraci zařízení a stahování updatů.

### 8.1 Povinné endpointy (Apple specifikace)

```
Base URL: https://api.app.example/wallet/v1

┌─────────────────────────────────────────────────────────────────────┐
│ Endpoint                                                    │ Auth │
├─────────────────────────────────────────────────────────────────────┤
│ POST   /devices/{deviceLibId}/registrations/{passTypeId}/{serial}  │
│        → Registrace zařízení pro push updaty                │ Token│
│                                                                     │
│ GET    /devices/{deviceLibId}/registrations/{passTypeId}            │
│        → Seznam serialů registrovaných pro toto zařízení    │ ---  │
│        Query: ?passesUpdatedSince={tag}                             │
│                                                                     │
│ GET    /passes/{passTypeId}/{serial}                                │
│        → Stáhne aktuální .pkpass soubor                     │ Token│
│        Header: If-Modified-Since                                    │
│                                                                     │
│ DELETE /devices/{deviceLibId}/registrations/{passTypeId}/{serial}   │
│        → Odregistrace zařízení                              │ Token│
│                                                                     │
│ POST   /log                                                        │
│        → Log zprávy z Apple Wallet (pro debugging)          │ ---  │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 Naše custom endpointy (pro frontend/mobilní app)

```
Base URL: https://api.app.example/wallet

┌─────────────────────────────────────────────────────────────────────┐
│ Endpoint                                              │ Auth       │
├─────────────────────────────────────────────────────────────────────┤
│ GET    /membership-pass                               │ JWT (user) │
│        → Vygeneruje a stáhne membership .pkpass       │            │
│        Content-Type: application/vnd.apple.pkpass      │            │
│                                                                     │
│ GET    /order-pass/{orderId}                           │ JWT (user) │
│        → Vygeneruje a stáhne order .pkpass             │            │
│                                                                     │
│ GET    /order-tracking/{orderId}                       │ JWT (user) │
│        → Vygeneruje .order bundle (iOS 16+)            │            │
│        Content-Type: application/vnd.apple.order        │            │
│                                                                     │
│ GET    /voucher-pass/{voucherId}                       │ JWT (user) │
│        → Vygeneruje voucher .pkpass                    │            │
│                                                                     │
│ GET    /passes                                         │ JWT (user) │
│        → Seznam aktivních passů uživatele              │            │
│                                                                     │
│ DELETE /passes/{passId}                                │ JWT (user) │
│        → Revoke/void pass                              │            │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.3 Autentizace

| Endpoint typ | Auth metoda |
|-------------|-------------|
| Apple Web Service API | `Authorization: ApplePass {{authentication_token}}` (token z pass.json) |
| Custom endpointy | `Authorization: Bearer {{supabase_jwt}}` |

---

## 9) Push Updates — APNs integrace

### 9.1 Flow

```
1. Změna v DB (trigger / webhook)
     │
     ▼
2. PassKit Service detekuje změnu
     │
     ▼
3. Najde registrovaná zařízení pro daný pass
   (SELECT FROM wallet_device_registrations WHERE pass_id = ...)
     │
     ▼
4. Pošle prázdný push přes APNs (type 2)
   → Apple probudí Wallet na zařízení
     │
     ▼
5. Wallet zavolá GET /devices/{id}/registrations/{passTypeId}
   → Zjistí, které passy se změnily (lastUpdated tag)
     │
     ▼
6. Wallet zavolá GET /passes/{passTypeId}/{serial}
   → Stáhne nový .pkpass
     │
     ▼
7. Pass se aktualizuje v peněžence uživatele
```

### 9.2 APNs Push (type 2 — silent)

```
POST https://api.push.apple.com/3/device/{push_token}
Headers:
  apns-topic: pass.com.platform.membership
  apns-push-type: background
  apns-priority: 5
Body: {}
```

**Důležité:** Push pro wallet je prázdný (type 2) — neobsahuje žádná data. Pouze budí zařízení, které si pak samo stáhne nový pass.

### 9.3 DB Triggery pro push

```sql
-- Trigger na orders tabulce
CREATE OR REPLACE FUNCTION notify_wallet_pass_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pass_id uuid;
BEGIN
  -- Najdi pass pro tuto objednávku
  SELECT id INTO v_pass_id
  FROM wallet_passes
  WHERE reference_id = NEW.id
    AND pass_type = 'order'
    AND status = 'active';
  
  IF v_pass_id IS NOT NULL THEN
    -- Inkrementuj verzi
    UPDATE wallet_passes
    SET version = version + 1,
        last_modified_at = now(),
        updated_at = now()
    WHERE id = v_pass_id;
    
    -- Zaloguj event
    INSERT INTO wallet_pass_events (pass_id, event_type, metadata)
    VALUES (v_pass_id, 'updated', jsonb_build_object(
      'trigger', 'order_status_change',
      'old_status', OLD.status,
      'new_status', NEW.status
    ));
    
    -- Notifikuj edge function (pg_notify nebo queue)
    PERFORM pg_notify('wallet_pass_update', json_build_object(
      'pass_id', v_pass_id,
      'pass_type', 'order',
      'reference_id', NEW.id
    )::text);
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_wallet_update
  AFTER UPDATE OF status, tracking_url, packeta_barcode, shipped_at, delivered_at
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_wallet_pass_update();
```

---

## 10) Mobilní app integrace (Expo)

### 10.1 Expo PassKit modul

Expo nemá vestavěný PassKit modul. Potřebujeme:

| Možnost | Popis | Doporučení |
|---------|-------|------------|
| `react-native-passkit-wallet` | Community knihovna | ⚠️ Omezeně udržovaná |
| `expo-apple-wallet` | Neexistuje oficiálně | ❌ |
| Custom Expo Module | Nativní Swift wrapping PassKit | ✅ **Doporučeno** |
| WebView fallback | Otevřít URL → Safari → "Add to Wallet" | ✅ Záloha |

### 10.2 Custom Expo Module — `expo-wallet-pass`

```swift
// ios/ExpoWalletPassModule.swift
import ExpoModulesCore
import PassKit

public class ExpoWalletPassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoWalletPass")
    
    // Zkontroluje, zda zařízení podporuje Wallet
    Function("isAvailable") { () -> Bool in
      return PKPassLibrary.isPassLibraryAvailable()
    }
    
    // Přidá pass z URL (stáhne .pkpass a zobrazí dialog)
    AsyncFunction("addPassFromURL") { (urlString: String) -> Bool in
      // Download .pkpass → PKPass → PKAddPassesViewController
    }
    
    // Přidá pass z base64 dat
    AsyncFunction("addPassFromData") { (base64Data: String) -> Bool in
      // Decode → PKPass → PKAddPassesViewController
    }
    
    // Zkontroluje, zda pass už je v peněžence
    AsyncFunction("containsPass") { (passTypeId: String, serialNumber: String) -> Bool in
      let library = PKPassLibrary()
      return library.containsPass(/* ... */)
    }
    
    // Otevře pass ve Wallet
    AsyncFunction("openPass") { (passTypeId: String, serialNumber: String) -> Void in
      // PKPassLibrary → open pass in Wallet app
    }
  }
}
```

### 10.3 React Native hook

```typescript
// mobile-app/src/hooks/useWalletPass.ts
import { useCallback, useState } from 'react';
import * as ExpoWalletPass from '../modules/expo-wallet-pass';

export function useWalletPass() {
  const [isAdding, setIsAdding] = useState(false);
  
  const isAvailable = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'ios') return false;
    return ExpoWalletPass.isAvailable();
  }, []);
  
  const addMembershipPass = useCallback(async (token: string) => {
    setIsAdding(true);
    try {
      const url = `${API_URL}/wallet/membership-pass`;
      return await ExpoWalletPass.addPassFromURL(url);
    } finally {
      setIsAdding(false);
    }
  }, []);
  
  const addOrderPass = useCallback(async (orderId: string) => {
    setIsAdding(true);
    try {
      const url = `${API_URL}/wallet/order-pass/${orderId}`;
      return await ExpoWalletPass.addPassFromURL(url);
    } finally {
      setIsAdding(false);
    }
  }, []);
  
  return { isAvailable, addMembershipPass, addOrderPass, isAdding };
}
```

---

## 11) Web integrace

### 11.1 "Add to Apple Wallet" tlačítko

Apple poskytuje oficiální badge/tlačítko, které se musí použít.

```tsx
// src/components/wallet/AddToWalletButton.tsx
import { useTranslation } from 'react-i18next';

interface AddToWalletButtonProps {
  passType: 'membership' | 'order' | 'voucher';
  referenceId?: string;
}

export function AddToWalletButton({ passType, referenceId }: AddToWalletButtonProps) {
  const { t } = useTranslation();
  
  const handleAdd = async () => {
    const endpoint = passType === 'membership'
      ? '/wallet/membership-pass'
      : passType === 'order'
        ? `/wallet/order-pass/${referenceId}`
        : `/wallet/voucher-pass/${referenceId}`;
    
    // Redirect / download .pkpass
    window.location.href = `${API_URL}${endpoint}?token=${session.access_token}`;
  };
  
  // Pouze iOS/macOS (detekce přes User-Agent)
  if (!isAppleDevice) return null;
  
  return (
    <button onClick={handleAdd} className="apple-wallet-button">
      <img 
        src="/images/add-to-apple-wallet.svg" 
        alt={t("wallet.addToAppleWallet")} 
      />
    </button>
  );
}
```

### 11.2 Kde zobrazit tlačítko

| Místo | Typ passu | Podmínka |
|-------|-----------|----------|
| Profil člena (`/profile`) | Membership | `membership.status === 'active'` |
| Checkout success page | Order | Po dokončení objednávky |
| Moje objednávky (`/orders`) | Order | U každé objednávky |
| Detail objednávky | Order | Vždy |
| Moje vouchery | Voucher | U aktivních voucherů |
| Email (order confirmation) | Order | Příloha .pkpass |
| Email (membership welcome) | Membership | Příloha .pkpass |

---

## 12) Google Wallet (rozšíření)

Pro kompletnost by se měla implementovat i Google Wallet podpora (Android uživatelé). Google Wallet API je odlišný (JWT-based, ne .pkpass), ale data model je sdílený.

### 12.1 Porovnání

| Aspekt | Apple Wallet | Google Wallet |
|--------|-------------|---------------|
| Formát | .pkpass (ZIP + podpis) | JWT (signed JSON) |
| Registrace | Pass Type ID + certifikát | Google Cloud Console + Service Account |
| Update mechanismus | APNs push + web service | Google Wallet API (REST) |
| Distribuce | Download .pkpass / PassKit API | "Save to Google Wallet" button + JWT link |
| Typy | generic, coupon, eventTicket, storeCard | loyaltyCard, offerObject, eventTicket, genericObject |
| Podepisování | PKCS#7 certifikátem | JWS (JSON Web Signature) service accountem |

### 12.2 Doporučení

Implementovat Google Wallet jako **fáze 2** se sdíleným data modelem (`wallet_passes` tabulka už má `pass_type_identifier`, stačí přidat `platform` enum: `apple` / `google`).

---

## 13) Bezpečnost a compliance

### 13.1 sensitive data pravidla

| Co | Povoleno v passu | Poznámka |
|----|-------------------|----------|
| Jméno člena | ✅ | Nutné pro identifikaci |
| Email | ❌ | Pouze v back fields, ne na přední straně |
| Zdravotní data | ❌ NIKDY | Žádné check-in data, diagnózy, suplementy |
| Tier/Status členství | ✅ | Veřejné metadata |
| Token balance | ✅ | Gamifikace, ne sensitive data |
| Objednávky / položky | ✅ | Názvy produktů, ceny |
| Adresa doručení | ⚠️ | Pouze v back fields, zkrácená forma |
| Platební údaje | ❌ | Pouze typ platby (visa ••••4242) |

### 13.2 Ochrana authentication tokenu

- Token nesmí být odvoditelný z veřejných dat (UUID v4)
- Token se posílá pouze přes HTTPS
- Token se neloguje (ani do audit_journal metadata)
- Token se hashuje v DB pro porovnání (bcrypt/argon2 je overkill, SHA-256 stačí)

### 13.3 Expirace a revokace

| Scénář | Akce |
|--------|------|
| Členství expiruje | Pass automaticky expiruje (`expirationDate` v pass.json) |
| Členství zrušeno | Revoke pass (voided = přeškrtnuté) |
| Objednávka doručena 30+ dní | Automaticky archivovat (nemazat) |
| Uživatel smaže účet | Revoke všechny passy + smazat registrace |
| Security incident | Batch revoke všech passů + rotace tokenů |

### 13.4 Audit trail

Každá operace s passy se loguje do `wallet_pass_events`:
- Generování passu
- Stažení passu
- Registrace zařízení
- Push update poslán
- Revokace

---

## 14) Implementační plán (fáze)

### Fáze 1 — Základ (2-3 týdny)

| # | Úkol | Priorita |
|---|------|----------|
| 1.1 | Apple Developer: registrace Pass Type IDs + certifikáty | P0 |
| 1.2 | DB migrace: `wallet_passes`, `wallet_device_registrations`, `wallet_pass_events` | P0 |
| 1.3 | PassKit Service: generování .pkpass (signing, zipping) | P0 |
| 1.4 | Membership Pass: generování + stažení | P0 |
| 1.5 | Web: "Add to Wallet" tlačítko na profilu | P0 |
| 1.6 | Testy: generování passu, validace struktury | P0 |

### Fáze 2 — Order Pass + Updates (2-3 týdny)

| # | Úkol | Priorita |
|---|------|----------|
| 2.1 | Order Pass: generování při vytvoření objednávky | P0 |
| 2.2 | Apple Web Service API (register/unregister/get serials/get pass) | P0 |
| 2.3 | APNs integrace pro push updates | P0 |
| 2.4 | DB triggery pro automatické updaty | P0 |
| 2.5 | Zásilkovna tracking integrace v passu | P1 |
| 2.6 | iOS 16+ Order Tracking (Wallet Orders) | P1 |
| 2.7 | Checkout success page: nabídka "Add to Wallet" | P1 |

### Fáze 3 — Mobile App + Vouchery (1-2 týdny)

| # | Úkol | Priorita |
|---|------|----------|
| 3.1 | Expo PassKit modul (`expo-wallet-pass`) | P1 |
| 3.2 | Mobile app: "Add to Wallet" v profilu a objednávkách | P1 |
| 3.3 | Voucher/Coupon pass | P2 |
| 3.4 | Email přílohy (.pkpass v order confirmation a welcome) | P2 |

### Fáze 4 — Polish + Google Wallet (2-3 týdny)

| # | Úkol | Priorita |
|---|------|----------|
| 4.1 | Google Wallet: loyalty card + order tracking | P2 |
| 4.2 | Cron job: expirace a upozornění (7d/1d před) | P2 |
| 4.3 | Admin panel: přehled wallet passů, statistiky | P3 |
| 4.4 | Monitoring: metriky (passes issued, updates sent, errors) | P3 |
| 4.5 | Lokalizace passů (CZ/EN/DE) | P2 |

---

## 15) Závislosti a prerekvizity

### 15.1 Apple Developer Account

| Položka | Akce |
|---------|------|
| Pass Type ID | Zaregistrovat `pass.com.platform.membership`, `pass.com.platform.order`, `pass.com.platform.voucher` |
| Order Type ID | Zaregistrovat `order.com.platform` (pro iOS 16+ Order Tracking) |
| Signing Certificate | Vygenerovat CSR → Apple → .cer → export .p12 |
| WWDR Certificate | Stáhnout z Apple (Apple Worldwide Developer Relations Certification Authority) |
| APNs Key | Vytvořit APNs auth key (.p8) nebo per-pass certifikát |

### 15.2 Infrastruktura

| Položka | Řešení |
|---------|--------|
| .pkpass generování | Supabase Edge Function nebo Cloudflare Worker |
| APNs push | HTTP/2 client (node `apn` nebo `@parse/node-apn`) |
| Certifikáty storage | Supabase Vault / env proměnné (base64 encoded) |
| Statické assety (ikony) | Supabase Storage nebo CDN |

### 15.3 Knihovny

| Knihovna | Účel | Prostředí |
|---------|------|-----------|
| `passkit-generator` (npm) | Generování .pkpass souborů | Edge Function / Worker |
| `@parse/node-apn` nebo `apns2` | APNs push notifikace | Edge Function / Worker |
| `react-native-passkit-wallet` nebo custom module | PassKit v mobilní app | Expo (iOS) |

---

## 16) Metriky úspěchu

| Metrika | Target (3 měsíce po launch) |
|---------|----------------------------|
| % členů s Wallet passem | > 30% iOS členů |
| Pass retention (pass stále v peněžence) | > 80% po 30 dnech |
| Order pass adoption | > 50% iOS objednávek |
| Push update delivery rate | > 95% |
| Voucher redemption rate (wallet vs email) | Wallet 2× vyšší |
| Churn reduction (členové s passem vs bez) | -15% churn |

---

## 17) Rizika a mitigace

| Riziko | Pravděpodobnost | Dopad | Mitigace |
|--------|-----------------|-------|----------|
| Apple certifikát expirace | Střední | Vysoký | Monitoring + automatický alert 30d předem |
| APNs rate limiting | Nízká | Střední | Batch push, exponential backoff |
| Nekompatibilní starší iOS | Nízká | Nízký | Graceful degradation (generic pass pro < iOS 16) |
| Uživatel smaže pass | Vysoká | Nízký | "Přidat znovu" tlačítko, re-download |
| GDPR / data v passu | Střední | Vysoký | Minimalizace dat, žádné sensitive-data, audit log |
| Zásilkovna API nedostupnost | Střední | Nízký | Cache tracking dat, graceful fallback |
| Expo module nestabilita | Střední | Střední | WebView fallback (Safari → Add to Wallet) |

---

## 18) Otevřené otázky (k rozhodnutí)

1. **Branding:** Přesné barvy, loga, strip images pro passy — potřeba od designéra
2. **Multi-language:** Mají passy být v jazyce uživatele (CZ/EN/DE) nebo vždy EN?
3. **Google Wallet priorita:** Implementovat souběžně s Apple nebo až ve fázi 4?
4. **Order pass automaticky:** Generovat automaticky pro každou objednávku nebo jen na vyžádání?
5. **Email integrace:** Přikládat .pkpass do existujících emailů (Resend/SendGrid) nebo samostatný email?
6. **QR kód na membership passu:** Co se stane při skenování? Redirect na web? Verifikace v admin panelu?
7. **Event passy:** Plánujeme eventy/workshopy? Pokud ano, přidat eventTicket typ.
8. **Offline verifikace:** Potřebujeme verifikovat členskou kartičku offline (např. na pobočce)?

---

## 19) Technické reference

| Zdroj | URL |
|-------|-----|
| Apple PassKit Documentation | https://developer.apple.com/documentation/walletpasses |
| Apple Wallet Web Service Reference | https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes |
| Apple Order Tracking | https://developer.apple.com/documentation/walletorders |
| Pass Design Guidelines | https://developer.apple.com/design/human-interface-guidelines/wallet |
| passkit-generator (npm) | https://github.com/nicola-nicola/passkit-generator |
| Google Wallet API | https://developers.google.com/wallet |
| APNs Provider API | https://developer.apple.com/documentation/usernotifications/sending-push-notifications-using-command-line-tools |

---

## 20) Shrnutí deliverables

| # | Deliverable | Typ |
|---|-------------|-----|
| 1 | DB migrace (3 tabulky + RLS + triggery) | SQL |
| 2 | PassKit Service (Edge Function) | TypeScript |
| 3 | Apple Web Service API (5 endpointů) | TypeScript |
| 4 | Custom API (6 endpointů) | TypeScript |
| 5 | APNs Push Service | TypeScript |
| 6 | Expo PassKit modul | Swift + TypeScript |
| 7 | Web komponenty (AddToWalletButton) | React/TSX |
| 8 | Hooky (useWalletPass, useWalletPassAdmin) | TypeScript |
| 9 | i18n klíče (wallet segment) | JSON |
| 10 | Testy (unit + integration) | TypeScript |
| 11 | Admin panel rozšíření (statistiky passů) | React/TSX |
| 12 | Dokumentace (API docs, setup guide) | Markdown |
