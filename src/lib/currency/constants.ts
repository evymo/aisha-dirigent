/**
 * Currency is per-instance DATA/config, never baked into code.
 *
 * The real base currency is resolved at runtime from `system_config`
 * (`commerce_base_currency`) via `useCommerceBaseCurrency()` on the client and
 * `public.commerce_base_currency()` in the database.
 *
 * BASE_CURRENCY_FALLBACK is the single sanctioned LAST-RESORT constant used only
 * when that config read is pending/unavailable (loading/error edge) or in pure,
 * non-React modules (schema defaults, formatters) that cannot read config
 * reactively. It is intentionally the one place a fiat code appears in code —
 * everything else must route through the config resolver. Do NOT add new fiat
 * literals elsewhere; import this instead.
 */
export const BASE_CURRENCY_FALLBACK = "CZK";
