import { useState, useMemo } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSession } from "@/hooks/useSession";
import { useConsultantUsers, useUserTrackingData } from "@/hooks/useConsultantUsers";
import { useConsentedUsers, useStudyCohortStatistics, useStudyCohortTrends, useStudyCohortLabTrends } from "@/hooks/useDataSharingConsent";
import type { CohortTrendData, CohortLabTrendData } from "@/components/partner/CohortTrendsChart";
import { UserLongevityScoreList } from "@/components/partner/UserLongevityScoreList";
import { UserDetailCard, CohortStatisticsView, type CohortStatistics } from "./users";
import {
  Users,
  Activity,
  FileText,
  ClipboardCheck,
  ChevronRight,
  Search,
  ArrowLeft,
  ShieldCheck,
  ShieldOff,
  Lock,
  BarChart3,
} from "lucide-react";

import type { ConsultantUser } from "@/hooks/useConsultantUsers";

export default function PartnerUsers() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useSession();
  const { data: users = [], isLoading: usersLoading } = useConsultantUsers();
  const { data: consentedUserIds = [], isLoading: consentsLoading } = useConsentedUsers();
  const [selectedUser, setSelectedUser] = useState<ConsultantUser | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [studyFilter, setStudyFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"consented" | "cohort" | "longevity">("consented");
  
  const { data: healthData, isLoading: healthDataLoading } = useUserTrackingData(
    selectedUser?.user_id || null
  );

  const dateLocale = getDateFnsLocale(i18n.language);

  // Separate users by consent status
  const { consentedUsers, anonymousUsers } = useMemo(() => {
    const consentedSet = new Set(consentedUserIds);
    return {
      consentedUsers: users.filter(p => consentedSet.has(p.user_id)),
      anonymousUsers: users.filter(p => !consentedSet.has(p.user_id)),
    };
  }, [users, consentedUserIds]);

  // Get unique studies for cohort statistics
  const studyIds = useMemo(() => {
    return [...new Set(users.map(p => p.study_id))];
  }, [users]);

  const { data: cohortStatsRaw = [] } = useStudyCohortStatistics(studyIds);
  const { data: cohortTrendsRaw = [] } = useStudyCohortTrends(studyIds);
  const { data: cohortLabTrendsRaw = [] } = useStudyCohortLabTrends(studyIds);

  // Type-safe conversion of cohort data
  const cohortStats = cohortStatsRaw as CohortStatistics[];
  const cohortTrends = cohortTrendsRaw as CohortTrendData[];
  const cohortLabTrends = cohortLabTrendsRaw as CohortLabTrendData[];

  // Get unique studies for filter
  const uniqueStudies = useMemo(() => {
    const studies = new Map<string, { id: string; name: string; code: string }>();
    users.forEach(p => {
      if (!studies.has(p.study_id)) {
        studies.set(p.study_id, { id: p.study_id, name: p.study_name, code: p.study_code });
      }
    });
    return Array.from(studies.values());
  }, [users]);

  // Translations are resolved server-side in get_active_studies(p_locale).

  // Filtered consented users
  const filteredConsentedUsers = useMemo(() => {
    return consentedUsers.filter(user => {
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        user.profile?.display_name?.toLowerCase().includes(searchLower) ||
        user.study_name.toLowerCase().includes(searchLower) ||
        user.study_code.toLowerCase().includes(searchLower);
      const matchesStudy = studyFilter === "all" || user.study_id === studyFilter;
      const matchesStatus = statusFilter === "all" || user.status === statusFilter;
      return matchesSearch && matchesStudy && matchesStatus;
    });
  }, [consentedUsers, searchQuery, studyFilter, statusFilter]);

  if (authLoading || usersLoading || consentsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  const activeUsers = consentedUsers.filter(p => p.status === "active" || p.status === "enrolled");
  const completedUsers = consentedUsers.filter(p => p.status === "completed");

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-primary/10 text-primary";
      case "enrolled": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "completed": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "withdrawn": return "bg-destructive/10 text-destructive";
      case "screening": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {t("partnerUsers.title")}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t("partnerUsers.subtitle")}
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/partner/dashboard")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t("partnerUsers.backToDashboard")}
            </Button>
          </div>

          {/* Privacy Notice */}
          <Alert className="mb-6 border-primary/20 bg-primary/5">
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>{t("partnerUsers.privacyNotice.title")}</AlertTitle>
            <AlertDescription>
              {t("partnerUsers.privacyNotice.description")}
            </AlertDescription>
          </Alert>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("partnerUsers.stats.total")}
                    </p>
                    <p className="text-2xl font-semibold">{users.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-green-200 dark:border-green-900">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                    <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("partnerUsers.stats.consented")}
                    </p>
                    <p className="text-2xl font-semibold">{consentedUsers.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Lock className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("partnerUsers.stats.anonymous")}
                    </p>
                    <p className="text-2xl font-semibold">{anonymousUsers.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("partnerUsers.stats.active")}
                    </p>
                    <p className="text-2xl font-semibold">{activeUsers.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                    <ClipboardCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("partnerUsers.stats.completed")}
                    </p>
                    <p className="text-2xl font-semibold">{completedUsers.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Tabs: Consented Users vs Cohort Statistics vs Longevity Scores */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "consented" | "cohort" | "longevity")} className="space-y-6">
            <TabsList className="grid w-full grid-cols-3 max-w-lg">
              <TabsTrigger value="consented" className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                {t("partnerUsers.tabs.consented")}
                <Badge variant="secondary" className="ml-1">{consentedUsers.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="longevity" className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                {t("partnerUsers.tabs.longevity")}
              </TabsTrigger>
              <TabsTrigger value="cohort" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                {t("partnerUsers.tabs.cohort")}
              </TabsTrigger>
            </TabsList>

            {/* Consented Users Tab */}
            <TabsContent value="consented">
              {consentedUsers.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <ShieldOff className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">
                      {t("partnerUsers.noConsentedUsers.title")}
                    </h3>
                    <p className="text-muted-foreground max-w-md mx-auto">
                      {t("partnerUsers.noConsentedUsers.description")}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Filters */}
                  <Card className="mb-6">
                    <CardContent className="pt-6">
                      <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                              placeholder={t("partnerUsers.searchPlaceholder")}
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="pl-10"
                            />
                          </div>
                        </div>
                        <Select value={studyFilter} onValueChange={setStudyFilter}>
                          <SelectTrigger className="w-full md:w-[220px]">
                            <SelectValue placeholder={t("partnerUsers.filterByStudy")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t("partnerUsers.allStudies")}</SelectItem>
                            {uniqueStudies.map(study => (
                              <SelectItem key={study.id} value={study.id}>
                                {study.code} - {study.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                          <SelectTrigger className="w-full md:w-[180px]">
                            <SelectValue placeholder={t("partnerUsers.filterByStatus")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t("partnerUsers.allStatuses")}</SelectItem>
                            <SelectItem value="screening">{t("partnerUsers.status.screening")}</SelectItem>
                            <SelectItem value="enrolled">{t("partnerUsers.status.enrolled")}</SelectItem>
                            <SelectItem value="active">{t("partnerUsers.status.active")}</SelectItem>
                            <SelectItem value="completed">{t("partnerUsers.status.completed")}</SelectItem>
                            <SelectItem value="withdrawn">{t("partnerUsers.status.withdrawn")}</SelectItem>
                          </SelectContent>
                        </Select>
                        {(searchQuery || studyFilter !== "all" || statusFilter !== "all") && (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setSearchQuery("");
                              setStudyFilter("all");
                              setStatusFilter("all");
                            }}
                          >
                            {t("common.clearAll")}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {filteredConsentedUsers.length === 0 ? (
                    <Card>
                      <CardContent className="py-12 text-center">
                        <Search className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium mb-2">
                          {t("partnerUsers.noResults.title")}
                        </h3>
                        <p className="text-muted-foreground">
                          {t("partnerUsers.noResults.description")}
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid lg:grid-cols-3 gap-6 min-w-0">
                      {/* User List */}
                      <Card className="lg:col-span-1">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-green-600" />
                            {t("partnerUsers.list.title")}
                          </CardTitle>
                          <CardDescription>
                            {filteredConsentedUsers.length} {t("partnerUsers.list.count")}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                          <ScrollArea className="h-[600px]">
                            <div className="divide-y">
                              {filteredConsentedUsers.map((user) => (
                                <button
                                  key={user.registration_id}
                                  onClick={() => setSelectedUser(user)}
                                  className={`w-full p-4 text-left hover:bg-muted/50 transition-colors ${
                                    selectedUser?.registration_id === user.registration_id ? "bg-muted" : ""
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="min-w-0 flex-1">
                                      <p className="font-medium truncate">
                                        {user.profile?.display_name || t("partnerUsers.unknownUser")}
                                      </p>
                                      <p className="text-sm text-muted-foreground truncate">
                                        {user.study_code} - {user.study_name}
                                      </p>
                                      <div className="flex items-center gap-2 mt-1">
                                        <Badge className={getStatusColor(user.status)} variant="secondary">
                                          {user.status}
                                        </Badge>
                                      </div>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                  </div>
                                </button>
                              ))}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>

                      {/* User Details */}
                      <div className="lg:col-span-2">
                        {!selectedUser ? (
                          <Card className="h-full flex items-center justify-center min-h-[400px]">
                            <CardContent className="text-center py-12">
                              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                              <p className="text-muted-foreground">
                                {t("partnerUsers.selectUser")}
                              </p>
                            </CardContent>
                          </Card>
                        ) : (
                          <UserDetailCard
                            user={selectedUser}
                            trackingData={healthData ?? undefined}
                            trackingDataLoading={healthDataLoading}
                            dateLocale={dateLocale}
                            getStatusColor={getStatusColor}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* Longevity Scores Tab */}
            <TabsContent value="longevity">
              <Card>
                <CardContent className="pt-6">
                  <UserLongevityScoreList />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Cohort Statistics Tab */}
            <TabsContent value="cohort">
              <CohortStatisticsView 
                cohortStats={cohortStats}
                cohortTrends={cohortTrends}
                cohortLabTrends={cohortLabTrends}
                uniqueStudies={uniqueStudies}
                anonymousCount={anonymousUsers.length}
                totalCount={users.length}
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Footer />
    </div>
  );
}
