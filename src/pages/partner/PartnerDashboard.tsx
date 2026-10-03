import { useEffect, useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSession } from "@/hooks/useSession";
import {
  useMyPartnerProfile,
  usePartnerAppointments,
  useUpdateAppointment,
  usePartnerCertifications,
} from "@/hooks/usePartners";
import { useConsultantStudies, useUserAlerts, useRecentUserData } from "@/hooks/usePartnerDashboard";
import { PartnerAvailabilityManager } from "@/components/partner/PartnerAvailabilityManager";
import { UnclaimedUsersPanel } from "@/components/partner/UnclaimedUsersPanel";
import { MyClientsPanel } from "@/components/partner/MyClientsPanel";
import { PartnerInvitations } from "@/components/partner/PartnerInvitations";
import { PricingSettings } from "@/components/partner/PricingSettings";
import { useSpecialistEarnings } from "@/hooks/useSpecialistEarnings";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "sonner";
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  CheckCircle,
  XCircle,
  Settings,
  Building,
  FlaskConical,
  Bell,
  Activity,
  FileText,
  Users,
  AlertCircle,
  Award,
  Heart,
  UserPlus,
  LayoutTemplate,
  Wallet,
  CreditCard,
} from "lucide-react";
import {
  partnerAppointmentArraySchema,
  parseArrayResponseSafe,
} from "@/lib/schemas/hookSchemas";
import { AppointmentCard } from "./dashboard";
import type { PartnerAppointment } from "./dashboard";

export default function PartnerDashboard() {
  const { t, i18n } = useTranslation();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useSession();
  const { data: partnerProfile, isLoading: profileLoading } = useMyPartnerProfile();
  usePartnerCertifications(); // Available for future certification display
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Note: certifications data available via usePartnerCertifications() hook if needed
  
  // Check if partner is certified for mentoring
  // IMPORTANT: Use `certification_passed_at` as single source of truth.
  // This timestamp is set by server-side RPC when certification is passed.
  // The `latestCertification?.passed` is derived data and should not be used for access control.
  const isCertified = Boolean(partnerProfile?.certification_passed_at);
  
  // Consultant data
  const { data: consultantStudies = [], isLoading: studiesLoading } = useConsultantStudies();
  const { data: userAlerts = [], isLoading: alertsLoading } = useUserAlerts();
  const { data: recentUserData = [], isLoading: _userDataLoading } = useRecentUserData();
  const [earningsPeriod, setEarningsPeriod] = useState<"month" | "quarter" | "year" | "all">("month");
  const earnings = useSpecialistEarnings(earningsPeriod);
  const earningsLoading = earnings.isLoading;
  const earningsData = {
    gross_revenue_czk: earnings.grossRevenue,
    total_earned_czk: earnings.totalEarned,
    total_projects: earnings.totalProjects,
    items: earnings.items,
  };
  
  const formattedDate = format(selectedDate, "yyyy-MM-dd");
  const { data: appointments = [], isLoading: appointmentsLoading } = usePartnerAppointments(
    partnerProfile?.id || "",
    formattedDate
  );
  
  const { data: allAppointments = [] } = usePartnerAppointments(partnerProfile?.id || "");
  const updateAppointment = useUpdateAppointment();

  const dateLocale = getDateFnsLocale(i18n.language);

  // Note: Auth redirect is handled by RequireAuth in App.tsx - this check is now handled at router level
  // Keeping certification redirect since partner access depends on profile existence (design decision)
  useEffect(() => {
    if (!profileLoading && !partnerProfile && user) {
      navigate("/partner-certification");
    }
  }, [partnerProfile, profileLoading, user, navigate]);

  const handleStatusChange = async (appointmentId: string, newStatus: "confirmed" | "cancelled" | "completed") => {
    try {
      await updateAppointment.mutateAsync({ id: appointmentId, status: newStatus });
      toast.success(t("partnerDashboard.statusUpdated"));
    } catch (error) {
      toast.error(t("partnerDashboard.statusUpdateFailed"));
    }
  };

  const typedAppointments = parseArrayResponseSafe(
    partnerAppointmentArraySchema,
    allAppointments,
    "partnerAppointments"
  ) as PartnerAppointment[];
  const pendingAppointments = typedAppointments.filter(a => a.status === "pending");
  const upcomingAppointments = typedAppointments
    .filter(a => a.status === "confirmed" && new Date(a.appointment_date) >= new Date())
    .sort((a, b) => new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime());

  // Get dates with appointments for calendar highlighting
  const appointmentDates = typedAppointments.map(a => parseISO(a.appointment_date));
  
  // Consultant stats
  const pendingStudies = consultantStudies.filter(s => s.status === "pending");
  const approvedStudies = consultantStudies.filter(s => s.status === "approved");
  const totalUsers = recentUserData.length;

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (!partnerProfile) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {t("partnerDashboard.title")}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t("partnerDashboard.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => navigate("/partner/templates")}>
                <LayoutTemplate className="w-4 h-4 mr-2" />
                {t("partnerDashboard.templates")}
              </Button>
              <Button variant="outline" onClick={() => navigate("/partner/users")}>
                <User className="w-4 h-4 mr-2" />
                {t("partnerDashboard.viewUsers")}
              </Button>
              {/* Certification Badge */}
              {partnerProfile.certification_score && (
                <Badge variant="outline" className="text-sm py-1 px-3 gap-1">
                  <Award className="w-4 h-4" />
                  {partnerProfile.certification_score}%
                </Badge>
              )}
              <Badge variant={partnerProfile.is_production_provider ? "default" : "secondary"} className="text-sm py-1 px-3">
                {partnerProfile.is_production_provider ? (
                  <Building className="w-4 h-4 mr-1" />
                ) : (
                  <User className="w-4 h-4 mr-1" />
                )}
                {partnerProfile.is_production_provider
                  ? t("partners.badges.provider")
                  : t("partners.badges.partner")}
              </Badge>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <FlaskConical className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("partnerDashboard.stats.studies")}</p>
                    <p className="text-2xl font-semibold">{approvedStudies.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-accent/50">
                    <Users className="w-5 h-5 text-accent-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("partnerDashboard.stats.users")}</p>
                    <p className="text-2xl font-semibold">{totalUsers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-warning/10">
                    <Clock className="w-5 h-5 text-warning" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("partnerDashboard.stats.pending")}</p>
                    <p className="text-2xl font-semibold">{pendingAppointments.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <CalendarIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("partnerDashboard.stats.upcoming")}</p>
                    <p className="text-2xl font-semibold">{upcomingAppointments.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <Bell className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("partnerDashboard.stats.alerts")}</p>
                    <p className="text-2xl font-semibold">{userAlerts.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-secondary/50">
                    <CheckCircle className="w-5 h-5 text-secondary-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("partnerDashboard.stats.completed")}</p>
                    <p className="text-2xl font-semibold">
                      {typedAppointments.filter(a => a.status === "completed").length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="flex-wrap">
              <TabsTrigger value="overview">{t("partnerDashboard.tabs.overview")}</TabsTrigger>
              {isCertified && (
                <TabsTrigger value="mentoring">
                  <Heart className="w-4 h-4 mr-1" />
                  {t("partnerDashboard.tabs.mentoring")}
                </TabsTrigger>
              )}
              <TabsTrigger value="studies">
                {t("partnerDashboard.tabs.studies")}
                {pendingStudies.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{pendingStudies.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="alerts">
                {t("partnerDashboard.tabs.alerts")}
                {userAlerts.length > 0 && (
                  <Badge variant="destructive" className="ml-2">{userAlerts.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="calendar">{t("partnerDashboard.tabs.calendar")}</TabsTrigger>
              <TabsTrigger value="pending">
                {t("partnerDashboard.tabs.pending")}
                {pendingAppointments.length > 0 && (
                  <Badge variant="destructive" className="ml-2">{pendingAppointments.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="availability">{t("partnerDashboard.tabs.availability")}</TabsTrigger>
              <TabsTrigger value="invitations">
                <UserPlus className="w-4 h-4 mr-1" />
                {t("partnerDashboard.tabs.invitations")}
              </TabsTrigger>
              <TabsTrigger value="earnings">
                <Wallet className="w-4 h-4 mr-1" />
                {t("partnerDashboard.tabs.earnings")}
              </TabsTrigger>
              <TabsTrigger value="pricing">
                <CreditCard className="w-4 h-4 mr-1" />
                {t("partnerDashboard.tabs.pricing")}
              </TabsTrigger>
              <TabsTrigger value="profile">{t("partnerDashboard.tabs.profile")}</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Consultant Studies Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FlaskConical className="w-5 h-5" />
                      {t("partnerDashboard.overview.studiesTitle")}
                    </CardTitle>
                    <CardDescription>{t("partnerDashboard.overview.studiesDesc")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {consultantStudies.length === 0 ? (
                      <p className="text-muted-foreground text-sm py-4">{t("partnerDashboard.overview.noStudies")}</p>
                    ) : (
                      <div className="space-y-3">
                        {consultantStudies.slice(0, 3).map(study => (
                          <div key={study.id} className="flex items-center justify-between gap-2 p-3 bg-muted/50 rounded-lg">
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{study.study_name}</p>
                              <p className="text-xs text-muted-foreground truncate">{study.study_code}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant={study.status === "approved" ? "default" : "secondary"}>
                                {study.status === "approved" ? t("common.approved") : t("common.pending")}
                              </Badge>
                              {study.status === "approved" && (
                                <span className="text-xs text-muted-foreground">
                                  {study.assigned_users} {t("partnerDashboard.overview.users")}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {consultantStudies.length > 3 && (
                          <Button variant="link" size="sm" className="w-full">
                            {t("partnerDashboard.overview.viewAll")} ({consultantStudies.length})
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Recent Alerts */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Bell className="w-5 h-5" />
                      {t("partnerDashboard.overview.alertsTitle")}
                    </CardTitle>
                    <CardDescription>{t("partnerDashboard.overview.alertsDesc")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {userAlerts.length === 0 ? (
                      <p className="text-muted-foreground text-sm py-4">{t("partnerDashboard.overview.noAlerts")}</p>
                    ) : (
                      <div className="space-y-3">
                        {userAlerts.slice(0, 4).map(alert => (
                          <div key={alert.id} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                            <div className={`p-1.5 rounded-full ${
                              alert.type === "new_lab_result" ? "bg-primary/10" : "bg-secondary/50"
                            }`}>
                              {alert.type === "new_lab_result" ? (
                                <FileText className="w-4 h-4 text-primary" />
                              ) : (
                                <Activity className="w-4 h-4 text-secondary-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{alert.user_name || t("common.unknown")}</p>
                              <p className="text-xs text-muted-foreground">{alert.message}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: dateLocale })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Upcoming Appointments Quick View */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5" />
                    {t("partnerDashboard.overview.upcomingTitle")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {upcomingAppointments.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-4">{t("partnerDashboard.upcoming.none")}</p>
                  ) : (
                    <div className="grid md:grid-cols-3 gap-3">
                      {upcomingAppointments.slice(0, 3).map(appointment => (
                        <AppointmentCard
                          key={appointment.id}
                          appointment={appointment}
                          onStatusChange={handleStatusChange}
                          showDate
                          t={t}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Mentoring Tab */}
            {isCertified && (
              <TabsContent value="mentoring" className="space-y-6">
                <UnclaimedUsersPanel />
                <MyClientsPanel />
              </TabsContent>
            )}
            
            {/* Certification Required Alert */}
            {!isCertified && (
              <TabsContent value="overview">
                <Alert className="mb-6">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    <strong>{t("partnerDashboard.mentoring.certificationRequired.title")}</strong>
                    <br />
                    {t("partnerDashboard.mentoring.certificationRequired.description")}
                    <Button 
                      variant="link" 
                      className="p-0 h-auto ml-2" 
                      onClick={() => navigate("/partner-certification")}
                    >
                      {t("partnerDashboard.mentoring.certificationRequired.cta")}
                    </Button>
                  </AlertDescription>
                </Alert>
              </TabsContent>
            )}

            {/* Studies Tab */}
            <TabsContent value="studies">
              <Card>
                <CardHeader>
                  <CardTitle>{t("partnerDashboard.studies.title")}</CardTitle>
                  <CardDescription>{t("partnerDashboard.studies.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {studiesLoading ? (
                    <div className="py-8 text-center text-muted-foreground">{t("common.loading")}</div>
                  ) : consultantStudies.length === 0 ? (
                    <div className="py-8 text-center">
                      <FlaskConical className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">{t("partnerDashboard.studies.none")}</p>
                      <Button variant="outline" className="mt-4" onClick={() => navigate("/studies")}>
                        {t("partnerDashboard.studies.browse")}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {consultantStudies.map(study => (
                        <div key={study.id} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex items-center gap-4">
                            <div className="p-2 rounded-lg bg-primary/10">
                              <FlaskConical className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{study.study_name}</p>
                              <p className="text-sm text-muted-foreground">{study.study_code} • {study.role}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-sm font-medium">{study.assigned_users}</p>
                              <p className="text-xs text-muted-foreground">{t("partnerDashboard.studies.assignedUsers")}</p>
                            </div>
                            <Badge variant={
                              study.status === "approved" ? "default" :
                              study.status === "pending" ? "secondary" : "destructive"
                            }>
                              {study.status === "approved" && <CheckCircle className="w-3 h-3 mr-1" />}
                              {study.status === "pending" && <Clock className="w-3 h-3 mr-1" />}
                              {study.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Alerts Tab */}
            <TabsContent value="alerts">
              <Card>
                <CardHeader>
                  <CardTitle>{t("partnerDashboard.alertsTab.title")}</CardTitle>
                  <CardDescription>{t("partnerDashboard.alertsTab.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {alertsLoading ? (
                    <div className="py-8 text-center text-muted-foreground">{t("common.loading")}</div>
                  ) : userAlerts.length === 0 ? (
                    <div className="py-8 text-center">
                      <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
                      <p className="text-muted-foreground">{t("partnerDashboard.alertsTab.none")}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {userAlerts.map(alert => (
                        <div key={alert.id} className="flex items-start gap-4 p-4 border rounded-lg hover:bg-muted/30 transition-colors">
                          <div className={`p-2 rounded-full ${
                            alert.type === "new_lab_result" ? "bg-primary/10" :
                            alert.type === "critical_value" ? "bg-destructive/10" : "bg-secondary/50"
                          }`}>
                            {alert.type === "new_lab_result" && <FileText className="w-5 h-5 text-primary" />}
                            {alert.type === "new_checkin" && <Activity className="w-5 h-5 text-secondary-foreground" />}
                            {alert.type === "critical_value" && <AlertCircle className="w-5 h-5 text-destructive" />}
                            {alert.type === "missed_checkin" && <XCircle className="w-5 h-5 text-warning" />}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="font-medium">{alert.user_name || t("common.unknown")}</p>
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: dateLocale })}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{alert.message}</p>
                            <Badge variant="outline" className="mt-2 text-xs">{alert.study_name}</Badge>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => navigate("/partner/users")}>
                            {t("common.view")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="calendar" className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("partnerDashboard.calendar.title")}</CardTitle>
                    <CardDescription>{t("partnerDashboard.calendar.selectDate")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => date && setSelectedDate(date)}
                      locale={dateLocale}
                      modifiers={{
                        hasAppointment: appointmentDates,
                      }}
                      modifiersStyles={{
                        hasAppointment: {
                          backgroundColor: "hsl(var(--primary) / 0.2)",
                          fontWeight: "bold",
                        },
                      }}
                      className="rounded-md border"
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      {format(selectedDate, "EEEE, d. MMMM", { locale: dateLocale })}
                    </CardTitle>
                    <CardDescription>
                      {appointments.length} {t("partnerDashboard.calendar.appointments")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {appointmentsLoading ? (
                      <div className="py-8 text-center text-muted-foreground">
                        {t("common.loading")}
                      </div>
                    ) : appointments.length === 0 ? (
                      <div className="py-8 text-center text-muted-foreground">
                        {t("partnerDashboard.calendar.noAppointments")}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {parseArrayResponseSafe(partnerAppointmentArraySchema, appointments, "appointments").map((appointment) => (
                          <AppointmentCard
                            key={appointment.id}
                            appointment={appointment}
                            onStatusChange={handleStatusChange}
                            t={t}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="pending">
              <Card>
                <CardHeader>
                  <CardTitle>{t("partnerDashboard.pending.title")}</CardTitle>
                  <CardDescription>{t("partnerDashboard.pending.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {pendingAppointments.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      {t("partnerDashboard.pending.none")}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pendingAppointments.map((appointment) => (
                        <AppointmentCard
                          key={appointment.id}
                          appointment={appointment}
                          onStatusChange={handleStatusChange}
                          showDate
                          t={t}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="upcoming">
              <Card>
                <CardHeader>
                  <CardTitle>{t("partnerDashboard.upcoming.title")}</CardTitle>
                  <CardDescription>{t("partnerDashboard.upcoming.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {upcomingAppointments.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      {t("partnerDashboard.upcoming.none")}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {upcomingAppointments.map((appointment) => (
                        <AppointmentCard
                          key={appointment.id}
                          appointment={appointment}
                          onStatusChange={handleStatusChange}
                          showDate
                          t={t}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="availability">
              <PartnerAvailabilityManager partnerId={partnerProfile.id} />
            </TabsContent>

            {/* Invitations Tab */}
            <TabsContent value="invitations">
              <PartnerInvitations />
            </TabsContent>

            {/* Earnings Tab */}
            <TabsContent value="earnings">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Wallet className="h-5 w-5" />
                        {t("delivery.earnings.title")}
                      </CardTitle>
                      <CardDescription>{t("delivery.earnings.subtitle")}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {(["month", "quarter", "year", "all"] as const).map((p) => (
                        <Button
                          key={p}
                          size="sm"
                          variant={earningsPeriod === p ? "default" : "outline"}
                          onClick={() => setEarningsPeriod(p)}
                        >
                          {t(`delivery.earnings.period.${p}`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {earningsLoading ? (
                    <div className="space-y-4">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-12 bg-muted animate-pulse rounded" />
                      ))}
                    </div>
                  ) : earningsData ? (
                    <div className="space-y-6">
                      {/* Summary Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-lg border">
                          <p className="text-sm text-muted-foreground">{t("delivery.earnings.grossRevenue")}</p>
                          <p className="text-2xl font-bold">
                            {formatPrice(earningsData.gross_revenue_czk)}
                          </p>
                        </div>
                        <div className="p-4 rounded-lg border">
                          <p className="text-sm text-muted-foreground">{t("delivery.earnings.totalEarned")}</p>
                          <p className="text-2xl font-bold text-green-600">
                            {formatPrice(earningsData.total_earned_czk)}
                          </p>
                        </div>
                        <div className="p-4 rounded-lg border">
                          <p className="text-sm text-muted-foreground">{t("delivery.earnings.totalProjects")}</p>
                          <p className="text-2xl font-bold">{earningsData.total_projects}</p>
                        </div>
                      </div>

                      {/* Earnings Table */}
                      {earningsData.items.length > 0 ? (
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-muted">
                              <tr>
                                <th className="text-left p-3 text-sm font-medium">{t("delivery.earnings.table.type")}</th>
                                <th className="text-right p-3 text-sm font-medium">{t("delivery.earnings.table.gross")}</th>
                                <th className="text-right p-3 text-sm font-medium">{t("delivery.earnings.table.net")}</th>
                                <th className="text-center p-3 text-sm font-medium">{t("delivery.earnings.table.status")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {earningsData.items.map((item) => (
                                <tr key={item.revenue_id} className="border-t">
                                  <td className="p-3 text-sm">
                                    <Badge variant="outline">{t(`delivery.earnings.type.${item.revenue_type}`)}</Badge>
                                  </td>
                                  <td className="p-3 text-sm text-right text-muted-foreground">
                                    {formatPrice(item.gross_amount)}
                                  </td>
                                  <td className="p-3 text-sm text-right font-medium">
                                    {formatPrice(item.my_split)}
                                    <span className="text-xs text-muted-foreground ml-1">({item.split_pct}%)</span>
                                  </td>
                                  <td className="p-3 text-center">
                                    <Badge variant={item.status === "completed" ? "default" : "secondary"}>
                                      {t(`delivery.earnings.status.${item.status}`)}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-center text-muted-foreground py-8">
                          {t("delivery.earnings.table.noData")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      {t("delivery.earnings.table.noData")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Pricing Tab */}
            <TabsContent value="pricing">
              <PricingSettings />
            </TabsContent>

            <TabsContent value="profile">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>{t("partnerDashboard.profile.title")}</CardTitle>
                    <CardDescription>{t("partnerDashboard.profile.description")}</CardDescription>
                  </div>
                  <Button asChild>
                    <a href="/partner/profile/edit">
                      <Settings className="mr-2 h-4 w-4" />
                      {t("partnerDashboard.profile.edit")}
                    </a>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm text-muted-foreground">{t("partnerDashboard.profile.displayName")}</p>
                        <p className="font-medium">{partnerProfile.display_name}</p>
                      </div>
                      {partnerProfile.business_name && (
                        <div>
                          <p className="text-sm text-muted-foreground">{t("partnerDashboard.profile.businessName")}</p>
                          <p className="font-medium">{partnerProfile.business_name}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-sm text-muted-foreground">{t("partnerDashboard.profile.location")}</p>
                        <p className="font-medium">{partnerProfile.city}, {partnerProfile.country}</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      {partnerProfile.email && (
                        <div>
                          <p className="text-sm text-muted-foreground">{t("partnerDashboard.profile.email")}</p>
                          <p className="font-medium">{partnerProfile.email}</p>
                        </div>
                      )}
                      {partnerProfile.phone && (
                        <div>
                          <p className="text-sm text-muted-foreground">{t("partnerDashboard.profile.phone")}</p>
                          <p className="font-medium">{partnerProfile.phone}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-sm text-muted-foreground">{t("partnerDashboard.profile.visibility")}</p>
                        <Badge variant={partnerProfile.is_visible ? "default" : "secondary"}>
                          {partnerProfile.is_visible ? t("partnerDashboard.profile.visible") : t("partnerDashboard.profile.hidden")}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {partnerProfile.description && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{t("partnerDashboard.profile.about")}</p>
                      <p className="text-foreground">{partnerProfile.description}</p>
                    </div>
                  )}
                  {partnerProfile.services && partnerProfile.services.length > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">{t("partnerDashboard.profile.services")}</p>
                      <div className="flex flex-wrap gap-2">
                        {partnerProfile.services.map((service: string) => (
                          <Badge key={service} variant="outline">{service}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Certification Status */}
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium">{t("partnerDashboard.profile.certificationScore")}</p>
                      <p className="text-sm text-muted-foreground">
                        {t("partnerDashboard.profile.certificationLevel")}: {partnerProfile.certification_level === "certified_provider" ? t("partners.badges.provider") : t("partners.badges.partner")}
                      </p>
                      {partnerProfile.certification_passed_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("partnerDashboard.profile.certifiedOn")}: {format(parseISO(partnerProfile.certification_passed_at), "PP", { locale: dateLocale })}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-2">
                        <Award className="w-6 h-6 text-primary" />
                        <p className="text-2xl font-bold text-primary">{partnerProfile.certification_score || 0}%</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Footer />
    </div>
  );
}

