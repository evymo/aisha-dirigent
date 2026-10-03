import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { useSubmitPartnerCertification, usePartnerCertifications } from "@/hooks/usePartners";
import { useTestQuestions, useValidateTestAnswers } from "@/hooks/useTestQuestions";
import { useProcessReward } from "@/hooks/useTokens";
import { useProfileContactPrefill } from "@/hooks/useDynamicOnboarding";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { Award, Building2, User, CheckCircle2, XCircle, ChevronRight, ChevronLeft, Loader2, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeError } from "@/lib/security/safeLogger";

// Validation schema for partner profile
const partnerProfileSchema = z.object({
  display_name: z.string().trim().min(1, "Display name is required").max(100, "Display name must be less than 100 characters"),
  business_name: z.string().trim().max(150, "Business name must be less than 150 characters").optional().or(z.literal("")),
  city: z.string().trim().min(1, "City is required").max(100, "City must be less than 100 characters"),
  country: z.string().trim().max(100, "Country must be less than 100 characters"),
  email: z.string().trim().email("Invalid email format").max(255, "Email must be less than 255 characters").optional().or(z.literal("")),
  phone: z.string().trim().regex(/^$|^\+?[0-9\s\-()]{6,20}$/, "Invalid phone format").optional().or(z.literal("")),
  description: z.string().trim().max(1000, "Description must be less than 1000 characters").optional().or(z.literal("")),
  services: z.array(z.string()).optional(),
});

const PASSING_SCORE = 80;

export default function PartnerCertification() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: sessionLoading } = useSession();
  const { hasPermission } = usePermissions();
  const { data: certifications } = usePartnerCertifications();
  const submitCertification = useSubmitPartnerCertification();
  
  // Fetch questions from database (without correct answers)
  const { data: questions, isLoading: questionsLoading } = useTestQuestions("certification");
  const validateAnswers = useValidateTestAnswers();
  const processReward = useProcessReward();

  const [step, setStep] = useState<"intro" | "profile" | "test" | "results">("intro");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isProductionProvider, setIsProductionProvider] = useState(false);
  const [profileData, setProfileData] = useState({
    display_name: "",
    business_name: "",
    city: "",
    country: "Czech Republic",
    email: user?.email || "",
    phone: "",
    description: "",
    services: [] as string[],
  });
  const [results, setResults] = useState<{ score: number; passed: boolean; correctCount: number; totalQuestions: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const testTranslationKeys = useMemo(() => {
    if (!questions) return [];
    const keys = new Set<string>();
    questions.forEach((q) => {
      if (q.question_key) keys.add(q.question_key);
      if (q.option_a_key) keys.add(q.option_a_key);
      if (q.option_b_key) keys.add(q.option_b_key);
      if (q.option_c_key) keys.add(q.option_c_key);
      if (q.option_d_key) keys.add(q.option_d_key);
    });
    return Array.from(keys);
  }, [questions]);
  const testTranslations = useDynamicTranslationsMap(testTranslationKeys, "tests", "en");
  const getTestLabel = (key: string | null | undefined, fallback: string): string => {
    if (!key) return fallback;
    return testTranslations[key] || t(key);
  };

  useEffect(() => {
    if (!sessionLoading && !user) {
      navigate("/auth", { state: { from: location }, replace: true });
    }
  }, [user, sessionLoading, navigate, location]);

  const hasPassedQualification = hasPermission("view_studies");

  // Pre-fill form with profile data via hook
  const { data: profilePrefill } = useProfileContactPrefill();
  
  useEffect(() => {
    if (!user) return;

    if (profilePrefill) {
      const address = profilePrefill.address;
      setProfileData((prev) => ({
        ...prev,
        display_name: profilePrefill.display_name || prev.display_name,
        email: profilePrefill.email || user.email || prev.email,
        phone: profilePrefill.phone || prev.phone,
        city: address?.city || prev.city,
        country: address?.country || prev.country,
      }));
    } else if (user.email) {
      setProfileData((prev) => ({
        ...prev,
        email: user.email || prev.email,
      }));
    }
  }, [user, profilePrefill]);

  const passedCertification = certifications?.find((c) => c.passed);
  const hasPreviousCertification = !!passedCertification;

  if (sessionLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (!hasPassedQualification) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 py-12">
          <div className="container max-w-3xl mx-auto px-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("partnerCertification.qualificationRequired.title")}</CardTitle>
                <CardDescription>
                  {t("partnerCertification.qualificationRequired.description")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link to="/qualification-test">
                    {t("partnerCertification.qualificationRequired.goToQualification")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const handleProfileSubmit = () => {
    const result = partnerProfileSchema.safeParse(profileData);
    
    if (!result.success) {
      const firstError = result.error.errors[0];
      toast.error(t("partnerCertification.messages.fillRequired"), {
        description: firstError.message,
      });
      return;
    }
    setStep("test");
  };

  const handleAnswerSelect = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleNextQuestion = () => {
    if (!questions) return;
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      submitTest();
    }
  };

  const handlePrevQuestion = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const submitTest = async () => {
    if (!questions || questions.length === 0) return;
    
    setIsSubmitting(true);
    
    try {
      // Validate answers server-side using the secure RPC function
      const validationResult = await validateAnswers.mutateAsync({
        testType: "certification",
        answers,
      });

      const { score, passed, correct_count, total_questions } = validationResult;

      // Submit certification result
      const submission = await submitCertification.mutateAsync({
        answers,
        isProductionProvider,
        profileData,
      });

      setResults({ score, passed, correctCount: correct_count, totalQuestions: total_questions });
      setStep("results");

      if (passed) {
        const roleGranted = submission?.roleGranted ?? null;
        if (!roleGranted) {
          toast.success(t("partnerCertification.messages.congratulations"), {
            description: t("partnerCertification.messages.certificationPassed"),
          });
          return;
        }

        // Process token reward for passing certification - use role as reference
        try {
          const rewardResult = await processReward.mutateAsync({
            actionType: "certification_complete",
            referenceId: roleGranted,
          });

          const awarded = rewardResult?.amount_awarded ?? 0;
          
          if (rewardResult?.success && awarded > 0) {
            toast.success(t("partnerCertification.messages.congratulations"), {
              description: (
                <div className="flex flex-col gap-1">
                  <span>{t("partnerCertification.messages.certificationPassed")}</span>
                  <span className="flex items-center gap-1 text-sm">
                    <Coins className="w-3 h-3" />
                    {t('tokens.rewardEarned', { amount: awarded })}
                  </span>
                </div>
              ),
            });
          } else {
            toast.success(t("partnerCertification.messages.congratulations"), {
              description: t("partnerCertification.messages.certificationPassed"),
            });
          }
        } catch {
          toast.success(t("partnerCertification.messages.congratulations"), {
            description: t("partnerCertification.messages.certificationPassed"),
          });
        }
      }
    } catch (error) {
      safeError("Certification submission error", error);
      toast.error(t("common.error"), {
        description: t("partnerCertification.messages.submitError"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentQ = questions?.[currentQuestion];
  const progress = questions?.length ? ((currentQuestion + 1) / questions.length) * 100 : 0;

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 py-12">
          <div className="container max-w-2xl mx-auto px-4 text-center">
            <Card>
              <CardContent className="py-12">
                <p className="text-muted-foreground mb-4">{t("partnerCertification.loginRequired")}</p>
                <Button onClick={() => navigate("/auth")}>{t("common.signIn")}</Button>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <div className="container max-w-3xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-serif font-bold text-foreground">
              {t("partnerCertification.title")}
            </h1>
            <p className="text-muted-foreground mt-2">
              {t("partnerCertification.subtitle")}
            </p>
          </div>

          {/* Already Certified - Show Status */}
          {step === "intro" && hasPreviousCertification && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                  {t("partnerCertification.alreadyCertified.title")}
                </CardTitle>
                <CardDescription>
                  {t("partnerCertification.alreadyCertified.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-6 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-lg text-center">
                  <Award className="h-16 w-16 mx-auto mb-4 text-green-600" />
                  <h3 className="text-xl font-semibold text-green-700 dark:text-green-400 mb-2">
                    {t("partnerCertification.alreadyCertified.certified")}
                  </h3>
                  <p className="text-green-600 dark:text-green-500 mb-4">
                    {t("partnerCertification.alreadyCertified.score", { score: passedCertification?.score || 0 })}
                  </p>
                  {passedCertification?.completed_at && (
                    <p className="text-sm text-muted-foreground">
                      {t("partnerCertification.alreadyCertified.completedAt", {
                        date: new Date(passedCertification.completed_at).toLocaleDateString(i18n.language)
                      })}
                    </p>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button onClick={() => navigate("/partner/dashboard")} className="flex-1">
                    {t("partnerCertification.alreadyCertified.goToDashboard")}
                  </Button>
                  <Button variant="outline" onClick={() => navigate("/partners")} className="flex-1">
                    {t("partnerCertification.alreadyCertified.viewNetwork")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Intro Step - Only for non-certified users */}
          {step === "intro" && !hasPreviousCertification && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-6 w-6 text-primary" />
                  {t("partnerCertification.intro.title")}
                </CardTitle>
                <CardDescription>
                  {t("partnerCertification.intro.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-medium">{t("partnerCertification.intro.selectType")}</h3>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <Card
                      className={cn(
                        "cursor-pointer transition-all",
                        !isProductionProvider && "ring-2 ring-primary"
                      )}
                      onClick={() => setIsProductionProvider(false)}
                    >
                      <CardContent className="pt-6 text-center">
                        <User className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                        <h4 className="font-medium">{t("partnerCertification.types.individual.title")}</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("partnerCertification.types.individual.description")}
                        </p>
                        <Badge variant="secondary" className="mt-3">
                          {t("partnerCertification.types.individual.badge")}
                        </Badge>
                      </CardContent>
                    </Card>

                    <Card
                      className={cn(
                        "cursor-pointer transition-all",
                        isProductionProvider && "ring-2 ring-primary"
                      )}
                      onClick={() => setIsProductionProvider(true)}
                    >
                      <CardContent className="pt-6 text-center">
                        <Building2 className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                        <h4 className="font-medium">{t("partnerCertification.types.provider.title")}</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("partnerCertification.types.provider.description")}
                        </p>
                        <Badge className="mt-3">
                          {t("partnerCertification.types.provider.badge")}
                        </Badge>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-medium mb-2">{t("partnerCertification.intro.whatYouGet")}</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• {t("partnerCertification.intro.benefit1")}</li>
                    <li>• {t("partnerCertification.intro.benefit2")}</li>
                    <li>• {t("partnerCertification.intro.benefit3")}</li>
                    <li>• {t("partnerCertification.intro.benefit4")}</li>
                  </ul>
                </div>

                <Button onClick={() => setStep("profile")} className="w-full">
                  {t("partnerCertification.intro.startButton")}
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Profile Step */}
          {step === "profile" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("partnerCertification.profile.title")}</CardTitle>
                <CardDescription>
                  {t("partnerCertification.profile.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("partnerCertification.profile.displayName")} *</Label>
                    <Input
                      value={profileData.display_name}
                      onChange={(e) =>
                        setProfileData((prev) => ({ ...prev, display_name: e.target.value }))
                      }
                      placeholder={t("partnerCertification.profile.displayNamePlaceholder")}
                    />
                  </div>

                  {isProductionProvider && (
                    <div className="space-y-2">
                      <Label>{t("partnerCertification.profile.businessName")}</Label>
                      <Input
                        value={profileData.business_name}
                        onChange={(e) =>
                          setProfileData((prev) => ({ ...prev, business_name: e.target.value }))
                        }
                        placeholder={t("partnerCertification.profile.businessNamePlaceholder")}
                      />
                    </div>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("partnerCertification.profile.city")} *</Label>
                    <Input
                      value={profileData.city}
                      onChange={(e) =>
                        setProfileData((prev) => ({ ...prev, city: e.target.value }))
                      }
                      placeholder={t("partnerCertification.profile.cityPlaceholder")}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("partnerCertification.profile.country")}</Label>
                    <Input
                      value={profileData.country}
                      onChange={(e) =>
                        setProfileData((prev) => ({ ...prev, country: e.target.value }))
                      }
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("partnerCertification.profile.email")}</Label>
                    <Input
                      type="email"
                      value={profileData.email}
                      onChange={(e) =>
                        setProfileData((prev) => ({ ...prev, email: e.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("partnerCertification.profile.phone")}</Label>
                    <Input
                      value={profileData.phone}
                      onChange={(e) =>
                        setProfileData((prev) => ({ ...prev, phone: e.target.value }))
                      }
                      placeholder={t("partnerCertification.profile.phonePlaceholder")}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t("partnerCertification.profile.description")}</Label>
                  <Textarea
                    value={profileData.description}
                    onChange={(e) =>
                      setProfileData((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder={t("partnerCertification.profile.descriptionPlaceholder")}
                    rows={3}
                  />
                </div>

                <div className="space-y-3">
                  <Label>{t("partnerCertification.profile.services")}</Label>
                  <div className="grid md:grid-cols-2 gap-2">
                    {["consultation", "screening", "diagnostics", "therapy", "coaching", "education"].map(
                      (service) => (
                        <div key={service} className="flex items-center space-x-2">
                          <Checkbox
                            id={service}
                            checked={profileData.services.includes(service)}
                            onCheckedChange={(checked) => {
                              setProfileData((prev) => ({
                                ...prev,
                                services: checked
                                  ? [...prev.services, service]
                                  : prev.services.filter((s) => s !== service),
                              }));
                            }}
                          />
                          <label htmlFor={service} className="text-sm cursor-pointer">
                            {t(`partnerCertification.services.${service}`)}
                          </label>
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep("intro")}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    {t("common.back")}
                  </Button>
                  <Button onClick={handleProfileSubmit}>
                    {t("partnerCertification.profile.continueToTest")}
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Test Step */}
          {step === "test" && (
            <Card>
              {questionsLoading ? (
                <CardContent className="py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                  <p className="text-muted-foreground">{t("common.loading")}</p>
                </CardContent>
              ) : !questions || questions.length === 0 ? (
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">{t("partnerCertification.noQuestionsAvailable")}</p>
                  <Button variant="outline" onClick={() => setStep("profile")} className="mt-4">
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    {t("common.back")}
                  </Button>
                </CardContent>
              ) : currentQ ? (
                <>
                  <CardHeader>
                    <div className="flex items-center justify-between mb-4">
                      <Badge variant="outline">
                        {t("partnerCertification.test.question")} {currentQuestion + 1} / {questions.length}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {PASSING_SCORE}% {t("partnerCertification.test.toPass")}
                      </span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <h3 className="text-lg font-medium">
                      {getTestLabel(currentQ.question_key, `Question ${currentQuestion + 1}`)}
                    </h3>

                    <RadioGroup
                      value={answers[currentQ.id] || ""}
                      onValueChange={(value) => handleAnswerSelect(currentQ.id, value)}
                    >
                      {[
                        { value: "a", key: currentQ.option_a_key },
                        { value: "b", key: currentQ.option_b_key },
                        { value: "c", key: currentQ.option_c_key },
                        ...(currentQ.option_d_key
                          ? [{ value: "d", key: currentQ.option_d_key }]
                          : []),
                      ].map((option) => {
                        const optionLabel = getTestLabel(option.key, `Option ${option.value.toUpperCase()}`);
                        return (
                          <div
                            key={option.value}
                            className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50"
                          >
                            <RadioGroupItem value={option.value} id={`${currentQ.id}-${option.value}`} />
                            <label
                              htmlFor={`${currentQ.id}-${option.value}`}
                              className="flex-1 cursor-pointer"
                            >
                              {optionLabel}
                            </label>
                          </div>
                        );
                      })}
                    </RadioGroup>

                    <div className="flex justify-between">
                      <Button
                        variant="outline"
                        onClick={handlePrevQuestion}
                        disabled={currentQuestion === 0}
                      >
                        <ChevronLeft className="mr-2 h-4 w-4" />
                        {t("common.previous")}
                      </Button>
                      <Button
                        onClick={handleNextQuestion}
                        disabled={!answers[currentQ.id] || isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t("common.loading")}
                          </>
                        ) : currentQuestion < questions.length - 1 ? (
                          <>
                            {t("common.next")}
                            <ChevronRight className="ml-2 h-4 w-4" />
                          </>
                        ) : (
                          <>
                            {t("partnerCertification.test.submit")}
                            <ChevronRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </>
              ) : null}
            </Card>
          )}

          {/* Results Step */}
          {step === "results" && results && (
            <Card>
              <CardContent className="py-12 text-center">
                {results.passed ? (
                  <>
                    <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">
                      {t("partnerCertification.results.passed")}
                    </h2>
                    <p className="text-muted-foreground mb-4">
                      {t("partnerCertification.results.passedDesc", { score: results.score })}
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("partnerCertification.results.correctAnswers", {
                        correct: results.correctCount,
                        total: results.totalQuestions,
                      })}
                    </p>
                    <Badge className="mb-6">
                      {isProductionProvider
                        ? t("partnerCertification.types.provider.badge")
                        : t("partnerCertification.types.individual.badge")}
                    </Badge>
                    <div className="flex justify-center gap-4">
                      <Button variant="outline" onClick={() => navigate("/partners")}>
                        {t("partnerCertification.results.viewDirectory")}
                      </Button>
                      <Button onClick={() => navigate("/member")}>
                        {t("partnerCertification.results.goToPortal")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">
                      {t("partnerCertification.results.notPassed")}
                    </h2>
                    <p className="text-muted-foreground mb-2">
                      {t("partnerCertification.results.notPassedDesc", {
                        score: results.score,
                        required: PASSING_SCORE,
                      })}
                    </p>
                    <p className="text-sm text-muted-foreground mb-6">
                      {t("partnerCertification.results.correctAnswers", {
                        correct: results.correctCount,
                        total: results.totalQuestions,
                      })}
                    </p>
                    <Button onClick={() => {
                      setStep("intro");
                      setCurrentQuestion(0);
                      setAnswers({});
                      setResults(null);
                    }}>
                      {t("partnerCertification.results.tryAgain")}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
