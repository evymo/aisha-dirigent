import { useParams } from "react-router-dom";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
// Separator removed - not currently used
import { usePartnerProfile, usePartnerAvailability } from "@/hooks/usePartners";
import { usePartnerRatingStats } from "@/hooks/usePartnerReviews";
import { PartnerBookingDialog } from "@/components/partners/PartnerBookingDialog";
import { useState } from "react";
import {
  Building,
  User,
  MapPin,
  Mail,
  Phone,
  Globe,
  Video,
  Calendar,
  Clock,
  Star,
  Award,
  CheckCircle,
  MessageSquare,
  Languages,
} from "lucide-react";

const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default function PartnerProfile() {
  const { partnerId } = useParams<{ partnerId: string }>();
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  
  const { data: partnerData, isLoading } = usePartnerProfile(partnerId || "");
  // Extend partner with optional fields that exist in DB but not in generated types
  const partner = partnerData as (typeof partnerData & { notes_for_visitors?: string; languages?: string[] }) | undefined;
  const { data: availability = [] } = usePartnerAvailability(partnerId || "");
  const { totalReviews, averageRating, ratingDistribution, reviews } = usePartnerRatingStats(partnerId || "");
  
  const [bookingOpen, setBookingOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (!partner) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">{t("partnerProfile.notFound")}</h1>
          <p className="text-muted-foreground">{t("partnerProfile.notFoundDescription")}</p>
        </main>
        <Footer />
      </div>
    );
  }

  // Group availability by day
  const availabilityByDay = availability.reduce((acc, slot) => {
    if (!acc[slot.day_of_week]) {
      acc[slot.day_of_week] = [];
    }
    acc[slot.day_of_week].push(slot);
    return acc;
  }, {} as Record<number, typeof availability>);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="py-12">
        <div className="container max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header Section */}
          <div className="flex flex-col md:flex-row gap-6 mb-8">
            <div className="flex-shrink-0">
              <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                {partner.is_production_provider ? (
                  <Building className="h-12 w-12 text-primary" />
                ) : (
                  <User className="h-12 w-12 text-primary" />
                )}
              </div>
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h1 className="text-3xl font-serif font-bold text-foreground">
                  {partner.display_name}
                </h1>
                <Badge variant={partner.is_production_provider ? "default" : "secondary"}>
                  {partner.is_production_provider
                    ? t("partners.badges.provider")
                    : t("partners.badges.partner")}
                </Badge>
              </div>
              {partner.business_name && (
                <p className="text-lg text-muted-foreground mb-2">{partner.business_name}</p>
              )}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {partner.city}, {partner.country}
                </span>
                {totalReviews > 0 && (
                  <span className="flex items-center gap-1">
                    <Star className="h-4 w-4 fill-warning text-warning" />
                    {averageRating} ({totalReviews} {t("partnerProfile.reviews")})
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => setBookingOpen(true)}>
                <Calendar className="mr-2 h-4 w-4" />
                {t("partners.bookAppointment")}
              </Button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="md:col-span-2 space-y-6">
              {/* About */}
              {partner.description && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t("partnerProfile.about")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground whitespace-pre-line">{partner.description}</p>
                  </CardContent>
                </Card>
              )}

              {/* Notes for Visitors */}
              {partner.notes_for_visitors && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5" />
                      {t("partnerProfile.notesForVisitors")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground whitespace-pre-line">{partner.notes_for_visitors}</p>
                  </CardContent>
                </Card>
              )}

              {/* Services */}
              {partner.services && partner.services.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t("partnerProfile.services")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {partner.services.map((service) => (
                        <Badge key={service} variant="outline" className="py-1 px-3">
                          {t(`partnerCertification.services.${service}`)}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Languages */}
              {partner.languages && partner.languages.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Languages className="h-5 w-5" />
                      {t("partnerProfile.languages")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {partner.languages.map((lang: string) => (
                        <Badge key={lang} variant="secondary" className="py-1 px-3">
                          {t(`partnerProfileEdit.languages.${lang}`)}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Availability */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    {t("partnerProfile.availability")}
                  </CardTitle>
                  <CardDescription>{t("partnerProfile.availabilityDescription")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(availabilityByDay).length === 0 ? (
                      <p className="text-muted-foreground text-sm">{t("partnerProfile.noAvailability")}</p>
                    ) : (
                      Object.entries(availabilityByDay)
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([day, slots]) => (
                          <div key={day} className="flex items-start justify-between py-2 border-b last:border-0">
                            <span className="font-medium capitalize">
                              {t(`common.days.${dayNames[Number(day)]}`)}
                            </span>
                            <div className="text-right space-y-1">
                              {slots.map((slot) => (
                                <div key={slot.id} className="flex items-center gap-2 text-sm">
                                  <span className="text-muted-foreground">
                                    {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                                  </span>
                                  <Badge variant="outline" className="text-xs">
                                    {slot.is_online ? (
                                      <><Video className="h-3 w-3 mr-1" />{t("partners.online")}</>
                                    ) : (
                                      <><MapPin className="h-3 w-3 mr-1" />{t("partners.inPerson")}</>
                                    )}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
                    {partner.accepts_online_appointments && (
                      <Badge variant="secondary" className="gap-1">
                        <Video className="h-3 w-3" />
                        {t("partnerProfile.acceptsOnline")}
                      </Badge>
                    )}
                    {partner.accepts_in_person_appointments && (
                      <Badge variant="secondary" className="gap-1">
                        <MapPin className="h-3 w-3" />
                        {t("partnerProfile.acceptsInPerson")}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Reviews */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Star className="h-5 w-5" />
                    {t("partnerProfile.reviewsTitle")}
                  </CardTitle>
                  <CardDescription>
                    {totalReviews > 0
                      ? t("partnerProfile.reviewsCount", { count: totalReviews })
                      : t("partnerProfile.noReviewsYet")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {totalReviews > 0 && (
                    <>
                      {/* Rating Summary */}
                      <div className="flex items-center gap-6 mb-6 p-4 bg-muted/50 rounded-lg">
                        <div className="text-center">
                          <div className="text-4xl font-bold text-foreground">{averageRating}</div>
                          <div className="flex items-center gap-0.5 mt-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`h-4 w-4 ${
                                  star <= Math.round(averageRating)
                                    ? "fill-warning text-warning"
                                    : "text-muted-foreground/30"
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="flex-1 space-y-1">
                          {ratingDistribution.map(({ rating, count, percentage }) => (
                            <div key={rating} className="flex items-center gap-2 text-sm">
                              <span className="w-3">{rating}</span>
                              <Star className="h-3 w-3 text-warning" />
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-warning rounded-full transition-all"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                              <span className="w-8 text-muted-foreground text-xs">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Individual Reviews */}
                      <div className="space-y-4">
                        {reviews.slice(0, 5).map((review) => (
                          <div key={review.id} className="pb-4 border-b last:border-0">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <Star
                                    key={star}
                                    className={`h-3 w-3 ${
                                      star <= review.rating
                                        ? "fill-warning text-warning"
                                        : "text-muted-foreground/30"
                                    }`}
                                  />
                                ))}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(review.created_at), "d. M. yyyy", { locale: dateLocale })}
                              </span>
                            </div>
                            {review.comment && (
                              <p className="text-sm text-muted-foreground">{review.comment}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Certification */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Award className="h-5 w-5 text-primary" />
                    {t("partnerProfile.certification")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t("partnerProfile.testScore")}</span>
                    <span className="font-bold text-primary">{partner.certification_score}%</span>
                  </div>
                  {partner.certification_passed_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{t("partnerProfile.certifiedSince")}</span>
                      <span className="text-sm">
                        {format(new Date(partner.certification_passed_at), "d. M. yyyy", { locale: dateLocale })}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-2">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      {partner.certification_level === "certified_provider"
                        ? t("partnerProfile.certifiedProvider")
                        : t("partnerProfile.certifiedPartner")}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Contact */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("partnerProfile.contact")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {partner.email && (
                    <a
                      href={`mailto:${partner.email}`}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Mail className="h-4 w-4" />
                      {partner.email}
                    </a>
                  )}
                  {partner.phone && (
                    <a
                      href={`tel:${partner.phone}`}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Phone className="h-4 w-4" />
                      {partner.phone}
                    </a>
                  )}
                  {partner.website && (
                    <a
                      href={partner.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Globe className="h-4 w-4" />
                      {t("partnerProfile.visitWebsite")}
                    </a>
                  )}
                  {partner.address && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 mt-0.5" />
                      <span>{partner.address}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {/* Booking Dialog */}
      <PartnerBookingDialog
        partner={partner}
        open={bookingOpen}
        onOpenChange={setBookingOpen}
      />
    </div>
  );
}
