import { Vote, Heart, Database, Coins } from "lucide-react";

// Token type to icon mapping
export const TOKEN_ICONS: Record<string, typeof Coins> = {
  governance: Vote,
  impact: Heart,
  data: Database,
  aisha: Coins,
};

// Token type to color class mapping
export const TOKEN_COLORS: Record<string, string> = {
  governance: "text-primary",
  impact: "text-rose-500",
  data: "text-amber-500",
  aisha: "text-green-500",
};
