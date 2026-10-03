/**
 * DimensionIcon — Renders a lucide-react icon for assessment dimensions.
 *
 * Maps dimension icon name strings (from DIMENSION_INFO.icon) to actual
 * lucide-react components. Replaces emoji icons with consistent vector icons.
 *
 * @example
 * <DimensionIcon name="sparkles" className="h-5 w-5" />
 * <DimensionIcon name={info.icon} />
 */

import {
  Sparkles,
  Zap,
  Moon,
  Dumbbell,
  Flame,
  Shield,
  HeartHandshake,
  Brain,
  Smile,
  HelpCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  zap: Zap,
  moon: Moon,
  dumbbell: Dumbbell,
  flame: Flame,
  shield: Shield,
  "heart-handshake": HeartHandshake,
  brain: Brain,
  smile: Smile,
};

interface DimensionIconProps {
  /** Icon name from DIMENSION_INFO.icon */
  name: string;
  className?: string;
}

export function DimensionIcon({ name, className }: DimensionIconProps) {
  const IconComponent = ICON_MAP[name] ?? HelpCircle;
  return <IconComponent className={cn("h-5 w-5", className)} />;
}
