# AISHA Dirigent — Finální produkční test plan

Aktuální release/deployment verifikace je v: [PRODUCTION_DEPLOYMENT_VERIFICATION_2026-04-14.md](./PRODUCTION_DEPLOYMENT_VERIFICATION_2026-04-14.md)

> Účel: Komplexní ověření funkčnosti celé platformy před zveřejněním repozitáře.
> Datum: 2026-04-08 (aktualizováno)
> Prostředí: Produkce (*.id3a.cz) + lokální codebase audit

---

## 📊 Produkční služby — Stav k 2026-04-08

| # | Služba | URL | Status | Poznámka |
|---|--------|-----|--------|----------|
| 1 | Web App | https://web.aisha.guru | ✅ HTTP 200 (0.46s) | SPA načtena, titul OK |
| 2 | API Gateway (Kong) | https://api.aisha.guru | ✅ Routing OK | /rest/v1, /auth/v1, /functions/v1 |
| 3 | Auth (GoTrue) | /auth/v1/health | ✅ v2.184.0 | Zdravý |
| 4 | Keycloak OIDC | https://auth.aisha.guru/realms/aisha | ✅ OIDC Discovery OK | Realm `evymo`, public key dostupný |
| 5 | Keycloak Admin | https://auth.aisha.guru (root) | ⚠️ Timeout 64s | Base URL timeoutuje, ale sub-endpointy fungují |
| 6 | Langfuse | https://langfuse.aisha.guru | ❌ HTTP 503 | "no available server" — **NUTNO OPRAVIT** |
| 7 | NocoDB | https://nocodb.aisha.guru | ✅ HTTP 302 → OAuth | SSO redirect přes Keycloak |
| 8 | Appsmith | https://appsmith.aisha.guru | ✅ HTTP 302 → OAuth | SSO redirect přes Keycloak |
| 9 | MCP Endpoint | /functions/v1/mcp-knowledge-server | ✅ HTTP 401 | Správně odmítá bez autorizace |
| 10 | Supabase Studio | https://db.aisha.guru | ✅ HTTP 307 | Redirect na login |

---

## 📦 Data na produkci — Stav

| Data | Status | Počet/Detail |
|------|--------|-------------|
| Studies (RPC `get_active_studies`) | ✅ | 2+ studií (Performance Optimization, UX Research) |
| Expert Rules | ✅ | 5+ publikovaných pravidel |
| Knowledge Topics | ✅ | 1+ téma (evymo-testing-philosophy) |
| Hero Slides | ✅ | 1+ aktivní slide s i18n klíči |
| Agent Catalog | ⚠️ | Column `name` neexistuje — schéma mismatch |
| Stories | ⚠️ | Potřebuje autentizaci pro přístup |
| Partner Profiles | ❓ | Netestováno z CLI |

---

## 🧪 TEST PLAN — Sekce

### A. WEB APLIKACE (web.aisha.guru)

#### A1. Veřejné stránky
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| A1.1 | Homepage se načte | Otevřít / — SPA renderuje hero slides, navigaci | 🔴 |
| A1.2 | Studies listing | /studies — zobrazují se studie (app design, game dev, enterprise) | 🔴 |
| A1.3 | Study detail | /studies/:id — detail studie s popisem, timeline, registrací | 🟡 |
| A1.4 | Knowledge base | /knowledge — seznam Knowledge topics s filtrací | 🔴 |
| A1.5 | Knowledge detail | /knowledge/:slug — detail tématu, posty, zdroje | 🟡 |
| A1.6 | Expert rules | /rules — seznam pravidel | 🟡 |
| A1.7 | Partners directory | /partners — seznam partnerů/specialistů | 🟡 |
| A1.8 | Guild of Experts | /guild — adresář expertů | 🟢 |
| A1.9 | Shop | /shop — produkty e-shopu | 🟢 |
| A1.10 | News | /news — novinky | 🟢 |
| A1.11 | i18n přepínání | Otestovat CS/EN přepnutí na klíčových stránkách | 🔴 |

#### A2. Auth flow
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| A2.1 | Login stránka | /auth — formulář se zobrazí | 🔴 |
| A2.2 | Keycloak SSO | Klik na Keycloak login → redirect na auth.aisha.guru → zpět | 🔴 |
| A2.3 | Google OAuth | Login via Google → úspěšný redirect | 🟡 |
| A2.4 | Apple OAuth | Login via Apple → úspěšný redirect | 🟡 |
| A2.5 | Token refresh | Ověřit že JWT se refreshuje správně | 🟡 |

#### A3. Member portal (po přihlášení)
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| A3.1 | Dashboard | /member — přehled se zobrazí | 🔴 |
| A3.2 | ~~Health~~ **Security Check-in** | /member/check-in — formulář (pain, mood, energy, sleep) | 🔴 |
| A3.3 | ~~Health~~ **Security Dashboard** | /member/health → PŘEJMENOVAT na /member/security | 🔴 |
| A3.4 | StoryLoop (Diary) | /member/story — osobní deník | 🔴 |
| A3.5 | Story detail | /member/story/:storyId — detail příběhu | 🟡 |
| A3.6 | Profile | /member/profile — zobrazení a editace | 🟡 |
| A3.7 | Questionnaires | /member/questionnaires — dotazníky | 🟢 |
| A3.8 | Token balance | /member/tokens — zůstatek tokenů | 🟢 |

#### A4. Partner portal
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| A4.1 | Partner dashboard | /partner/dashboard — metriky, quick links | 🔴 |
| A4.2 | StoryLoop workspace | /partner/storyloop — správa příběhů pacientů/klientů | 🔴 |
| A4.3 | Story detail + health panel | Detail story → health/security sidebar | 🔴 |
| A4.4 | Templates | /partner/templates — správa šablon | 🟡 |
| A4.5 | Contributed rules | /partner/rules — vlastní pravidla | 🟡 |

#### A5. Admin panel
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| A5.1 | Admin overview | /admin — přehled systému | 🔴 |
| A5.2 | StoryLoop admin | /admin/storyloop — celkový přehled stories | 🔴 |
| A5.3 | Studies admin | /admin/studies — správa studií/oblastí zájmu | 🔴 |
| A5.4 | Knowledge admin | /admin/knowledge/topics — správa KB | 🔴 |
| A5.5 | Audit journal | /admin/audit-journal — logy operací | 🟡 |
| A5.6 | AI runs | /admin/ai-runs — záznamy AI workflow | 🟡 |
| A5.7 | Members admin | /admin/members — správa uživatelů | 🟡 |
| A5.8 | Partners admin | /admin/partners — správa partnerů | 🟡 |

---

### B. ADMINISTRAČNÍ SLUŽBY

#### B1. NocoDB (nocodb.aisha.guru)
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| B1.1 | SSO login | Přihlášení přes Keycloak → NocoDB session | 🔴 |
| B1.2 | Tabulky viditelné | Vidět klíčové tabulky: stories, studies, knowledge_topics, expert_rules | 🔴 |
| B1.3 | Data konzistence | Ověřit že data v NocoDB odpovídají web UI | 🟡 |
| B1.4 | CRUD operace | Zkusit vytvořit/editovat záznam (v testovací tabulce) | 🟡 |

#### B2. Langfuse (langfuse.aisha.guru) — ❌ AKTUÁLNĚ NEFUNGUJE
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| B2.1 | Service health | API health endpoint vrací 200 | 🔴 BLOKOVÁNO |
| B2.2 | SSO login | Přihlášení přes Keycloak | 🔴 BLOKOVÁNO |
| B2.3 | Traces viditelné | Vidět AI traces z n8n workflows | 🔴 BLOKOVÁNO |
| B2.4 | Project aisha-dirigent | Ověřit projekt existuje s pk/sk klíči | 🟡 BLOKOVÁNO |
| B2.5 | Costs/metrics | Ověřit metriky spotřeby tokenů | 🟡 BLOKOVÁNO |

#### B3. Keycloak (auth.aisha.guru)
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| B3.1 | OIDC Discovery | /.well-known/openid-configuration dostupný | ✅ PROJDE |
| B3.2 | Admin Console | /admin → přístup | 🔴 |
| B3.3 | Realm evymo | Realm existuje, klienti nakonfigurovaní | 🔴 |
| B3.4 | SSO Clients | aisha-app, langfuse, nocodb-proxy, appsmith-proxy | 🟡 |
| B3.5 | Roles | admin, staff, practitioner, member, evaluator | 🟡 |

#### B4. Appsmith (appsmith.aisha.guru)
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| B4.1 | SSO login | Přihlášení přes Keycloak | 🟡 |
| B4.2 | Dashboards | StoryLoop dashboard existuje a zobrazuje data | 🟡 |

---

### C. AI & MCP STACK

#### C1. MCP Knowledge Server
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| C1.1 | get_knowledge_stats | Vrací statistiky KB grafu | 🔴 |
| C1.2 | search_knowledge | Hledání v knowledge base funguje | 🔴 |
| C1.3 | get_expert_rule | Načtení pravidla podle slug | 🟡 |
| C1.4 | get_project_context | Kontext projektu | 🟡 |
| C1.5 | assess_quality | Quality check funguje | 🟡 |
| C1.6 | admin_health_check | Ping všech služeb | 🔴 |

#### C2. Extension (aisha-dirigent)
| Test | Co ověřit | Jak | Priorita |
|------|-----------|-----|----------|
| C2.1 | /health příkaz | Spustit @aisha /health → výsledky | 🔴 |
| C2.2 | /models | Seznam dostupných LLM modelů | 🟡 |
| C2.3 | /story | Story kontext se načte | 🟡 |
| C2.4 | /instructions | Generuje copilot-instructions.md | 🟡 |
| C2.5 | MCP konektivita | Extension se připojí k produkčnímu MCP | 🔴 |

---

### D. PŘEJMENOVÁNÍ: Health → Security/Confidential

#### D1. Koncept
**Aktuální stav**: "Health" = denní wellness check-iny (pain, mood, energy, sleep, medicace)
**Nový koncept**: Předefinovat na obecnější "důvěrná/citlivá data" platformy

**Dvě odlišné entity:**
1. **Member "Security Profile"** (dříve Health) — citlivé osobní údaje, check-iny, dokumenty
2. **System Health** (deployment health) — stav backendu pro story/službu

#### D2. Rozsah přejmenování
| Kategorie | Počet | Soubory |
|-----------|-------|---------|
| Routes (/member/health*) | 2 | router.tsx |
| Components (Health*) | 6+ | src/components/member/, health/, storyloop/ |
| Hooks (useHealth*, usePatientHealth) | 7+ | src/hooks/ |
| i18n klíče (member.health*) | 30+ | všech 6 locales × member.json |
| DB funkce (health*) | 34 | supabase/sql/functions/ |
| DB tabulky (health*) | 6 | health_check_ins, health_metrics, atd. |
| Admin i18n | 5+ | admin.json (integrations.health, role_permissions) |
| Extension /health | 1 | participant.ts — **PONECHAT jako system diagnostics** |

#### D3. Návrh nových názvů
| Stávající | Nový | Kontext |
|-----------|------|---------|
| `health` (member) | `confidential` / `secure-data` | Citlivá osobní data |
| `/member/health` | `/member/secure-profile` | Osobní security dashboard |
| `/member/check-in` | `/member/check-in` | Ponechat (je generický) |
| `health_check_ins` (DB) | `secure_check_ins` | DB tabulka |
| `PatientHealthPanel` | `ClientSecureDataPanel` | Komponenta |
| `useHealthTracking` | `useSecureTracking` | Hook |
| Extension `/health` | `/diagnostics` nebo `/status` | System health check |
| `admin.integrations.health` | `admin.integrations.system_health` | Stav integrace |

---

### E. STUDIES → OBLASTI ZÁJMU (Interest Areas)

#### E1. Koncept
**Aktuální**: Studies = klinické výzkumné studie (observational, blinded, funding)
**Nový**: Studies = oblasti zájmu — app design, vývoj her, enterprise aplikace, AI/ML

#### E2. Existující data na produkci
- "Performance Optimization Study" (PRG-PO-001)
- "UX Research Program - Usability" (PRG-UX-001)
→ Tyto studie jsou relevantní pro software delivery platformu ✅

#### E3. Doporučené akce
1. Přidat více oblastí zájmu (Game Development, Mobile App Design, Enterprise Systems)
2. Upravit i18n texty: "Research Studies" → "Areas of Expertise" / "Oblasti zájmu"
3. Funding model ponechat (crowdfunding pro projekty dává smysl)

---

## 🔧 NALEZENÉ PROBLÉMY — K OPRAVĚ

### Kritické (🔴)
1. **Langfuse 503** — Service je down ("no available server")
   - Akce: Zkontrolovat docker-compose stack, ClickHouse, Redis
2. **Keycloak timeout** — Base URL (auth.aisha.guru) timeoutuje na root
   - Akce: Ověřit Coolify routing / health check config
3. ~~**agent_catalog.name** — Column neexistuje~~ ✅ VYŘEŠENO
   - Schema je správné: sloupec se jmenuje `display_name`, ne `name`
   - Kód korektně používá `display_name` (AdminAgentCatalog.tsx)

### Střední (🟡)
4. **Health → Security rebrand** — 0% hotovo (masivní scope)
   - 37+ komponent, 10+ hooků, 70+ DB funkcí, 100+ i18n klíčů, 5 DB tabulek
   - Doporučení: Řešit jako samostatný milestone, ne pre-release blocker
5. ~~**Studies kontextualizace** — Nové oblasti zájmu~~ ✅ VYŘEŠENO
   - EN i18n: již přejmenováno na "Clusters / Programs"
   - CS i18n: aktualizováno — "studie" → "klastry", "Observační" → "Komunitní", "Klinická studie" → "Praktický workshop"

### Nízká (🟢)
6. **Extension /health přejmenování** na /diagnostics — `/health` je alias pro `/status` ✅ OK
7. **Chybějící produkční data** — Seed více oblastí zájmu
8. ~~**Keycloak evaluator role** — chyběla v realm JSON~~ ✅ VYŘEŠENO
   - Přidáno do keycloak/evymo-realm.json

---

## ✅ CODEBASE AUDIT — 2026-04-08

### Build & CI kontroly

| Check | Status | Detail |
|-------|--------|--------|
| `npm run build` | ✅ PASS | Vite build 20.79s, PWA generated, 12 precache entries |
| `npx tsc --noEmit` | ✅ PASS | Žádné TypeScript chyby |
| `npm run lint` | ✅ PASS | Žádné lint chyby |
| `npm run i18n:check` | ✅ PASS | 0 errors, 0 warnings, 6 locales synchronized |
| `npm run test:run` | ✅ PASS | **299 test files, 4610 testů passed**, 70 skipped |
| `npm run test:gates` | ✅ PASS | **35 gate files, 954 testů passed** |
| Extension compile | ✅ PASS | aisha-dirigent esbuild OK |
| IDE instructions | ✅ PASS | 7/7 souborů regenerováno z offline payloadu |

### Route pokrytí

| Sekce | Počet routes | Komponenty existují | Status |
|-------|-------------|---------------------|--------|
| Veřejné stránky | 32 | ✅ 100% | ✅ |
| Auth flow | 5 | ✅ 100% | ✅ |
| Member portal | 21 | ✅ 100% | ✅ |
| Partner portal | 14 | ✅ 100% | ✅ |
| Admin panel | 52+ | ✅ 100% | ✅ |
| Registrace/onboarding | 7 | ✅ 100% | ✅ |
| Legal | 8 | ✅ 100% | ✅ |
| **Celkem** | **100+** | **100%** | ✅ |

### Infrastruktura

| Komponenta | Status | Detail |
|------------|--------|--------|
| Docker Compose (Supabase) | ✅ | db, kong, auth, rest, realtime, storage, meta, edge-functions |
| Docker Compose (Langfuse) | ✅ Config OK | ClickHouse + Redis + MinIO + Langfuse v3 + Caddy gateway |
| Keycloak realm | ✅ | 4 OIDC klienti (evymo-app, appsmith-proxy, nocodb-proxy, langfuse), **5 rolí** (member, practitioner, staff, admin, evaluator) |
| Kong gateway | ✅ | 8 routes (auth, rest, realtime, storage, meta, functions) |
| MCP Knowledge Server | ✅ | **49 nástrojů** implementováno, všech 6 požadovaných přítomno |
| Extension (aisha-dirigent) | ✅ | **18 slash commands**, MCP + n8n dual-path connectivity |
| Edge Functions | ✅ | **48 funkcí** v supabase/functions/ |

### i18n pokrytí

| Jazyk | Status | Segmenty |
|-------|--------|----------|
| cs (Czech) | ✅ | 14 segmentů |
| en (English) | ✅ | 14 segmentů |
| de (German) | ✅ | 14 segmentů |
| fr (French) | ✅ | 14 segmentů |
| ru (Russian) | ✅ | 14 segmentů |
| th (Thai) | ✅ | 14 segmentů |

---

## 📋 POŘADÍ PRÁCE

1. ✅ Otestovat produkční endpointy (hotovo 2026-04-07)
2. ✅ Codebase audit — build, testy, lint, i18n, TypeScript (hotovo 2026-04-08)
3. ✅ IDE instrukce regenerovány z offline payloadu (hotovo 2026-04-08)
4. ✅ agent_catalog schema ověřeno — žádný bug (2026-04-08)
5. ✅ Keycloak evaluator role přidána do realm JSON (2026-04-08)
6. ✅ Czech i18n Studies terminologie aktualizována (2026-04-08)
7. 🔄 Diagnostikovat Langfuse 503 (produkční infra)
8. 🔄 Otestovat web UI manuálně (veřejné stránky v prohlížeči)
9. 🔄 Otestovat SSO flow (Keycloak → App → NocoDB)
10. ⏳ Implementovat Health → Security přejmenování (budoucí milestone)
11. 🔄 Finální regresní test před release
