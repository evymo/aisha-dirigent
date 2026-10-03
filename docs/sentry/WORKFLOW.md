# Sentry Workflow - Platform

**Instance:** https://sentry.example.com (self-hosted)  
**Projekty:** platform-web, platform-ios, ci (Internal)

---

## 📋 NPM Scripts

| Příkaz | Účel |
|--------|------|
| `npm run sentry:issues` | Všechny projekty, posledních 24h |
| `npm run sentry:issues -- --verbose` | Se stack traces |
| `npm run sentry:issues -- --json` | JSON output |
| `npm run sentry:issues -- --days 7` | Posledních 7 dní |
| `npm run sentry:issues:unresolved` | Pouze neresolvnuté |
| `npm run sentry:issues:week` | Posledních 7 dní |
| `npm run sentry:analyze` | Generovat AI-friendly report |
| `npm run sentry:analyze:save` | Uložit report do docs/sentry/ |
| `npm run sentry:resolve -- <id> [--reason <reason>]` | Označit jako resolved |

---

## 🔧 Konfigurace

### Environment Variables

```bash
# .env
SENTRY_API_TOKEN=<token>  # Vyžaduje project:write scope pro resolve
```

### Token Scopes

Pro plnou funkcionalitu potřebuješ token s těmito scopes:
- `project:read` - Čtení issues
- `project:write` - Resolve issues
- `org:read` - Seznam projektů

---

## 📖 Workflow

### 1. Denní check

```bash
npm run sentry:issues:unresolved
```

### 2. Analýza issue

```bash
# Verbose výstup se stack traces
npm run sentry:issues -- --verbose

# Nebo JSON pro detailní analýzu
npm run sentry:issues -- --json | jq '.[] | select(.shortId == "PLATFORMBYRTN-WEB-1")'
```

### 3. API pro detailní info

```bash
# Nejnovější event pro issue
source .env
curl -s -H "Authorization: Bearer $SENTRY_API_TOKEN" \
  "https://sentry.example.com/api/0/issues/<id>/events/latest/" | jq '.'
```

### 4. Po opravě

```bash
npm run sentry:resolve -- <id> --reason "Fixed in commit abc123 / migration xyz"
```

---

## 🔍 Typy Issues

### Code Bugs (opravit)
- `TypeError: X is not a function`
- `function X does not exist`
- `permission denied for function`

### Config Issues (admin settings)
- `X not configured`
- `Missing API key`

### User/Network Issues (ignorovat)
- `Network request failed`
- `password_signin_failed`
- `App Hanging` (performance)

---

## 📊 Příklad Výstupu

```
📦 platform-web
🔴 ✅ [PLATFORMBYRTN-WEB-3] TypeError: s.replace is not a function
   📍 /member/documents
   📊 2 events, 1 users
   🕐 Last seen: 1/29/2026, 8:02:24 PM

📦 platform-ios  
🔴 ⚠️ [PLATFORMBYRTN-IOS-6] Network request failed
   📍 TrackingSync
   📊 4 events, 1 users
```

Legenda:
- 🔴 = error level
- 🟡 = warning level
- ✅ = resolved
- ⚠️ = unresolved

---

## 🛠️ Skripty

### [scripts/sentry/fetch-issues.mjs](../../scripts/sentry/fetch-issues.mjs)
Fetch issues z Sentry API, formátovaný výstup.

### [scripts/sentry/analyze-issues.mjs](../../scripts/sentry/analyze-issues.mjs)
Generuje AI-friendly analýzu pro debugging.

### [scripts/sentry/resolve-issues.mjs](../../scripts/sentry/resolve-issues.mjs)
Označí issues jako resolved přes API.

---

## 📝 Best Practices

1. **Denně kontroluj unresolved issues**
2. **Po každé opravě označ jako resolved s důvodem**
3. **Nevytvářej issues pro síťové/uživatelské chyby**
4. **Sourcemaps nahrávej při buildu pro čitelné stack traces**

---

*Dokumentace vytvořena: 30. ledna 2026*
