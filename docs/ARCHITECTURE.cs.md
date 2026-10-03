# Architektura platformy

> Veřejný architekturní přehled pro RC. Bez interních tokenů, osobních účtů a provozních runbooků.

## Co AISHA Platform je

AISHA Platform je orchestrace produktu, vývoje a provozu kolem autonomního AI dirigenta. Kombinuje webovou aplikaci, workflow automatizaci, znalostní vrstvu přes MCP a auditovatelnou datovou vrstvu.

## Hlavní vrstvy

| Vrstva | Role |
|--------|------|
| Web a UI | React/Vite frontend, admin rozhraní a klientské obrazovky |
| API a orchestrace | Gateway, edge funkce a aplikační routing |
| Identita | Keycloak jako hlavní identitní vrstva a SSO bod |
| Znalosti | MCP knowledge server, RAG a expertní pravidla |
| Workflow | n8n workflow engine pro delivery, compliance a automatizaci |
| Data | PostgreSQL + PostgREST + auditované RPC funkce |
| Observabilita | Langfuse, audit trail, provozní health kontroly |

## Architektonické principy

- RPC-only přístup k datům: aplikace a agenti sahají na data přes explicitní RPC funkce.
- Auditovatelnost: citlivé operace mají auditní stopu.
- Guardrails na serveru: bezpečnost a přístupová pravidla nejsou delegována na frontend.
- Modulární orchestrace: workflow, agenti a znalosti se dají rozvíjet po vrstvách.
- Self-hosted provoz: klíčové části stacku běží pod vlastní kontrolou.

## Co patří do RC

- Veřejný web a hlavní aplikační tok
- Keycloak-based autentizace a e-mailová tematizace AISHA
- MCP knowledge vrstva a základní agentní orchestrace
- n8n workflow backbone pro delivery a compliance
- Základní observabilita, health kontroly a release disciplína

## Co není součástí veřejného architektonického přehledu

- Interní provozní runbooky
- Detailní bezpečnostní audity a incident playbooky
- Interní adresáře s historickými návrhy a expertními pracovními materiály

Podrobnější veřejný kontext je v [README.md](../README.md), roadmapa v [ROADMAP.md](ROADMAP.md) a RC snapshot v [FINAL-DRAFT.md](../FINAL-DRAFT.md).