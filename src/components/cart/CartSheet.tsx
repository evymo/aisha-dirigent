import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ShoppingBag, Plus, Minus, Trash2, ArrowRight } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { useSession } from "@/hooks/useSession";
import { useCurrency } from "@/hooks/useCurrency";

interface CartSheetProps {
  children?: React.ReactNode;
}

export function CartSheet({ children }: CartSheetProps) {
  const { t } = useTranslation();
  const { items, loading, updateQuantity, removeFromCart, total, itemCount } = useCart();
  const { user } = useSession();
  const { formatPrice } = useCurrency();
  const isAuthenticated = !!user;
  const safeItems = Array.isArray(items) ? items : [];
  const safeTotal = typeof total === "number" ? total : 0;
  const safeItemCount = typeof itemCount === "number" ? itemCount : 0;

  const productTranslationKeys = useMemo(() => {
    if (!Array.isArray(items)) return [];

    const keys = items
      .map((item) => item.product?.slug)
      .filter((slug): slug is string => typeof slug === "string" && slug.trim().length > 0)
      .map((slug) => `products.${slug}.name`);

    return Array.from(new Set(keys));
  }, [items]);

  const productTranslations = useDynamicTranslationsMap(productTranslationKeys, "products", "en");

  const getProductName = (product?: { slug?: string | null; name?: string | null }) => {
    const slug = typeof product?.slug === "string" ? product.slug.trim() : "";
    if (!slug) return product?.name || "";

    const key = `products.${slug}.name`;
    const translated = typeof productTranslations[key] === "string" ? productTranslations[key].trim() : "";
    return translated || product?.name || "";
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        {children || (
          <Button variant="ghost" size="icon" className="relative" aria-label="Open cart">
            <ShoppingBag className="h-5 w-5" />
            {safeItemCount > 0 && (
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                {safeItemCount}
              </span>
            )}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-serif text-2xl">{t('cart.title')}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col h-full pt-6">
          {!isAuthenticated ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
              <ShoppingBag className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-serif text-lg font-semibold mb-2">{t('cart.signInToView')}</h3>
              <p className="text-sm text-muted-foreground mb-6">
                {t('cart.signInDescription')}
              </p>
              <Button asChild>
                <Link to="/auth">{t('common.signIn')}</Link>
              </Button>
            </div>
          ) : loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
            </div>
          ) : safeItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
              <ShoppingBag className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-serif text-lg font-semibold mb-2">{t('cart.empty')}</h3>
              <p className="text-sm text-muted-foreground mb-6">
                {t('cart.emptyDescription')}
              </p>
              <Button asChild variant="outline">
                <Link to="/shop">{t('cart.browseProducts')}</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                {safeItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex gap-4 p-4 bg-muted/50 rounded-lg border border-border"
                  >
                    <div className="w-20 h-20 bg-muted rounded-md overflow-hidden flex-shrink-0">
                      <img
                        src={item.product?.image_url || "/placeholder.svg"}
                        alt={getProductName(item.product)}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-foreground truncate">
                        {getProductName(item.product)}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {formatPrice(item.product?.price || 0)}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="Decrease quantity"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center text-sm">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="Increase quantity"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 ml-auto text-destructive hover:text-destructive"
                          aria-label="Remove item"
                          onClick={() => removeFromCart(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-6 mt-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-medium">{t('cart.total')}</span>
                  <span className="text-2xl font-semibold">
                    {formatPrice(safeTotal)}
                  </span>
                </div>
                <Button className="w-full" size="lg" asChild>
                  <Link to="/checkout">
                    {t('cart.proceedToCheckout')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  {t('cart.shippingCalculated')}
                </p>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
