/**
 * Operational Assessment Page
 * 
 * Standalone page for the Operational Tag Assessment System (CTAS).
 * Accessible from member dashboard for periodic health check-ins.
 * 
 * Route: /member/assessment
 */

import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { OperationalAssessmentWizard, PreviousScoreIndicator } from "@/components/assessment";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { LongevityScore } from "@/components/assessment/types";

export default function OperationalAssessmentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Get assessment type from URL params
  const assessmentType = (searchParams.get("type") as "onboarding" | "periodic" | "followup") ?? "periodic";
  const returnPath = searchParams.get("return") ?? "/member";

  const handleComplete = (score: LongevityScore) => {
    // Navigate to return path with score in state
    navigate(returnPath, { 
      state: { 
        assessmentCompleted: true, 
        longevityScore: score.overall,
        interpretation: score.interpretation,
      } 
    });
  };

  const handleSkip = () => {
    navigate(returnPath);
  };

  return (
    <div className="container max-w-4xl py-8">
      {/* Back button */}
      <div className="mb-6">
        <Button 
          variant="ghost" 
          onClick={() => navigate(returnPath)}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </Button>
      </div>

      {/* Previous score indicator */}
      <div className="mb-6">
        <PreviousScoreIndicator />
      </div>

      {/* Main wizard */}
      <OperationalAssessmentWizard
        assessmentType={assessmentType}
        onComplete={handleComplete}
        onSkip={handleSkip}
        showSkip={assessmentType !== "onboarding"}
        title={
          assessmentType === "onboarding" 
            ? t("assessment.onboarding.title")
            : assessmentType === "followup"
            ? t("assessment.followup.title")
            : t("assessment.periodic.title")
        }
        description={
          assessmentType === "onboarding"
            ? t("assessment.onboarding.description")
            : t("assessment.periodic.description")
        }
      />
    </div>
  );
}
