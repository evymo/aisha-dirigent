import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import {
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  Shield,
  ChevronRight,
  ChevronLeft,
  Users,
} from "lucide-react";

import { PartnerSelection } from "@/components/onboarding/PartnerSelection";
import { type CertifiedPartnerWithAvailability } from "@/hooks/useCertifiedPartners";

import { login as oidcLogin } from "@/integrations/auth";
import { useAuth } from "@/hooks/useAuth";
import { useSession } from "@/hooks/useSession";
import { useSecureMode } from "@/hooks/useSecureMode";
import { useUploadTrackingDocument, type TrackingDocumentCategory } from "@/hooks/useTrackingDocuments";
import { 
  useValidateInvitation, 
  useClaimInvitation,
} from "@/hooks/useInvitations";
import { 
  useSubmitOnboardingConsents, 
  useUpdateProfileDisplayName, 
  useCreateMyAppointment 
} from "@/hooks/useDynamicOnboarding";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Form } from "@/components/ui/form";

import {
  createBasePromoFormSchema,
  createPromoFormSchema,
  type UploadedDocument,
  type PromoFormData,
} from "./promo/promoOnboardingSchemas";
import { DocumentUploadZone } from "./promo/DocumentUploadZone";
import { DocumentCard } from "./promo/DocumentCard";
import { PromoBasicInfoStep } from "./promo/PromoBasicInfoStep";
import { PromoConsentStep } from "./promo/PromoConsentStep";

// =============================================================================
// Main Component
// =============================================================================

export default function PromoOnboarding() {
  const { code } = useParams<{ code?: string }>();
  const [searchParams] = useSearchParams();
  const inviteCode = code || searchParams.get('code') || searchParams.get('invite');

  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { user: sessionUser } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const uploadMutation = useUploadTrackingDocument();
  
  // Invitation validation via hook
  const { 
    data: inviteData, 
    isLoading: isValidating, 
    error: validationQueryError 
  } = useValidateInvitation(inviteCode);
  
  // Mutation hooks for onboarding actions
  const claimInvitation = useClaimInvitation();
  const updateDisplayName = useUpdateProfileDisplayName();
  const submitConsents = useSubmitOnboardingConsents();
  const createAppointment = useCreateMyAppointment();
  
  // Derive validation error from hook
  const validationError = validationQueryError 
    ? t("invitations.validation_error") 
    : (!inviteCode 
        ? t("promo.errors.noCode") 
        : (inviteData && !inviteData.is_valid 
            ? t("invitations.invalid_code") 
            : null));
  
  // State
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);

  // Consents
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedDataProcessing, setAgreedDataProcessing] = useState(false);
  const [agreedDataSharing, setAgreedDataSharing] = useState(false);

  // Partner selection
  const [selectedPartner, setSelectedPartner] = useState<CertifiedPartnerWithAvailability | null>(null);
  const [appointmentRequest, setAppointmentRequest] = useState<{ dayOfWeek: number; startTime: string } | null>(null);

  const isLoggedIn = !!(user || sessionUser);
  const currentUser = user || sessionUser;

  // With Keycloak, passwords are managed on the KC side.
  // Registration happens via KC login/register page, not inline.
  const requirePassword = false;

  const STEPS = [
    { id: 1, title: t("promo.steps.basicInfo") },
    { id: 2, title: t("promo.steps.documents") },
    { id: 3, title: t("promo.steps.mentor") },
    { id: 4, title: t("promo.steps.consent") },
  ];

  const promoFormSchema = useMemo(() => createPromoFormSchema(t, requirePassword), [t, requirePassword]);
  const promoFormResolver = useMemo(() => zodResolver(promoFormSchema), [promoFormSchema]);

  const form = useForm<PromoFormData>({
    resolver: promoFormResolver,
    defaultValues: {
      email: currentUser?.email || "",
      firstName: "",
      lastName: "",
      physicalState: 5,
      energyLevel: 5,
      gender: "prefer_not_to_say",
      password: "",
      confirmPassword: "",
    },
  });

  // Pre-fill from invitation data or logged-in user
  useEffect(() => {
    // Email: priority = logged in user > invited email
    if (currentUser?.email && !form.getValues("email")) {
      form.setValue("email", currentUser.email);
    } else if (inviteData?.invited_email && !form.getValues("email")) {
      form.setValue("email", inviteData.invited_email);
    }

    // Prefill name from invitation
    if (inviteData?.prefill_first_name && !form.getValues("firstName")) {
      form.setValue("firstName", inviteData.prefill_first_name);
    }
    if (inviteData?.prefill_last_name && !form.getValues("lastName")) {
      form.setValue("lastName", inviteData.prefill_last_name);
    }
  }, [currentUser, inviteData, form]);

  // ==========================================================================
  // Document handling
  // ==========================================================================
  const handleFilesSelected = useCallback((files: File[]) => {
    const newDocs: UploadedDocument[] = files.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      status: 'pending',
      category: 'lab_results' as TrackingDocumentCategory,
    }));
    setDocuments(prev => [...prev, ...newDocs]);
  }, []);

  const handleRemoveDocument = useCallback((id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id));
  }, []);

  const handleCategoryChange = useCallback((id: string, category: TrackingDocumentCategory) => {
    setDocuments(prev => prev.map(d =>
      d.id === id ? { ...d, category } : d
    ));
  }, []);

  // ==========================================================================
  // Form submission
  // ==========================================================================
  const handleSubmit = async (data: PromoFormData) => {
    if (!agreedTerms || !agreedDataProcessing || !agreedDataSharing) {
      toast.error(t("invitations.must_agree_all"));
      return;
    }

    setIsSubmitting(true);

    try {
      const userId = currentUser?.id;

      // User MUST be logged in at this point (KC handles registration).
      // If somehow not logged in, redirect to KC login with return path.
      if (!isLoggedIn || !userId) {
        const returnPath = inviteCode ? `/promo/${inviteCode}` : "/promo";
        await oidcLogin({ returnPath });
        return;
      }

      // Update display name via hook
      await updateDisplayName.mutateAsync({
        displayName: `${data.firstName} ${data.lastName}`,
      });

      // Claim invitation
      if (inviteCode && userId) {
        try {
          await claimInvitation.mutateAsync({ code: inviteCode });
        } catch (claimError) {
          safeError("PromoOnboarding.claimInvitation", claimError);
          // Continue anyway - invitation claim is not blocking
        }
      }

      // Create consents via hook — for both parent (umbrella) and child study
      if (userId) {
        // Create consents for the target study
        const studyId = inviteData?.study_id;
        if (!studyId) {
          throw new Error("Study ID is required for consent creation");
        }
        await submitConsents.mutateAsync({
          consentTypes: ["data_processing", "informed_consent"],
          studyId,
          version: "1.0",
        });

        // If there's a parent umbrella study, create consents for it too
        if (inviteData?.parent_study_id) {
          await submitConsents.mutateAsync({
            consentTypes: ["data_processing", "informed_consent", "terms", "data_sharing"],
            studyId: inviteData.parent_study_id,
            version: "1.0",
          });
        }
      }

      // Upload documents if user is authenticated with secure mode
      if (documents.length > 0 && isPhiEnabled && secureClient && userId) {
        for (const doc of documents) {
          if (doc.status === 'pending') {
            setDocuments(prev => prev.map(d =>
              d.id === doc.id ? { ...d, status: 'uploading' as const } : d
            ));

            try {
              const result = await uploadMutation.mutateAsync({
                file: doc.file,
                category: doc.category,
                title: doc.file.name.replace(/\.[^/.]+$/, ''),
              });

              setDocuments(prev => prev.map(d =>
                d.id === doc.id
                  ? { ...d, status: 'completed' as const, documentId: result.id }
                  : d
              ));
            } catch (uploadError) {
              safeError("PromoOnboarding.uploadDocument", uploadError);
              setDocuments(prev => prev.map(d =>
                d.id === doc.id
                  ? { ...d, status: 'error' as const, error: t("promo.document.uploadFailed") }
                  : d
              ));
            }
          }
        }
      }

      // Create appointment request if partner selected with availability
      if (userId && selectedPartner && appointmentRequest) {
        try {
          // Calculate requested date from day_of_week
          const today = new Date();
          const todayDayOfWeek = today.getDay();
          let daysUntilNext = appointmentRequest.dayOfWeek - todayDayOfWeek;
          if (daysUntilNext <= 0) daysUntilNext += 7; // Next week

          const requestedDate = new Date(today);
          requestedDate.setDate(today.getDate() + daysUntilNext);
          const formattedDate = format(requestedDate, 'yyyy-MM-dd');

          // Calculate end time (1 hour after start)
          const [startHour, startMin] = appointmentRequest.startTime.split(':').map(Number);
          const endHour = startHour + 1;
          const endTime = `${endHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`;

          // Use hook instead of direct RPC
          await createAppointment.mutateAsync({
            appointmentDate: formattedDate,
            appointmentType: "consultation",
            endTime: endTime,
            notes: t("promo.mentor.initialConsultationNote"),
            partnerId: selectedPartner.id,
            startTime: appointmentRequest.startTime,
          });
        } catch (appointmentErr) {
          safeError("PromoOnboarding.createAppointment", appointmentErr);
          // Non-blocking - continue even if appointment creation fails
        }
      }

      toast.success(t("promo.success.title"), {
        description: t("promo.success.description"),
      });

      navigate("/member");
    } catch (error) {
      safeError("PromoOnboarding.submit", error);
      toast.error(t("common.error"), {
        description: t("promo.errors.submit"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==========================================================================
  // Navigation
  // ==========================================================================
  const nextStep = async () => {
    if (currentStep === 1) {
      // Validate basic info fields (and password if required)
      // Use base schema with .pick() here since the full schema with refine doesn't support pick
      const baseSchema = createBasePromoFormSchema(t);

      // Build step1 fields to validate
      const step1FieldsToPick = {
        email: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
      } as const;

      const step1Schema = baseSchema.pick(step1FieldsToPick);
      const formValues = form.getValues();

      const parsed = step1Schema.safeParse(formValues);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const fieldName = issue.path[0];
          if (
            fieldName === "email" ||
            fieldName === "firstName" ||
            fieldName === "lastName" ||
            fieldName === "dateOfBirth"
          ) {
            form.setError(fieldName, {
              type: "manual",
              message: issue.message,
            });
          }
        }
        return;
      }

      // Validate password fields separately if required
      if (requirePassword) {
        const password = formValues.password;
        const confirmPassword = formValues.confirmPassword;

        if (!password || password.length < 8) {
          form.setError("password", { type: "manual", message: t("validation.passwordMin8") });
          return;
        }
        if (!/[A-Z]/.test(password)) {
          form.setError("password", { type: "manual", message: t("validation.passwordUppercase") });
          return;
        }
        if (!/[a-z]/.test(password)) {
          form.setError("password", { type: "manual", message: t("validation.passwordLowercase") });
          return;
        }
        if (!/[0-9]/.test(password)) {
          form.setError("password", { type: "manual", message: t("validation.passwordNumber") });
          return;
        }
        // eslint-disable-next-line security/detect-possible-timing-attacks -- UI confirm-field equality, not a secret comparison
        if (password !== confirmPassword) {
          form.setError("confirmPassword", { type: "manual", message: t("validation.passwordsNotMatch") });
          return;
        }
      }

      // Validate that email matches invitation email (if invitation has specific email)
      const enteredEmail = form.getValues("email")?.toLowerCase().trim();
      const invitedEmail = inviteData?.invited_email?.toLowerCase().trim();

      if (invitedEmail && enteredEmail !== invitedEmail) {
        form.setError("email", {
          type: "manual",
          message: t("promo.errors.emailMismatch"),
        });
        toast.error(t("promo.errors.emailMismatchTitle"), {
          description: t("promo.errors.emailMismatch"),
        });
        return;
      }
    }

    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // ==========================================================================
  // Loading state
  // ==========================================================================
  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Error state - no valid invitation
  // ==========================================================================
  if (validationError || !inviteData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-background to-muted/30">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>{t("common.error")}</CardTitle>
            <CardDescription>{validationError || t("promo.errors.invalidInvitation")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => navigate("/")}
              variant="outline"
              className="w-full"
            >
              {t("invitations.back_home")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ==========================================================================
  // Main render
  // ==========================================================================
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="container max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">{t("promo.title")}</h1>
              {inviteData.partner_name && (
                <p className="text-sm text-muted-foreground">
                  {t("promo.invitedBy", { name: inviteData.partner_name })}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher
                onLanguageChanged={(langCode) => {
                  const next = new URLSearchParams(searchParams);
                  next.set('lang', langCode);
                  setSearchParams(next);
                }}
              />
              <Badge variant="outline">
                {currentStep}/{STEPS.length}
              </Badge>
            </div>
          </div>

          {/* Progress */}
          <Progress
            value={(currentStep / STEPS.length) * 100}
            className="mt-3 h-1.5"
          />
        </div>
      </div>

      {/* Content */}
      <div className="container max-w-lg mx-auto px-4 py-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            {/* Step 1: Basic Info */}
            {currentStep === 1 && (
              <PromoBasicInfoStep
                form={form}
                invitedEmail={inviteData?.invited_email}
                isLoggedIn={isLoggedIn}
                requirePassword={requirePassword}
              />
            )}

            {/* Step 2: Documents */}
            {currentStep === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    {t("promo.steps.documents")}
                  </CardTitle>
                  <CardDescription>
                    {t("promo.documents.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <DocumentUploadZone
                    onFilesSelected={handleFilesSelected}
                    isUploading={isSubmitting}
                  />

                  {documents.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <p className="text-sm font-medium">
                          {t("promo.documents.uploaded")} ({documents.length})
                        </p>
                        {documents.map(doc => (
                          <DocumentCard
                            key={doc.id}
                            doc={doc}
                            onRemove={handleRemoveDocument}
                            onCategoryChange={handleCategoryChange}
                          />
                        ))}
                      </div>
                    </>
                  )}

                  <Alert>
                    <Shield className="h-4 w-4" />
                    <AlertDescription>
                      {t("promo.documents.securityNote")}
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            )}

            {/* Step 3: Mentor Selection */}
            {currentStep === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    {t("promo.steps.mentor")}
                  </CardTitle>
                  <CardDescription>
                    {t("promo.mentor.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PartnerSelection
                    onSelectPartner={(partner) => {
                      setSelectedPartner(partner);
                      // Pokud uživatel vybere partnera a ten nemá dostupnost, zrušit případný starý request
                      if (!partner?.hasAvailability) {
                        setAppointmentRequest(null);
                      }
                    }}
                    onRequestAppointment={(partner, dayOfWeek, startTime) => {
                      setSelectedPartner(partner);
                      setAppointmentRequest({ dayOfWeek, startTime });
                    }}
                    selectedPartnerId={selectedPartner?.id}
                    showAppointmentBooking={true}
                  />

                  {/* Summary of selection */}
                  {selectedPartner && (
                    <Alert className="mt-4">
                      <CheckCircle className="h-4 w-4 text-primary" />
                      <AlertDescription>
                        {appointmentRequest ? (
                          t("promo.mentor.appointmentSelected", { name: selectedPartner.display_name })
                        ) : (
                          t("promo.mentor.selected", { name: selectedPartner.display_name })
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Step 4: Consent */}
            {currentStep === 4 && (
              <PromoConsentStep
                agreedDataProcessing={agreedDataProcessing}
                agreedDataSharing={agreedDataSharing}
                agreedTerms={agreedTerms}
                documentsCount={documents.length}
                onAgreedDataProcessingChange={setAgreedDataProcessing}
                onAgreedDataSharingChange={setAgreedDataSharing}
                onAgreedTermsChange={setAgreedTerms}
              />
            )}

            {/* Navigation */}
            <div className="flex gap-3 mt-6">
              {currentStep > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={prevStep}
                  className="flex-1"
                  disabled={isSubmitting}
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  {t("common.previous")}
                </Button>
              )}

              {currentStep < STEPS.length ? (
                <Button
                  type="button"
                  onClick={nextStep}
                  className="flex-1"
                  disabled={isSubmitting}
                >
                  {t("common.next")}
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={isSubmitting || !agreedTerms || !agreedDataProcessing || !agreedDataSharing}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t("common.processing")}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {t("promo.submit")}
                    </>
                  )}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
