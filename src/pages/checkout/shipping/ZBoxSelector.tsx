/**
 * Z-BOX selector — list of Packeta Z-BOX parcel lockers.
 *
 * Similar to PickupPointSelector but styled for Z-BOXes (24/7, keypad, etc.)
 *
 * @module pages/checkout/shipping/ZBoxSelector
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Lock, MapPin, Navigation, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShippingPoint } from "@/lib/schemas/shippingCheckoutSchemas";

interface ZBoxSelectorProps {
  /** Callback when a Z-BOX is selected */
  onSelect: (point: ShippingPoint) => void;
  /** Available Z-BOXes */
  points: ShippingPoint[];
  /** Currently selected Z-BOX */
  selectedPoint: ShippingPoint | null;
  /** Total available count (before limit) */
  totalCount?: number;
}

/**
 * Searchable list of Z-BOX parcel lockers.
 */
export function ZBoxSelector({
  onSelect,
  points,
  selectedPoint,
  totalCount,
}: ZBoxSelectorProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return points;
    const q = searchQuery.toLowerCase().trim();
    return points.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.street.toLowerCase().includes(q) ||
        p.zip.replace(/\s/g, "").includes(q.replace(/\s/g, "")),
    );
  }, [points, searchQuery]);

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("checkout.shipping.searchZBox")}
          type="search"
          value={searchQuery}
        />
      </div>

      {/* Selected summary */}
      {selectedPoint && (
        <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="font-medium text-sm">{t("checkout.shipping.selectedZBox")}</span>
          </div>
          <div className="text-sm">
            <strong>{selectedPoint.name}</strong>
            <span className="text-muted-foreground ml-1">
              — {selectedPoint.street}, {selectedPoint.city} {selectedPoint.zip}
            </span>
          </div>
        </div>
      )}

      {/* Z-BOX list */}
      <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            {t("checkout.shipping.noZBoxesFound")}
          </div>
        ) : (
          filtered.map((point) => (
            <button
              type="button"
              key={point.id}
              onClick={() => onSelect(point)}
              className={cn(
                "w-full text-left p-3 hover:bg-muted/50 transition-colors",
                selectedPoint?.id === point.id && "bg-primary/5 border-l-4 border-l-primary",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{point.name}</span>
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {t("checkout.shipping.open247")}
                    </Badge>
                    {point.hasKeypad && (
                      <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <MapPin className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">
                      {point.street}, {point.city} {point.zip}
                    </span>
                  </div>
                </div>
                {point.distance != null && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                    <Navigation className="h-3 w-3" />
                    <span>{point.distance} {t("checkout.shipping.km")}</span>
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {totalCount != null && totalCount > points.length && (
        <p className="text-xs text-muted-foreground text-center">
          {t("checkout.shipping.showingOfTotal", {
            count: points.length,
            total: totalCount,
          })}
        </p>
      )}
    </div>
  );
}
