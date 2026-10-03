import { useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { format, addDays, startOfWeek } from "date-fns";
import { 
  MapPin, 
  Star, 
  Calendar,
  Clock,
  Video,
  Building,
  ChevronRight,
  Check,
  RefreshCw,
  Award
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useCertifiedPartners, useRandomCertifiedPartner, type CertifiedPartnerWithAvailability } from "@/hooks/useCertifiedPartners";
import { cn } from "@/lib/utils";

interface PartnerSelectionProps {
  onSelectPartner: (partner: CertifiedPartnerWithAvailability | null) => void;
  onRequestAppointment?: (partner: CertifiedPartnerWithAvailability, dayOfWeek: number, startTime: string) => void;
  selectedPartnerId?: string | null;
  showAppointmentBooking?: boolean;
  className?: string;
}

export function PartnerSelection({
  onSelectPartner,
  onRequestAppointment,
  selectedPartnerId,
  showAppointmentBooking = true,
  className,
}: PartnerSelectionProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  
  const [showAllPartners, setShowAllPartners] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<CertifiedPartnerWithAvailability | null>(null);
  const [showAvailabilityDialog, setShowAvailabilityDialog] = useState(false);

  // Get a random suggested partner
  const { 
    data: suggestedPartner, 
    isLoading: suggestedLoading,
    refetch: refreshSuggestion 
  } = useRandomCertifiedPartner({ 
    includeAvailability: true,
    preferWithAvailability: true 
  });

  // Get all certified partners for browsing
  const { 
    data: allPartners, 
    isLoading: allLoading 
  } = useCertifiedPartners({ 
    includeAvailability: true,
    randomize: false 
  });

  const handleSelectPartner = (partner: CertifiedPartnerWithAvailability) => {
    setSelectedPartner(partner);
    onSelectPartner(partner);
  };

  const handleSkip = () => {
    setSelectedPartner(null);
    onSelectPartner(null);
  };

  const handleShowAvailability = (partner: CertifiedPartnerWithAvailability) => {
    setSelectedPartner(partner);
    setShowAvailabilityDialog(true);
  };

  const handleBookSlot = (dayOfWeek: number, startTime: string) => {
    if (selectedPartner && onRequestAppointment) {
      onRequestAppointment(selectedPartner, dayOfWeek, startTime);
      setShowAvailabilityDialog(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getDayName = (dayOfWeek: number) => {
    const date = addDays(startOfWeek(new Date()), dayOfWeek);
    return format(date, "EEEE", { locale: dateLocale });
  };

  // Group availability by day
  type AvailabilitySlot = NonNullable<CertifiedPartnerWithAvailability["availability"]>[number];
  const groupAvailabilityByDay = (availability: CertifiedPartnerWithAvailability["availability"]) => {
    const grouped = new Map<number, AvailabilitySlot[]>();
    if (!availability) return grouped;
    
    for (const slot of availability) {
      const existing = grouped.get(slot.day_of_week) || [];
      existing.push(slot);
      grouped.set(slot.day_of_week, existing);
    }
    return grouped;
  };

  if (suggestedLoading) {
    return (
      <div className={cn("space-y-4", className)}>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Suggested Partner Card */}
      {suggestedPartner && !showAllPartners && (
        <Card className={cn(
          "border-2 transition-colors",
          selectedPartnerId === suggestedPartner.id ? "border-primary" : "border-border"
        )}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="h-4 w-4" />
                {t("promo.partnerSelection.suggested")}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refreshSuggestion()}
                className="h-8 px-2"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {t("promo.partnerSelection.another")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={suggestedPartner.avatar_url || undefined} />
                <AvatarFallback className="text-lg">
                  {getInitials(suggestedPartner.display_name || "P")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg truncate">
                  {suggestedPartner.display_name}
                </h3>
                {suggestedPartner.business_name && (
                  <p className="text-sm text-muted-foreground truncate">
                    {suggestedPartner.business_name}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {suggestedPartner.city && (
                    <Badge variant="outline" className="text-xs">
                      <MapPin className="h-3 w-3 mr-1" />
                      {suggestedPartner.city}
                    </Badge>
                  )}
                  {suggestedPartner.certification_passed_at && (
                    <Badge variant="secondary" className="text-xs">
                      <Award className="h-3 w-3 mr-1" />
                      {t("promo.partnerSelection.certified")}
                    </Badge>
                  )}
                  {suggestedPartner.hasAvailability && (
                    <Badge variant="default" className="text-xs">
                      <Calendar className="h-3 w-3 mr-1" />
                      {t("promo.partnerSelection.hasAvailability")}
                    </Badge>
                  )}
                </div>
                {suggestedPartner.description && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                    {suggestedPartner.description}
                  </p>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button
                className="flex-1"
                onClick={() => handleSelectPartner(suggestedPartner)}
                variant={selectedPartnerId === suggestedPartner.id ? "default" : "outline"}
              >
                {selectedPartnerId === suggestedPartner.id ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                      {t("common.selected")}
                  </>
                ) : (
                    t("promo.partnerSelection.selectMentor")
                )}
              </Button>
              {showAppointmentBooking && suggestedPartner.hasAvailability && (
                <Button
                  variant="secondary"
                  onClick={() => handleShowAvailability(suggestedPartner)}
                >
                  <Calendar className="h-4 w-4 mr-2" />
                    {t("promo.partnerSelection.showAvailability")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Browse all partners link */}
      {!showAllPartners && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <Button
            variant="ghost"
            onClick={() => setShowAllPartners(true)}
            className="w-full sm:w-auto"
          >
            {t("promo.partnerSelection.showAll")}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
          <Button
            variant="link"
            onClick={handleSkip}
            className="text-muted-foreground"
          >
            {t("promo.partnerSelection.skip")}
          </Button>
        </div>
      )}

      {/* All Partners List */}
      {showAllPartners && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              {t("promo.partnerSelection.allPartners")}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllPartners(false)}
            >
              {t("common.back")}
            </Button>
          </div>

          {allLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : allPartners && allPartners.length > 0 ? (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3 pr-4">
                {allPartners.map((partner) => (
                  <Card
                    key={partner.id}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/50",
                      selectedPartnerId === partner.id && "border-primary border-2"
                    )}
                    onClick={() => handleSelectPartner(partner)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={partner.avatar_url || undefined} />
                          <AvatarFallback>
                            {getInitials(partner.display_name || "P")}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium truncate">
                              {partner.display_name}
                            </h4>
                            {selectedPartnerId === partner.id && (
                              <Check className="h-5 w-5 text-primary flex-shrink-0" />
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            {partner.city && (
                              <span className="text-xs text-muted-foreground flex items-center">
                                <MapPin className="h-3 w-3 mr-1" />
                                {partner.city}
                              </span>
                            )}
                            {partner.hasAvailability && (
                              <Badge variant="outline" className="text-xs">
                                <Calendar className="h-3 w-3 mr-1" />
                                {t("promo.partnerSelection.hasAvailability")}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {showAppointmentBooking && partner.hasAvailability && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShowAvailability(partner);
                            }}
                          >
                            <Calendar className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <Alert>
              <AlertDescription>
                {t("promo.partnerSelection.noPartners")}
              </AlertDescription>
            </Alert>
          )}

          <Button
            variant="link"
            onClick={handleSkip}
            className="w-full text-muted-foreground"
          >
            {t("promo.partnerSelection.skip")}
          </Button>
        </div>
      )}

      {/* Availability Dialog */}
      <Dialog open={showAvailabilityDialog} onOpenChange={setShowAvailabilityDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("promo.partnerSelection.availabilityTitle", {
                name: selectedPartner?.display_name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("promo.partnerSelection.availabilityDescription")}
            </DialogDescription>
          </DialogHeader>
          
          {selectedPartner?.availability && selectedPartner.availability.length > 0 ? (
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {Array.from(groupAvailabilityByDay(selectedPartner.availability).entries())
                .sort(([a], [b]) => a - b)
                .map(([dayOfWeek, slots]) => (
                  <div key={dayOfWeek}>
                    <h4 className="font-medium text-sm mb-2 capitalize">
                      {getDayName(dayOfWeek)}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {slots?.sort((a, b) => a.start_time.localeCompare(b.start_time)).map((slot) => (
                        <Button
                          key={slot.id}
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => handleBookSlot(dayOfWeek, slot.start_time)}
                        >
                          <Clock className="h-3 w-3 mr-1" />
                          {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                          {slot.is_online ? (
                            <Video className="h-3 w-3 ml-1" />
                          ) : (
                            <Building className="h-3 w-3 ml-1" />
                          )}
                        </Button>
                      ))}
                    </div>
                    <Separator className="mt-3" />
                  </div>
                ))}
            </div>
          ) : (
            <Alert>
              <AlertDescription>
                {t("promo.partnerSelection.noAvailability")}
              </AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
