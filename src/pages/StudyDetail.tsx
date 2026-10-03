import { useState, useEffect } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useCurrency } from "@/hooks/useCurrency";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
// Tabs TabsContent unused currently - keeping TabsList, TabsTrigger for future use
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  useStudyDetail,
  useStudyContributions,
  useApplyAsConsultant,
  useStudyConsultants,
  useStudyRatings,
  useMyStudyRating,
  useCreateContribution,
  useSubmitStudyRating,
  useMyStudyConsultantApplication,
} from "@/hooks/useStudyFunding";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { useMyPartnerProfile } from "@/hooks/usePartners";
import { useMyRegistrations } from "@/hooks/useStudies";
import { useRIIMembership, useIsUmbrellaStudy } from "@/hooks/useRIIMembership";
import { useHasInformedConsent } from "@/hooks/useInformedConsent";

import {
  FlaskConical,
  Users,
  Calendar,
  Clock,
  Wallet,
  Star,
  MessageSquare,
  Building,
  User,
  ArrowLeft,
  CheckCircle,
  Coins,
  AlertCircle,
  Shield,
  FileSignature,
} from "lucide-react";

export default function StudyDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { baseCurrency } = useCurrency();
  const { hasPermission } = usePermissions();
  const isAuthenticated = !!user;
  const { hasInformedConsent } = useHasInformedConsent(id);
  const isQualifiedMember = hasPermission("view_studies");
  const isUmbrellaStudy = useIsUmbrellaStudy(id || "");
  const { isRIIMember, isRIIActive, isPendingRII, umbrellaStudyId, hasCompletedQuestionnaire } = useRIIMembership();
  const { data: partnerProfile } = useMyPartnerProfile();
  const { registrations, enrollInStudy } = useMyRegistrations();

  const { data: study, isLoading, error: studyError } = useStudyDetail(id || "");
  const { data: contributions = [] } = useStudyContributions(id || "");
  const { data: consultants = [] } = useStudyConsultants(id || "");
  const { data: myConsultantApplication } = useMyStudyConsultantApplication(id || "", partnerProfile?.id);
  const { data: ratings = [] } = useStudyRatings(id || "");
  const { data: myRating } = useMyStudyRating(id || "");

  // Translations are resolved server-side in get_study_detail(p_study_id, p_locale).
  // study.name / study.description already contain locale-aware values.
  const studyName = study?.name ?? "";
  const studyDescription = study?.description ?? "";

  const createContribution = useCreateContribution();
  const submitRating = useSubmitStudyRating();
  const applyAsConsultant = useApplyAsConsultant();

  const [contributeOpen, setContributeOpen] = useState(searchParams.get("contribute") === "true");
  const [ratingOpen, setRatingOpen] = useState(false);
  const [contributionType, setContributionType] = useState<"financial" | "tokens_governance" | "tokens_impact">("financial");
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionMessage, setContributionMessage] = useState("");
  const [ratingValue, setRatingValue] = useState(myRating?.rating || 5);
  const [ratingComment, setRatingComment] = useState(myRating?.comment || "");
  const [isApplyingConsultant, setIsApplyingConsultant] = useState(false);
  const [isEnrolling, setIsEnrolling] = useState(false);

  const dateLocale = getDateFnsLocale(i18n.language);

  useEffect(() => {
    if (myRating) {
      setRatingValue(myRating.rating);
      setRatingComment(myRating.comment || "");
    }
  }, [myRating]);

  const myRegistration = registrations.find(e => e.study_id === id);
  const isConsultantForStudy =
    !!myConsultantApplication && myConsultantApplication.status !== "rejected";
  const canRate =
    myRegistration &&
    ["active", "completed"].includes(myRegistration.status) &&
    !isConsultantForStudy;
  const averageRating = ratings.length > 0 
    ? ratings.reduce((acc, r) => acc + r.rating, 0) / ratings.length 
    : 0;

  const getFundingPercentage = () => {
    if (!study?.funding_goal || study.funding_goal === 0) return 100;
    return Math.min(100, (study.current_funding / study.funding_goal) * 100);
  };

  const handleContribute = async () => {
    if (!contributionAmount || parseFloat(contributionAmount) <= 0) {
      toast.error(t("studyDetail.contribute.invalidAmount"));
      return;
    }

    try {
      await createContribution.mutateAsync({
        study_id: id!,
        contribution_type: contributionType,
        amount: parseFloat(contributionAmount),
        currency: contributionType === "financial" ? baseCurrency : undefined,
        message: contributionMessage || undefined,
      });
      toast.success(t("studyDetail.contribute.success"));
      setContributeOpen(false);
      setContributionAmount("");
      setContributionMessage("");
    } catch (error) {
      toast.error(t("studyDetail.contribute.error"));
    }
  };

  const handleSubmitRating = async () => {
    try {
      await submitRating.mutateAsync({
        study_id: id!,
        registration_id: myRegistration?.id,
        rating: ratingValue,
        comment: ratingComment || undefined,
      });
      toast.success(t("studyDetail.rating.success"));
      setRatingOpen(false);
    } catch (error) {
      toast.error(t("studyDetail.rating.error"));
    }
  };

  const handleApplyAsConsultant = async () => {
    if (!partnerProfile || !id) return;
    setIsApplyingConsultant(true);
    try {
      await applyAsConsultant.mutateAsync({
        study_id: id,
        partner_id: partnerProfile.id,
        role: "consultant",
      });
      toast.success(t("studyDetail.consultant.applySuccess"));
    } catch (error) {
      toast.error(t("studyDetail.consultant.applyError"));
    } finally {
      setIsApplyingConsultant(false);
    }
  };

  const handleEnrollAsMember = async () => {
    if (!id) return;
    setIsEnrolling(true);
    try {
      const { error } = await enrollInStudy(id);
      if (error) {
        toast.error(error);
      } else {
        toast.success(t("studyDetail.registration.success"));
      }
    } catch (error) {
      toast.error(t("studyDetail.registration.error"));
    } finally {
      setIsEnrolling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (studyError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <Alert variant="destructive" className="text-left">
            <AlertTitle>{t("common.error")}</AlertTitle>
            <AlertDescription>
              {t("studyDetail.loadError")}
            </AlertDescription>
          </Alert>
          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t("common.retry")}
            </Button>
            <Button asChild>
              <Link to="/studies">{t("studyDetail.backToStudies")}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!study) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <FlaskConical className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">{t("studyDetail.notFound")}</h2>
          <Button asChild>
            <Link to="/studies">{t("studyDetail.backToStudies")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-24 pb-16">
        <div className="container max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Back link */}
          <Button variant="ghost" asChild className="mb-6">
            <Link to="/studies">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("studyDetail.backToStudies")}
            </Link>
          </Button>

          {/* Header */}
          <div className="mb-8">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge variant="outline">{study.code}</Badge>
              <Badge>{t(`studies.status.${study.funding_status}`)}</Badge>
              <Badge variant="secondary">{t(`studies.types.${study.study_type}`)}</Badge>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-4">
              {studyName}
            </h1>
            <p className="text-lg text-muted-foreground">{studyDescription}</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 min-w-0">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-8 min-w-0">
              {/* Funding Progress */}
              {study.funding_goal > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Wallet className="h-5 w-5" />
                      {t("studyDetail.funding.title")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-3xl font-bold">{study.current_funding.toLocaleString()} {t("common.currencyCzk")}</p>
                        <p className="text-muted-foreground">
                          {t("studyDetail.funding.of")} {study.funding_goal.toLocaleString()} {t("common.currencyCzk")}
                        </p>
                      </div>
                      <p className="text-lg font-semibold text-primary">
                        {Math.round(getFundingPercentage())}%
                      </p>
                    </div>
                    <Progress value={getFundingPercentage()} className="h-3" />
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{contributions.length} {t("studyDetail.funding.contributors")}</span>
                      {study.funding_deadline && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {format(new Date(study.funding_deadline), "d. MMMM yyyy", { locale: dateLocale })}
                        </span>
                      )}
                    </div>

                    {study.funding_status === "funding" && isAuthenticated && (
                      <Dialog open={contributeOpen} onOpenChange={setContributeOpen}>
                        <DialogTrigger asChild>
                          <Button className="w-full">
                            <Wallet className="mr-2 h-4 w-4" />
                            {t("studyDetail.funding.contribute")}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t("studyDetail.contribute.title")}</DialogTitle>
                            <DialogDescription>{t("studyDetail.contribute.description")}</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label>{t("studyDetail.contribute.type")}</Label>
                              <RadioGroup value={contributionType} onValueChange={(v) => setContributionType(v as typeof contributionType)}>
                                <div className="flex items-center space-x-2">
                                  <RadioGroupItem value="financial" id="financial" />
                                  <Label htmlFor="financial">{t("studyDetail.contribute.types.financial")}</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <RadioGroupItem value="tokens_governance" id="tokens_governance" />
                                  <Label htmlFor="tokens_governance">{t("studyDetail.contribute.types.governance")}</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <RadioGroupItem value="tokens_impact" id="tokens_impact" />
                                  <Label htmlFor="tokens_impact">{t("studyDetail.contribute.types.impact")}</Label>
                                </div>
                              </RadioGroup>
                            </div>
                            <div className="space-y-2">
                              <Label>{t("studyDetail.contribute.amount")}</Label>
                              <Input
                                type="number"
                                value={contributionAmount}
                                onChange={(e) => setContributionAmount(e.target.value)}
                                placeholder={contributionType === "financial" ? "1000" : "10"}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>{t("studyDetail.contribute.message")}</Label>
                              <Textarea
                                value={contributionMessage}
                                onChange={(e) => setContributionMessage(e.target.value)}
                                placeholder={t("studyDetail.contribute.messagePlaceholder")}
                              />
                            </div>
                            <Button onClick={handleContribute} className="w-full" disabled={createContribution.isPending}>
                              {createContribution.isPending ? t("common.loading") : t("studyDetail.contribute.submit")}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Ratings & Reviews */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Star className="h-5 w-5" />
                      {t("studyDetail.ratings.title")}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`h-4 w-4 ${star <= averageRating ? "fill-amber-400 text-amber-400" : "text-muted"}`}
                          />
                        ))}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        ({ratings.length})
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {canRate && (
                    <Dialog open={ratingOpen} onOpenChange={setRatingOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="w-full">
                          <MessageSquare className="mr-2 h-4 w-4" />
                          {myRating ? t("studyDetail.ratings.update") : t("studyDetail.ratings.add")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("studyDetail.ratings.dialogTitle")}</DialogTitle>
                          <DialogDescription>{t("studyDetail.ratings.dialogDescription")}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>{t("studyDetail.ratings.yourRating")}</Label>
                            <div className="flex items-center gap-2">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                  key={star}
                                  type="button"
                                  onClick={() => setRatingValue(star)}
                                  className="p-1 hover:scale-110 transition-transform"
                                >
                                  <Star
                                    className={`h-8 w-8 ${star <= ratingValue ? "fill-amber-400 text-amber-400" : "text-muted"}`}
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>{t("studyDetail.ratings.comment")}</Label>
                            <Textarea
                              value={ratingComment}
                              onChange={(e) => setRatingComment(e.target.value)}
                              placeholder={t("studyDetail.ratings.commentPlaceholder")}
                            />
                          </div>
                          <Button onClick={handleSubmitRating} className="w-full" disabled={submitRating.isPending}>
                            {submitRating.isPending ? t("common.loading") : t("studyDetail.ratings.submit")}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}

                  {ratings.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">
                      {t("studyDetail.ratings.none")}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {ratings.slice(0, 5).map((rating) => (
                        <div key={rating.id} className="border-b last:border-0 pb-4 last:pb-0">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center gap-0.5">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  className={`h-3 w-3 ${star <= rating.rating ? "fill-amber-400 text-amber-400" : "text-muted"}`}
                                />
                              ))}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(rating.created_at), "d. M. yyyy", { locale: dateLocale })}
                            </span>
                          </div>
                          {rating.comment && (
                            <p className="text-sm text-muted-foreground">{rating.comment}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Consultants */}
              {consultants.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      {t("studyDetail.consultants.title")}
                    </CardTitle>
                    <CardDescription>{t("studyDetail.consultants.description")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4">
                      {consultants.map((consultant) => (
                        <div key={consultant.id} className="flex items-center gap-4 p-3 border rounded-lg">
                          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                            {consultant.partner?.is_production_provider ? (
                              <Building className="h-6 w-6 text-primary" />
                            ) : (
                              <User className="h-6 w-6 text-primary" />
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="font-medium">{consultant.partner?.display_name}</p>
                            <p className="text-sm text-muted-foreground">{consultant.partner?.city}</p>
                          </div>
                          <Badge variant="outline">
                            {t(`studyDetail.consultants.roles.${consultant.role}`)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6 min-w-0">
              {/* Study Info */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("studyDetail.info.title")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {study.current_registration} / {study.target_registration || "∞"}
                      </p>
                      <p className="text-sm text-muted-foreground">{t("studyDetail.info.participants")}</p>
                    </div>
                  </div>
                  {study.duration_weeks && (
                    <div className="flex items-center gap-3">
                      <Calendar className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{study.duration_weeks} {t("studies.weeks")}</p>
                        <p className="text-sm text-muted-foreground">{t("studyDetail.info.duration")}</p>
                      </div>
                    </div>
                  )}
                  {study.target_condition && (
                    <div className="flex items-center gap-3 min-w-0">
                      <FlaskConical className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium break-words">{study.target_condition}</p>
                        <p className="text-sm text-muted-foreground">{t("studyDetail.info.condition")}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Actions */}
              <Card>
                <CardContent className="pt-6 space-y-3">
                  {/* Not authenticated - show sign in */}
                  {!isAuthenticated && (
                    <Button asChild className="w-full">
                      <Link to="/auth">{t("common.signIn")}</Link>
                    </Button>
                  )}

                  {/* Authenticated but not qualified - for non-umbrella studies */}
                  {isAuthenticated && !isQualifiedMember && !myRegistration && !isUmbrellaStudy && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>{t("studyDetail.qualificationRequired.title")}</AlertTitle>
                      <AlertDescription className="mt-2">
                        {t("studyDetail.qualificationRequired.description")}
                        <Button asChild variant="link" className="p-0 h-auto ml-1">
                          <Link to="/qualification-test">
                            {t("studyDetail.qualificationRequired.testLink")}
                          </Link>
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* For umbrella study - anyone authenticated can enroll (no qualification needed) */}
                  {isAuthenticated && !myRegistration && isUmbrellaStudy && (
                    <Button 
                      className="w-full" 
                      onClick={handleEnrollAsMember}
                      disabled={isEnrolling}
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      {isEnrolling ? t("common.loading") : t("studyDetail.actions.joinRII")}
                    </Button>
                  )}

                  {/* Qualified member - show registration options for specific studies */}
                  {isAuthenticated && isQualifiedMember && !myRegistration && !isUmbrellaStudy && (
                    <>
                      {/* Specific study programs - require RII membership AND informed consent */}
                      {(study.funding_status === "active" || study.funding_status === "funded" || study.funding_status === "funding") && (
                        <>
                          {!hasCompletedQuestionnaire ? (
                            <Alert>
                              <AlertCircle className="h-4 w-4" />
                              <AlertTitle>{t("studyDetail.questionnaireRequired.title")}</AlertTitle>
                              <AlertDescription className="mt-2">
                                {t("studyDetail.questionnaireRequired.description")}{" "}
                                <Button asChild variant="link" className="p-0 h-auto ml-1">
                                  <Link to="/study-registration">
                                    {t("studyDetail.questionnaireRequired.link")}
                                  </Link>
                                </Button>
                              </AlertDescription>
                            </Alert>
                          ) : !hasInformedConsent ? (
                            <Alert>
                              <FileSignature className="h-4 w-4" />
                              <AlertTitle>{t("studyDetail.consentRequired.title")}</AlertTitle>
                              <AlertDescription className="mt-2">
                                {t("studyDetail.consentRequired.description")}
                                <Button asChild variant="link" className="p-0 h-auto ml-1">
                                  <Link to={`/informed-consent?studyId=${study.id}&studyName=${encodeURIComponent(studyName)}&returnTo=${encodeURIComponent(`/studies/${study.id}`)}`}>
                                    {t("studyDetail.consentRequired.signLink")}
                                  </Link>
                                </Button>
                              </AlertDescription>
                            </Alert>
                          ) : isRIIActive ? (
                            <Button 
                              className="w-full"
                              onClick={handleEnrollAsMember}
                              disabled={isEnrolling}
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              {isEnrolling ? t("common.loading") : t("studyDetail.actions.enroll")}
                            </Button>
                          ) : (
                            <Alert>
                              <AlertCircle className="h-4 w-4" />
                              <AlertTitle>{t("studyDetail.riiRequired.title")}</AlertTitle>
                              <AlertDescription className="mt-2">
                                {t("studyDetail.riiRequired.description")}
                                <Button asChild variant="link" className="p-0 h-auto ml-1">
                                  <Link to={`/studies/${umbrellaStudyId}`}>
                                    {t("studyDetail.riiRequired.joinLink")}
                                  </Link>
                                </Button>
                              </AlertDescription>
                            </Alert>
                          )}
                        </>
                      )}

                      {/* Pending RII membership notice */}
                      {isPendingRII && !isRIIMember && (
                        <Alert>
                          <Clock className="h-4 w-4" />
                          <AlertTitle>{t("studyDetail.riiPending.title")}</AlertTitle>
                          <AlertDescription>
                            {t("studyDetail.riiPending.description")}
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  )}

                  {myRegistration && (
                    <div className={`p-3 rounded-lg text-center ${
                      myRegistration.status === "screening" 
                        ? "bg-warning/10" 
                        : myRegistration.status === "withdrawn"
                        ? "bg-destructive/10"
                        : "bg-primary/10"
                    }`}>
                      <div className="flex items-center justify-center gap-2">
                        {myRegistration.status === "screening" ? (
                          <Clock className="h-4 w-4 text-warning" />
                        ) : myRegistration.status === "withdrawn" ? (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <CheckCircle className="h-4 w-4 text-primary" />
                        )}
                        <p className={`font-medium ${
                          myRegistration.status === "screening"
                            ? "text-warning"
                            : myRegistration.status === "withdrawn"
                            ? "text-destructive"
                            : "text-primary"
                        }`}>
                          {myRegistration.status === "screening" 
                            ? t("studyDetail.registration.pending")
                            : t("studyDetail.actions.enrolled")}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {myRegistration.status === "screening"
                          ? t("studyDetail.registration.pendingDesc")
                          : t(`studies.registrationStatus.${myRegistration.status}`)}
                      </p>
                    </div>
                  )}
                  
                  {/* Partner consultant application */}
                  {partnerProfile && (() => {
                    const myConsultantApp = myConsultantApplication;
                    
                    if (!myConsultantApp) {
                      return (
                        <Button 
                          variant="outline" 
                          className="w-full"
                          onClick={handleApplyAsConsultant}
                          disabled={isApplyingConsultant}
                        >
                          <Building className="mr-2 h-4 w-4" />
                          {isApplyingConsultant ? t("common.loading") : t("studyDetail.actions.applyConsultant")}
                        </Button>
                      );
                    }
                    
                    // Show status based on approval
                    if (myConsultantApp.status === "approved") {
                      return (
                        <div className="p-3 bg-green-500/10 rounded-lg text-center">
                          <div className="flex items-center justify-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <p className="font-medium text-green-700">{t("studyDetail.consultant.approved")}</p>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {t("studyDetail.consultant.approvedDesc")}
                          </p>
                        </div>
                      );
                    }
                    
                    if (myConsultantApp.status === "rejected") {
                      return (
                        <div className="p-3 bg-destructive/10 rounded-lg text-center">
                          <div className="flex items-center justify-center gap-2">
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <p className="font-medium text-destructive">{t("studyDetail.consultant.rejected")}</p>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {t("studyDetail.consultant.rejectedDesc")}
                          </p>
                        </div>
                      );
                    }
                    
                    // Pending
                    return (
                      <div className="p-3 bg-warning/10 rounded-lg text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Clock className="h-4 w-4 text-warning" />
                          <p className="font-medium text-warning">{t("studyDetail.consultant.pending")}</p>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("studyDetail.consultant.pendingDesc")}
                        </p>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Recent Contributors */}
              {contributions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">{t("studyDetail.contributors.title")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {contributions.slice(0, 5).map((contribution) => (
                        <div key={contribution.id} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            {contribution.contribution_type === "financial" ? (
                              <Wallet className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Coins className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className="text-muted-foreground">
                              {contribution.is_anonymous ? t("studyDetail.contributors.anonymous") : t("studyDetail.contributors.member")}
                            </span>
                          </div>
                          <span className="font-medium">
                            {contribution.amount.toLocaleString()}
                            {contribution.contribution_type === "financial" ? " CZK" : " " + t(`studyDetail.contributors.tokens.${contribution.contribution_type}`)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
