# Spec 05 — Doplňkové patterny hodné pozornosti

> Menší, ale hodnotné patterny z Odysseu. Každý má vlastní mini-scope. Pořadí dle poměru přínos/effort.

---

## 5A. SSRF / URL guard — univerzální aplikace + DNS-rebinding pinning

> **Priorita:** Vysoká (security) · **Effort:** S · **Riziko:** Nízké
> **Odysseus zdroj:** `src/url_security.py`, `src/url_safety.py` · **AISHA:** `packages/security/src/ssrf.ts`

**Current state:** AISHA má **silný** `ssrf.ts` — scheme allowlist (default `https:` only), host allowlist, IP guard (IPv4/IPv6 private/loopback/link-local/metadata/CGNAT), `safeFetch()` 30s timeout. Coverage je dobrá. **Gapy:**
- **Není univerzálně aplikovaný** — grep ukazuje `safeFetch` jen v openai/anthropic health-checks; nejasné, zda Ragnarok fetch, MCP server cally a (budoucí) web-research přes něj jdou.
- **DNS rebinding** — single `lookup()` při fetch (kód to přiznává); sub-sekundový rebind teoreticky možný. Bez connector pinningu.
- **Metadata edge cases** — 169.254.169.254 blokováno, ale IMDSv2 na 127.0.0.1 varianty pokryté loopback pravidlem; ověřit cloud-specific endpointy.

**Cíl:** 
- **Audit + deklarativní vynucení** — každý outbound z untrusted/LLM-driven cesty MUSÍ jít přes `safeFetch` (lint/architektonický test, ne disciplína). Odysseus to má jako pravidlo v `THREAT_MODEL.md` (vyjmenované surfaces).
- DNS pinning přes undici dispatcher s custom connectorem (resolve→pin→connect na stejné IP) pro high-stakes cesty.
- SSRF rejection integration testy nad Ragnarok / MCP / web-research cestami.

**Akceptace:** žádná LLM-driven outbound cesta neobchází guard (architektonický test); rebinding payload odmítnut (test).

---

## 5B. Tool-policy / plan-mode — per-turn vypnutí toolů

> **Priorita:** Střední · **Effort:** S · **Riziko:** Nízké
> **Odysseus zdroj:** `src/tool_policy.py`, agent_loop plan-mode

**Current state:** AISHA má consent/audit/tier gates (`toolBuilder.ts`), ale **ne per-turn deklarativní politiku** „pro tenhle turn žádné tooly / jen čtení / guide-only".

**Pattern (Odysseus):** `ToolPolicy` (frozen dataclass): `disabled_tools`, `hidden_tools`, `block_all_tool_calls`. `GUIDE_ONLY_DIRECTIVE` — když user turn zakáže tooly, model jen radí / požádá o paste výstupu, nevolá nic. Skládá se **po** výběru toolů (synergie se spec 01).

**Cíl pro AISHA:** lehká `ToolPolicy` vrstva v `svc-ai-chat` — per-turn / per-profile / per-plan-step omezení (např. „plan mode" = read-only tooly, „guide-only" = žádné). Hodí se k Dirigent plan/approval flow a k bezpečnému autonomnímu módu. **Dynamické** — politika odvozená z intentu turnu + role + plan stavu.

**Akceptace:** guide-only turn nevolá žádný tool (test); plan-mode povolí jen read-only tooly.

---

## 5C. Memory provider abstrakce — pluggable recall

> **Priorita:** Nízká–Střední · **Effort:** M · **Riziko:** Nízké
> **Odysseus zdroj:** `src/memory_provider.py` · **AISHA:** `services/svc-ai-chat/src/lib/hippocampus.ts`

**Current state:** AISHA má hippocampus (personality traits base+experiential z vector space, `traitLimit = 12`). Funkční, ale **konkrétní implementace**, ne abstrakce.

**Pattern (Odysseus):** `MemoryProvider` ABC + `MemoryRecord` / `MemorySearchHit` dataclasses. Native provider vždy dostupný; externí providery přidávají recall/write a vlastní tooly **bez nahrazení** baseline. Provider-neutrální tvar záznamu (id, text, category, source, owner, session, metadata).

**Cíl pro AISHA:** zavést `MemoryProvider` interface, aby hippocampus byl jeden z providerů a šlo přidat další (per-tenant, externí mem0/Zep apod.) bez přepisu chat orchestrace. **Dynamické** — výběr providera per tenant/profil. Provázat `traitLimit` na budget (spec 03), ne konstantu.

**Akceptace:** hippocampus implementuje společný interface; lze přidat druhý provider bez změny orchestrace.

---

## 5D. Internal-tool loopback auth — bezpečný in-process tool→API most

> **Priorita:** Nízká (referenční) · **Effort:** — · **Riziko:** —
> **Odysseus zdroj:** `THREAT_MODEL.md` §Internal Tool Loopback

**Pattern:** agent tool cally chodí na admin-gated HTTP routes přes in-process loopback s `INTERNAL_TOOL_TOKEN` (random `secrets.token_hex(32)` při startu, nikdy neperzistovaný, nikdy ke klientovi). Před vydáním loopback callu se ověří, že session owner je admin (`owner_is_admin_or_single_user`). Reserved username `internal-tool` nelze registrovat.

**Relevance pro AISHA:** AISHA má gateway + JWT translation + service-to-service auth (mesh). Odysseus pattern je **referenční checklist** pro in-process/tool→service cesty: ephemeral token, owner-check před privilege eskalací, reserved identity. Spíš audit-položka než nová feature — ověřit, že svc-agent-runner / plugin-exec nemají obejitelnou privilege-escalation cestu.

**Akceptace:** review tool→service auth cesty proti tomuto checklistu; dokumentovat v threat modelu.

---

## 5E. Hardware-aware dynamický výběr modelu (cookbook/hwfit)

> **Priorita:** Nízká–Střední · **Effort:** M · **Riziko:** Nízké
> **Odysseus zdroj:** `services/hwfit/`, cookbook ranking (ROADMAP) · **AISHA:** `aisha_resolve_clow_backend`

**Current state:** AISHA už má **health-aware** resolver (`capability-resolver.ts` / `aisha_resolve_clow_backend`) — vybírá provider dle health, cost class, capability flags, budget. To je silnější než Odysseus pro *provider* routing.

**Co může inspirovat:** Odysseus cookbook/hwfit **ranking modelů dle hardware-fit** (architektura, kvant formát, VRAM/RAM fit, backend support, vision/mmproj). Pro AISHA self-hosted vLLM (Qwen3-30B) je relevantní **scoring vrstva** nad resolverem: nejen „který provider je zdravý", ale „který model nejlíp sedne na dostupný HW pro tenhle task". Dnes resolver řeší provider-fit; hwfit by přidal model-fit ranking.

**Cíl:** rozšířit `aisha_resolve_clow_backend` o hardware-fit scoring pro self-hosted modely (architecture age, quant, VRAM fit). **Dynamické** — re-score dle aktuálně dostupného HW/served modelů.

**Akceptace:** resolver pro self-hosted preferuje lépe HW-fitující model na eval setu; žádná regrese u API providerů.

---

## Shrnutí priorit doplňků

| ID | Pattern | Priorita | Effort | Hlavní přínos |
|----|---------|----------|--------|---------------|
| 5A | SSRF univerzální + DNS pinning | **Vysoká** | S | Zacelit security gap (univerzální aplikace) |
| 5B | Tool-policy / plan-mode | Střední | S | Bezpečný autonomní/plan mód |
| 5C | Memory provider abstrakce | Nízká–Stř. | M | Pluggable per-tenant memory |
| 5D | Internal-tool loopback auth | Nízká | — | Audit checklist privilege escalation |
| 5E | Hardware-aware model ranking | Nízká–Stř. | M | Lepší self-hosted model fit |
