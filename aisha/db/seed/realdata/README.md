# Real Data — Production User Migration

Tato složka je **gitignored** a obsahuje SQL soubory pro migraci reálných dat
z produkčního systému pro konkrétní uživatele.

## Struktura

```
realdata/
├── README.md              # Tento soubor (NENÍ gitignored)
├── .gitkeep               # Drží složku v gitu
├── users/                 # Per-user data migrace
│   ├── user_abc123.sql
│   └── user_def456.sql
├── partners/              # Per-partner data migrace
│   └── partner_xyz.sql
└── bulk/                  # Hromadné migrace
    └── 2026-02-import.sql
```

## Bezpečnostní pravidla

- **NIKDY** necommituj SQL soubory s reálnými daty
- Soubory obsahují sensitive data — chráněné zdravotní údaje
- Po aplikaci na produkci soubor **smaž**
- Před aplikací vždy zkontroluj na lokální DB

## Použití

```bash
# Aplikovat na lokální DB (AISHA PostgreSQL — port viz `npx supabase status` / lokální stack)
psql "$LOCAL_DB_URL" -f aisha/db/seed/realdata/users/user_abc.sql

# Aplikovat na produkci (přes SSH tunel / VPN)
psql "$PRODUCTION_DB_URL" -f aisha/db/seed/realdata/users/user_abc.sql
```
