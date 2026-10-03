# App Integrity Testing Guide

**Verze:** 1.0 | **Datum:** 3. února 2026

---

## 🔍 Ověření Backend Funkčnosti

### 1. Lokální Supabase Setup

```bash
# Start lokální Supabase
npm run supabase:start

# Zkontroluj, že Edge Functions běží
npx supabase status

# Výstup by měl obsahovat:
# API URL: http://127.0.0.1:54321
# DB URL: postgresql://postgres:...
# Studio: http://127.0.0.1:54323
# Functions: Running
```

### 2. Nastavení Environment Variables

#### Pro lokální testování (test secrets):

```bash
# Nastav secrets pro lokální Edge Function
supabase secrets set --env-file .env.local GOOGLE_CLOUD_PROJECT_NUMBER=123456789012
supabase secrets set --env-file .env.local GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account","project_id":"test",...}'
supabase secrets set --env-file .env.local APPLE_APP_ID=ABC123DEF4.com.app.example
```

Nebo vytvoř `.env.local`:

```env
GOOGLE_CLOUD_PROJECT_NUMBER=123456789012
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"test","private_key":"-----BEGIN PRIVATE KEY-----..."}
APPLE_APP_ID=ABC123DEF4.com.app.example
```

Pak:
```bash
supabase secrets set --env-file .env.local
```

---

## 🧪 Testování Edge Function

### Test 1: Activity Check (bez verifikace)

```bash
# Curl request
curl -X POST http://127.0.0.1:54321/functions/v1/verify-app-integrity \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "token": "test-token",
    "platform": "android"
  }'

# Očekávaný response (přibližně):
{
  "valid": false,
  "platform": "android",
  "error": "Invalid or malformed token"
}
```

Kde najít `YOUR_ANON_KEY`:
```bash
supabase status | grep "anon key"
# nebo z: supabase/config.json
```

### Test 2: Missing Credentials (kontrola env vars)

```bash
# Pokud chybí GOOGLE_CLOUD_PROJECT_NUMBER
curl -X POST http://127.0.0.1:54321/functions/v1/verify-app-integrity \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"token":"test","platform":"android"}'

# Očekávaný response:
{
  "valid": false,
  "platform": "android",
  "error": "Missing Google Cloud configuration"
}
```

### Test 3: iOS Token (bez Apple credentials)

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/verify-app-integrity \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{
    "token": "test-assertion",
    "platform": "ios"
  }'

# Očekávaný response:
{
  "valid": false,
  "platform": "ios",
  "error": "Missing Apple configuration"
}
```

---

## 📱 Testování z Mobile App

### Setup: Integrace integrityFetch

```typescript
// V hooky kde voláš API
import { integrityFetch, initializeIntegrity } from '@/services/api/integrityFetch';

// Při startu app (v _layout.tsx)
useEffect(() => {
  initializeIntegrity();
}, []);

// V API callu
const makeSecureRequest = async (data: any) => {
  try {
    const response = await integrityFetch('/api/my-action', {
      method: 'POST',
      body: JSON.stringify(data),
    }, {
      challenge: 'my-server-nonce', // Server by měl poslat nonce
    });

    if (response.ok) {
      console.log('✅ Request accepted by backend');
      return await response.json();
    } else {
      console.error('❌ Backend rejected:', response.status);
    }
  } catch (error) {
    console.error('❌ Integrity request failed:', error);
  }
};
```

### Manuální test v Dev Tools

```typescript
// V React Native debuggeru (Expo)
import { useAppIntegrity } from '@/hooks/useAppIntegrity';

const DebugScreen = () => {
  const { requestIntegrityToken, isLoading, error, lastToken } = useAppIntegrity();

  return (
    <View>
      <Button
        title={isLoading ? 'Requesting...' : 'Test Integrity Token'}
        onPress={async () => {
          const result = await requestIntegrityToken('test-challenge-123');
          console.log('✅ Token Result:', result);
        }}
      />
      
      {lastToken && (
        <Text>
          Platform: {lastToken.platform}
          Type: {lastToken.tokenType}
          Token: {lastToken.token.substring(0, 50)}...
        </Text>
      )}
      
      {error && <Text style={{color: 'red'}}>❌ {error.message}</Text>}
    </View>
  );
};
```

---

## 🔐 Testing: Full Integration

### Setup: Protected Edge Function

Vytvoř Edge Function která vyžaduje integritu:

```typescript
// supabase/functions/test-protected-endpoint/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAppIntegrity } from '../_shared/appIntegrity.ts';

serve(async (req) => {
  // Vyžaduj integritu
  const integrityError = await requireAppIntegrity(req);
  if (integrityError) return integrityError;

  // Zpracuj request
  return new Response(JSON.stringify({
    success: true,
    message: 'Request passed integrity check',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

Deploy:
```bash
supabase functions deploy test-protected-endpoint
```

### Test ze Mobile App

```typescript
const testProtectedEndpoint = async () => {
  const response = await integrityFetch(
    'http://127.0.0.1:54321/functions/v1/test-protected-endpoint',
    { method: 'POST' },
    { challenge: 'server-nonce' }
  );

  if (response.ok) {
    console.log('✅ Protected endpoint responded');
  } else if (response.status === 403) {
    console.log('❌ Integrity check failed');
  }
};
```

---

## 🐛 Debugging

### Log Environment Variables

```bash
# Zkontroluj sekety jsou nastaveny
supabase secrets list

# Výstup:
# GOOGLE_CLOUD_PROJECT_NUMBER   ***
# GOOGLE_APPLICATION_CREDENTIALS_JSON   ***
# APPLE_APP_ID   ***
```

### Logs z Edge Function

```bash
# Real-time logs
supabase functions list
supabase functions logs verify-app-integrity

# Nebo v Supabase Studio
# http://127.0.0.1:54323 → Functions → verify-app-integrity → Logs
```

### Inspect Request Headers

V Edge Function loguj incoming headers:

```typescript
serve(async (req) => {
  console.log('Headers:', {
    'x-integrity-token': req.headers.get('x-integrity-token'),
    'x-integrity-platform': req.headers.get('x-integrity-platform'),
    'x-integrity-type': req.headers.get('x-integrity-type'),
  });
  // ...
});
```

---

## ✅ Checklist: Backend Activity

- [ ] Lokální Supabase běží (`supabase status`)
- [ ] Edge Function `verify-app-integrity` je deployed
- [ ] `GOOGLE_CLOUD_PROJECT_NUMBER` je nastaveno
- [ ] `GOOGLE_APPLICATION_CREDENTIALS_JSON` je nastaveno
- [ ] `APPLE_APP_ID` je nastaveno
- [ ] Curl request s `platform: 'android'` vrací response (ne error 500)
- [ ] Curl request s `platform: 'ios'` vrací response (ne error 500)
- [ ] Mobile app běží bez TypeScript chyb
- [ ] `useAppIntegrity` hook nevrací error při inicializaci
- [ ] Mock token se dá vygenerovat (`requestIntegrityToken`)

---

## 🚨 Common Issues

### Issue 1: "Missing Google Cloud configuration"

**Příčina:** `GOOGLE_CLOUD_PROJECT_NUMBER` není nastaveno
**Řešení:**
```bash
supabase secrets set GOOGLE_CLOUD_PROJECT_NUMBER=123456789012
supabase functions deploy verify-app-integrity
```

### Issue 2: "Invalid service account JSON"

**Příčina:** `GOOGLE_APPLICATION_CREDENTIALS_JSON` je malformed
**Řešení:**
```bash
# Validuj JSON
cat your-service-account.json | jq .

# Nastav správně (bez line breaks!)
CREDS_JSON=$(cat your-service-account.json | jq -c .)
supabase secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON="$CREDS_JSON"
```

### Issue 3: "Cannot find module '@expo/app-integrity'"

**Příčina:** V mobile-app není nainstalován balíček
**Řešení:**
```bash
cd mobile-app
npm install @expo/app-integrity
```

### Issue 4: iOS token vrací error "Not supported"

**Příčina:** Zařízení nepodporuje App Attest (emulátor, starý iOS)
**Řešení:** Testuj na fyzickém zařízení iOS 14+

### Issue 5: Edge Function timeout

**Příčina:** Google Play Integrity API je pomalá
**Řešení:** Zvyš timeout v Edge Function, implementuj caching

---

## 📊 Test Result Expectations

### Úspěšný Android token (mock)

```json
{
  "valid": true,
  "platform": "android",
  "verdict": {
    "deviceIntegrity": ["MEETS_DEVICE_INTEGRITY"],
    "appIntegrity": "MEETS_DEVICE_INTEGRITY",
    "accountLicensing": "LICENSED"
  }
}
```

### Úspěšný iOS token (mock)

```json
{
  "valid": true,
  "platform": "ios",
  "verdict": {
    "deviceIntegrity": "MEETS_DEVICE_INTEGRITY",
    "appIntegrity": "MEETS_DEVICE_INTEGRITY"
  }
}
```

### Neúspěšný token (bez credentials)

```json
{
  "valid": false,
  "platform": "android",
  "error": "Missing Google Cloud configuration"
}
```

---

## 🔗 Reference

- [Google Play Integrity API - Testing](https://developer.android.com/google/play/integrity/test)
- [Apple App Attest - Testing](https://developer.apple.com/documentation/devicecheck/testing-app-attest-in-xcode)
- [Supabase Functions - Local Testing](https://supabase.com/docs/guides/functions)

---

*Pokud máš otázky, koukej do:**
- [docs/security/APP_INTEGRITY.md](../security/APP_INTEGRITY.md) - Setup
- [supabase/functions/verify-app-integrity/index.ts](../../supabase/functions/verify-app-integrity/index.ts) - Implementation
- [mobile-app/src/hooks/useAppIntegrity.ts](../../mobile-app/src/hooks/useAppIntegrity.ts) - Mobile API
