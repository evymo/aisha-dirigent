import { cn } from "@/lib/utils";

interface OrganicBlobProps {
  className?: string;
  variant?: "primary" | "secondary" | "accent" | "muted";
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  animate?: boolean;
  blur?: boolean;
}

const sizeMap = {
  sm: "w-32 h-32",
  md: "w-48 h-48",
  lg: "w-64 h-64",
  xl: "w-96 h-96",
  "2xl": "w-[32rem] h-[32rem]",
};

const colorMap = {
  primary: "bg-primary/10",
  secondary: "bg-secondary/10",
  accent: "bg-accent/10",
  muted: "bg-muted/30",
};

export function OrganicBlob({ 
  className,
  variant = "primary",
  size = "lg",
  animate = true,
  blur = true,
}: OrganicBlobProps) {
  return (
    <div
      className={cn(
        sizeMap[size],
        colorMap[variant],
        animate && "animate-morph-blob animate-float-slow",
        blur && "blur-3xl",
        "pointer-events-none",
        className
      )}
    />
  );
}

export function FloatingBlobs() {
  return (
    <div className="floating-elements">
      <OrganicBlob 
        variant="primary" 
        size="2xl" 
        className="absolute -top-32 -left-32" 
      />
      <OrganicBlob 
        variant="secondary" 
        size="xl" 
        className="absolute top-1/2 -right-20"
        animate
      />
      <OrganicBlob 
        variant="accent" 
        size="lg" 
        className="absolute bottom-20 left-1/4"
        animate
      />
      <OrganicBlob 
        variant="muted" 
        size="xl" 
        className="absolute -bottom-32 right-1/4"
      />
    </div>
  );
}
