import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useMembership } from "@/hooks/useMembership";
import { User, Shield, Crown, Save, Loader2, Settings, Share2, KeyRound, Mail, Eye, Bell } from "lucide-react";
import { StudyStatusCard } from "@/components/member/StudyStatusCard";
import { DataSharingManager } from "@/components/member/DataSharingManager";
import { PrivacySettings } from "@/components/member/PrivacySettings";
import { NotificationSettings } from "@/components/member/NotificationSettings";
import { StoryLoopWorkspaceSettings } from "@/components/member/StoryLoopWorkspaceSettings";
import { RequireSecureMode } from "@/components/security/RequireSecureMode";
import { useRequestPasswordChange } from "@/hooks/useRequestPasswordChange";
import { useHasPassword } from "@/hooks/useHasPassword";
import { usePermissions } from "@/hooks/usePermissions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  MEMBER_PROFILE_DEFAULTS,
  memberProfileFormSchema,
  useMemberProfile,
  type MemberProfileFormData,
} from "@/hooks/useMemberProfile";

export default function MemberProfile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: authLoading, roleRecords } = useSession();
  const { requestPasswordChange, isLoading: isRequestingPasswordChange, isSuccess: passwordChangeRequested } = useRequestPasswordChange();
  const { hasPassword, isLoading: isLoadingPassword } = useHasPassword();
  const { profile, isLoading: profileLoading, isSaving, saveProfile } = useMemberProfile();
  const { membership, isUpgraded } = useMembership();
  const { hasPermission } = usePermissions();

  // sensitive data edit permission — if missing, health fields are read-only
  const canEditPhi = hasPermission("edit_sensitive_data");

  const form = useForm<MemberProfileFormData>({
    resolver: zodResolver(memberProfileFormSchema),
    defaultValues: MEMBER_PROFILE_DEFAULTS,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth", { state: { from: location }, replace: true });
    }
  }, [authLoading, location, navigate, user]);

  useEffect(() => {
    form.reset(profile);
  }, [form, profile]);

  const onSubmit = async (data: MemberProfileFormData) => {
    try {
      await saveProfile(data);
      toast.success(t("profile.success.saved"), {
        description: t("profile.success.savedDescription"),
      });
    } catch {
      toast.error(t("common.error"), {
        description: t("profile.errors.saveFailed"),
      });
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const membershipLabel = membership?.tier
    ? membership.tier.charAt(0).toUpperCase() + membership.tier.slice(1)
    : "Basic";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12 pt-24">
        <RequireSecureMode>
          <div className="container max-w-3xl mx-auto px-4">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="p-3 rounded-full bg-primary/10">
              <User className="w-8 h-8 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-serif font-bold">{t("profile.title")}</h1>
              <p className="text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          {/* Status Cards */}
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Crown className={`w-5 h-5 shrink-0 ${isUpgraded ? "text-amber-500" : "text-muted-foreground"}`} />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{t("profile.membership")}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {membership?.status === "active" ? t("profile.membershipActive") : t("profile.membershipInactive")}
                      </p>
                    </div>
                  </div>
                  <Badge variant={isUpgraded ? "default" : "secondary"} className="shrink-0">
                    {membershipLabel}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Shield className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{t("profile.roles")}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {roleRecords.length} {t("profile.activeRoles")}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end shrink-0 max-w-[50%]">
                    {roleRecords.map((r) => (
                      <Badge key={r.id} variant="outline" className="text-xs">
                        {r.role}
                      </Badge>
                    ))}
                    {roleRecords.length === 0 && (
                      <Badge variant="outline" className="text-xs">{t("profile.basicUser")}</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Study Status Card */}
          <div className="mb-8">
            <StudyStatusCard />
          </div>

          {/* Tabs for Profile and Data Sharing */}
          <Tabs defaultValue="profile" className="space-y-6">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="profile" className="flex items-center gap-2">
                <Settings className="w-4 h-4" />
                {t("profile.tabs.profile")}
              </TabsTrigger>
              <TabsTrigger value="privacy" className="flex items-center gap-2">
                <Eye className="w-4 h-4" />
                {t("profile.privacy.title")}
              </TabsTrigger>
              <TabsTrigger value="notifications" className="flex items-center gap-2">
                <Bell className="w-4 h-4" />
                {t("profile.tabs.notifications")}
              </TabsTrigger>
              <TabsTrigger value="account" className="flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                {t("profile.tabs.account")}
              </TabsTrigger>
              <TabsTrigger value="dataSharing" className="flex items-center gap-2">
                <Share2 className="w-4 h-4" />
                {t("dataSharing.title")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="privacy">
              <PrivacySettings />
            </TabsContent>

            <TabsContent value="notifications">
              <NotificationSettings />
            </TabsContent>

            <TabsContent value="profile">
              {/* Profile Form */}
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("profile.basicInfo.title")}</CardTitle>
                      <CardDescription>
                        {t("profile.basicInfo.description")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <FormField
                        control={form.control}
                        name="display_name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("profile.basicInfo.displayName")}</FormLabel>
                            <FormControl>
                              <Input placeholder={t("profile.basicInfo.placeholders.displayName")} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("profile.basicInfo.phone")}</FormLabel>
                              <FormControl>
                                <Input placeholder={t("profile.basicInfo.placeholders.phone")} {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="date_of_birth"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("profile.basicInfo.dateOfBirth")}</FormLabel>
                              <FormControl>
                                <Input type="date" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="gender"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("profile.basicInfo.gender")}</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder={t("profile.basicInfo.selectPlaceholder")} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="male">{t("profile.basicInfo.genderMale")}</SelectItem>
                                  <SelectItem value="female">{t("profile.basicInfo.genderFemale")}</SelectItem>
                                  <SelectItem value="other">{t("profile.basicInfo.genderOther")}</SelectItem>
                                  <SelectItem value="prefer_not_to_say">{t("profile.basicInfo.genderPreferNot")}</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="preferred_language"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("profile.basicInfo.language")}</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder={t("profile.basicInfo.selectPlaceholder")} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="cs">{t("profile.basicInfo.languageCzech")}</SelectItem>
                                  <SelectItem value="en">{t("profile.basicInfo.languageEnglish")}</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>{t("profile.trackingInfo.title")}</CardTitle>
                      <CardDescription>
                        {t("profile.trackingInfo.description")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!canEditPhi && (
                        <Alert>
                          <Shield className="w-4 h-4" />
                          <AlertDescription>
                            {t("profile.trackingInfo.readOnlyNotice")}
                          </AlertDescription>
                        </Alert>
                      )}
                      <FormField
                        control={form.control}
                        name="primary_diagnosis"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("profile.trackingInfo.primaryDiagnosis")}</FormLabel>
                            <FormControl>
                              <Input placeholder={t("profile.trackingInfo.primaryDiagnosisPlaceholder")} disabled={!canEditPhi} {...field} />
                            </FormControl>
                            <FormDescription>
                              {t("profile.trackingInfo.primaryDiagnosisDescription")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="current_medications"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("profile.trackingInfo.currentMedications")}</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={t("profile.trackingInfo.currentMedicationsPlaceholder")}
                                className="min-h-[80px]"
                                disabled={!canEditPhi}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="allergies"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("profile.trackingInfo.allergies")}</FormLabel>
                            <FormControl>
                              <Input placeholder={t("profile.trackingInfo.allergiesPlaceholder")} disabled={!canEditPhi} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="medical_history"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("profile.trackingInfo.medicalHistory")}</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={t("profile.trackingInfo.medicalHistoryPlaceholder")}
                                className="min-h-[100px]"
                                disabled={!canEditPhi}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t("profile.saving")}
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          {t("profile.saveChanges")}
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="dataSharing">
              <DataSharingManager />
            </TabsContent>

            <TabsContent value="account">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <KeyRound className="w-5 h-5" />
                      {t("profile.account.passwordTitle")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Password Status */}
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                      {isLoadingPassword ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : hasPassword ? (
                        <>
                          <Shield className="w-5 h-5 text-green-600" />
                          <div>
                            <p className="font-medium">{t("profile.account.hasPassword")}</p>
                            <p className="text-sm text-muted-foreground">
                              {t("profile.account.hasPasswordDescription")}
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <Mail className="w-5 h-5 text-amber-600" />
                          <div>
                            <p className="font-medium">{t("profile.account.noPassword")}</p>
                            <p className="text-sm text-muted-foreground">
                              {t("profile.account.noPasswordDescription")}
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Success Message */}
                    {passwordChangeRequested && (
                      <Alert className="border-green-200 bg-green-50">
                        <Mail className="w-4 h-4 text-green-600" />
                        <AlertDescription className="text-green-800">
                          {t("profile.account.passwordEmailSent")}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Security Info */}
                    <Alert>
                      <Shield className="w-4 h-4" />
                      <AlertDescription>
                        {t("profile.account.securityInfo")}
                      </AlertDescription>
                    </Alert>

                    {/* Change Password Button */}
                    <Button
                      onClick={() => requestPasswordChange()}
                      disabled={isRequestingPasswordChange || passwordChangeRequested}
                      className="w-full sm:w-auto"
                    >
                      {isRequestingPasswordChange ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t("profile.account.sendingEmail")}
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4 mr-2" />
                          {hasPassword 
                            ? t("profile.account.changePassword")
                            : t("profile.account.setPassword")
                          }
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                <StoryLoopWorkspaceSettings />
              </div>
            </TabsContent>
          </Tabs>
          </div>
        </RequireSecureMode>
      </main>

      <Footer />
    </div>
  );
}
