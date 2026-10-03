import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ImageOff, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceDisplay } from "@/components/common/PriceDisplay";
import { useProducts } from "@/hooks";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/**
 * Runtime block: full product catalog grid.
 * Renders all published products with image, price, badges and link to detail.
 * Config: { columns?: 2 | 3 }
 */
/** Tailwind requires static class names — dynamic interpolation does NOT work. */
const GRID_COLS: Record<number, string> = {
  2: "grid grid-cols-1 md:grid-cols-2 gap-6",
  3: "grid grid-cols-1 md:grid-cols-3 gap-6",
  4: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6",
};

export default function ProductCatalogBlock({ config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const columns = (config?.columns as number) ?? 3;
  const gridClass = GRID_COLS[columns] ?? GRID_COLS[3];
  const { products, loading } = useProducts();

  if (loading) {
    return (
      <div className={gridClass}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-80 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!products?.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {t("shop.emptyState")}
      </div>
    );
  }

  return (
    <div className={gridClass}>
      {products.map((product) => (
        <Link
          key={product.id}
          to={`/shop/${product.slug}`}
          className="group block rounded-xl border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="relative aspect-[4/3] bg-muted overflow-hidden">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageOff className="h-12 w-12 text-muted-foreground/40" />
              </div>
            )}
            <div className="absolute top-2 left-2 flex flex-wrap gap-1">
              {product.requires_membership && (
                <Badge variant="secondary">{t("shop.membersOnly")}</Badge>
              )}
              {product.category && (
                <Badge variant="outline" className="bg-background/80">
                  {product.category}
                </Badge>
              )}
              {!product.in_stock && (
                <Badge variant="destructive">{t("shop.outOfStock")}</Badge>
              )}
            </div>
          </div>

          <div className="p-4 space-y-2">
            <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">
              {product.name}
            </h3>
            {product.short_description && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {product.short_description}
              </p>
            )}
            <div className="flex items-center justify-between pt-2">
              <PriceDisplay amount={product.price} size="md" />
              <Button size="sm" variant="outline">
                {t("shop.viewDetail")}
              </Button>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
