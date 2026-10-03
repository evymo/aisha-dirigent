import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { useProductAccess, ProductAccessType, canAddToCart } from "@/hooks/useProductAccess";
import { Lock, ShoppingCart, Clock, CheckCircle, Loader2 } from "lucide-react";

interface ProductAccessBadgeProps {
  productId: string;
  showLabel?: boolean;
  className?: string;
}

/**
 * Displays the user's access level for a product.
 * Badges:
 * - "View Only" (lock icon) - user can only view, no cart
 * - "Pre-order" (clock icon) - user can pre-order
 * - "Order" (cart icon) - user can order
 * - "Auto-Approve" (check icon) - orders auto-approved
 */
export function ProductAccessBadge({ 
  productId, 
  showLabel = true,
  className = ""
}: ProductAccessBadgeProps) {
  const { t } = useTranslation();
  const { accessType, isLoading } = useProductAccess(productId);

  if (isLoading) {
    return (
      <Badge variant="secondary" className={className}>
        <Loader2 className="h-3 w-3 animate-spin" />
      </Badge>
    );
  }

  const badgeConfig = getBadgeConfig(accessType, t);

  return (
    <Badge variant={badgeConfig.variant} className={`${className} flex items-center gap-1`}>
      {badgeConfig.icon}
      {showLabel && <span>{badgeConfig.label}</span>}
    </Badge>
  );
}

interface BadgeConfig {
  icon: React.ReactNode;
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
}

type TranslateFn = (key: string) => string;

function getBadgeConfig(
  accessType: ProductAccessType | null, 
  t: TranslateFn
): BadgeConfig {
  switch (accessType) {
    case "auto_approve":
      return {
        icon: <CheckCircle className="h-3 w-3" />,
        label: t("shop.access.autoApprove"),
        variant: "default"
      };
    case "order":
      return {
        icon: <ShoppingCart className="h-3 w-3" />,
        label: t("shop.access.canOrder"),
        variant: "default"
      };
    case "preorder":
      return {
        icon: <Clock className="h-3 w-3" />,
        label: t("shop.access.preorder"),
        variant: "secondary"
      };
    case "view":
    default:
      return {
        icon: <Lock className="h-3 w-3" />,
        label: t("shop.access.viewOnly"),
        variant: "outline"
      };
  }
}

/**
 * Component to conditionally show Add to Cart based on access.
 */
interface AddToCartGuardProps {
  productId: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function AddToCartGuard({ 
  productId, 
  children, 
  fallback 
}: AddToCartGuardProps) {
  const { accessType, isLoading } = useProductAccess(productId);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  
  if (!canAddToCart(accessType)) {
    return <>{fallback}</> || null;
  }
  
  return <>{children}</>;
}
