/**
 * Shipping category card — visual grouping for a shipping method category.
 *
 * Shows a selectable card with icon, title, description, price.
 * Used inside the CheckoutShippingSection to render each category
 * (pickup, Z-BOX, home delivery, personal).
 *
 * @module pages/checkout/shipping/ShippingCategoryCard
 */

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface ShippingCategoryCardProps {
  /** Whether user has free shipping */
  children?: ReactNode;
  /** Cost to display (0 = free) */
  cost: number;
  /** Short description for the category */
  description: string;
  /** Whether this card is disabled */
  disabled?: boolean;
  /** Currency format function */
  formatCurrency: (amount: number, currency: string) => string;
  /** Icon component (lucide-react) */
  icon: ReactNode;
  /** Whether user has free shipping for this method */
  isFree?: boolean;
  /** Whether this category is currently selected */
  isSelected: boolean;
  /** Click handler */
  onClick: () => void;
  /** ISO 4217 currency code */
  preferredCurrency: string;
  /** Title for the category */
  title: string;
}

/**
 * A selectable card representing a shipping category.
 */
export function ShippingCategoryCard({
  children,
  cost,
  description,
  disabled = false,
  formatCurrency,
  icon,
  isFree = false,
  isSelected,
  onClick,
  preferredCurrency,
  title,
}: ShippingCategoryCardProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 border rounded-lg transition-colors",
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "hover:bg-muted/50",
        disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex items-center justify-center w-10 h-10 rounded-lg",
            isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}>
            {icon}
          </div>
          <div>
            <span className="font-medium">{title}</span>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex-shrink-0 ml-4 text-right">
          {isFree || cost === 0 ? (
            <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
              {t("checkout.shipping.free")}
            </Badge>
          ) : (
            <span className="font-medium">
              {formatCurrency(cost, preferredCurrency)}
            </span>
          )}
        </div>
      </div>
      {isSelected && children && (
        <div className="mt-4 border-t pt-4">
          {children}
        </div>
      )}
    </button>
  );
}
