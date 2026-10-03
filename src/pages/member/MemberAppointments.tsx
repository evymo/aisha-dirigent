import { useEffect, useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format, parseISO, isPast, isFuture, isToday } from "date-fns";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/hooks/useSession";
import { useMyAppointmentNotes, useMyAppointments, useUpdateAppointment } from "@/hooks/usePartners";
import { useAppointmentReview } from "@/hooks/usePartnerReviews";
import { AppointmentReviewDialog } from "@/components/appointments/AppointmentReviewDialog";
import { RequireSecureMode } from "@/components/security/RequireSecureMode";
import { useSecureMode } from "@/hooks/useSecureMode";
import { toast } from "sonner";
import {
  Calendar,
  Clock,
  MapPin,
  Video,
  Building,
  User,
  XCircle,
  Users,
  Star,
  MessageSquare,
} from "lucide-react";
import type { Locale } from "date-fns";

interface Appointment {
  id: string;
  partner_id: string;
  member_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  appointment_type: string;
  status: string;
  service: string | null;
  created_at: string;
  updated_at: string;
  partner?: { display_name: string; business_name: string | null; city: string } | null;
}

export default function MemberAppointments() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const { data: appointments = [], isLoading } = useMyAppointments({ enabled: isPhiEnabled, client: secureClient ?? undefined });
  const { data: notesByAppointmentId = {} } = useMyAppointmentNotes(
    appointments.map((a: Appointment) => a.id),
    { enabled: isPhiEnabled, client: secureClient ?? undefined }
  );
  const updateAppointment = useUpdateAppointment({ client: secureClient ?? undefined });
  
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<{
    id: string;
    partnerId: string;
    partnerName: string;
  } | null>(null);

  const dateLocale = getDateFnsLocale(i18n.language);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  const handleCancelAppointment = async (appointmentId: string) => {
    if (!isPhiEnabled || !secureClient) {
      toast.error(t("phiMode.title"));
      return;
    }

    try {
      await updateAppointment.mutateAsync({ id: appointmentId, status: "cancelled" });
      toast.success(t("memberAppointments.cancelled"));
    } catch (error) {
      toast.error(t("memberAppointments.cancelFailed"));
    }
  };

  const handleOpenReview = (appointment: Appointment) => {
    setSelectedAppointment({
      id: appointment.id,
      partnerId: appointment.partner_id,
      partnerName: appointment.partner?.display_name || "",
    });
    setReviewDialogOpen(true);
  };

  const upcomingAppointments = appointments.filter(
    (a: Appointment) => a.status !== "cancelled" && (isFuture(parseISO(a.appointment_date)) || isToday(parseISO(a.appointment_date)))
  );
  const pastAppointments = appointments.filter(
    (a: Appointment) => isPast(parseISO(a.appointment_date)) && !isToday(parseISO(a.appointment_date))
  );
  const cancelledAppointments = appointments.filter((a: Appointment) => a.status === "cancelled");

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  const statusColors = {
    pending: "bg-warning/10 text-warning",
    confirmed: "bg-primary/10 text-primary",
    completed: "bg-secondary/50 text-secondary-foreground",
    cancelled: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <RequireSecureMode>
          <div className="container max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {t("memberAppointments.title")}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t("memberAppointments.subtitle")}
              </p>
            </div>
            <Button asChild>
              <Link to="/partners">
                <Users className="w-4 h-4 mr-2" />
                {t("memberAppointments.findPartner")}
              </Link>
            </Button>
          </div>

          {appointments.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">{t("memberAppointments.noAppointments")}</h3>
                <p className="text-muted-foreground mb-6">{t("memberAppointments.noAppointmentsDescription")}</p>
                <Button asChild>
                  <Link to="/partners">{t("memberAppointments.browsePartners")}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Tabs defaultValue="upcoming" className="space-y-6">
              <TabsList>
                <TabsTrigger value="upcoming">
                  {t("memberAppointments.tabs.upcoming")}
                  {upcomingAppointments.length > 0 && (
                    <Badge variant="secondary" className="ml-2">{upcomingAppointments.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="past">{t("memberAppointments.tabs.past")}</TabsTrigger>
                <TabsTrigger value="cancelled">{t("memberAppointments.tabs.cancelled")}</TabsTrigger>
              </TabsList>

              <TabsContent value="upcoming">
                {upcomingAppointments.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      {t("memberAppointments.noUpcoming")}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {upcomingAppointments.map((appointment: Appointment) => (
                      <Card key={appointment.id}>
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between">
                            <div className="space-y-3">
                              {/* Partner info */}
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <User className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                  <p className="font-medium">{appointment.partner?.display_name}</p>
                                  {appointment.partner?.business_name && (
                                    <p className="text-sm text-muted-foreground">
                                      {appointment.partner.business_name}
                                    </p>
                                  )}
                                </div>
                              </div>

                              {/* Date and time */}
                              <div className="flex flex-wrap gap-4 text-sm">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <Calendar className="h-4 w-4" />
                                  <span>
                                    {format(parseISO(appointment.appointment_date), "EEEE, d. MMMM yyyy", {
                                      locale: dateLocale,
                                    })}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <Clock className="h-4 w-4" />
                                  <span>
                                    {appointment.start_time.slice(0, 5)} - {appointment.end_time.slice(0, 5)}
                                  </span>
                                </div>
                              </div>

                              {/* Type and location */}
                              <div className="flex flex-wrap gap-4 text-sm">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  {appointment.appointment_type === "online" ? (
                                    <Video className="h-4 w-4" />
                                  ) : (
                                    <MapPin className="h-4 w-4" />
                                  )}
                                  <span>
                                    {appointment.appointment_type === "online"
                                      ? t("memberAppointments.type.online")
                                      : t("memberAppointments.type.inPerson")}
                                  </span>
                                </div>
                                {appointment.partner?.city && (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <Building className="h-4 w-4" />
                                    <span>{appointment.partner.city}</span>
                                  </div>
                                )}
                              </div>

                              {/* Service */}
                              {appointment.service && (
                                <p className="text-sm">
                                  <span className="text-muted-foreground">{t("memberAppointments.service")}: </span>
                                  {appointment.service}
                                </p>
                              )}

                              {/* Notes */}
                              {notesByAppointmentId[appointment.id] && (
                                <p className="text-sm text-muted-foreground">
                                  {notesByAppointmentId[appointment.id]}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-col items-end gap-3">
                              <Badge className={statusColors[appointment.status as keyof typeof statusColors]}>
                                {t(`memberAppointments.status.${appointment.status}`)}
                              </Badge>

                              {(appointment.status === "pending" || appointment.status === "confirmed") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancelAppointment(appointment.id)}
                                >
                                  <XCircle className="h-4 w-4 mr-1" />
                                  {t("memberAppointments.cancel")}
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="past">
                {pastAppointments.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      {t("memberAppointments.noPast")}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {pastAppointments.map((appointment: Appointment) => (
                      <PastAppointmentCard
                        key={appointment.id}
                        appointment={appointment}
                        dateLocale={dateLocale}
                        statusColors={statusColors}
                        onReview={handleOpenReview}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="cancelled">
                {cancelledAppointments.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      {t("memberAppointments.noCancelled")}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {cancelledAppointments.map((appointment: Appointment) => (
                      <Card key={appointment.id} className="opacity-60">
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between">
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                                  <User className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div>
                                  <p className="font-medium line-through">{appointment.partner?.display_name}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {format(parseISO(appointment.appointment_date), "d. MMMM yyyy", {
                                      locale: dateLocale,
                                    })}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <Badge variant="destructive">{t("memberAppointments.status.cancelled")}</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
          </div>
        </RequireSecureMode>
      </main>

      <Footer />

      {/* Review Dialog */}
      {selectedAppointment && (
        <AppointmentReviewDialog
          open={reviewDialogOpen}
          onOpenChange={setReviewDialogOpen}
          appointmentId={selectedAppointment.id}
          partnerId={selectedAppointment.partnerId}
          partnerName={selectedAppointment.partnerName}
        />
      )}
    </div>
  );
}

// Sub-component for past appointments with review functionality
function PastAppointmentCard({
  appointment,
  dateLocale,
  statusColors,
  onReview,
  t,
}: {
  appointment: Appointment;
  dateLocale: Locale;
  statusColors: Record<string, string>;
  onReview: (appointment: Appointment) => void;
  t: (key: string) => string;
}) {
  const { data: review } = useAppointmentReview(appointment.id);
  const isCompleted = appointment.status === "completed";

  return (
    <Card className="opacity-90 hover:opacity-100 transition-opacity">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <User className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">{appointment.partner?.display_name}</p>
                <p className="text-sm text-muted-foreground">
                  {format(parseISO(appointment.appointment_date), "d. MMMM yyyy", {
                    locale: dateLocale,
                  })}
                </p>
              </div>
            </div>

            {/* Show existing review */}
            {review && (
              <div className="flex items-center gap-2 text-sm">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`h-4 w-4 ${
                        star <= review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                      }`}
                    />
                  ))}
                </div>
                {review.comment && (
                  <span className="text-muted-foreground truncate max-w-[200px]">
                    "{review.comment}"
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <Badge className={statusColors[appointment.status as keyof typeof statusColors]}>
              {t(`memberAppointments.status.${appointment.status}`)}
            </Badge>

            {isCompleted && (
              <Button
                size="sm"
                variant={review ? "outline" : "default"}
                onClick={() => onReview(appointment)}
              >
                {review ? (
                  <>
                    <MessageSquare className="h-4 w-4 mr-1" />
                    {t("memberAppointments.editReview")}
                  </>
                ) : (
                  <>
                    <Star className="h-4 w-4 mr-1" />
                    {t("memberAppointments.leaveReview")}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
