# Agentic Commerce — Implementační plán pro Platform

> **Verze:** 1.0 | **Datum:** 20. února 2026  
> **Status:** Proposal — čeká na schválení před implementací

Implementační plán pro podporu **UCP** (Universal Commerce Protocol) a **ACP** (Agentic Commerce Protocol) v našem e-shopu. Plán je přizpůsobený naší existující architektuře: **Supabase (PostgreSQL + Edge Functions)**, **Stripe**, **Zásilkovna/Packeta**, **Google/Apple OAuth**.

---

## 0) Cíl a rozsah

### Cíl

Rozšířit náš e-shop backend o dvě kompatibilní integrační vrstvy pro AI agenty:

1. **UCP** (Google AI Mode / Gemini) — agent vytvoří košík, dopočítá dopravu (Zásilkovna) / daně / slevy, provede platbu a dokončí objednávku.
2. **ACP** (OpenAI / ChatGPT) — agent provede konverzační checkout přes standardizované endpointy s tokenizovanou Stripe platbou (SPT).

### Co už máme (existující infrastruktura)

| Vrstva | Technologie | Stav |
|--------|-------------|------|
| **Platby** | Stripe Checkout + Webhooks (10+ event typů), Fio Bank auto-matching (VS) | Produkce |
| **Doprava** | Zásilkovna SOAP API (`packeta-api` Edge Fn: create-packet, track, pickup-points) | Produkce |
| **Shipping sazby** | `get_shipping_cost(method, country, currency)` RPC — packeta_pickup 99 CZK / 3.9 EUR, packeta_home 149 CZK / 5.9 EUR, osobní 0 | Produkce |
| **Auth** | Google OAuth, Apple OAuth, Magic Link, Password | Produkce |
| **DB** | PostgreSQL via Supabase, RPC-only pattern, RLS, audit_journal | Produkce |
| **Edge Functions** | `create-checkout-session`, `stripe-webhook`, `packeta-api`, `fio-bank-sync`, `customer-portal` | Produkce |
| **Objednávky** | `create_order_with_items_audited` RPC (multi-item, multi-currency, voucher, shipping) | Produkce |
| **Košík** | `get_my_cart`, `add_to_cart`, `update_cart_quantity`, `remove_from_cart`, `clear_my_cart` RPC | Produkce |
| **Produkty** | Katalog s i18n (title/desc `*_key`), SKU, `stripe_product_id`/`stripe_price_id`, access rules, reviews, vouchery | Produkce |
| **Měny** | CZK (primární), EUR, USD — konverze v DB | Produkce |
| **Checkout** | 9 consent polí (GDPR, production compliance), dual payment (karta + bankovní převod) | Produkce |
| **Order stavy** | `order_status` enum: pending → paid → processing → shipped → delivered / cancelled / refunded (12 stavů) | Produkce |

### Co dodat (deliverables)

- **3 nové Edge Functions:** `ucp-checkout`, `acp-checkout`, `agentic-well-known`
- **Manifesty** `/.well-known/ucp` a `/.well-known/acp` (servované z Edge Function)
- **DB migrace:** tabulka `agent_checkout_sessions`, `agent_api_keys`, rozšíření `orders` o `agent_*` sloupce
- **Napojení na existující:** `create_order_with_items_audited`, `get_shipping_cost`, `get_products_for_checkout`, Stripe API, `packeta-api`
- **Security:** API key auth pro agenty, HMAC podpisy, idempotence, audit trail (do `audit_journal`)
- **Testy:** Happy path + negativní scénáře pro oba protokoly

---

## 1) Kontext: co přesně implementujeme

### UCP — Universal Commerce Protocol

- Merchant publikuje profil `/.well-known/ucp` (JSON) s deklarací services, capabilities, endpointů a payment handlers.
- UCP checkout je standardizovaný přes REST endpointy — agent volá `create/update/complete/cancel` a merchant vrací autoritativní stav košíku.
- **Náš payment handler:** Stripe (`com.stripe` — instrument = Google Pay token / karta → Stripe PaymentIntent).
- **Náš fulfillment:** 3 metody z existujícího `shipping_method` enumu:
  - `packeta_pickup` — výdejní místa Zásilkovna (99 CZK / 3.9 EUR)
  - `packeta_home` — doručení na adresu Zásilkovna (149 CZK / 5.9 EUR)
  - `personal_pickup` — osobní odběr (0 CZK)
- Kompatibilní s AP2 mandates jako volitelná future-proof vrstva.

### ACP — Agentic Commerce Protocol

- Merchant publikuje manifest `/.well-known/acp`.
- Merchant implementuje endpointy `/checkout_sessions` + `/{id}` + `/{id}/complete` + `/{id}/cancel`.
- Platba: agent pošle `payment_data.token` (Stripe SPT) → naše Edge Function vytvoří Stripe PaymentIntent a confirme token.
- **Náš Stripe je already integrated** — SPT flow se napojí na stávající `stripe-webhook` handler pro event processing.

---

## 2) Architektura — napojení na existující systém

### Princip: reuse existujících RPC a Edge Functions, ne duplikace

```
┌─────────────────────────────────────────────────────────────────────┐
│  AI AGENTI                                                          │
│  ┌──────────────────┐     ┌──────────────────┐                     │
│  │ UCP Agent        │     │ ACP Agent        │                     │
│  │ (Google AI Mode) │     │ (ChatGPT)        │                     │
│  └────────┬─────────┘     └────────┬─────────┘                     │
│           │                        │                               │
├───────────┴────────────────────────┴───────────────────────────────┤
│  NOVÉ EDGE FUNCTIONS (Deno, supabase/functions/)                   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ agentic-well-known                                          │   │
│  │ GET /.well-known/ucp  → UCP profil JSON                    │   │
│  │ GET /.well-known/acp  → ACP manifest JSON                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐                │
│  │ ucp-checkout         │  │ acp-checkout         │                │
│  │ POST /checkout-      │  │ POST /checkout_      │                │
│  │   sessions           │  │   sessions           │                │
│  │ GET  /{id}           │  │ POST /{id}           │                │
│  │ PUT  /{id}           │  │ GET  /{id}           │                │
│  │ POST /{id}/complete  │  │ POST /{id}/complete  │                │
│  │ POST /{id}/cancel    │  │ POST /{id}/cancel    │                │
│  └──────────┬───────────┘  └──────────┬───────────┘                │
│             └──────────┬──────────────┘                             │
│                        ▼                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Sdílený modul: _shared/agentic-core/                        │   │
│  │ • SessionManager (state machine, idempotence)               │   │
│  │ • PricingResolver (reuse DB cen + get_shipping_cost RPC)    │   │
│  │ • OrderCreator (volá create_order_with_items_audited RPC)   │   │
│  │ • PaymentProcessor (Stripe PaymentIntent z SPT/instrument)  │   │
│  │ • SignatureVerifier (HMAC-SHA256)                           │   │
│  │ • ApiKeyAuth (validace + rate limiting)                     │   │
│  │ • AuditLogger (→ audit_journal)                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  EXISTUJÍCÍ EDGE FUNCTIONS (beze změn / minimální rozšíření)        │
│  ┌─────────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ stripe-webhook   │ │ packeta-api  │ │ create-checkout-session  │ │
│  │ (10+ events)     │ │ (SOAP+widget)│ │ (pro UI checkout)        │ │
│  └─────────────────┘ └──────────────┘ └──────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  POSTGRESQL (Supabase)                                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ EXISTUJÍCÍ:                                                   │  │
│  │ products, orders, order_items, cart_items, payment_sessions,  │  │
│  │ shipment_settings, stripe_disputes, bank_transactions,        │  │
│  │ audit_journal                                                 │  │
│  │                                                               │  │
│  │ NOVÉ:                                                         │  │
│  │ agent_checkout_sessions — stavový automat agentic sessions    │  │
│  │ agent_api_keys — autentizace agentů (API klíče per platforma) │  │
│  │ orders.agent_* — rozšíření: protocol, agent_profile, proofs  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  EXTERNAL SERVICES (beze změn)                                      │
│  ┌────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────────┐     │
│  │ Stripe │  │ Zásilkovna   │  │ Fio Bank │  │ Google/Apple │     │
│  │ (SPT,  │  │ (pickup +    │  │ (VS      │  │ OAuth        │     │
│  │  PI,   │  │  home del.,  │  │  match)  │  │ (pro UI)     │     │
│  │  GPay) │  │  tracking)   │  │          │  │              │     │
│  └────────┘  └──────────────┘  └──────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Reuse mapa: existující → nové využití

| Existující komponenta | Nové využití |
|----------------------|-------------|
| `products` tabulka (price, sku, stripe_product_id, stripe_price_id) | Validace item IDs, ceny, dostupnost |
| `get_shipping_cost(method, country, currency)` RPC | Výpočet dopravného pro agentic session |
| `get_products_for_checkout(p_product_ids uuid[])` RPC | Stripe IDs pro payment processing |
| `create_order_with_items_audited` RPC | Vytvoření objednávky po `complete` |
| `edge_app_secrets()` RPC | Stripe API klíče pro PaymentIntent |
| `edge_payment_sessions(action, payload)` RPC | Evidence Stripe sessions |
| `stripe-webhook` Edge Function | Zpracování `payment_intent.succeeded` pro agentic orders |
| `packeta-api` Edge Function (pickup-points) | Seznam výdejních míst pro fulfillment options |
| `audit_journal` tabulka | Audit trail agentic přístupů |
| `order_status` enum | Stavové přechody objednávek |
| `shipping_method` enum | Fulfillment options (packeta_pickup/home, personal_pickup) |

---

## 3) Data model (DB) — migrace

### 3.1 `agent_api_keys` (nová tabulka)

```sql
CREATE TABLE public.agent_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,                    -- 'google_ucp', 'openai_acp', 'generic'
  api_key_hash text NOT NULL UNIQUE,         -- SHA-256 hash API klíče
  api_key_prefix text NOT NULL,              -- prvních 8 znaků pro identifikaci (ak_xxxxxxxx)
  label text,                                -- lidsky čitelný popis
  permissions jsonb NOT NULL DEFAULT '["checkout"]'::jsonb,
  rate_limit_per_minute int NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

ALTER TABLE public.agent_api_keys ENABLE ROW LEVEL SECURITY;
-- RLS: jen admin/staff má přístup (správa klíčů přes admin panel)
```

### 3.2 `agent_checkout_sessions` (nová tabulka)

```sql
CREATE TYPE public.agent_protocol AS ENUM ('ucp', 'acp');
CREATE TYPE public.agent_session_status AS ENUM (
  'incomplete',
  'ready_for_payment',
  'processing_payment',
  'completed',
  'canceled',
  'expired'
);

CREATE TABLE public.agent_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol agent_protocol NOT NULL,
  status agent_session_status NOT NULL DEFAULT 'incomplete',
  api_key_id uuid NOT NULL REFERENCES agent_api_keys(id),

  -- Položky a ceny (vše v JSONB — normalizované interní formáty)
  currency text NOT NULL DEFAULT 'CZK',
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{product_id, sku, name, quantity, unit_price, total, available: bool}]

  pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {subtotal, tax, shipping, discount, total, shipping_method, shipping_country}

  -- Buyer info
  buyer jsonb,
  -- {first_name, last_name, email, phone}

  -- Fulfillment
  fulfillment jsonb,
  -- {shipping_address: {street, city, zip, country}, shipping_method, packeta_branch_id, selected_option_id}

  -- Protokol-specifická data
  capabilities jsonb,          -- UCP: negotiated capabilities snapshot
  payment_context jsonb,       -- handler/instrument metadata, ACP provider info
  affiliate_attribution jsonb, -- ACP: {first_touch, last_touch}

  -- Výsledek
  order_id uuid REFERENCES orders(id),
  stripe_payment_intent_id text,
  external_refs jsonb DEFAULT '{}'::jsonb,

  -- Idempotence
  idempotency_key text,
  idempotency_hash text,       -- SHA-256 hash request body pro conflict detection

  -- Production compliance
  consents jsonb,              -- {gdpr: bool, terms: bool, not_medical_advice: bool, ...}

  -- Audit
  messages jsonb DEFAULT '[]'::jsonb,  -- recoverable issues pro agenta
  agent_profile text,          -- UCP-Agent header / ACP agent identifier
  risk_signals jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),

  UNIQUE(protocol, idempotency_key)
);

ALTER TABLE public.agent_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Trigger pro updated_at
CREATE TRIGGER set_agent_checkout_sessions_updated_at
  BEFORE UPDATE ON public.agent_checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index pro expiraci
CREATE INDEX idx_agent_checkout_sessions_expires
  ON agent_checkout_sessions(expires_at) WHERE status NOT IN ('completed', 'canceled');

-- Permissions
GRANT SELECT, INSERT, UPDATE ON public.agent_checkout_sessions TO service_role;
```

### 3.3 Rozšíření existující `orders` tabulky

```sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS agent_checkout_session_id uuid REFERENCES agent_checkout_sessions(id),
  ADD COLUMN IF NOT EXISTS agent_protocol text,        -- 'ucp' | 'acp' | null (UI checkout)
  ADD COLUMN IF NOT EXISTS agent_profile text,         -- identifikátor agenta
  ADD COLUMN IF NOT EXISTS audit_proofs jsonb;         -- AP2 mandates / signature metadata
```

### 3.4 Stávající tabulky (beze změn)

Tyto tabulky se **nemění**, jen se z nich čte / píše přes existující RPC:

- `products` — katalog (validace item IDs, ceny)
- `order_items` — položky objednávky (plněno přes `create_order_with_items_audited`)
- `payment_sessions` — Stripe session evidence (plněno přes `edge_payment_sessions`)
- `shipment_settings` — sazby dopravy (čteno přes `get_shipping_cost`)
- `audit_journal` — audit trail

---

## 4) Společná pravidla pro obě integrace

### 4.1 Autoritativní cart state

Každé `create` i `update` musí vracet serverem spočítaný stav:

```json
{
  "id": "acs_...",
  "status": "incomplete",
  "currency": "CZK",
  "line_items": [
    {"product_id": "uuid", "sku": "CBD-01", "name": "CBD Olej 10%", "quantity": 2, "unit_price": 1290, "total": 2580, "available": true}
  ],
  "totals": {
    "subtotal": 2580,
    "tax": 0,
    "shipping": 99,
    "discount": 0,
    "total": 2679
  },
  "fulfillment_options": [
    {"id": "packeta_pickup", "label": "Zásilkovna — výdejní místo", "price": 99, "currency": "CZK"},
    {"id": "packeta_home", "label": "Zásilkovna — doručení domů", "price": 149, "currency": "CZK"},
    {"id": "personal_pickup", "label": "Osobní odběr", "price": 0, "currency": "CZK"}
  ],
  "messages": [
    {"type": "recoverable", "code": "missing_email", "message": "Buyer email is required to complete checkout"}
  ]
}
```

**Pricing logika:**
- Ceny produktů → `SELECT price FROM products WHERE id = ANY($1) AND is_active = true`
- Dopravné → existující `get_shipping_cost(p_method, p_country, p_currency)` RPC
- Tax → momentálně 0 (CZ DPH zahrnuta v ceně), pro budoucnost deklarováno jako `tax_included: true`

### 4.2 Production consents

**Specifické pro náš projekt.** Před `complete` agent MUSÍ poskytnout souhlas kupujícího s:

| Consent | Povinný | Popis |
|---------|---------|-------|
| `gdpr` | Ano | Zpracování osobních údajů |
| `terms` | Ano | Obchodní podmínky |
| `not_medical_advice` | Ano | Produkty nejsou náhradou lékařské péče |
| `marketing` | Ne | Marketingová komunikace |

Agent, který neodevzdá povinné consenty → `complete` vrátí chybu s `messages: [{type: "recoverable", code: "missing_consents", ...}]`.

### 4.3 Idempotence

- Header `Idempotency-Key` → uložení do `agent_checkout_sessions.idempotency_key`
- Hash request body → `idempotency_hash` (SHA-256)
- Stejný klíč + stejný hash → vrať uloženou odpověď
- Stejný klíč + jiný hash → `409 Conflict`
- Key scope: `(protocol, idempotency_key)` (UNIQUE constraint)

### 4.4 Podpisy a čas

- Headery: `X-Signature`, `X-Timestamp`
- Implementace:
  - Canonical JSON: UTF-8, sorted keys, bez whitespace
  - HMAC-SHA256: `canonical_body + timestamp + request_path`
  - Tolerance: `abs(now - timestamp) <= 5 min`
  - Neplatné → `401 Unauthorized`
- **MVP:** podpisy volitelné (validuj jen pokud přítomné); **Enterprise:** povinné

### 4.5 Rate limiting

- Per API key (`agent_api_keys.rate_limit_per_minute`)
- Implementace: Sliding window counter v Edge Function memory (nebo Redis v budoucnu)
- `429 Too Many Requests` při překročení
- Headery: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### 4.6 Audit trail

Každá agentic operace → zápis do `audit_journal`:

```sql
INSERT INTO audit_journal (user_id, action, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000000',  -- system user (agent nemá auth.uid())
  'AGENTIC_CHECKOUT_CREATE',
  jsonb_build_object(
    'area', 'agentic_commerce',
    'protocol', 'acp',
    'session_id', p_session_id,
    'api_key_prefix', 'ak_12345678',
    'items_count', 2,
    'total', 2679
    -- NIKDY: buyer email, jméno, adresa!
  )
);
```

---

## 5) UCP implementace

### 5.1 `/.well-known/ucp` (profil)

Servováno z Edge Function `agentic-well-known`:

```json
{
  "ucp": {
    "version": "2026-01-11"
  },
  "merchant": {
    "name": "Platform",
    "description": "Production & wellness products",
    "url": "https://app.example.cx",
    "supported_currencies": ["CZK", "EUR", "USD"],
    "tax_included": true,
    "country": "CZ"
  },
  "services": {
    "dev.ucp.shopping": {
      "rest": {
        "endpoint": "https://app.example.cx/functions/v1/ucp-checkout"
      }
    }
  },
  "capabilities": [
    "dev.ucp.shopping.checkout",
    "dev.ucp.shopping.fulfillment",
    "dev.ucp.shopping.discount"
  ],
  "payment_handlers": [
    {
      "id": "com.stripe",
      "name": "Stripe",
      "supported_instruments": ["card", "google_pay", "apple_pay"]
    }
  ],
  "fulfillment_options": [
    {"id": "packeta_pickup", "type": "pickup", "label": "Zásilkovna pickup point", "countries": ["CZ", "SK"]},
    {"id": "packeta_home", "type": "delivery", "label": "Zásilkovna home delivery", "countries": ["CZ", "SK", "DE", "AT", "PL", "HU"]},
    {"id": "personal_pickup", "type": "pickup", "label": "Personal pickup (Praha)", "countries": ["CZ"]}
  ],
  "checkout_requirements": {
    "production_consents_required": true,
    "required_consents": ["gdpr", "terms", "not_medical_advice"]
  }
}
```

### 5.2 UCP REST endpoints — Edge Function `ucp-checkout`

Cesta: `supabase/functions/ucp-checkout/index.ts`

#### 5.2.1 `POST /checkout-sessions` (Create)

- **Vstup:** `line_items` (product_id + quantity), volitelně `buyer`, `fulfillment`, `currency`
- **Core logika:**
  1. Validuj API klíč (header `Authorization: Bearer ak_...`)
  2. Validuj produkty → `SELECT id, price, sku, is_active FROM products WHERE id = ANY($1)`
  3. Zkontroluj `requires_prescription` — RX produkty → odmítnout
  4. Zkontroluj `product_access_rules` — omezené produkty → odmítnout
  5. Přepočítej ceny (+ `get_shipping_cost` pokud fulfillment přítomný)
  6. Vytvoř `agent_checkout_sessions` záznam se status `incomplete`
  7. Vrať 201 + autoritativní snapshot s fulfillment_options

#### 5.2.2 `GET /checkout-sessions/{id}`

- Vrací aktuální stav session (autoritativní snapshot)

#### 5.2.3 `PUT /checkout-sessions/{id}` (Update — full replace)

- UCP pravidlo: PUT nahrazuje celý session (agent musí poslat vše)
- Přepočítej totals, validuj fulfillment option
- Pokud se cena produktu změnila od create → přidej `message: {type: "info", code: "price_updated"}`

#### 5.2.4 `POST /checkout-sessions/{id}/complete`

- **Vstup:** `payment.instrument` (Google Pay blob / karta token), `consents`, volitelně `risk_signals`
- **Core logika:**
  1. Validuj povinné consenty (gdpr, terms, not_medical_advice)
  2. Ověř finální ceny (price integrity check vs products tabulka)
  3. Pokud cena se změnila → `409 {code: "price_changed", updated_totals: {...}}`
  4. Vytvoř Stripe PaymentIntent z instrumentu:
     ```typescript
     const stripe = new Stripe(secrets.STRIPE_SECRET_KEY);
     const pi = await stripe.paymentIntents.create({
       amount: session.pricing.total,
       currency: session.currency.toLowerCase(),
       payment_method_data: /* z instrument blob */,
       confirm: true,
       metadata: { agent_session_id: session.id, protocol: 'ucp' }
     });
     ```
  5. Volej `create_order_with_items_audited` RPC → vytvoř objednávku
  6. Aktualizuj session: `status = 'completed'`, `order_id`, `stripe_payment_intent_id`
  7. Audit log: `AGENTIC_ORDER_COMPLETED`
  8. Vrať 200 + completed session s order info

#### 5.2.5 `POST /checkout-sessions/{id}/cancel`

- Označ session `canceled`, uvolni případné stock rezervace
- Pokud existuje pending PaymentIntent → `stripe.paymentIntents.cancel(pi_id)`

### 5.3 Payment handler (Stripe)

- V profilu deklarujeme `com.stripe` handler s instrumenty `card`, `google_pay`, `apple_pay`
- V `complete` přijde instrument blob → mapujeme na Stripe PaymentMethod typ
- MVP: podpora `card` (raw token) a `google_pay` (Google Pay payment data)
- Apple Pay instrument → také přes Stripe (Stripe umí Apple Pay token processing)

### 5.4 (Volitelné) AP2 mandates rozšíření

- Rozšíř `complete` request o pole `ap2_mandate` a ukládej do `orders.audit_proofs`
- Ověř podpis a vazbu na checkout totals (price integrity)
- Implementace v Enterprise fázi

---

## 6) ACP implementace

### 6.1 `/.well-known/acp` (manifest)

```json
{
  "acp": {
    "version": "2026-01-30"
  },
  "merchant": {
    "name": "Platform",
    "description": "Production & wellness products",
    "url": "https://app.example.cx"
  },
  "api": {
    "base_url": "https://app.example.cx/functions/v1/acp-checkout",
    "authentication": "bearer",
    "supported_api_versions": ["2026-01-30"]
  },
  "features": {
    "shipping": true,
    "pickup": true,
    "tax_included": true,
    "multi_currency": true,
    "supported_currencies": ["CZK", "EUR", "USD"],
    "affiliate_attribution": true,
    "production_consents_required": true
  },
  "payment": {
    "providers": ["stripe"],
    "accepted_token_types": ["spt"]
  }
}
```

### 6.2 ACP Checkout Sessions API — Edge Function `acp-checkout`

Cesta: `supabase/functions/acp-checkout/index.ts`

#### 6.2.1 `POST /checkout_sessions` (Create)

- **Headery:** `Authorization: Bearer ak_...`, `API-Version: 2026-01-30`, volitelně `Idempotency-Key`, `X-Signature`, `X-Timestamp`
- **Body:**
  ```json
  {
    "items": [{"id": "product-uuid", "quantity": 1}],
    "currency": "CZK",
    "fulfillment_details": {
      "name": "Jan Novák",
      "email": "jan@example.com",
      "phone": "+420123456789",
      "address": {"street": "Hlavní 1", "city": "Praha", "zip": "11000", "country": "CZ"}
    },
    "affiliate_attribution": {"touchpoint": "first", "agent_id": "chatgpt-shopping"}
  }
  ```
- **Core logika:**
  1. Validuj API klíč
  2. Map item IDs na `products` tabulku
  3. Zkontroluj `requires_prescription` + access rules
  4. Přepočet totals
  5. Vytvoření session
- **Response 201:** Autoritativní `CheckoutSession` (viz §4.1)

#### 6.2.2 `POST /checkout_sessions/{id}` (Update)

- **Body:** Výběr dopravy, update buyer info:
  ```json
  {
    "selected_fulfillment_options": [{
      "type": "shipping",
      "shipping": {"option_id": "packeta_pickup", "packeta_branch_id": 12345}
    }]
  }
  ```
- Přepočet totals s vybranou dopravou (volání `get_shipping_cost`)

#### 6.2.3 `GET /checkout_sessions/{id}`

- Vrací aktuální autoritativní stav

#### 6.2.4 `POST /checkout_sessions/{id}/complete`

- **Body:**
  ```json
  {
    "buyer": {"first_name": "Jan", "last_name": "Novák", "email": "jan@example.com"},
    "payment_data": {"token": "spt_abc123", "provider": "stripe"},
    "consents": {"gdpr": true, "terms": true, "not_medical_advice": true},
    "affiliate_attribution": {"touchpoint": "last", "agent_id": "chatgpt-shopping"}
  }
  ```
- **Core logika:**
  1. Validuj consenty
  2. Price integrity check
  3. Stripe: vytvoř PaymentIntent s SPT tokenem:
     ```typescript
     const pi = await stripe.paymentIntents.create({
       amount: totals.total,
       currency: 'czk',
       payment_method: sptToken,  // Stripe Shared Payment Token
       confirm: true,
       metadata: { agent_session_id: session.id, protocol: 'acp' }
     });
     ```
  4. `create_order_with_items_audited` → objednávka
  5. Evidence: `edge_payment_sessions('insert', {stripe_session_id: pi.id, ...})`
  6. Vrať 200: `CheckoutSessionWithOrder`

#### 6.2.5 `POST /checkout_sessions/{id}/cancel`

- Volitelně `intent_trace` (důvod opuštění) → audit log
- Response 200 / 405 pokud nelze zrušit

### 6.3 ACP Delegate Payment (Enterprise fáze)

`POST /agentic_commerce/delegate_payment` — tokenizace karty s allowance. Odkládáme do Enterprise fáze, v MVP nepotřebujeme.

---

## 7) Mapování na interní doménu

### 7.1 Položky

| Protokol | Vstup | Interní (core) |
|----------|-------|-----------------|
| UCP | `line_items[].item.id` + `quantity` | `product_id` → lookup `products` tabulka → `{sku, unit_price, name, available}` |
| ACP | `items[].id` + `quantity` | Stejný lookup |

### 7.2 Fulfillment → Zásilkovna mapping

| Protokol | Vstup | Interní |
|----------|-------|---------|
| UCP | `fulfillment.shipping_option` | → `shipping_method` enum + `get_shipping_cost()` |
| ACP | `selected_fulfillment_options[].shipping.option_id` | → stejné |

Fulfillment options mapping:

| Option ID | `shipping_method` enum | Zásilkovna API | Cena CZK/EUR |
|-----------|----------------------|----------------|-------------|
| `packeta_pickup` | `packeta_pickup` | create-packet (branch_id) | 99 / 3.9 |
| `packeta_home` | `packeta_home` | create-packet (address) | 149 / 5.9 |
| `personal_pickup` | `personal_pickup` | — | 0 / 0 |

### 7.3 Messages / Errors mapping

| Situace | UCP response | ACP response |
|---------|-------------|-------------|
| Chybí email | `messages: [{type: "recoverable", code: "missing_email"}]` | `422 {error: {code: "missing_email"}}` |
| Out of stock | `messages: [{type: "fatal", code: "out_of_stock"}]` | `409 {error: {code: "out_of_stock"}}` |
| Cena se změnila | `messages: [{type: "info", code: "price_updated"}]` + updated totals | `409 {error: {code: "price_changed"}}` |
| Chybí consenty | `messages: [{type: "recoverable", code: "missing_consents"}]` | `422 {error: {code: "missing_consents", required: [...]}}` |
| RX produkt | `messages: [{type: "fatal", code: "prescription_required"}]` | `422 {error: {code: "prescription_required"}}` |
| Neplatná adresa pro Zásilkovnu | `messages: [{type: "recoverable", code: "invalid_shipping_address"}]` | `422 {error: {code: "invalid_shipping"}}` |
| Osobní odběr mimo CZ | `messages: [{type: "recoverable", code: "personal_pickup_cz_only"}]` | `422 {error: {code: "personal_pickup_cz_only"}}` |

---

## 8) Stavový automat

```
              create
                │
                ▼
         ┌─────────────┐
         │  INCOMPLETE  │◄──── update (přidání buyer/fulfillment)
         │              │────► update (přepočet cen)
         └──────┬───────┘
                │ (vše vyplněno: buyer, fulfillment, items, consenty)
                ▼
      ┌──────────────────┐
      │ READY_FOR_PAYMENT│
      └──────┬───────────┘
             │ complete (+ payment token)
             ▼
    ┌─────────────────────┐
    │ PROCESSING_PAYMENT  │
    └──────┬──────────────┘
           │ Stripe PaymentIntent succeeded
           ▼
     ┌───────────┐
     │ COMPLETED │──── order vytvoření via create_order_with_items_audited
     └───────────┘

     Z jakéhokoliv stavu (kromě COMPLETED):
         cancel ──► CANCELED
     
     CRON (každou hodinu):
         expires_at < now() AND status NOT IN (completed, canceled) ──► EXPIRED
```

### Pravidla přechodů

| Z → Na | Podmínka |
|--------|----------|
| `incomplete` → `ready_for_payment` | `buyer.email` + `fulfillment.shipping_method` + `line_items` neprázdné + `consents` validní |
| `ready_for_payment` → `processing_payment` | `complete` request s validním payment tokenem |
| `processing_payment` → `completed` | Stripe PaymentIntent `status = succeeded` |
| `*` → `canceled` | `cancel` request (kromě `completed`) |
| `*` → `expired` | `expires_at < now()` (CRON job) |
| `ready_for_payment` → `incomplete` | Cena se změnila (price drift) — agent musí potvrdit nové ceny |

---

## 9) Stripe integrace (Payment processing)

### 9.1 ACP flow (SPT — Stripe Shared Payment Token)

```
Agent (ChatGPT) ─── spt_abc123 ──► acp-checkout/complete
                                            │
                                            ▼
                                    stripe.paymentIntents.create({
                                      amount: totals.total,
                                      currency: 'czk',
                                      payment_method: 'spt_abc123',
                                      confirm: true,
                                      metadata: { agent_session_id, protocol: 'acp' }
                                    })
                                            │
                                            ▼
                                    stripe-webhook ← payment_intent.succeeded
                                            │
                                            ▼
                                    orders.status = 'paid'
```

### 9.2 UCP flow (Payment Instrument)

```
Agent (Gemini) ─── instrument blob (GPay/card) ──► ucp-checkout/complete
                                                          │
                                                          ▼
                                                  Parse instrument → Stripe PaymentMethod
                                                  stripe.paymentIntents.create({
                                                    amount: totals.total,
                                                    currency: 'czk',
                                                    payment_method_data: { type, token },
                                                    confirm: true,
                                                    metadata: { agent_session_id, protocol: 'ucp' }
                                                  })
                                                          │
                                                          ▼
                                                  stripe-webhook ← payment_intent.succeeded
```

### 9.3 Existující `stripe-webhook` — minimální rozšíření

Při `payment_intent.succeeded` — přidat check:

```typescript
// Pokud metadata.agent_session_id existuje → agentic order
if (paymentIntent.metadata?.agent_session_id) {
  // Update agent_checkout_sessions.status = 'completed'
  // (objednávka už byla vytvořena v complete handleru)
}
```

### 9.4 Co NEDĚLÁME

- **Bankovní převod** jako platební metoda pro agentic checkout — agenti pracují jen s tokenizovanými platbami
- **Subscription checkout** — předplatné má vlastní flow, agentic je jen pro single-purchase
- Stávající Fio Bank auto-matching flow se nemění

---

## 10) Bezpečnost, audit, compliance

### 10.1 Autentizace agentů

- API klíče v `agent_api_keys` tabulce
- Formát: `ak_` prefix + 32 random alfanumerických znaků
- Uložen jako SHA-256 hash, pouze prefix pro identifikaci v logách
- Správa přes admin panel (nová záložka)
- Každý klíč vázán na `platform` (google_ucp, openai_acp, generic)

### 10.2 Co logujeme do `audit_journal`

| Akce | Metadata (povoleno) |
|------|---------------------|
| `AGENTIC_SESSION_CREATE` | session_id, protocol, api_key_prefix, items_count, currency |
| `AGENTIC_SESSION_UPDATE` | session_id, changed_fields (jen názvy, ne hodnoty!), new_status |
| `AGENTIC_SESSION_COMPLETE` | session_id, order_id, total, currency, payment_provider |
| `AGENTIC_SESSION_CANCEL` | session_id, reason_code |
| `AGENTIC_AUTH_FAILED` | api_key_prefix, reason, ip_address_hash |
| `AGENTIC_RATE_LIMITED` | api_key_prefix, endpoint, current_count |

**NIKDY nelogujeme:** buyer email, jméno, adresu, payment tokeny, instrument blobs.

### 10.3 Production compliance specifika

| Pravidlo | Implementace |
|----------|-------------|
| **RX produkty blokované** | Produkty s `requires_prescription = true` → odmítnout při create session |
| **Access rules** | `product_access_rules` → validace zda produkt je veřejně dostupný |
| **Production consenty** | 3 povinné consenty před complete (gdpr, terms, not_medical_advice) |
| **Consent tracking** | Consenty z agentic checkoutu uloženy do session + order |
| **No sensitive data in logs** | Audit loguje jen IDs, county, amounty — nikdy PII |

### 10.4 PCI compliance

- **Nikdy neukládáme** raw payment tokeny (SPT, instrument blobs) do DB nebo logů
- Stripe je PCI DSS Level 1 — tokeny jdou přímo do Stripe API
- Ukládáme pouze: `stripe_payment_intent_id` (reference)

---

## 11) Observability

### 11.1 Response headery (obě integrace)

```
X-Request-Id: req_uuid
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1708425600
```

### 11.2 Metriky (Supabase Edge Function logs + audit_journal)

| Metrika | Zdroj |
|---------|-------|
| create/update/complete latency | Edge Function execution time |
| Conversion funnel (created → completed) | `agent_checkout_sessions` statusy |
| Error rates by code | audit_journal + Edge Function logs |
| Price drift rate | Messages s kódem `price_updated` / `price_changed` |
| Stock conflict rate | Complete failures s kódem `out_of_stock` |
| Rate limit hits | audit_journal `AGENTIC_RATE_LIMITED` |
| Revenue agentic vs UI | `orders.agent_protocol IS NOT NULL` |

### 11.3 Admin dashboard (budoucí)

Rozšíření admin panelu o záložku "Agentic Commerce":
- Aktivní sessions (live)
- Conversion funnel vizualizace
- Revenue z agentic kanálů vs UI checkout
- API key management (create, revoke, view stats)
- Agent activity log (posledních N akcí per klíč)

---

## 12) Test scénáře

### 12.1 Happy path UCP

1. `GET /.well-known/ucp` → parse capabilities, endpoint, payment_handlers, fulfillment_options
2. `POST /checkout-sessions` s 1 produktem → response `incomplete` + totals + fulfillment_options
3. `PUT /checkout-sessions/{id}` s buyer + address + `packeta_pickup` + `packeta_branch_id: 12345`
4. `POST /checkout-sessions/{id}/complete` s Stripe instrument + consenty → `completed` + order info
5. Ověř: `orders` tabulka obsahuje záznam s `agent_protocol = 'ucp'`
6. Ověř: `audit_journal` obsahuje záznamy `AGENTIC_SESSION_CREATE`, `AGENTIC_SESSION_COMPLETE`

### 12.2 Happy path ACP

1. `GET /.well-known/acp` → parse api.base_url, features, payment.providers
2. `POST /checkout_sessions` s items + fulfillment_details
3. `POST /checkout_sessions/{id}` — vyber `packeta_home` shipping
4. `POST /checkout_sessions/{id}/complete` s `payment_data: {token: "spt_...", provider: "stripe"}` + consenty
5. `GET /checkout_sessions/{id}` — musí být `completed`, obsahovat `order` info
6. Ověř: Stripe PaymentIntent existuje, objednávka v DB s `agent_protocol = 'acp'`

### 12.3 Production specifické

- Pokus o koupi RX produktu (`requires_prescription = true`) → odmítnuto s chybou
- Chybějící consent `not_medical_advice` → `complete` vrací chybu
- Produkt s `product_access_rules` (omezený přístup) → odmítnuto
- Validace, že buyer PII není v audit_journal (jen IDs)

### 12.4 Zásilkovna specifické

- Výběr `packeta_pickup` bez `packeta_branch_id` → message `missing_pickup_point`
- Země mimo podporované pro `packeta_home` (např. US) → `invalid_shipping_country`
- `personal_pickup` s adresou mimo CZ → `personal_pickup_cz_only`
- Správný výpočet dopravného přes `get_shipping_cost` pro CZK/EUR

### 12.5 Negativní scénáře

| Scénář | Očekávaný výsledek |
|--------|-------------------|
| Idempotency conflict (stejný key, jiné body) | 409 Conflict |
| Out of stock při complete | 409 `out_of_stock` |
| Price drift (cena se změnila) | 409 `price_changed` + updated totals |
| Invalid/expired API key | 401 Unauthorized |
| Neplatný signature/timestamp | 401 Unauthorized |
| Chybějící buyer email | UCP: message recoverable / ACP: 422 |
| Rate limit překročen | 429 Too Many Requests |
| Neexistující product ID | 422 `invalid_product` |
| Session expired (> 1 hour) | 410 Gone |
| Complete na canceled session | 409 `session_canceled` |
| Stripe payment failure | 402 Payment Required |
| RX produkt v agentic checkout | 422 `prescription_required` |

---

## 13) Implementační checklist — pořadí

### Fáze 1: Core (MVP) — ~12 pracovních dnů

| # | Úkol | Závislosti | Odhad |
|---|------|------------|-------|
| 1 | DB migrace: `agent_api_keys`, `agent_checkout_sessions`, `orders` ALTER | — | 1 den |
| 2 | RPC: `edge_agent_checkout_sessions(action, payload)` — SECURITY DEFINER, service_role | #1 | 1 den |
| 3 | RPC: `edge_agent_api_keys(action, payload)` — validace, CRUD | #1 | 0.5 dne |
| 4 | Sdílený modul `_shared/agentic-core/` (session manager, pricing, signatures, auth) | #2 | 2 dny |
| 5 | Edge Function `agentic-well-known` (servuje UCP profil + ACP manifest) | — | 0.5 dne |
| 6 | Edge Function `ucp-checkout` (5 routes) | #4 | 2 dny |
| 7 | Edge Function `acp-checkout` (5 routes) | #4 | 2 dny |
| 8 | Stripe PaymentIntent z SPT / instrument (napojení přes `edge_app_secrets`) | #6, #7 | 1 den |
| 9 | Rozšíření `stripe-webhook` o agentic metadata check | #8 | 0.5 dne |
| 10 | Test suite: happy path + negativní (oba protokoly) | #6, #7, #8 | 2 dny |
| 11 | Admin: API key management tab (create, list, revoke) | #3 | 1 den |

### Fáze 2: Hardening — ~5 dnů

| # | Úkol |
|---|------|
| 12 | HMAC signature verification (povinné pro produkci) |
| 13 | Rate limiting s persistencí (pg tabulka nebo pg_cron counter) |
| 14 | Session expiration CRON (pg_cron: hourly expire stale sessions) |
| 15 | Monitoring dashboard v admin panelu (conversion funnel, revenue, activity) |
| 16 | Packeta pickup-points proxy pro agentic (agent nabídne konkrétní pobočky) |

### Fáze 3: Enterprise — dle roadmapy

| # | Úkol |
|---|------|
| 17 | ACP Delegate Payment endpoint (tokenizace karty s allowance) |
| 18 | AP2 mandates (kryptografické důkazy souhlasu, verifiable credentials) |
| 19 | Order management webhooky pro agenty (shipped, delivered, refunded events) |
| 20 | Anti-fraud scoring pipeline (risk_signals evaluation, ML scoring) |
| 21 | Multi-agent support (per-agent analytics, A/B testing fulfillment options) |

---

## 14) Souborová struktura (co vznikne)

```
supabase/
├── functions/
│   ├── _shared/
│   │   └── agentic-core/               # NOVÉ — sdílená logika
│   │       ├── session-manager.ts       # State machine, CRUD přes edge_agent_checkout_sessions
│   │       ├── pricing-resolver.ts      # Ceny z products, doprava přes get_shipping_cost
│   │       ├── order-creator.ts         # Wrapper nad create_order_with_items_audited
│   │       ├── payment-processor.ts     # Stripe PaymentIntent z SPT + instrument
│   │       ├── signature-verifier.ts    # HMAC-SHA256 verify
│   │       ├── api-key-auth.ts          # API key validation přes edge_agent_api_keys
│   │       ├── audit-logger.ts          # → audit_journal (secure-safe)
│   │       ├── consent-validator.ts     # Production consent validation
│   │       ├── product-validator.ts     # RX check, access rules, availability
│   │       └── types.ts                 # Sdílené typy
│   │
│   ├── agentic-well-known/             # NOVÉ
│   │   └── index.ts                     # GET /.well-known/ucp + /.well-known/acp
│   │
│   ├── ucp-checkout/                   # NOVÉ
│   │   └── index.ts                     # UCP REST binding (5 routes)
│   │
│   ├── acp-checkout/                   # NOVÉ
│   │   └── index.ts                     # ACP OpenAPI (5 routes)
│   │
│   ├── create-checkout-session/        # EXISTUJÍCÍ (beze změn)
│   ├── stripe-webhook/                 # EXISTUJÍCÍ (+ agentic metadata check)
│   ├── packeta-api/                    # EXISTUJÍCÍ (beze změn)
│   ├── fio-bank-sync/                  # EXISTUJÍCÍ (beze změn)
│   └── customer-portal/               # EXISTUJÍCÍ (beze změn)
│
├── migrations/
│   └── YYYYMMDDHHMMSS_agentic_commerce.sql  # NOVÉ — vše v jedné migraci
│
└── sql/
    └── functions/
        ├── edge_agent_checkout_sessions.sql # NOVÉ
        └── edge_agent_api_keys.sql          # NOVÉ
```

---

## 15) Rozhodnutí specifická pro náš projekt

### Co děláme jinak než generické zadání

| Rozhodnutí | Důvod |
|-----------|-------|
| **Production consenty povinné** (gdpr, terms, not_medical_advice) | Regulatorní požadavek — bez nich nelze prodat |
| **RX produkty blokované** pro agentic checkout | Recepty vyžadují ověření odborníkem, agent to neumí |
| **Bankovní převod nepodporován** v agentic flow | Agent nemůže čekat na VS párování (asynchronní) |
| **Edge Functions** místo standalone API serveru | Konzistence s existující Supabase architekturou |
| **RPC-only pattern** zachován i pro agentic | `edge_agent_checkout_sessions()` jako SECURITY DEFINER |
| **Audit journal** (ne separátní tabulka) | Reuse existujícího audit systému |
| **Multi-currency** z DB | `products.price` + konverze v SQL, ne hardcoded |
| **Zásilkovna jako primární/jediný dopravce** | CZ/SK trh, existující integrace, fungující API |
| **Subscription packages vyloučené** | Předplatné má vlastní flow, agentic checkout je pro single-purchase |
| **Token-based reward shop vyloučený** | Loyalty program, ne agentic commerce (interní tokeny) |
| **Stávající order_status enum reused** | Agentic objednávky vstupují do stejného fulfillment pipeline |
| **agent_profile místo auth.uid()** | Agenti nemají Supabase auth — identifikace přes API key + agent header |

### Co NEMĚNÍ/NEOVLIVŇUJE

- Stávající UI checkout flow (React + useCheckout hook) — beze změn
- Stávající `cart_items` tabulka — agenti nepoužívají persistentní cart (session-only)
- Stávající admin objednávky / Packeta flow — funguje stejně pro agentic i UI orders
- Mobile app — žádné změny
- Fio Bank sync — beze změn
- Stripe Customer Portal — beze změn
- Google/Apple OAuth — beze změn (to je pro UI uživatele, ne pro agenty)
