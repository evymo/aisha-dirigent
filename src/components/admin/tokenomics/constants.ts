import { TFunction } from "i18next";
import { Coins, Vote, Heart, Database, Activity, ClipboardCheck, UserPlus, Users, Trophy, Gift } from "lucide-react";
import type { TokenRewardRule } from "@/hooks/useTokenomics";

export const TOKEN_ICONS: Record<string, typeof Coins> = {
  governance: Vote,
  impact: Heart,
  data: Database,
  aisha: Coins,
};

export const TOKEN_COLORS: Record<string, string> = {
  governance: "text-primary",
  impact: "text-rose-500",
  data: "text-amber-500",
  aisha: "text-green-500",
};

// Activity templates for quick creation — display names resolved via i18n: admin.tokenomics.templates.{action_type}
export const ACTIVITY_TEMPLATES = [
  // Data & Engagement
  { action_type: "daily_checkin", token_type: "data", base_amount: 10, multiplier: 1, category: "Data & Engagement" },
  { action_type: "weekly_checkin", token_type: "data", base_amount: 50, multiplier: 1, category: "Data & Engagement" },
  { action_type: "monthly_checkin", token_type: "data", base_amount: 100, multiplier: 1, category: "Data & Engagement" },
  { action_type: "lab_result", token_type: "data", base_amount: 100, multiplier: 1, category: "Data & Engagement" },
  { action_type: "wearable_sync", token_type: "data", base_amount: 5, multiplier: 1, category: "Data & Engagement" },
  { action_type: "dosing_log", token_type: "data", base_amount: 5, multiplier: 1, category: "Data & Engagement" },
  { action_type: "profile_complete", token_type: "data", base_amount: 50, multiplier: 1, category: "Data & Engagement" },
  // Study Participation
  { action_type: "study_registration", token_type: "impact", base_amount: 100, multiplier: 1, category: "Study Participation" },
  { action_type: "study_completion", token_type: "impact", base_amount: 500, multiplier: 1.5, category: "Study Participation" },
  { action_type: "study_milestone", token_type: "impact", base_amount: 75, multiplier: 1, category: "Study Participation" },
  { action_type: "study_adherence_bonus", token_type: "impact", base_amount: 50, multiplier: 1.2, category: "Study Participation" },
  { action_type: "feedback_study", token_type: "impact", base_amount: 30, multiplier: 1, category: "Study Participation" },
  { action_type: "questionnaire_complete", token_type: "data", base_amount: 25, multiplier: 1, category: "Study Participation" },
  // Referrals & Growth
  { action_type: "referral", token_type: "impact", base_amount: 200, multiplier: 1, category: "Referrals & Growth" },
  { action_type: "referral_qualified", token_type: "impact", base_amount: 100, multiplier: 1.5, category: "Referrals & Growth" },
  { action_type: "referral_study_enrolled", token_type: "impact", base_amount: 150, multiplier: 1, category: "Referrals & Growth" },
  // Community Contribution
  { action_type: "appointment_review", token_type: "impact", base_amount: 20, multiplier: 1, category: "Community Contribution" },
  { action_type: "order_review", token_type: "impact", base_amount: 25, multiplier: 1, category: "Community Contribution" },
  { action_type: "data_sharing", token_type: "data", base_amount: 50, multiplier: 1, category: "Community Contribution" },
  { action_type: "community_contribution", token_type: "governance", base_amount: 100, multiplier: 1, category: "Community Contribution" },
  // Achievements & Milestones
  { action_type: "qualification_test", token_type: "governance", base_amount: 100, multiplier: 1, category: "Achievements" },
  { action_type: "subscription_purchase", token_type: "governance", base_amount: 50, multiplier: 1, category: "Achievements" },
  { action_type: "informed_consent", token_type: "impact", base_amount: 25, multiplier: 1, category: "Achievements" },
  { action_type: "certification_achieved", token_type: "governance", base_amount: 500, multiplier: 1, category: "Achievements" },
  { action_type: "first_lab_result", token_type: "data", base_amount: 50, multiplier: 1, category: "Achievements" },
] as const;

export type ActivityTemplate = typeof ACTIVITY_TEMPLATES[number];

export const groupedTemplates = ACTIVITY_TEMPLATES.reduce((acc, template) => {
  if (!acc[template.category]) acc[template.category] = [];
  acc[template.category].push(template);
  return acc;
}, {} as Record<string, ActivityTemplate[]>);

// Categorize rules by action_type prefix
export function categorizeRules(rules: TokenRewardRule[]) {
  const categories: Record<string, TokenRewardRule[]> = {
    "data_engagement": [],
    "study_participation": [],
    "referrals": [],
    "community": [],
    "achievements": [],
  };

  rules.forEach(rule => {
    if (rule.action_type.includes("checkin") || rule.action_type.includes("lab") || rule.action_type.includes("wearable") || rule.action_type.includes("dosing") || rule.action_type.includes("profile")) {
      categories.data_engagement.push(rule);
    } else if (rule.action_type.includes("study") || rule.action_type.includes("questionnaire") || rule.action_type.includes("feedback") || rule.action_type.includes("adherence")) {
      categories.study_participation.push(rule);
    } else if (rule.action_type.includes("referral")) {
      categories.referrals.push(rule);
    } else if (rule.action_type.includes("review") || rule.action_type.includes("data_sharing") || rule.action_type.includes("community")) {
      categories.community.push(rule);
    } else {
      categories.achievements.push(rule);
    }
  });

  // Filter out empty categories
  return Object.fromEntries(Object.entries(categories).filter(([_, rules]) => rules.length > 0));
}

export function getCategoryIcon(category: string) {
  switch (category) {
    case "data_engagement": return Activity;
    case "study_participation": return ClipboardCheck;
    case "referrals": return UserPlus;
    case "community": return Users;
    case "achievements": return Trophy;
    default: return Gift;
  }
}

export function getCategoryLabel(category: string, t: TFunction) {
  const labels: Record<string, string> = {
    data_engagement: t("admin.tokenomics.categories.dataEngagement"),
    study_participation: t("admin.tokenomics.categories.studyParticipation"),
    referrals: t("admin.tokenomics.categories.referrals"),
    community: t("admin.tokenomics.categories.community"),
    achievements: t("admin.tokenomics.categories.achievements"),
  };
  return labels[category] || category;
}

export function getCategoryDescription(category: string, t: TFunction) {
  const descriptions: Record<string, string> = {
    data_engagement: t("admin.tokenomics.categoryDesc.dataEngagement"),
    study_participation: t("admin.tokenomics.categoryDesc.studyParticipation"),
    referrals: t("admin.tokenomics.categoryDesc.referrals"),
    community: t("admin.tokenomics.categoryDesc.community"),
    achievements: t("admin.tokenomics.categoryDesc.achievements"),
  };
  return descriptions[category] || "";
}

export function getCategoryColorClass(category: string) {
  switch (category) {
    case "data_engagement": return "text-amber-500";
    case "study_participation": return "text-blue-500";
    case "referrals": return "text-green-500";
    case "community": return "text-purple-500";
    case "achievements": return "text-yellow-500";
    default: return "";
  }
}
