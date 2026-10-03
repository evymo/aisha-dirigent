/**
 * PriceDisplay component for showing prices in user's preferred currency
 *
 * Automatically converts from base currency to user's currency based on language
 * and optional user-selected preference.
 */

import { useCurrency } from "@/hooks/useCurrency";
import { cn } from "@/lib/utils";

interface PriceDisplayProps {
  /** Price in base currency (configured via system config) */
  amount: number;
  /** Optional: force specific currency instead of auto-detect */
  forceCurrency?: string;
  /** Show original base price as secondary */
  showOriginal?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

export function PriceDisplay({
  amount,
  forceCurrency,
  showOriginal = false,
  className,
  size = "md",
}: PriceDisplayProps) {
  const { formatPrice, formatCurrency, preferredCurrency, baseCurrency } = useCurrency();

  const targetCurrency = forceCurrency ?? preferredCurrency;
  const isConverted = targetCurrency !== baseCurrency;

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-2xl font-bold",
  };

  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span className={sizeClasses[size]}>
        {formatPrice(amount, targetCurrency)}
      </span>
      {showOriginal && isConverted && (
        <span className="text-xs text-muted-foreground">
          ({formatCurrency(amount, baseCurrency)})
        </span>
      )}
    </span>
  );
}
