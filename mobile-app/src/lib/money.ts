/**
 * Currency-aware money formatting.
 *
 * Currency is DATA (a row's `currency` / the instance base currency), never a
 * baked fiat literal. `formatMoney` renders an amount in whatever currency code
 * it is handed via `Intl.NumberFormat`, falling back to a plain `amount code`
 * string when the runtime does not recognise the ISO code.
 */

/** Format `amount` in the ISO 4217 `currency` code, localized by `locale`. */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Intl throws RangeError on an unsupported currency code — degrade to
    // "<amount> <code>" rather than a hardcoded symbol.
    return `${amount} ${code}`;
  }
}
