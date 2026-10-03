import { cn } from "@/lib/utils";

/**
 * Aisha AI assistant avatar component.
 *
 * Renders the Aisha SVG logo inside a rounded container.
 * @param size - Size variant: "sm" (24px), "md" (32px), "lg" (48px)
 * @param className - Additional CSS classes
 *
 * @example
 * <AishaAvatar size="sm" />
 * <AishaAvatar size="lg" className="ring-2 ring-primary" />
 */

interface AishaAvatarProps {
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional CSS classes for the outer container */
  className?: string;
}

const sizeMap = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-12 w-12",
} as const;

export function AishaAvatar({ size = "md", className }: AishaAvatarProps) {
  return (
    <div
      className={cn(
        "rounded-full overflow-hidden bg-primary/10 flex items-center justify-center flex-shrink-0",
        sizeMap[size],
        className,
      )}
    >
      <img
        src="/aisha.svg"
        alt="Aisha"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
