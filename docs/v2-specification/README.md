# Platform V2 - Specifikace

Tato složka obsahuje kompletní specifikaci pro vývoj Platform verze 2.

## Obsah

| Dokument | Popis |
|----------|-------|
| [PLATFORM_V2_SPECIFICATION.md](./PLATFORM_V2_SPECIFICATION.md) | Hlavní specifikace pro V2 |

## Shrnutí V2

### Klíčové Změny oproti V1

| Oblast | V1 (Současný stav) | V2 (Cílový stav) |
|--------|-------------------|------------------|
| **Architektura** | Monolith (Vite + Supabase) | Microservices / Modular Monolith |
| **Databáze** | 1 DB, 87+ tabulek | Oddělené DB per doména |
| **Audit** | Rozptýlen v RPC funkcích | Centrální Audit Service |
| **API** | Přímé volání Supabase | API Gateway |
| **Domény** | Smíšené | 10 jasně definovaných bounded contexts |

### 10 Bounded Contexts V2

1. **Identity** - Uživatelé, autentizace, autorizace
2. **Activity** - Zdravotní data (sensitive data), check-iny, dokumenty
3. **Research** - Studie, registration, protokoly
4. **Commerce** - Produkty, objednávky, platby
5. **Partner** - Partneři, schůzky, matching
6. **Production** - Výrobní dávky, kvalita, inventář
7. **Token** - Tokenová ekonomika
8. **Audit** - Centrální logování, compliance
9. **Notification** - Všechny typy notifikací
10. **Content** - CMS, archiv, překlady

### Identifikované Problémy V1

- 87+ tabulek v jedné databázi
- 130+ migračních souborů (mnoho "fix" migrací)
- 53+ custom hooks bez jasné struktury
- 303KB vygenerovaný types.ts
- Audit rozptýlen v SQL funkcích
- sensitive data a non-sensitive data ve stejné DB
- Business logika rozptýlena (DB, Edge Functions, frontend)

### Doporučený Stack V2

- **Frontend:** Next.js 15 + React 19
- **API:** API Gateway + domain services
- **Backend:** Node.js + Fastify/NestJS
- **Database:** PostgreSQL per doména + TimescaleDB pro audit
- **Message Queue:** RabbitMQ / Redis Streams
- **Monitoring:** Prometheus + Grafana + OpenTelemetry

## Jak Použít Tuto Specifikaci

1. **Pro Product Ownera:** Části 1-3 (analýza, architektura, domény)
2. **Pro Architekta:** Části 4-8 (stack, DB, API, audit, security)
3. **Pro Vývojáře:** Části 9-12 (testování, deployment, implementace)
4. **Pro Management:** Části 13-15 (rozdíly, rizika, doporučení)

---

*Vytvořeno: 29. prosince 2025*
