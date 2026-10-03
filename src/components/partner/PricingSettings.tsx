/**
 * Specialist pricing settings form — hourly rate, min block, max concurrent, instant booking.
 *
 * @module components/partner/PricingSettings
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateSpecialistPricing } from "@/hooks/useSpecialistPricing";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { Settings, Zap, Loader2 } from "lucide-react";

interface PricingSettingsProps {
  /** Current pricing from partner profile or null if not set */
  currentPricing?: {
    hourly_rate?: number | null;
    min_block_hours?: number | null;
    max_concurrent_projects?: number | null;
    instant_booking_enabled?: boolean | null;
  } | null;
}

/**
 * Form component for specialist to manage their pricing.
 * Uses upsert RPC — works for both create and update.
 *
 * @example
 * <PricingSettings currentPricing={profile?.pricing} />
 */
export function PricingSettings({ currentPricing }: PricingSettingsProps) {
  const { t } = useTranslation();
  const { baseCurrency } = useCurrency();
  const updatePricing = useUpdateSpecialistPricing();

  const [hourlyRate, setHourlyRate] = useState(
    currentPricing?.hourly_rate ?? 3250
  );
  const [minBlock, setMinBlock] = useState(
    currentPricing?.min_block_hours ?? 4
  );
  const [maxConcurrent, setMaxConcurrent] = useState(
    currentPricing?.max_concurrent_projects ?? 3
  );
  const [instantBooking, setInstantBooking] = useState(
    currentPricing?.instant_booking_enabled ?? false
  );

  useEffect(() => {
    if (currentPricing) {
      if (currentPricing.hourly_rate != null)
        setHourlyRate(currentPricing.hourly_rate);
      if (currentPricing.min_block_hours != null)
        setMinBlock(currentPricing.min_block_hours);
      if (currentPricing.max_concurrent_projects != null)
        setMaxConcurrent(currentPricing.max_concurrent_projects);
      if (currentPricing.instant_booking_enabled != null)
        setInstantBooking(currentPricing.instant_booking_enabled);
    }
  }, [currentPricing]);

  const handleSave = () => {
    updatePricing.mutate(
      {
        hourlyRateCzk: hourlyRate,
        minBlockHours: minBlock,
        maxConcurrentProjects: maxConcurrent,
        instantBookingEnabled: instantBooking,
      },
      {
        onSuccess: () => {
          toast.success(t("delivery.pricing.saved"));
        },
        onError: (error) => {
          safeError("PricingSettings.updatePricing", error);
          toast.error(t("delivery.pricing.saveError"));
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {t("delivery.pricing.title")}
        </CardTitle>
        <CardDescription>
          {t("delivery.pricing.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Hourly Rate */}
        <div className="space-y-2">
          <Label htmlFor="hourly-rate">{t("delivery.pricing.hourlyRate")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="hourly-rate"
              type="number"
              min={500}
              max={50000}
              step={50}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm text-muted-foreground">{baseCurrency} / h</span>
          </div>
        </div>

        {/* Min Block */}
        <div className="space-y-2">
          <Label htmlFor="min-block">{t("delivery.pricing.minBlock")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="min-block"
              type="number"
              min={1}
              max={40}
              step={1}
              value={minBlock}
              onChange={(e) => setMinBlock(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm text-muted-foreground">h</span>
          </div>
        </div>

        {/* Max Concurrent */}
        <div className="space-y-2">
          <Label htmlFor="max-concurrent">
            {t("delivery.pricing.maxConcurrent")}
          </Label>
          <Input
            id="max-concurrent"
            type="number"
            min={1}
            max={20}
            step={1}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(Number(e.target.value))}
            className="w-40"
          />
        </div>

        {/* Instant Booking */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="instant-booking" className="flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-yellow-500" />
              {t("delivery.pricing.instantBooking")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("delivery.pricing.instantBookingDescription")}
            </p>
          </div>
          <Switch
            id="instant-booking"
            checked={instantBooking}
            onCheckedChange={setInstantBooking}
          />
        </div>

        {/* Save Button */}
        <Button
          onClick={handleSave}
          disabled={updatePricing.isPending}
          className="w-full"
        >
          {updatePricing.isPending && (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          )}
          {t("delivery.pricing.save")}
        </Button>
      </CardContent>
    </Card>
  );
}
