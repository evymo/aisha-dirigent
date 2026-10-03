import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Armchair,
  PersonStanding,
  ShieldQuestion,
  Stethoscope,
  User,
  UserRound,
  Users,
} from "lucide-react";

const OPTION_ICON_MAP: Record<string, Record<string, LucideIcon>> = {
  registration_membership_type: {
    individual: User,
    professional: Stethoscope,
  },
  registration_gender: {
    male: User,
    female: UserRound,
    non_binary: Users,
    prefer_not_to_say: ShieldQuestion,
  },
  registration_work_activity: {
    none: Armchair,
    moderate: PersonStanding,
    high: Activity,
  },
};

/**
 * Returns a lucide icon for known registration questionnaire options.
 *
 * For all unknown options, returns null so no emoji fallback is rendered.
 */
export function getQuestionOptionIcon(blockCode: string, optionValue: string): LucideIcon | null {
  const blockIcons = OPTION_ICON_MAP[blockCode];
  if (!blockIcons) return null;
  return blockIcons[optionValue] ?? null;
}
