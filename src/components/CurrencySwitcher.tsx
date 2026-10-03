import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrency } from "@/hooks/useCurrency";
import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";

// Loading-state guard only: shown until the currency_rates registry (the real,
// per-instance currency list) loads. Never a hardcoded multi-fiat set — just the
// instance base currency as a single last-resort entry.
const fallbackCurrencies = [
  { code: BASE_CURRENCY_FALLBACK, label: BASE_CURRENCY_FALLBACK, symbol: BASE_CURRENCY_FALLBACK },
];

type CurrencyOption = {
  code: string;
  label: string;
  symbol: string;
};

export function CurrencySwitcher() {
  const { t } = useTranslation();
  const { rates, preferredCurrency, setPreferredCurrency } = useCurrency();

  const currencies = useMemo<CurrencyOption[]>(() => {
    if (rates.length === 0) return fallbackCurrencies;

    return rates
      .filter((rate) => rate.is_active)
      .map((rate) => ({
        code: rate.code,
        label: rate.name_native || rate.name || rate.code,
        symbol: rate.symbol || rate.code,
      }));
  }, [rates]);

  const current =
    currencies.find((currency) => currency.code === preferredCurrency) ||
    currencies[0] ||
    fallbackCurrencies[0];

  const handleChange = (code: string) => {
    if (code === preferredCurrency) return;
    setPreferredCurrency(code);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2"
          aria-label={t("common.currency")}
        >
          <span className="font-semibold">{current.symbol}</span>
          <span className="hidden sm:inline">{current.code}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {currencies.map((currency) => (
          <DropdownMenuItem
            key={currency.code}
            onClick={() => handleChange(currency.code)}
            className={currency.code === preferredCurrency ? "bg-muted" : ""}
          >
            <span className="mr-2 font-semibold">{currency.symbol}</span>
            <span className="mr-2">{currency.code}</span>
            <span className="text-muted-foreground">{currency.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
