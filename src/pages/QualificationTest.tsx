import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useMembership } from "@/hooks/useMembership";
import { useTestQuestions } from "@/hooks/useTestQuestions";
import { useRIIMembership } from "@/hooks/useRIIMembership";
import { useProcessReward } from "@/hooks/useTokens";
import { useSubmitQualificationTest, useSaveQualificationResponse } from "@/hooks";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { safeError } from "@/lib/security/safeLogger";
import { 
  GraduationCap, Award, CheckCircle2, XCircle, 
  ChevronRight, ChevronLeft, Clock, Target, Shield, AlertCircle, Users, Coins
} from "lucide-react";

const PASSING_SCORE = 75; // Percentage required to pass

export default function QualificationTest() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: authLoading, roles, isLoading: rolesLoading, refetchRoles } = useSession();
  const { loading: membershipLoading } = useMembership();
  const { data: questions, isLoading: questionsLoading } = useTestQuestions("qualification");
  const { isRIIMember, isRIIActive, isPendingRII, umbrellaStudyId, canTakeQualificationTest, hasCompletedQuestionnaire, isLoading: riiLoading } = useRIIMembership();
  const processReward = useProcessReward();
  const submitQualification = useSubmitQualificationTest();
  const saveQualificationResponse = useSaveQualificationResponse();

  const [testStarted, setTestStarted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showResults, setShowResults] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<{
    passed: boolean;
    score: number;
    correct_count: number;
    total_questions: number;
  } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth", { state: { from: location }, replace: true });
    }
  }, [user, authLoading, navigate, location]);

  const handleAnswer = (questionId: string, answerId: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answerId }));
  };

  const handleSubmitTest = async () => {
    if (!questions) return;
    setIsSubmitting(true);

    try {
      // Build answers in the format expected by the RPC function (question_id -> answer letter)
      const answersForRpc: Record<string, string> = {};
      Object.entries(answers).forEach(([questionId, answerId]) => {
        answersForRpc[questionId] = answerId;
      });

      // Use secure server-side function that validates answers AND assigns role if passed
      const result = await submitQualification.mutateAsync({ answers: answersForRpc });

      setTestResult({
        passed: result.passed,
        score: result.score,
        correct_count: result.correct_count,
        total_questions: result.total_questions,
      });

      // Save test results to questionnaire_responses for tracking (deterministic questionnaire UUID).
      // Best-effort: do not block the flow if storing results fails.
      let qualificationResponseId: string | null = null;
      try {
        qualificationResponseId = await saveQualificationResponse.mutateAsync({
          answers,
          score: result.score,
          passed: result.passed,
        });
      } catch (storeError) {
        safeError("QualificationTest.storeResult", storeError);
      }

      if (result.passed) {
        if (result.role_assigned) {
          await refetchRoles();
        }

        if (!qualificationResponseId) {
          toast.success(t('qualificationTest.congratulations'), {
            description: t('qualificationTest.messages.passed'),
          });
          try {
            const rewardResult = await processReward.mutateAsync({
              actionType: "qualification_test",
              referenceId: qualificationResponseId ?? undefined,
            });

            const awarded = rewardResult?.amount_awarded ?? 0;
          
            if (rewardResult?.success && awarded > 0) {
              toast.success(t('qualificationTest.congratulations'), {
                description: (
                  <div className="flex flex-col gap-1">
                    <span>{t('qualificationTest.messages.passed')}</span>
                    <span className="flex items-center gap-1 text-sm">
                      <Coins className="w-3 h-3" />
                      {t('tokens.rewardEarned', { amount: awarded })}
                    </span>
                  </div>
                ),
              });
            } else {
              toast.success(t('qualificationTest.congratulations'), {
                description: t('qualificationTest.messages.passed'),
              });
            }
          } catch {
            toast.success(t('qualificationTest.congratulations'), {
              description: t('qualificationTest.messages.passed'),
            });
          }
        }
      } else {
        toast.error(t('qualificationTest.tryAgain'), {
          description: t('qualificationTest.messages.notPassed', { score: result.score, required: PASSING_SCORE }),
        });
      }

      setShowResults(true);
    } catch (error) {
      safeError("QualificationTest.submit", error);
      toast.error(t('common.error'), {
        description: t('study.messages.errorDesc'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const questionCount = questions?.length || 0;
  const currentQ = questions?.[currentQuestion];
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
  const progress = questionCount > 0 ? ((currentQuestion + 1) / questionCount) * 100 : 0;
  const allAnswered = questions?.every((q) => answers[q.id!]) || false;

  if (authLoading || rolesLoading || membershipLoading || questionsLoading || riiLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  // Check if user already has member role (already passed)
  const isMember = roles.includes("member");

  // Check if user is enrolled in RII (required before taking test)
  // User can take test only if RII enrolled AND questionnaire completed
  const canTakeTest = canTakeQualificationTest;

  // No questions available
  if (!questions || questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 py-12">
          <div className="container max-w-3xl mx-auto px-4">
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">{t('qualificationTest.noQuestionsAvailable')}</p>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // User must be enrolled in RII AND have completed questionnaire before taking the test
  if (!canTakeTest && !isMember) {
    // Determine which step they're missing
    const needsRIIRegistration = !isRIIMember && !isPendingRII;
    const needsRIIApproval = isPendingRII;
    const needsQuestionnaire = isRIIMember && !hasCompletedQuestionnaire;
    const needsActivation = isRIIMember && hasCompletedQuestionnaire && !isRIIActive;

    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 py-12">
          <div className="container max-w-3xl mx-auto px-4">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <GraduationCap className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {t('qualificationTest.title')}
              </h1>
            </div>

            {needsRIIRegistration && (
              <>
                <Alert className="mb-6">
                  <Users className="h-4 w-4" />
                  <AlertTitle>{t('qualificationTest.riiRequired.title')}</AlertTitle>
                  <AlertDescription className="mt-2">
                    {t('qualificationTest.riiRequired.description')}
                  </AlertDescription>
                </Alert>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-muted-foreground mb-6">
                      {t('qualificationTest.riiRequired.enrollFirst')}
                    </p>
                    <Button asChild>
                      <Link to={umbrellaStudyId ? `/studies/${umbrellaStudyId}` : "/studies"}>
                        <Users className="mr-2 h-4 w-4" />
                        {t('qualificationTest.riiRequired.joinRII')}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}

            {needsRIIApproval && (
              <>
                <Alert className="mb-6">
                  <Clock className="h-4 w-4" />
                  <AlertTitle>{t('qualificationTest.pendingApproval.title')}</AlertTitle>
                  <AlertDescription className="mt-2">
                    {t('qualificationTest.pendingApproval.description')}
                  </AlertDescription>
                </Alert>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-muted-foreground">
                      {t('qualificationTest.pendingApproval.waitMessage')}
                    </p>
                  </CardContent>
                </Card>
              </>
            )}

            {needsQuestionnaire && (
              <>
                <Alert className="mb-6">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t('qualificationTest.questionnaireRequired.title')}</AlertTitle>
                  <AlertDescription className="mt-2">
                    {t('qualificationTest.questionnaireRequired.description')}
                  </AlertDescription>
                </Alert>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-muted-foreground mb-6">
                      {t('qualificationTest.questionnaireRequired.fillFirst')}
                    </p>
                    <Button asChild>
                      <Link to="/study-registration">
                        {t('qualificationTest.questionnaireRequired.fillQuestionnaire')}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}

            {needsActivation && (
              <>
                <Alert className="mb-6">
                  <Shield className="h-4 w-4" />
                  <AlertTitle>
                    {t('qualificationTest.activationRequired.title')}
                  </AlertTitle>
                  <AlertDescription className="mt-2">
                    {t('qualificationTest.activationRequired.description')}
                  </AlertDescription>
                </Alert>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <Button asChild>
                      <Link to="/member">
                        {t('qualificationTest.activationRequired.backToMember')}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
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
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <GraduationCap className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-serif font-bold text-foreground">
              {t('qualificationTest.title')}
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
              {t('qualificationTest.subtitle')}
            </p>
          </div>

          {isMember && !testStarted && !showResults && (
            <Card className="mb-6 border-secondary">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-full bg-secondary/20">
                    <CheckCircle2 className="w-6 h-6 text-secondary" />
                  </div>
                  <div>
                    <p className="font-semibold">{t('qualificationTest.alreadyQualified')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('qualificationTest.alreadyQualifiedDesc')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!testStarted && !showResults && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5" />
                  {t('qualificationTest.aboutTest')}
                </CardTitle>
                <CardDescription>
                  {t('qualificationTest.aboutTestDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <Clock className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                    <p className="font-semibold">{questionCount} {t('qualificationTest.questions')}</p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <Target className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                    <p className="font-semibold">{PASSING_SCORE}% {t('qualificationTest.toPass')}</p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <Shield className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                    <p className="font-semibold">{t('qualificationTest.noTimeLimit')}</p>
                  </div>
                </div>

                <div className="p-4 bg-muted/30 rounded-lg">
                  <h4 className="font-semibold mb-2">{t('qualificationTest.whatTestCovers')}</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• {t('qualificationTest.testTopics.basics')}</li>
                    <li>• {t('qualificationTest.testTopics.studyRules')}</li>
                    <li>• {t('qualificationTest.testTopics.membership')}</li>
                    <li>• {t('qualificationTest.testTopics.safety')}</li>
                  </ul>
                </div>

                <Button onClick={() => setTestStarted(true)} className="w-full" size="lg">
                  {t('qualificationTest.startTest')}
                  <ChevronRight className="ml-2 w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          )}

          {testStarted && !showResults && currentQ && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between mb-4">
                  <Badge variant="outline">
                    {t('qualificationTest.question')} {currentQuestion + 1} / {questionCount}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {Object.keys(answers).length} / {questionCount} {t('qualificationTest.answered')}
                  </span>
                </div>
                <Progress value={progress} className="mb-4" />
                <CardTitle className="text-lg leading-relaxed">
                  {getTestLabel(currentQ.question_key, `Question ${currentQuestion + 1}`)}
                </CardTitle>
                <CardDescription>{getTestLabel(currentQ.question_key, "")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <RadioGroup
                  value={answers[currentQ.id!] || ""}
                  onValueChange={(value) => handleAnswer(currentQ.id!, value)}
                >
                  {[
                    { id: "a", key: currentQ.option_a_key },
                    { id: "b", key: currentQ.option_b_key },
                    { id: "c", key: currentQ.option_c_key },
                    ...(currentQ.option_d_key
                      ? [{ id: "d", key: currentQ.option_d_key }]
                      : []),
                  ].map((option) => {
                    const optionText = getTestLabel(option.key, `Option ${option.id.toUpperCase()}`);
                    return (
                      <div
                        key={option.id}
                        className={`flex items-start space-x-3 p-4 rounded-lg border transition-colors cursor-pointer ${
                          answers[currentQ.id!] === option.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                        onClick={() => handleAnswer(currentQ.id!, option.id)}
                      >
                        <RadioGroupItem value={option.id} id={`${currentQ.id}-${option.id}`} />
                        <Label
                          htmlFor={`${currentQ.id}-${option.id}`}
                          className="flex-1 cursor-pointer"
                        >
                          <span className="block">{optionText}</span>
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>

                <div className="flex justify-between pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setCurrentQuestion((prev) => Math.max(0, prev - 1))}
                    disabled={currentQuestion === 0}
                  >
                    <ChevronLeft className="mr-2 w-4 h-4" />
                    {t('qualificationTest.previous')}
                  </Button>
                  
                  {currentQuestion < questionCount - 1 ? (
                    <Button
                      onClick={() => setCurrentQuestion((prev) => prev + 1)}
                      disabled={!answers[currentQ.id!]}
                    >
                      {t('qualificationTest.next')}
                      <ChevronRight className="ml-2 w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSubmitTest}
                      disabled={!allAnswered || isSubmitting}
                    >
                      {isSubmitting ? t('common.loading') : t('qualificationTest.submitTest')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {showResults && testResult && (
            <Card>
              <CardHeader className="text-center">
                <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mx-auto mb-4 ${
                  testResult.passed ? "bg-secondary/20" : "bg-destructive/20"
                }`}>
                  {testResult.passed ? (
                    <Award className="w-10 h-10 text-secondary" />
                  ) : (
                    <XCircle className="w-10 h-10 text-destructive" />
                  )}
                </div>
                <CardTitle className="text-2xl">
                  {testResult.passed
                    ? t('qualificationTest.testPassed')
                    : t('qualificationTest.testFailed')}
                </CardTitle>
                <CardDescription>
                  {testResult.passed
                    ? t('qualificationTest.passedDesc')
                    : t('qualificationTest.failedDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="text-center p-6 bg-muted/50 rounded-lg">
                  <p className="text-4xl font-bold mb-2">{testResult.score}%</p>
                  <p className="text-muted-foreground">
                    {testResult.correct_count} / {testResult.total_questions} {t('qualificationTest.correctAnswers')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {t('qualificationTest.passingScore', { score: PASSING_SCORE })}
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  {testResult.passed ? (
                    <>
                      <Button onClick={() => navigate("/member")} className="w-full">
                        {t('qualificationTest.goToMemberPortal')}
                        <ChevronRight className="ml-2 w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => navigate("/studies")}
                        className="w-full"
                      >
                        {t('qualificationTest.browseStudies')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        onClick={() => {
                          setShowResults(false);
                          setTestStarted(false);
                          setCurrentQuestion(0);
                          setAnswers({});
                          setTestResult(null);
                        }}
                        className="w-full"
                      >
                        {t('qualificationTest.retakeTest')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => navigate("/")}
                        className="w-full"
                      >
                        {t('common.backToHome')}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
